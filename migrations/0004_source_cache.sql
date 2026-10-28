-- Generic per-key cache for public data sources fetched by county or tile
-- (CDC PLACES health estimates, NASA night-lights tiles, ...).
CREATE TABLE source_cache (
  key        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
