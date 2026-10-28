-- Reviews left from the landing page or the app. Kept even if the email to the team fails.
CREATE TABLE reviews (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  message    TEXT NOT NULL,
  name       TEXT,
  email      TEXT,
  source     TEXT NOT NULL,
  user_id    TEXT,
  ip_hash    TEXT NOT NULL,
  emailed_at INTEGER
);
CREATE INDEX reviews_ip_created ON reviews (ip_hash, created_at);
