import { getUserCloudCredentials } from "@/lib/credentials";
import { resolveAI, type AIProvider } from "@/lib/ai/client";
import { buildRemediationPlan, type RemediationPlan, type RemediationProgressEvent } from "@/lib/github/terraform-remediation";
import { executeTerraformPrFlow } from "@/lib/github/terraform-pr-flow";
import { createBackgroundTask, upsertBackgroundTask } from "@/lib/tasks/store";
import type { RemediationTarget } from "@/lib/github/remediation-targets";
import type { AnyBackgroundTask, BackgroundTask, BackgroundTaskKind, TaskResultMap } from "@/lib/tasks/types";

const MAX_PROGRESS_ENTRIES = 12;

export interface DurableTerraformPreviewInput {
  userEmail: string;
  taskId: string;
  repoFullName: string;
  defaultBranch: string;
  targets: RemediationTarget[];
}

export interface DurableTerraformPrInput extends DurableTerraformPreviewInput {}

interface WorkflowDeps {
  githubToken: string;
  aiProvider: AIProvider;
  aiKey: string;
}

type TerraformPreviewTask = BackgroundTask<"terraform_preview">;
type TerraformPrTask = BackgroundTask<"terraform_pr">;

function nowIso(): string {
  return new Date().toISOString();
}

async function loadWorkflowDeps(userEmail: string) {
  "use step";

  const [creds, ai] = await Promise.all([
    getUserCloudCredentials(userEmail, "github"),
    resolveAI(userEmail),
  ]);

  if (!creds?.token) {
    throw new Error("GitHub token not configured");
  }

  return {
    githubToken: creds.token,
    aiProvider: ai.provider,
    aiKey: ai.key,
  } satisfies WorkflowDeps;
}

async function persistTaskState(userEmail: string, task: AnyBackgroundTask) {
  "use step";

  await upsertBackgroundTask(userEmail, task);
  return task;
}

function progressTask<K extends BackgroundTaskKind>(
  task: BackgroundTask<K>,
  progress: RemediationProgressEvent
): BackgroundTask<K> {
  const updatedAt = nowIso();
  return {
    ...task,
    status: "running" as const,
    updatedAt,
    lastProgressAt: updatedAt,
    percent: progress.percent ?? task.percent,
    progress: [...task.progress.slice(-(MAX_PROGRESS_ENTRIES - 1)), progress],
  } as BackgroundTask<K>;
}

function buildPreviewResult(
  plan: RemediationPlan,
  input: DurableTerraformPreviewInput
): TaskResultMap["terraform_preview"] {
  return {
    ok: true,
    repoFullName: input.repoFullName,
    defaultBranch: input.defaultBranch,
    patches: plan.patches,
    failures: plan.failures,
    coveredTargetIds: plan.coveredTargetIds,
    uncoveredTargets: plan.uncoveredTargets,
    fullyAddressed: plan.fullyAddressed,
    suggestedBatches: plan.suggestedBatches,
    summary: plan.summary,
    targets: input.targets,
  };
}

function buildPrResult(
  remediationPlan: RemediationPlan,
  pr: { html_url: string; number: number },
  input: DurableTerraformPrInput
): TaskResultMap["terraform_pr"] {
  return {
    ok: true,
    repoFullName: input.repoFullName,
    defaultBranch: input.defaultBranch,
    prUrl: pr.html_url,
    prNumber: pr.number,
    patchCount: remediationPlan.patches.length,
    message: pr.html_url
      ? `Pull request #${pr.number} created`
      : remediationPlan.patches.length === 0
        ? "No changes were needed."
        : "Remediation completed without creating a pull request.",
    failures: remediationPlan.failures,
    coveredTargetIds: remediationPlan.coveredTargetIds,
    uncoveredTargets: remediationPlan.uncoveredTargets,
    fullyAddressed: remediationPlan.fullyAddressed,
    suggestedBatches: remediationPlan.suggestedBatches,
    targets: input.targets,
  };
}

