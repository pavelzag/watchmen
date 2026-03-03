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
