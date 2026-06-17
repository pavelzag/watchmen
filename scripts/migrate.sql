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

CREATE TABLE IF NOT EXISTS agent_hosts (
  id              TEXT PRIMARY KEY,
  user_email      TEXT NOT NULL,
  provider        TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  zone            TEXT NOT NULL,
  instance_id     TEXT NOT NULL,
  instance_name   TEXT NOT NULL,
  hostname        TEXT NOT NULL DEFAULT '',
  agent_version   TEXT NOT NULL DEFAULT '',
  kernel_version  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'registered',
  secret_hash     TEXT NOT NULL DEFAULT '',
  metadata        JSONB NOT NULL DEFAULT '{}',
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_email, provider, project_id, zone, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_hosts_lookup
  ON agent_hosts (user_email, provider, project_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS agent_events (
  id            BIGSERIAL PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  provider      TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  event         JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_lookup
  ON agent_events (agent_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_events_http_requests_by_agent
  ON agent_events (agent_id, received_at DESC)
  WHERE event->>'type' = 'http_request';

CREATE INDEX IF NOT EXISTS idx_agent_events_http_responses_by_agent
  ON agent_events (agent_id, received_at DESC)
  WHERE event->>'type' = 'http_response';

CREATE INDEX IF NOT EXISTS idx_agent_events_http_errors_by_agent
  ON agent_events (agent_id, received_at DESC)
  WHERE event->>'type' = 'http_response'
    AND (CASE WHEN event->>'status' ~ '^[0-9]{3}$' THEN (event->>'status')::int ELSE NULL END) >= 400;
