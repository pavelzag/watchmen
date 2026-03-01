-- One-time migration: create the user_snapshots table in Vercel Postgres.
-- Run via Vercel Postgres dashboard query editor or psql.

CREATE TABLE IF NOT EXISTS user_snapshots (
  user_email  TEXT PRIMARY KEY,
  snapshot    JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
