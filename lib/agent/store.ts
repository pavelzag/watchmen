import { randomUUID } from "crypto";
import { ensureAgentRunsTables, sql } from "@/lib/db";
import type { AgentRunRecord, AgentRunStatus, AgentStepRecord, AgentWorkflow } from "@/lib/agent/types";

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeRun(row: any): AgentRunRecord {
  return {
    id: row.id,
    workflow: row.workflow,
    status: row.status,
    prompt: row.prompt,
    input: row.input,
    output: row.output,
    error: row.error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

export async function createAgentRun(params: {
  userEmail: string;
  workflow: AgentWorkflow;
  prompt?: string;
  input: unknown;
}): Promise<AgentRunRecord> {
  await ensureAgentRunsTables();
  const id = `agent-run-${randomUUID()}`;
  const result = await sql`
    INSERT INTO agent_runs (id, user_email, workflow, status, prompt, input)
    VALUES (${id}, ${params.userEmail}, ${params.workflow}, 'running', ${params.prompt ?? ""}, ${JSON.stringify(params.input)}::jsonb)
    RETURNING *
  `;
  return normalizeRun(result.rows[0]);
}

export async function recordAgentStep(step: AgentStepRecord): Promise<void> {
  await ensureAgentRunsTables();
  await sql`
    INSERT INTO agent_steps (
      run_id,
      step_index,
      tool_name,
      status,
      input,
      output,
      error,
      requires_approval,
      completed_at
    )
    VALUES (
      ${step.runId},
      ${step.stepIndex},
      ${step.toolName},
      ${step.status},
      ${JSON.stringify(step.input)}::jsonb,
      ${JSON.stringify(step.output)}::jsonb,
      ${step.error ?? null},
      ${Boolean(step.requiresApproval)},
      NOW()
    )
  `;
}

export async function completeAgentRun(params: {
  runId: string;
  status: AgentRunStatus;
  output?: unknown;
  error?: string | null;
}): Promise<AgentRunRecord> {
  await ensureAgentRunsTables();
  const result = await sql`
    UPDATE agent_runs
    SET
      status = ${params.status},
      output = ${JSON.stringify(params.output ?? {})}::jsonb,
      error = ${params.error ?? null},
      updated_at = NOW(),
      completed_at = NOW()
    WHERE id = ${params.runId}
    RETURNING *
  `;
  return normalizeRun(result.rows[0]);
}

export interface FindingAgentRunSummary {
  id: string;
  workflow: AgentWorkflow;
  status: AgentRunStatus;
  findingId: string;
  report?: string | null;
  previewEligible?: boolean;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

function getFindingIdForRun(row: any): string | null {
  const input = row.input ?? {};
  if (typeof input.id === "string") return input.id;
  if (typeof input.finding?.id === "string") return input.finding.id;
  return null;
}

function summarizeFindingRun(row: any): FindingAgentRunSummary | null {
  const findingId = getFindingIdForRun(row);
  if (!findingId) return null;
  const output = row.output ?? {};
  return {
    id: row.id,
    workflow: row.workflow,
    status: row.status,
    findingId,
    report: typeof output.report === "string" ? output.report : null,
    previewEligible: Boolean(output.plan?.previewEligible),
    error: row.error,
    createdAt: toIso(row.created_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

export async function listFindingAgentRuns(params: {
  userEmail: string;
  findingIds: string[];
}): Promise<Record<string, Partial<Record<AgentWorkflow, FindingAgentRunSummary>>>> {
  await ensureAgentRunsTables();
  const uniqueIds = [...new Set(params.findingIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const findingIdsJson = JSON.stringify(uniqueIds);
  const result = await sql`
    SELECT id, workflow, status, input, output, error, created_at, completed_at
    FROM agent_runs
    WHERE user_email = ${params.userEmail}
      AND workflow IN ('investigate_finding', 'plan_remediation')
      AND (
        input->>'id' IN (SELECT value FROM jsonb_array_elements_text(${findingIdsJson}::jsonb))
        OR input->'finding'->>'id' IN (SELECT value FROM jsonb_array_elements_text(${findingIdsJson}::jsonb))
      )
    ORDER BY created_at DESC
    LIMIT 500
  `;

  const byFinding: Record<string, Partial<Record<AgentWorkflow, FindingAgentRunSummary>>> = {};
  for (const row of result.rows) {
    const summary = summarizeFindingRun(row);
    if (!summary) continue;
    byFinding[summary.findingId] ??= {};
    if (!byFinding[summary.findingId]?.[summary.workflow]) {
      byFinding[summary.findingId]![summary.workflow] = summary;
    }
  }

  return byFinding;
}
