CREATE TABLE IF NOT EXISTS credentials (tenant TEXT PRIMARY KEY, envelope TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (tenant TEXT NOT NULL, bucket TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (tenant,bucket));
CREATE TABLE IF NOT EXISTS reservations (tenant TEXT NOT NULL, digest TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (tenant,digest));
CREATE INDEX IF NOT EXISTS reservations_expiry ON reservations(expires_at);
