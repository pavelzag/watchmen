import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

type SqlPrimitive = string | number | boolean | undefined | null;

let directPool: Pool | null = null;
let pooledClientUrl: string | undefined;
let pooledClient: NeonQueryFunction<false, true> | null = null;

function getConnectionString(): string | undefined {
  return process.env.POSTGRES_URL || process.env.DATABASE_URL;
}

function shouldUseDirectClient(connectionString: string | undefined): boolean {
  if (!connectionString) return false;
  try {
    const url = new URL(connectionString);
    const host = url.hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "host.docker.internal" ||
      host.endsWith(".internal") ||
      !host.includes("-pooler.")
    );
  } catch {
    return false;
  }
}

function templateToQuery(strings: TemplateStringsArray, values: SqlPrimitive[]): { text: string; values: SqlPrimitive[] } {
  let text = strings[0] ?? "";
  for (let index = 0; index < values.length; index += 1) {
    text += `$${index + 1}${strings[index + 1] ?? ""}`;
  }
  return { text, values };
}

function getDirectPool(): Pool {
  if (!directPool) {
    const connectionString = getConnectionString();
    directPool = new Pool({ connectionString });
  }
  return directPool;
}

function getPooledClient(connectionString: string): NeonQueryFunction<false, true> {
  if (!pooledClient || pooledClientUrl !== connectionString) {
    pooledClientUrl = connectionString;
    pooledClient = neon(connectionString, { fullResults: true });
  }
  return pooledClient;
}

export async function sql<O extends QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: SqlPrimitive[]
): Promise<QueryResult<O>> {
  const connectionString = getConnectionString();
  const query = templateToQuery(strings, values);
  if (shouldUseDirectClient(connectionString)) {
    const pool = getDirectPool();
    return pool.query<O>(query.text, query.values);
  }
  if (!connectionString) {
    throw new Error("Missing POSTGRES_URL or DATABASE_URL environment variable.");
  }
  const neonSql = getPooledClient(connectionString);
  return (await neonSql.query(query.text, query.values)) as unknown as QueryResult<O>;
}

let backgroundTasksTableReady: Promise<void> | null = null;
let agentRunsTableReady: Promise<void> | null = null;
let agentInstallTablesReady: Promise<void> | null = null;
let runtimeSecurityTablesReady: Promise<void> | null = null;
let handoffTablesReady: Promise<void> | null = null;
let containerScanCacheTableReady: Promise<void> | null = null;

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
 * Ensures tables for audited AI agent workflow runs.
 */
export async function ensureAgentRunsTables(): Promise<void> {
  if (!agentRunsTableReady) {
    agentRunsTableReady = retryOnce(async () => {
      await sql`
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
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_agent_runs_lookup
          ON agent_runs (user_email, created_at DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS agent_steps (
          id              BIGSERIAL PRIMARY KEY,
          run_id          TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          step_index      INT NOT NULL,
          tool_name       TEXT NOT NULL,
          status          TEXT NOT NULL,
          input           JSONB NOT NULL DEFAULT '{}',
          output          JSONB NOT NULL DEFAULT '{}',
          error           TEXT,
          requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at    TIMESTAMPTZ
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_steps_run_order
          ON agent_steps (run_id, step_index)
      `;
    }).catch((error) => {
      agentRunsTableReady = null;
      throw error;
    });
  }

  await agentRunsTableReady;
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
 * Ensures tables for v0.8/v0.9 runtime request security rules and request decisions.
 */
export async function ensureRuntimeSecurityTables(): Promise<void> {
  if (!runtimeSecurityTablesReady) {
    runtimeSecurityTablesReady = retryOnce(async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS runtime_security_rules (
          user_email       TEXT NOT NULL,
          id               TEXT NOT NULL,
          name             TEXT NOT NULL,
          enabled          BOOLEAN NOT NULL DEFAULT TRUE,
          action           TEXT NOT NULL,
          mode             TEXT NOT NULL DEFAULT 'detect',
          condition_kind   TEXT NOT NULL,
          condition_value  TEXT NOT NULL,
          severity         TEXT NOT NULL,
          description      TEXT NOT NULL DEFAULT '',
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_email, id)
        )
      `;
      await sql`ALTER TABLE runtime_security_rules ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'detect'`;
      await sql`
        CREATE TABLE IF NOT EXISTS runtime_request_events (
          user_email              TEXT NOT NULL,
          id                      TEXT NOT NULL,
          ts                      TIMESTAMPTZ NOT NULL,
          source_ip               TEXT,
          source_port             INT,
          source_ip_class         TEXT,
          source_geo_lat          DOUBLE PRECISION,
          source_geo_lon          DOUBLE PRECISION,
          source_geo_region       TEXT,
          source_geo_city         TEXT,
          source_geo_country      TEXT,
          method                  TEXT,
          path                    TEXT,
          content_type            TEXT,
          body_size               INT,
          body_sample             TEXT,
          status_code             INT,
          destination_service     TEXT,
          destination_namespace   TEXT,
          destination_pod         TEXT,
          destination_workload    TEXT,
          decision                TEXT NOT NULL,
          matched_rule_ids        JSONB NOT NULL DEFAULT '[]',
          reasons                 JSONB NOT NULL DEFAULT '[]',
          highest_severity        TEXT,
          created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_email, id)
        )
      `;
      await sql`ALTER TABLE runtime_request_events ADD COLUMN IF NOT EXISTS source_geo_lat DOUBLE PRECISION`;
      await sql`ALTER TABLE runtime_request_events ADD COLUMN IF NOT EXISTS source_geo_lon DOUBLE PRECISION`;
      await sql`ALTER TABLE runtime_request_events ADD COLUMN IF NOT EXISTS source_geo_region TEXT`;
      await sql`ALTER TABLE runtime_request_events ADD COLUMN IF NOT EXISTS source_geo_city TEXT`;
      await sql`ALTER TABLE runtime_request_events ADD COLUMN IF NOT EXISTS source_geo_country TEXT`;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_runtime_request_events_lookup
          ON runtime_request_events (user_email, ts DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_runtime_request_events_matched_rules
          ON runtime_request_events USING GIN (matched_rule_ids)
      `;
    }).catch((error) => {
      runtimeSecurityTablesReady = null;
      throw error;
    });
  }

  await runtimeSecurityTablesReady;
}

