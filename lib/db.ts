import { sql } from "@vercel/postgres";
export { sql };

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
