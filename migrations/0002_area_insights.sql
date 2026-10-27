-- Area insights: market data, cached area metrics, saved searches.

-- Zillow Research data by ZIP code (ZHVI home values, ZORI rents), refreshed monthly.
CREATE TABLE zip_market (
  zip        TEXT PRIMARY KEY,
  state      TEXT,
  city       TEXT,
  metro      TEXT,
  county     TEXT,
  zhvi       REAL,
  zhvi_yoy   REAL,
  zhvi_month TEXT,
  zhvi_sfr   REAL,
  zhvi_condo REAL,
  zhvi_1br   REAL,
  zhvi_2br   REAL,
  zhvi_3br   REAL,
  zhvi_4br   REAL,
  zhvi_5br   REAL,
  zori       REAL,
  zori_yoy   REAL,
  zori_month TEXT,
  updated_at INTEGER NOT NULL
);

-- One row per Zillow CSV, so the app can show what's loaded and the cron knows what's stale.
CREATE TABLE zillow_imports (
  dataset     TEXT PRIMARY KEY,
  month       TEXT,
  rows        INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER,
  attempted_at INTEGER NOT NULL,
  error       TEXT
);

-- Census tracts we've seen, with simplified boundaries and computed metrics (JSON).
CREATE TABLE area_cache (
  geoid      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  county     TEXT NOT NULL,
  geometry   TEXT NOT NULL,
  w          REAL NOT NULL,
  s          REAL NOT NULL,
  e          REAL NOT NULL,
  n          REAL NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  area_km2   REAL NOT NULL,
  metrics    TEXT,
  metrics_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_area_cache_bbox ON area_cache (w, e, s, n);

-- Map tiles whose tract boundaries have already been fetched.
CREATE TABLE area_tiles (
  tile       TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);

-- Census ACS results per county (all tracts in one call), keyed by state+county FIPS.
CREATE TABLE acs_cache (
  county     TEXT PRIMARY KEY,
  year       TEXT NOT NULL,
  data       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- Named searches: the user's criteria, the map view and a snapshot of the results.
CREATE TABLE saved_searches (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  criteria   TEXT NOT NULL,
  view       TEXT NOT NULL,
  results    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_saved_searches_user ON saved_searches (user_id, updated_at DESC);
