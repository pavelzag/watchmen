-- One-time migration: create tables in Vercel Postgres.
-- Run via Vercel Postgres dashboard query editor or psql.
-- Note: user_api_keys is also auto-created on first request (ensureApiKeysTable).

CREATE TABLE IF NOT EXISTS user_snapshots (
  user_email  TEXT PRIMARY KEY,
  snapshot    JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_email    TEXT NOT NULL,
  provider      TEXT NOT NULL,           -- 'google' | 'openai' | 'anthropic'
  encrypted_key TEXT NOT NULL,           -- AES-256-GCM encrypted, format: iv:authTag:ciphertext
  key_hint      TEXT NOT NULL,           -- last 4 chars of the original key
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_email, provider)
);
