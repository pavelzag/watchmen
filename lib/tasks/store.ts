import { ensureBackgroundTasksTable, sql } from "@/lib/db";
import type { AnyBackgroundTask, BackgroundTask, BackgroundTaskKind, TaskParamsMap } from "@/lib/tasks/types";

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function taskTitle(kind: BackgroundTaskKind, params: TaskParamsMap[BackgroundTaskKind]): string {
  if (kind === "gcp_scan") return "GCP Cloud Scan";
  if (kind === "aws_scan") return "AWS Cloud Scan";
  if (kind === "attack_paths") return "Attack Path Analysis";
  if (kind === "terraform_preview") return `Terraform Preview · ${(params as TaskParamsMap["terraform_preview"]).repoFullName}`;
  return `Terraform PR · ${(params as TaskParamsMap["terraform_pr"]).repoFullName}`;
}

export function createBackgroundTask<K extends BackgroundTaskKind>(
  kind: K,
  params: TaskParamsMap[K],
  overrides: Partial<Pick<BackgroundTask<K>, "status" | "error" | "result" | "progress" | "percent">> & {
    id?: string;
    title?: string;
    createdAt?: string;
    updatedAt?: string;
    lastProgressAt?: string;
  } = {}
): BackgroundTask<K> {
  const now = new Date().toISOString();
  const createdAt = overrides.createdAt ?? now;
  const updatedAt = overrides.updatedAt ?? createdAt;
  const lastProgressAt = overrides.lastProgressAt ?? updatedAt;
  return {
    id: overrides.id ?? crypto.randomUUID(),
    kind,
    title: overrides.title ?? taskTitle(kind, params),
    status: overrides.status ?? "queued",
    createdAt,
    updatedAt,
    lastProgressAt,
    progress: overrides.progress ?? [],
    percent: overrides.percent ?? 0,
    error: overrides.error ?? null,
    result: overrides.result,
    params,
  };
}

export function normalizeBackgroundTask(task: AnyBackgroundTask): AnyBackgroundTask {
  const normalized = {
    ...task,
    lastProgressAt: task.lastProgressAt ?? task.updatedAt,
  } as AnyBackgroundTask;

  if (normalized.kind === "terraform_preview" && normalized.result) {
    return {
      ...normalized,
      result: {
        ...normalized.result,
        failures: normalized.result.failures ?? [],
        coveredTargetIds: normalized.result.coveredTargetIds ?? [],
        uncoveredTargets: normalized.result.uncoveredTargets ?? [],
        fullyAddressed: normalized.result.fullyAddressed ?? true,
        suggestedBatches: normalized.result.suggestedBatches ?? [],
      },
    } as AnyBackgroundTask;
  }

  if (normalized.kind === "terraform_pr" && normalized.result) {
    return {
      ...normalized,
      result: {
        ...normalized.result,
        failures: normalized.result.failures ?? [],
        coveredTargetIds: normalized.result.coveredTargetIds ?? [],
        uncoveredTargets: normalized.result.uncoveredTargets ?? [],
        fullyAddressed: normalized.result.fullyAddressed ?? true,
        suggestedBatches: normalized.result.suggestedBatches ?? [],
      },
    } as AnyBackgroundTask;
  }

  return normalized;
}

export async function upsertBackgroundTask(userEmail: string, task: AnyBackgroundTask): Promise<void> {
  await ensureBackgroundTasksTable();
  await sql`
    INSERT INTO user_background_tasks (user_email, task_id, task_kind, task_status, task_data, dismissed, updated_at, created_at)
    VALUES (
      ${userEmail},
      ${task.id},
      ${task.kind},
      ${task.status},
      ${JSON.stringify(task)},
      FALSE,
      ${task.updatedAt},
      ${task.createdAt}
    )
    ON CONFLICT (user_email, task_id) DO UPDATE
      SET task_kind = EXCLUDED.task_kind,
          task_status = EXCLUDED.task_status,
          task_data = EXCLUDED.task_data,
          dismissed = FALSE,
          updated_at = EXCLUDED.updated_at
  `;
}

export async function getBackgroundTask(userEmail: string, taskId: string): Promise<AnyBackgroundTask | null> {
  await ensureBackgroundTasksTable();
  const result = await sql`
    SELECT task_data
    FROM user_background_tasks
    WHERE user_email = ${userEmail}
      AND task_id = ${taskId}
      AND dismissed = FALSE
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return normalizeBackgroundTask(result.rows[0].task_data as AnyBackgroundTask);
}
