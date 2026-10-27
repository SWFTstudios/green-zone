-- Guest accounts: use the app without signing in. A guest is a normal user row with a
-- placeholder email, tied to this browser by its session cookie, until they add a real email.
ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
-- SHA-256 of the creating network address, only used to rate-limit guest sign-ups.
ALTER TABLE users ADD COLUMN guest_ip TEXT;
CREATE INDEX idx_users_guest ON users (is_guest, created_at);
