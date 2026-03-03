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

CREATE TABLE IF NOT EXISTS compliance_history (
  id               BIGSERIAL PRIMARY KEY,
  user_email       TEXT NOT NULL,
  standard         TEXT NOT NULL,
  score            INT NOT NULL,
  total_controls   INT NOT NULL,
  failing_controls INT NOT NULL,
  warning_controls INT NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_history_lookup
  ON compliance_history (user_email, standard, recorded_at DESC);

CREATE TABLE IF NOT EXISTS aws_snapshots (
  user_email  TEXT PRIMARY KEY,
  snapshot    JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_suppressions (
  user_email    TEXT NOT NULL,
  control_id    TEXT NOT NULL,
  justification TEXT NOT NULL DEFAULT '',
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_email, control_id)
);

CREATE TABLE IF NOT EXISTS user_cloud_credentials (
  user_email   TEXT NOT NULL,
  provider     TEXT NOT NULL,        -- 'gcp' | 'aws'
  credentials  TEXT NOT NULL,        -- AES-256-GCM encrypted JSON (iv:authTag:ciphertext)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_email, provider)
);
