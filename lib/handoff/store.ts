import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { ensureHandoffTables, sql } from "@/lib/db";
import {
  renderTaskPromptMarkdown,
  type HandoffBatchMode,
  type HandoffTaskDraft,
  type HandoffTaskPayload,
  type HandoffTaskRecord,
  type HandoffTaskStatus,
  type HandoffTool,
  type LastVerificationSummary,
} from "@/lib/handoff/tasks";
import type { SecurityFindingSeverity } from "@/lib/gcp/types";

export interface PersonalApiTokenRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface HandoffActor {
  email: string;
  authMethod: "session" | "api_token";
  isDemoUser: boolean;
  tokenId?: string;
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mapTaskRow(row: Record<string, unknown>): HandoffTaskRecord {
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    title: String(row.title),
    targetTool: (row.target_tool as HandoffTool) ?? "any",
    batchMode: (row.batch_mode as HandoffBatchMode) ?? "grouped",
    status: (row.status as HandoffTaskStatus) ?? "open",
    severity: (row.severity as SecurityFindingSeverity) ?? "medium",
    issueCount: Number(row.issue_count ?? 1),
    payload: (row.payload ?? {}) as HandoffTaskPayload,
    promptMarkdown: String(row.prompt_markdown ?? ""),
    prUrl: row.pr_url ? String(row.pr_url) : null,
    sessionRef: row.session_ref ? String(row.session_ref) : null,
    claimedBy: row.claimed_by ? String(row.claimed_by) : null,
    claimedAt: toIsoOrNull(row.claimed_at),
    completedAt: toIsoOrNull(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function resolveHandoffActor(req?: NextRequest): Promise<HandoffActor | null> {
  const authHeader = req?.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(wm_[A-Za-z0-9_-]+)$/i);
  if (match?.[1]) {
    const rawToken = match[1].trim();
    const tokenHash = hashToken(rawToken);
    await ensureHandoffTables();
    const res = await sql<{ id: string; user_email: string }>`
      SELECT id, user_email
      FROM user_api_tokens
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
      LIMIT 1
    `;
    const row = res.rows[0];
    if (row?.user_email) {
      await sql`
        UPDATE user_api_tokens
        SET last_used_at = NOW()
        WHERE id = ${row.id}
      `.catch(() => {});
      return {
        email: row.user_email,
        authMethod: "api_token",
        isDemoUser: false,
        tokenId: row.id,
      };
    }
    return null;
  }

  const session = await auth();
  if (!session?.user?.email) return null;
  return {
    email: session.user.email,
    authMethod: "session",
    isDemoUser: Boolean(session.isDemoUser),
  };
}

export async function listPersonalApiTokens(userEmail: string): Promise<PersonalApiTokenRecord[]> {
  await ensureHandoffTables();
  const res = await sql`
    SELECT id, name, token_prefix, last_used_at, revoked_at, created_at
    FROM user_api_tokens
    WHERE user_email = ${userEmail}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return res.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    tokenPrefix: String(row.token_prefix),
    lastUsedAt: toIsoOrNull(row.last_used_at),
    revokedAt: toIsoOrNull(row.revoked_at),
    createdAt: toIso(row.created_at),
  }));
}

export async function createPersonalApiToken(params: {
  userEmail: string;
  name: string;
}): Promise<{ token: string; record: PersonalApiTokenRecord }> {
  await ensureHandoffTables();
  const cleanName = params.name.trim().slice(0, 64) || "CLI Token";
  const id = `tok_${randomBytes(10).toString("hex")}`;
  const rawSecret = randomBytes(24).toString("hex");
  const token = `wm_${rawSecret}`;
  const tokenPrefix = token.slice(0, 12);
  const tokenHash = hashToken(token);

  const res = await sql`
    INSERT INTO user_api_tokens (id, user_email, name, token_prefix, token_hash)
    VALUES (${id}, ${params.userEmail}, ${cleanName}, ${tokenPrefix}, ${tokenHash})
    RETURNING id, name, token_prefix, last_used_at, revoked_at, created_at
  `;
  const row = res.rows[0];
  return {
    token,
    record: {
      id: String(row.id),
      name: String(row.name),
      tokenPrefix: String(row.token_prefix),
      lastUsedAt: toIsoOrNull(row.last_used_at),
      revokedAt: toIsoOrNull(row.revoked_at),
      createdAt: toIso(row.created_at),
    },
  };
}

export async function revokePersonalApiToken(userEmail: string, tokenId: string): Promise<boolean> {
  await ensureHandoffTables();
  const res = await sql`
    UPDATE user_api_tokens
    SET revoked_at = NOW()
    WHERE user_email = ${userEmail} AND id = ${tokenId} AND revoked_at IS NULL
    RETURNING id
  `;
  return res.rows.length > 0;
}

export async function pushHandoffTasks(params: {
  userEmail: string;
  drafts: HandoffTaskDraft[];
  watchmenUrl?: string;
}): Promise<{
  tasks: HandoffTaskRecord[];
  createdCount: number;
  updatedCount: number;
}> {
  await ensureHandoffTables();
  const tasks: HandoffTaskRecord[] = [];
  let createdCount = 0;
  let updatedCount = 0;

  for (const draft of params.drafts) {
    const existing = await sql`
      SELECT id
      FROM cli_handoff_tasks
      WHERE user_email = ${params.userEmail}
        AND fingerprint = ${draft.fingerprint}
        AND status IN ('open', 'claimed', 'in_progress')
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    const existingId = existing.rows[0]?.id ? String(existing.rows[0].id) : null;
    const taskId = existingId ?? `wm_tsk_${randomBytes(8).toString("hex")}`;
    const promptMarkdown = renderTaskPromptMarkdown({
      title: draft.title,
      severity: draft.severity,
      issues: draft.payload.issues,
      taskId,
      watchmenUrl: params.watchmenUrl,
    });

    if (existingId) {
      const updated = await sql`
        UPDATE cli_handoff_tasks
        SET title = ${draft.title},
            target_tool = ${draft.targetTool},
            batch_mode = ${draft.batchMode},
            severity = ${draft.severity},
            issue_count = ${draft.issueCount},
            payload = ${JSON.stringify(draft.payload)}::jsonb,
            prompt_markdown = ${promptMarkdown},
            updated_at = NOW()
        WHERE user_email = ${params.userEmail} AND id = ${existingId}
        RETURNING *
      `;
      if (updated.rows[0]) {
        tasks.push(mapTaskRow(updated.rows[0]));
        updatedCount += 1;
      }
    } else {
      const inserted = await sql`
        INSERT INTO cli_handoff_tasks (
          id, user_email, fingerprint, title, target_tool, batch_mode,
          status, severity, issue_count, payload, prompt_markdown
        )
        VALUES (
          ${taskId},
          ${params.userEmail},
          ${draft.fingerprint},
          ${draft.title},
          ${draft.targetTool},
          ${draft.batchMode},
          'open',
          ${draft.severity},
          ${draft.issueCount},
          ${JSON.stringify(draft.payload)}::jsonb,
          ${promptMarkdown}
        )
        RETURNING *
      `;
      if (inserted.rows[0]) {
        tasks.push(mapTaskRow(inserted.rows[0]));
        createdCount += 1;
      }
    }
  }

  return { tasks, createdCount, updatedCount };
}

export async function listHandoffTasks(params: {
  userEmail: string;
  status?: string;
  severity?: string;
  tool?: string;
  limit?: number;
}): Promise<HandoffTaskRecord[]> {
  await ensureHandoffTables();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const res = await sql`
    SELECT *
    FROM cli_handoff_tasks
    WHERE user_email = ${params.userEmail}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;

  let rows = res.rows.map(mapTaskRow);
  if (params.status && params.status !== "all") {
    const allowed = new Set(params.status.split(",").map((s) => s.trim()));
    rows = rows.filter((t) => allowed.has(t.status));
  }
  if (params.severity && params.severity !== "all") {
    const allowed = new Set(params.severity.split(",").map((s) => s.trim()));
    rows = rows.filter((t) => allowed.has(t.severity));
  }
  if (params.tool && params.tool !== "all") {
    rows = rows.filter((t) => t.targetTool === params.tool || t.targetTool === "any");
  }
  return rows;
}

export async function getHandoffTask(userEmail: string, taskId: string): Promise<HandoffTaskRecord | null> {
  await ensureHandoffTables();
  const res = await sql`
    SELECT *
    FROM cli_handoff_tasks
    WHERE user_email = ${userEmail} AND id = ${taskId}
    LIMIT 1
  `;
  return res.rows[0] ? mapTaskRow(res.rows[0]) : null;
}

export async function updateHandoffTask(params: {
  userEmail: string;
  taskId: string;
  status?: HandoffTaskStatus;
  targetTool?: HandoffTool;
  prUrl?: string | null;
  sessionRef?: string | null;
  claimedBy?: string | null;
}): Promise<HandoffTaskRecord | null> {
  await ensureHandoffTables();
  const current = await getHandoffTask(params.userEmail, params.taskId);
  if (!current) return null;

  const nextStatus = params.status ?? current.status;
  const nextTool = params.targetTool ?? current.targetTool;
  const nextPrUrl = params.prUrl !== undefined ? params.prUrl : current.prUrl;
  const nextSessionRef = params.sessionRef !== undefined ? params.sessionRef : current.sessionRef;
  const nextClaimedBy = params.claimedBy !== undefined ? params.claimedBy : current.claimedBy;
  const claimedAt =
    nextStatus === "claimed" || nextStatus === "in_progress"
      ? current.claimedAt ?? new Date().toISOString()
      : current.claimedAt;
  const completedAt =
    nextStatus === "completed" || nextStatus === "dismissed"
      ? current.completedAt ?? new Date().toISOString()
      : null;

  const res = await sql`
    UPDATE cli_handoff_tasks
    SET status = ${nextStatus},
        target_tool = ${nextTool},
        pr_url = ${nextPrUrl},
        session_ref = ${nextSessionRef},
        claimed_by = ${nextClaimedBy},
        claimed_at = ${claimedAt},
        completed_at = ${completedAt},
        updated_at = NOW()
    WHERE user_email = ${params.userEmail} AND id = ${params.taskId}
    RETURNING *
  `;
  return res.rows[0] ? mapTaskRow(res.rows[0]) : null;
}

export async function saveHandoffTaskVerification(params: {
  userEmail: string;
  taskId: string;
  verification: LastVerificationSummary;
  autoComplete?: boolean;
}): Promise<HandoffTaskRecord | null> {
  await ensureHandoffTables();
  const current = await getHandoffTask(params.userEmail, params.taskId);
  if (!current) return null;

  const nextPayload: HandoffTaskPayload = {
    ...current.payload,
    lastVerification: params.verification,
  };
  const shouldComplete =
    params.autoComplete !== false &&
    params.verification.allResolved &&
    params.verification.resolvedCount > 0;
  const nextStatus: HandoffTaskStatus = shouldComplete ? "completed" : current.status;
  const completedAt =
    nextStatus === "completed" || nextStatus === "dismissed"
      ? current.completedAt ?? new Date().toISOString()
      : null;

  const res = await sql`
    UPDATE cli_handoff_tasks
    SET status = ${nextStatus},
        payload = ${JSON.stringify(nextPayload)}::jsonb,
        completed_at = ${completedAt},
        updated_at = NOW()
    WHERE user_email = ${params.userEmail} AND id = ${params.taskId}
    RETURNING *
  `;
  return res.rows[0] ? mapTaskRow(res.rows[0]) : null;
}

export async function deleteHandoffTask(userEmail: string, taskId: string): Promise<boolean> {
  await ensureHandoffTables();
  const res = await sql`
    DELETE FROM cli_handoff_tasks
    WHERE user_email = ${userEmail} AND id = ${taskId}
    RETURNING id
  `;
  return res.rows.length > 0;
}
