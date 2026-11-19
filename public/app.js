(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const badge = s => `<span class="badge b-${esc(s).replace(/ /g, '-')}">${esc(s)}</span>`;
  const show = (el, text) => { el.textContent = text; el.classList.toggle('hidden', !text); };
  async function api(url, opts) {
    let res;
    try { res = await fetch(url, opts); } catch (e) { throw new Error('Cannot reach the server. Check your connection.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  /* neighbourhoods: edit this list to match your city */
  const AREAS = ['City Centre', 'Old Town', 'North End', 'South End', 'East Side', 'West Side', 'Market Area', 'Industrial Area', 'Residential Colony'];
  $('#neighbourhood').innerHTML = '<option value="">Select a neighbourhood</option>' +
    AREAS.concat('Other').map(a => `<option>${esc(a)}</option>`).join('');

  /* issue cards */
  const ISSUES = [
    ['Roads & Potholes', 'Roads', '🛣️', '#e0e7ff', 'Damaged roads, potholes'],
    ['Streetlight Failure', 'Streetlights', '💡', '#fef9c3', 'Dark or flickering lights'],
    ['Drainage & Sewage', 'Drainage', '🚰', '#cffafe', 'Blocked drains, overflow'],
    ['Waste & Cleanliness', 'Waste', '🗑️', '#dcfce7', 'Garbage, dumping'],
    ['Water Supply', 'Water', '💧', '#dbeafe', 'Leaks, no supply'],
    ['Other Civic Issues', 'Other', '🧩', '#f3e8ff', 'Anything else public'],
  ];
  $('#issue-cards').innerHTML = ISSUES.map(([t, v, ic, bg, d]) =>
    `<button type="button" class="issue" data-cat="${v}"><span class="ic" style="background:${bg}">${ic}</span><b>${t}</b><small>${d}</small></button>`).join('');
  $('#issue-cards').addEventListener('click', e => {
    const b = e.target.closest('.issue'); if (!b) return;
    resetReport(); $('#category').value = b.dataset.cat; location.hash = '#/report';
  });

  /* router */
  const PAGES = ['home', 'report', 'track', 'public', 'about'];
  function route() {
    const p = (location.hash.replace(/^#\/?/, '') || 'home').split(/[/?]/)[0];
    const page = PAGES.includes(p) ? p : 'home';
    PAGES.forEach(n => $('#page-' + n).classList.toggle('show', n === page));
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === page));
    window.scrollTo({ top: 0 });
    if (page === 'home') loadStats();
    if (page === 'public') loadPublic();
  }
  window.addEventListener('hashchange', route);

  async function loadStats() {
    try {
      const s = await api('/api/stats');
      $('#st-total').textContent = s.total; $('#st-resolved').textContent = s.resolved; $('#st-progress').textContent = s.in_progress;
    } catch (e) { /* stats are non-critical */ }
  }

  /* neighbourhood "Other" */
  $('#neighbourhood').addEventListener('change', e => {
    const other = e.target.value === 'Other';
    $('#neighbourhood_other').classList.toggle('hidden', !other);
    if (other) $('#neighbourhood_other').focus();
  });

  /* photo validation + preview */
  const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  let photoOk = true;
  $('#photo').addEventListener('change', e => {
    const f = e.target.files[0], prev = $('#photo-preview');
    prev.classList.add('hidden'); show($('#photo-err'), ''); $('#photo-name').textContent = ''; photoOk = true;
    if (!f) return;
    const extOk = /\.(jpe?g|png|webp)$/i.test(f.name);
    if (!OK_TYPES.includes(f.type) || !extOk) { photoOk = false; show($('#photo-err'), 'Invalid file type. Choose a JPG, PNG or WEBP image.'); return; }
    if (f.size > 10 * 1024 * 1024) { photoOk = false; show($('#photo-err'), 'File is too large. The maximum size is 10 MB.'); return; }
    $('#photo-name').textContent = `Selected: ${f.name} (${(f.size / 1048576).toFixed(2)} MB)`;
    if (prev.dataset.url) URL.revokeObjectURL(prev.dataset.url);
    prev.dataset.url = URL.createObjectURL(f); prev.src = prev.dataset.url; prev.classList.remove('hidden');
  });

  /* GPS */
  $('#gps-btn').addEventListener('click', () => {
    const out = $('#gps-out'), btn = $('#gps-btn');
    out.className = 'msg info';
    if (!navigator.geolocation) { out.className = 'msg err'; out.textContent = 'This browser does not support location. You can still submit without it.'; return; }
    out.textContent = 'Waiting for your permission…'; btn.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      $('#latitude').value = pos.coords.latitude.toFixed(6); $('#longitude').value = pos.coords.longitude.toFixed(6);
      out.className = 'msg ok'; out.textContent = `Location captured: ${$('#latitude').value}, ${$('#longitude').value}`; btn.disabled = false;
    }, err => {
      $('#latitude').value = ''; $('#longitude').value = '';
      out.className = 'msg err';
      out.textContent = err.code === 1 ? 'Location permission was denied. You can still submit without GPS.'
        : err.code === 3 ? 'Location request timed out. Try again or submit without GPS.'
        : 'Location is unavailable right now. You can still submit without GPS.';
      btn.disabled = false;
    }, { enableHighAccuracy: true, timeout: 15000 });
  });

  /* submit */
  function resetReport() {
    $('#report-form').reset(); $('#report-form').classList.remove('hidden'); $('#report-success').classList.add('hidden');
    $('#neighbourhood_other').classList.add('hidden'); $('#photo-preview').classList.add('hidden');
    ['#photo-err', '#form-err', '#gps-out'].forEach(s => show($(s), '')); $('#photo-name').textContent = ''; photoOk = true;
  }
  $('#report-form').addEventListener('submit', async e => {
    e.preventDefault();
    const v = id => $(id).value.trim(), err = $('#form-err');
    const digits = v('#phone').replace(/\D/g, '');
    const problems = [
      [!v('#category'), 'Choose an issue category.', '#category'],
      [!v('#neighbourhood'), 'Choose a neighbourhood.', '#neighbourhood'],
      [v('#neighbourhood') === 'Other' && !v('#neighbourhood_other'), 'Type your neighbourhood.', '#neighbourhood_other'],
      [v('#title').length < 5, 'Enter a title of at least 5 characters.', '#title'],
      [v('#description').length < 20, 'Describe the issue in at least 20 characters.', '#description'],
      [v('#location_text').length < 3, 'Enter a street, area or landmark.', '#location_text'],
      [!photoOk, 'Fix or remove the photograph before submitting.', '#photo'],
      [v('#full_name').length < 2, 'Enter your full name.', '#full_name'],
      [!/^[+\d][\d\s-]*$/.test(v('#phone')) || digits.length < 10 || digits.length > 13, 'Enter a valid phone number (10 to 13 digits).', '#phone'],
    ].find(p => p[0]);
    if (problems) { show(err, problems[1]); $(problems[2]).focus(); return; }
    show(err, '');
    const btn = $('#submit-btn'); btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const fd = new FormData($('#report-form'));
      if (!fd.get('photo') || !fd.get('photo').size) fd.delete('photo');
      const { id } = await api('/api/complaints', { method: 'POST', body: fd });
      $('#new-id').textContent = id; $('#report-form').classList.add('hidden'); $('#report-success').classList.remove('hidden');
      $('#copy-msg').textContent = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (ex) { show(err, ex.message); }
    btn.disabled = false; btn.textContent = '🚀 Submit Complaint';
  });
  $('#copy-id').addEventListener('click', async () => {
    const id = $('#new-id').textContent;
    try { await navigator.clipboard.writeText(id); $('#copy-msg').textContent = 'Copied to clipboard.'; }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('#new-id')); getSelection().removeAllRanges(); getSelection().addRange(r); $('#copy-msg').textContent = 'Press Ctrl+C (or long-press) to copy the selected ID.'; }
  });
  $('#go-track').addEventListener('click', () => { const id = $('#new-id').textContent; resetReport(); location.hash = '#/track'; $('#track-id').value = id; doTrack(id); });
  $('#another').addEventListener('click', resetReport);

  /* track */
  async function doTrack(id) {
    const err = $('#track-err'), box = $('#track-result');
    show(err, ''); box.classList.add('hidden');
    if (!id.trim()) { show(err, 'Enter your complaint ID.'); return; }
    try {
      const c = await api('/api/complaints/' + encodeURIComponent(id.trim()));
      const idx = ['Reported', 'In Progress', 'Resolved'].indexOf(c.status);
      const steps = ['Reported', 'In Progress', 'Resolved'].map((s, i) => `<div class="step ${i <= idx ? 'done' : ''}"><i>${i <= idx ? '✓' : i + 1}</i>${s}</div>`).join('');
      box.innerHTML = `<h2>${esc(c.title)} ${badge(c.status)}</h2>
        <div class="progress"><div class="fill" style="width:${idx * 42}%"></div>${steps}</div>
        <dl class="det"><dt>Complaint ID</dt><dd>${esc(c.id)}</dd><dt>Category</dt><dd>${esc(c.category)}</dd>
        <dt>Location</dt><dd>${esc(c.neighbourhood)} – ${esc(c.location_text)}</dd><dt>Submitted</dt><dd>${fmtDate(c.created_at)}</dd>
        <dt>Last updated</dt><dd>${fmtDate(c.updated_at)}</dd><dt>Details</dt><dd>${esc(c.description)}</dd></dl>`;
      box.classList.remove('hidden');
    } catch (ex) { show(err, ex.message); }
  }
  $('#track-form').addEventListener('submit', e => { e.preventDefault(); doTrack($('#track-id').value); });

  /* public issues */
  let timer;
  async function loadPublic() {
    const q = new URLSearchParams({ search: $('#f-search').value, category: $('#f-cat').value, status: $('#f-status').value });
    const list = $('#public-list');
    try {
      const rows = await api('/api/complaints/public?' + q);
      show($('#public-err'), '');
      list.innerHTML = rows.length ? rows.map(c => `<article class="pcard"><h3>${esc(c.title)}</h3>
        <div class="meta"><span class="chip">${esc(c.category)}</span><span class="chip">${esc(c.neighbourhood)}</span>${badge(c.status)}</div>
        <small>📍 ${esc(c.location_text)}</small><p>${esc(c.description.length > 220 ? c.description.slice(0, 220) + '…' : c.description)}</p>
        <small>Submitted ${fmtDate(c.created_at)}</small></article>`).join('')
        : '<div class="empty" style="grid-column:1/-1">No issues match. Try different filters, or <a href="#/report">report a new issue</a>.</div>';
    } catch (ex) { list.innerHTML = ''; show($('#public-err'), ex.message); }
  }
  $('#f-search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadPublic, 300); });
  $('#f-cat').addEventListener('change', loadPublic); $('#f-status').addEventListener('change', loadPublic);

  route();
})();
