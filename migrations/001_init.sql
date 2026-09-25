-- 001_init: core schema for OnPost
-- IDs are generated in the application (crypto.randomUUID) as TEXT.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'officer'
                CHECK (role IN ('master', 'supervisor', 'officer')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  archived   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which sites an officer is assigned to. Masters/supervisors implicitly
-- have access to every site.
CREATE TABLE user_sites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);

-- Standing post orders per site. One row per site; carried over day to day.
-- Only a Master may edit these.
CREATE TABLE post_orders (
  site_id    TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Standing checkpoint locations per site. Saved once, reused every day.
-- Only a Master may add/remove these (new locations typed while logging a
-- checkpoint are auto-saved only when logged by a Master; everyone else's
-- ad-hoc names are stored on the checkpoint record itself).
CREATE TABLE checkpoint_locations (
  id         TEXT PRIMARY KEY,
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, name)
);

CREATE TABLE checkpoints (
  id            TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  location_id   TEXT REFERENCES checkpoint_locations(id) ON DELETE SET NULL,
  location_name TEXT NOT NULL DEFAULT '',
  photo_path    TEXT,
  note          TEXT NOT NULL DEFAULT '',
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shifts (
  id         TEXT PRIMARY KEY,
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clock_in   TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Date-specific part of the daily briefing. Post orders are NOT stored here;
-- they are read live from post_orders so they always carry over.
CREATE TABLE briefings (
  site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  priorities    TEXT NOT NULL DEFAULT '',
  handoff_notes TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (site_id, date)
);

CREATE TABLE reports (
  id         TEXT PRIMARY KEY,
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  severity   TEXT NOT NULL DEFAULT 'routine'
             CHECK (severity IN ('routine', 'urgent', 'critical')),
  status     TEXT NOT NULL DEFAULT 'open'
             CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkpoints_site_created ON checkpoints (site_id, created_at DESC);
CREATE INDEX idx_shifts_site_user ON shifts (site_id, user_id, clock_in DESC);
CREATE INDEX idx_reports_site_status ON reports (site_id, status, created_at DESC);
