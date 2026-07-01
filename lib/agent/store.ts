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