async function runPreviewWorkflow(input: DurableTerraformPreviewInput, deps: WorkflowDeps): Promise<TaskResultMap["terraform_preview"]> {
  "use step";

  let task: TerraformPreviewTask = createBackgroundTask("terraform_preview", {
    repoFullName: input.repoFullName,
    defaultBranch: input.defaultBranch,
    targets: input.targets,
  }, {
    id: input.taskId,
    status: "running",
  });
  await persistTaskState(input.userEmail, task);

  const persist: Promise<void>[] = [];
  try {
    const plan = await buildRemediationPlan(
      deps.githubToken,
      input.repoFullName.split("/")[0],
      input.repoFullName.split("/")[1],
      input.targets,
      deps.aiProvider,
      deps.aiKey,
      {
        scope: `workflow/terraform-preview:${input.taskId}`,
        onProgress: (progress) => {
          task = progressTask(task, progress);
          persist.push(upsertBackgroundTask(input.userEmail, task).catch(() => {}));
        },
      }
    );

    await Promise.allSettled(persist);
    const result = buildPreviewResult(plan, input);
    task = {
      ...task,
      status: "completed",
      updatedAt: nowIso(),
      lastProgressAt: task.lastProgressAt ?? task.updatedAt,
      percent: 100,
      result,
    };
    await persistTaskState(input.userEmail, task);
    return result;
  } catch (error) {
    await Promise.allSettled(persist);
    const message = error instanceof Error ? error.message : "Failed to generate Terraform preview.";
    task = {
      ...task,
      status: "failed",
      updatedAt: nowIso(),
      lastProgressAt: task.lastProgressAt ?? task.updatedAt,
      error: message,
    };
    await persistTaskState(input.userEmail, task);
    throw error;
  }
}

async function runPrWorkflow(input: DurableTerraformPrInput, deps: WorkflowDeps): Promise<TaskResultMap["terraform_pr"]> {
  "use step";

  let task: TerraformPrTask = createBackgroundTask("terraform_pr", {
    repoFullName: input.repoFullName,
    defaultBranch: input.defaultBranch,
    targets: input.targets,
  }, {
    id: input.taskId,
    status: "running",
  });
  await persistTaskState(input.userEmail, task);

  const persist: Promise<void>[] = [];
  try {
    const [owner, repo] = input.repoFullName.split("/");
    const { remediationPlan, pr } = await executeTerraformPrFlow(
      {
        email: input.userEmail,
        token: deps.githubToken,
        owner,
        repo,
        repoFullName: input.repoFullName,
        defaultBranch: input.defaultBranch,
        targets: input.targets,
        aiKey: {
          provider: deps.aiProvider,
          key: deps.aiKey,
        },
      },
      (progress) => {
        task = progressTask(task, progress);
        persist.push(upsertBackgroundTask(input.userEmail, task).catch(() => {}));
      }
    );

    await Promise.allSettled(persist);
    const result = buildPrResult(remediationPlan, pr, input);
    task = {
      ...task,
      status: "completed",
      updatedAt: nowIso(),
      lastProgressAt: task.lastProgressAt ?? task.updatedAt,
      percent: 100,
      result,
    };
    await persistTaskState(input.userEmail, task);
    return result;
  } catch (error) {
    await Promise.allSettled(persist);
    const message = error instanceof Error ? error.message : "Failed to create Terraform PR.";
    task = {
      ...task,
      status: "failed",
      updatedAt: nowIso(),
      lastProgressAt: task.lastProgressAt ?? task.updatedAt,
      error: message,
    };
    await persistTaskState(input.userEmail, task);
    throw error;
  }
}

export async function terraformPreviewWorkflow(input: DurableTerraformPreviewInput) {
  "use workflow";

  try {
    const deps = await loadWorkflowDeps(input.userEmail);
    return await runPreviewWorkflow(input, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate Terraform preview.";
    await persistTaskState(input.userEmail, createBackgroundTask("terraform_preview", {
      repoFullName: input.repoFullName,
      defaultBranch: input.defaultBranch,
      targets: input.targets,
    }, {
      id: input.taskId,
      status: "failed",
      error: message,
    }));
    throw error;
  }
}

export async function terraformPrWorkflow(input: DurableTerraformPrInput) {
  "use workflow";

  try {
    const deps = await loadWorkflowDeps(input.userEmail);
    return await runPrWorkflow(input, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create Terraform PR.";
    await persistTaskState(input.userEmail, createBackgroundTask("terraform_pr", {
      repoFullName: input.repoFullName,
      defaultBranch: input.defaultBranch,
      targets: input.targets,
    }, {
      id: input.taskId,
      status: "failed",
      error: message,
    }));
    throw error;
  }
}
