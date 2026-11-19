-- Public complaint data (safe to show publicly)
CREATE TABLE IF NOT EXISTS complaints (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL CHECK (category IN ('Roads','Streetlights','Drainage','Waste','Water','Other')),
  neighbourhood TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  location_text TEXT NOT NULL,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  status        TEXT NOT NULL DEFAULT 'Reported' CHECK (status IN ('Reported','In Progress','Resolved')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Private citizen contact details: only ever read by admin endpoints
CREATE TABLE IF NOT EXISTS complaint_contacts (
  complaint_id TEXT PRIMARY KEY REFERENCES complaints(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  phone        TEXT NOT NULL
);
-- Photos (validated JPG/PNG/WEBP, max 10 MB) stored in the database; served to admins only
CREATE TABLE IF NOT EXISTS complaint_photos (
  complaint_id TEXT PRIMARY KEY REFERENCES complaints(id) ON DELETE CASCADE,
  mime         TEXT NOT NULL,
  filename     TEXT,
  data         BYTEA NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints (created_at DESC);
