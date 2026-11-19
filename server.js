require('dotenv').config();
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const { DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET } = process.env;
if (!DATABASE_URL || !ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error('Missing DATABASE_URL, ADMIN_PASSWORD or SESSION_SECRET. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const CATEGORIES = ['Roads', 'Streetlights', 'Drainage', 'Waste', 'Water', 'Other'];
const STATUSES = ['Reported', 'In Progress', 'Resolved'];
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const rec = (hits.get(req.ip) || []).filter(t => now - t < windowMs);
    if (rec.length >= max) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    rec.push(now); hits.set(req.ip, rec); next();
  };
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const sign = p => crypto.createHmac('sha256', SESSION_SECRET).update(p).digest('base64url');
function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 3600e3 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function requireAdmin(req, res, next) {
  const [payload, sig] = (req.get('authorization') || '').replace('Bearer ', '').split('.');
  try {
    if (payload && sig && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload))) &&
        JSON.parse(Buffer.from(payload, 'base64url')).exp > Date.now()) return next();
  } catch (e) { /* fall through */ }
  res.status(401).json({ error: 'Admin login required.' });
}
function detectImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
function newId() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += abc[crypto.randomInt(abc.length)];
  return `CC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${s}`;
}
const PUBLIC_COLS = 'id, category, neighbourhood, title, description, location_text, status, created_at, updated_at';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const handleUpload = (req, res, next) => upload.single('photo')(req, res, err => {
  if (!err) return next();
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photograph must be 10 MB or smaller.' : 'Photo upload failed.' });
});

/* ---------- health check ---------- */
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'CivicCare' });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'Database unavailable.' });
  }
});

/* ---------- public API ---------- */
app.post('/api/complaints', rateLimit(10, 15 * 60e3), handleUpload, async (req, res) => {
  const b = req.body, errors = [];
  const t = k => String(b[k] || '').trim();
  const category = t('category');
  let neighbourhood = t('neighbourhood');
  if (!CATEGORIES.includes(category)) errors.push('Choose an issue category.');
  if (!neighbourhood) errors.push('Choose a neighbourhood.');
  if (neighbourhood === 'Other') neighbourhood = t('neighbourhood_other');
  if (!neighbourhood || neighbourhood.length > 80) errors.push('Type your neighbourhood (up to 80 characters).');
  if (t('title').length < 5 || t('title').length > 120) errors.push('Title must be 5 to 120 characters.');
  if (t('description').length < 20 || t('description').length > 2000) errors.push('Description must be 20 to 2000 characters.');
  if (t('location_text').length < 3 || t('location_text').length > 200) errors.push('Enter a street, area or landmark.');
  if (t('full_name').length < 2 || t('full_name').length > 80) errors.push('Enter your full name.');
  const digits = t('phone').replace(/\D/g, '');
  if (!/^[+\d][\d\s-]*$/.test(t('phone')) || digits.length < 10 || digits.length > 13) errors.push('Enter a valid phone number (10 to 13 digits).');
  let lat = null, lng = null;
  if (t('latitude') || t('longitude')) {
    lat = Number(t('latitude')); lng = Number(t('longitude'));
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) errors.push('GPS coordinates are invalid.');
  }
  let mime = null;
  if (req.file) {
    mime = detectImage(req.file.buffer);
    if (!mime) errors.push('Photograph must be a real JPG, PNG or WEBP image.');
  }
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const client = await pool.connect();
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO complaints (id, category, neighbourhood, title, description, location_text, latitude, longitude)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, category, neighbourhood, t('title'), t('description'), t('location_text'), lat, lng]);
        await client.query('INSERT INTO complaint_contacts (complaint_id, full_name, phone) VALUES ($1,$2,$3)', [id, t('full_name'), t('phone')]);
        if (req.file) await client.query('INSERT INTO complaint_photos (complaint_id, mime, filename, data) VALUES ($1,$2,$3,$4)',
          [id, mime, (req.file.originalname || 'photo').slice(0, 120), req.file.buffer]);
        await client.query('COMMIT');
        return res.status(201).json({ id });
      } catch (e) {
        await client.query('ROLLBACK');
        if (e.code !== '23505') throw e;
      }
    }
    throw new Error('Could not generate a unique ID');
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save your complaint. Please try again.' });
  } finally { client.release(); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const r = await pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status='Resolved')::int AS resolved,
      count(*) FILTER (WHERE status='In Progress')::int AS in_progress FROM complaints`);
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load statistics.' }); }
});

app.get('/api/complaints/public', async (req, res) => {
  const where = [], vals = [];
  const { search, category, status } = req.query;
  if (CATEGORIES.includes(category)) { vals.push(category); where.push(`category = $${vals.length}`); }
  if (STATUSES.includes(status)) { vals.push(status); where.push(`status = $${vals.length}`); }
  if (search && String(search).trim()) {
    vals.push('%' + String(search).trim().slice(0, 80).replace(/[%_\\]/g, '\\$&') + '%');
    where.push(`(title ILIKE $${vals.length} OR description ILIKE $${vals.length} OR location_text ILIKE $${vals.length} OR neighbourhood ILIKE $${vals.length})`);
  }
  try {
    const r = await pool.query(`SELECT ${PUBLIC_COLS} FROM complaints ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`, vals);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load complaints.' }); }
});

app.get('/api/complaints/:id', rateLimit(60, 60e3), async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${PUBLIC_COLS} FROM complaints WHERE id = $1`, [req.params.id.trim().toUpperCase()]);
    if (!r.rows[0]) return res.status(404).json({ error: 'No complaint found with that ID. Check it and try again.' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not look up the complaint.' }); }
});

