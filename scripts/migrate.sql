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
  event_type    TEXT,
  http_status   INT,
  http_method   TEXT,
  http_path     TEXT,
  cluster_name  TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS http_status INT;
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS http_method TEXT;
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS http_path TEXT;
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS cluster_name TEXT;

UPDATE agent_events e
SET
  event_type = COALESCE(event_type, e.event->>'type'),
  http_status = COALESCE(
    http_status,
    CASE WHEN e.event->>'status' ~ '^[0-9]{3}$' THEN (e.event->>'status')::int ELSE NULL END
  ),
  http_method = COALESCE(http_method, e.event->>'method'),
  http_path = COALESCE(http_path, e.event->>'path'),
  cluster_name = COALESCE(cluster_name, h.metadata->>'clusterName')
FROM agent_hosts h
WHERE h.id = e.agent_id
  AND (
    e.event_type IS NULL
    OR e.http_status IS NULL
    OR e.http_method IS NULL
    OR e.http_path IS NULL
    OR e.cluster_name IS NULL
  );

CREATE INDEX IF NOT EXISTS idx_agent_events_lookup
  ON agent_events (agent_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_events_retention
  ON agent_events (received_at);

CREATE INDEX IF NOT EXISTS idx_agent_events_http_requests_by_agent
  ON agent_events (agent_id, received_at DESC)
  WHERE event_type = 'http_request';

CREATE INDEX IF NOT EXISTS idx_agent_events_http_responses_by_agent
  ON agent_events (agent_id, received_at DESC)
  WHERE event_type = 'http_response';

CREATE INDEX IF NOT EXISTS idx_agent_events_http_errors_by_agent
  ON agent_events (agent_id, received_at DESC)
  WHERE event_type = 'http_response' AND http_status >= 400;

CREATE INDEX IF NOT EXISTS idx_agent_events_cluster_analytics
  ON agent_events (cluster_name, event_type, http_status, received_at DESC);

DELETE FROM agent_events
WHERE received_at < NOW() - INTERVAL '30 days';

CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  user_email      TEXT NOT NULL,
  workflow        TEXT NOT NULL,
  status          TEXT NOT NULL,
  prompt          TEXT NOT NULL DEFAULT '',
  input           JSONB NOT NULL DEFAULT '{}',
  output          JSONB NOT NULL DEFAULT '{}',
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_lookup
  ON agent_runs (user_email, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_steps (
  id                BIGSERIAL PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_index        INT NOT NULL,
  tool_name         TEXT NOT NULL,
  status            TEXT NOT NULL,
  input             JSONB NOT NULL DEFAULT '{}',
  output            JSONB NOT NULL DEFAULT '{}',
  error             TEXT,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_steps_run_order
  ON agent_steps (run_id, step_index);