/**
 * Ensures tables for host agent enrollment and fleet install jobs.
 */
export async function ensureAgentInstallTables(): Promise<void> {
  if (!agentInstallTablesReady) {
    agentInstallTablesReady = retryOnce(async () => {
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
          event_type    TEXT,
          http_status   INT,
          http_method   TEXT,
          http_path     TEXT,
          cluster_name  TEXT,
          received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS event_type TEXT`;
      await sql`ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS http_status INT`;
      await sql`ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS http_method TEXT`;
      await sql`ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS http_path TEXT`;
      await sql`ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS cluster_name TEXT`;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_agent_events_lookup
          ON agent_events (agent_id, received_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_agent_events_retention
          ON agent_events (received_at)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_agent_events_http_requests_by_agent
          ON agent_events (agent_id, received_at DESC)
          WHERE event_type = 'http_request'
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_agent_events_http_responses_by_agent
          ON agent_events (agent_id, received_at DESC)
          WHERE event_type = 'http_response'
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_agent_events_http_errors_by_agent
          ON agent_events (agent_id, received_at DESC)
          WHERE event_type = 'http_response' AND http_status >= 400
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_agent_events_cluster_analytics
          ON agent_events (cluster_name, event_type, http_status, received_at DESC)
      `;
      await sql`
        DELETE FROM agent_events
        WHERE received_at < NOW() - INTERVAL '30 days'
      `;
    }).catch((error) => {
      agentInstallTablesReady = null;
      throw error;
    });
  }

  await agentInstallTablesReady;
}

/**
 * Ensures tables for v0.9 CLI task handoff and personal API tokens.
 */
export async function ensureHandoffTables(): Promise<void> {
  if (!handoffTablesReady) {
    handoffTablesReady = retryOnce(async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_api_tokens (
          id            TEXT PRIMARY KEY,
          user_email    TEXT NOT NULL,
          name          TEXT NOT NULL,
          token_prefix  TEXT NOT NULL,
          token_hash    TEXT NOT NULL UNIQUE,
          last_used_at  TIMESTAMPTZ,
          revoked_at    TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_user_api_tokens_lookup
          ON user_api_tokens (user_email, created_at DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS cli_handoff_tasks (
          id              TEXT PRIMARY KEY,
          user_email      TEXT NOT NULL,
          fingerprint     TEXT NOT NULL,
          title           TEXT NOT NULL,
          target_tool     TEXT NOT NULL DEFAULT 'any',
          batch_mode      TEXT NOT NULL DEFAULT 'grouped',
          status          TEXT NOT NULL DEFAULT 'open',
          severity        TEXT NOT NULL DEFAULT 'medium',
          issue_count     INT NOT NULL DEFAULT 1,
          payload         JSONB NOT NULL DEFAULT '{}',
          prompt_markdown TEXT NOT NULL DEFAULT '',
          pr_url          TEXT,
          session_ref     TEXT,
          claimed_by      TEXT,
          claimed_at      TIMESTAMPTZ,
          completed_at    TIMESTAMPTZ,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_cli_handoff_tasks_lookup
          ON cli_handoff_tasks (user_email, status, updated_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_cli_handoff_tasks_fingerprint
          ON cli_handoff_tasks (user_email, fingerprint, status)
      `;
    }).catch((error) => {
      handoffTablesReady = null;
      throw error;
    });
  }

  await handoffTablesReady;
}

/**
 * Ensures the container image scan cache table exists (keyed by immutable image ref/digest).
 */
export async function ensureContainerScanCacheTable(): Promise<void> {
  if (!containerScanCacheTableReady) {
    containerScanCacheTableReady = retryOnce(async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS container_scan_cache (
          image_ref        TEXT PRIMARY KEY,
          cloud            TEXT NOT NULL,
          account_id       TEXT NOT NULL,
          scanner          TEXT NOT NULL DEFAULT 'trivy',
          vulnerabilities  JSONB NOT NULL DEFAULT '[]',
          summary          JSONB NOT NULL DEFAULT '{}',
          scanned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    }).catch((error) => {
      containerScanCacheTableReady = null;
      throw error;
    });
  }

  await containerScanCacheTableReady;
}
