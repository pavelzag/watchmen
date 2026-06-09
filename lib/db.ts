import { sql } from "@vercel/postgres";
export { sql };

let backgroundTasksTableReady: Promise<void> | null = null;

export async function retryOnce<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return work();
  }
}

/**
 * Ensures the GCP snapshot table exists. Safe to call on every request.
 */
export async function ensureGcpSnapshotTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS user_snapshots (
      user_email  TEXT PRIMARY KEY,
      snapshot    JSONB NOT NULL,
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

/**
 * Ensures the AWS snapshot table exists. Safe to call on every request.
 */
export async function ensureAwsSnapshotTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS aws_snapshots (
      user_email  TEXT PRIMARY KEY,
      snapshot    JSONB NOT NULL,
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

/**
 * Ensures compliance tables exist. Safe to call on every request.
 */
export async function ensureComplianceTables(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS compliance_history (
      id               BIGSERIAL PRIMARY KEY,
      user_email       TEXT NOT NULL,
      standard         TEXT NOT NULL,
      score            INT NOT NULL,
      total_controls   INT NOT NULL,
      failing_controls INT NOT NULL,
      warning_controls INT NOT NULL,
      recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_compliance_history_lookup
      ON compliance_history (user_email, standard, recorded_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS compliance_suppressions (
      user_email    TEXT NOT NULL,
      control_id    TEXT NOT NULL,
      justification TEXT NOT NULL DEFAULT '',
      suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_email, control_id)
    )
  `;
}
/**
 * Ensures the alert rules table exists. Safe to call on every request.
 */
export async function ensureAlertRulesTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS alert_rules (
      user_email         TEXT PRIMARY KEY,
      webhook_url        TEXT NOT NULL DEFAULT '',
      on_new_critical    BOOLEAN NOT NULL DEFAULT TRUE,
      on_new_high        BOOLEAN NOT NULL DEFAULT FALSE,
      last_finding_ids   JSONB NOT NULL DEFAULT '[]',
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Migrate: add Slack bot token columns if they don't exist yet
  await sql`ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS slack_bot_token TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS slack_channel_id TEXT NOT NULL DEFAULT ''`;
}

/**
 * Ensures the demo usage tracking table exists.
 */
export async function ensureDemoUsageTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS demo_usage (
      user_email   TEXT PRIMARY KEY,
      daily_count  INT NOT NULL DEFAULT 0,
      last_reset   DATE NOT NULL DEFAULT CURRENT_DATE
    )
  `;
}

/**
 * Ensures the global usage tracking table exists.
 */
export async function ensureGlobalUsageTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS global_usage (
      id           INT PRIMARY KEY DEFAULT 1,
      daily_count  INT NOT NULL DEFAULT 0,
      max_limit    INT NOT NULL DEFAULT 5000,
      last_reset   DATE NOT NULL DEFAULT CURRENT_DATE,
      CONSTRAINT one_row CHECK (id = 1)
    )
  `;
  // Initialize if empty
  await sql`
    INSERT INTO global_usage (id, daily_count, max_limit, last_reset)
    VALUES (1, 0, 5000, CURRENT_DATE)
    ON CONFLICT (id) DO NOTHING
  `;
}

/**
 * Ensures the background task table exists.
 */
export async function ensureBackgroundTasksTable(): Promise<void> {
  if (!backgroundTasksTableReady) {
    backgroundTasksTableReady = retryOnce(async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_background_tasks (
          user_email   TEXT NOT NULL,
          task_id      TEXT NOT NULL,
          task_kind    TEXT NOT NULL,
          task_status  TEXT NOT NULL,
          task_data    JSONB NOT NULL,
          dismissed    BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_email, task_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_user_background_tasks_lookup
          ON user_background_tasks (user_email, dismissed, updated_at DESC)
      `;
    }).catch((error) => {
      backgroundTasksTableReady = null;
      throw error;
    });
  }

  await backgroundTasksTableReady;
}

/**
 * Ensures the trace source configuration table exists.
 */
export async function ensureTraceSourceConfigsTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS user_trace_source_configs (
      user_email   TEXT NOT NULL,
      cloud        TEXT NOT NULL,
      config       JSONB NOT NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_email, cloud)
    )
  `;
}

/**
 * Ensures tables for host agent enrollment and fleet install jobs.
 */
export async function ensureAgentInstallTables(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS agent_install_jobs (
      id                  TEXT PRIMARY KEY,
      user_email          TEXT NOT NULL,
      provider            TEXT NOT NULL,
      project_id          TEXT NOT NULL,
      status              TEXT NOT NULL,
      selected_instances  JSONB NOT NULL,
      assignment_names    JSONB NOT NULL DEFAULT '[]',
      error               TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at          TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_agent_install_jobs_lookup
      ON agent_install_jobs (user_email, provider, project_id, updated_at DESC)
  `;
  await sql`
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
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_agent_hosts_lookup
      ON agent_hosts (user_email, provider, project_id, last_seen_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_events (
      id            BIGSERIAL PRIMARY KEY,
      agent_id      TEXT NOT NULL,
      provider      TEXT NOT NULL,
      project_id    TEXT NOT NULL,
      event         JSONB NOT NULL,
      received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_agent_events_lookup
      ON agent_events (agent_id, received_at DESC)
  `;
}
