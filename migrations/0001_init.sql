-- Green Zone initial schema (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- One-time sign-in codes sent by email. Only a hash of the code is stored.
CREATE TABLE login_codes (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_codes_email ON login_codes (email, created_at);

-- Browser sessions. The cookie holds a random token; only its hash is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

-- The colors a user paints with (the "key"). Every user gets Green/Yellow/Red;
-- Pro users can add their own (e.g. Purple = "community to reach out to").
CREATE TABLE zone_types (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_default  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_zone_types_user ON zone_types (user_id, archived, sort_order);

-- A drive. `legend` is a JSON snapshot of the key used on this trip
-- ([{zoneTypeId, name, color, description, tripNote}]) so old trips keep
-- their colors and meanings even if the user edits their zones later.
CREATE TABLE trips (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  legend     TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  ended_at   INTEGER NOT NULL,
  distance_m REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_trips_user ON trips (user_id, started_at DESC);

-- A painted stretch of street: one color, a polyline of [lat, lng] points (JSON).
CREATE TABLE segments (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  zone_type_id TEXT NOT NULL,
  path         TEXT NOT NULL,
  length_m     REAL NOT NULL DEFAULT 0,
  started_at   INTEGER,
  ended_at     INTEGER
);
CREATE INDEX idx_segments_trip ON segments (trip_id);
CREATE INDEX idx_segments_user ON segments (user_id);

-- Notes dropped on the map during a drive ("vacant house, overgrown yard").
CREATE TABLE pins (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  zone_type_id TEXT,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_pins_trip ON pins (trip_id);
CREATE INDEX idx_pins_user ON pins (user_id);