/* ---------- admin API ---------- */
app.post('/api/admin/login', rateLimit(8, 15 * 60e3), (req, res) => {
  if (crypto.timingSafeEqual(sha(req.body && req.body.password), sha(ADMIN_PASSWORD))) return res.json({ token: makeToken() });
  res.status(401).json({ error: 'Incorrect password.' });
});

app.get('/api/admin/complaints', requireAdmin, async (req, res) => {
  const where = [], vals = [];
  const { search, category, status } = req.query;
  if (CATEGORIES.includes(category)) { vals.push(category); where.push(`c.category = $${vals.length}`); }
  if (STATUSES.includes(status)) { vals.push(status); where.push(`c.status = $${vals.length}`); }
  if (search && String(search).trim()) {
    vals.push('%' + String(search).trim().slice(0, 80).replace(/[%_\\]/g, '\\$&') + '%');
    where.push(`(c.id ILIKE $${vals.length} OR c.title ILIKE $${vals.length} OR c.description ILIKE $${vals.length} OR c.location_text ILIKE $${vals.length} OR k.full_name ILIKE $${vals.length})`);
  }
  try {
    const r = await pool.query(`SELECT c.*, k.full_name, k.phone, (p.complaint_id IS NOT NULL) AS has_photo
      FROM complaints c LEFT JOIN complaint_contacts k ON k.complaint_id = c.id LEFT JOIN complaint_photos p ON p.complaint_id = c.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.created_at DESC LIMIT 500`, vals);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load complaints.' }); }
});

app.patch('/api/admin/complaints/:id/status', requireAdmin, async (req, res) => {
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const r = await pool.query('UPDATE complaints SET status=$1, updated_at=now() WHERE id=$2 RETURNING id, status', [status, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Complaint not found.' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not update status.' }); }
});

app.get('/api/admin/complaints/:id/photo', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT mime, data FROM complaint_photos WHERE complaint_id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'No photograph.' });
    res.type(r.rows[0].mime).set('Cache-Control', 'private, max-age=300').send(r.rows[0].data);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load photograph.' }); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* ---------- start ---------- */
(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`CivicCare running on http://localhost:${port}`));
  } catch (e) { console.error('Database connection failed:', e.message); process.exit(1); }
})();
