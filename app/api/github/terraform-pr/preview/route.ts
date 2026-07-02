import { NextRequest, NextResponse } from "next/server";
import { resolveAI } from "@/lib/ai/client";
import { auth } from "@/lib/auth";
import { rejectDemoAi } from "@/lib/ai/demo";
import { getUserCloudCredentials } from "@/lib/credentials";
import { buildRemediationBatchSuggestions, remediationTargetFromAttackPath, remediationTargetFromFinding, shouldAutoSplitRemediationTargets, type RemediationTarget } from "@/lib/github/remediation-targets";
import { buildRemediationPlan, type RemediationProgressEvent } from "@/lib/github/terraform-remediation";
import { debugLog } from "@/lib/debug";
import { isTerraformVerboseEnabled, logTerraformError, logTerraformInfo } from "@/lib/github/terraform-logging";
import { createBackgroundTask, getBackgroundTask, upsertBackgroundTask } from "@/lib/tasks/store";
import type { TaskResultMap } from "@/lib/tasks/types";
import type { AttackPath } from "@/lib/gcp/attack-paths";
import type { SecurityFinding } from "@/lib/gcp/types";

export const maxDuration = 300;

interface RequestBody {
  repoFullName: string;
  defaultBranch: string;
  taskId?: string;
  paths?: AttackPath[];
  findings?: SecurityFinding[];
  targets?: RemediationTarget[];
  stream?: boolean;
}

function sendTaskEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: unknown
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function createSplitResult(targets: RemediationTarget[]) {
  const suggestedBatches = buildRemediationBatchSuggestions(targets);
  return {
    ok: true,
    patches: [],
    summary: `Split ${targets.length} selected items into ${suggestedBatches.length} smaller remediation batch${suggestedBatches.length === 1 ? "" : "es"}.`,
    failures: [],
    coveredTargetIds: [],
    uncoveredTargets: targets,
    fullyAddressed: false,
    suggestedBatches,
  };
}

function createTaskStream(
  email: string,
  taskId: string
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let lastProgressCount = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Ignore late close races.
        }
      };

      void (async () => {
        try {
          while (!closed) {
            const snapshot = await getBackgroundTask(email, taskId);
            if (!snapshot) {
              sendTaskEvent(controller, encoder, { type: "error", error: "Terraform preview task not found." });
              close();
              return;
            }

            const newProgress = snapshot.progress.slice(lastProgressCount);
            for (const progress of newProgress) {
              sendTaskEvent(controller, encoder, { type: "progress", progress });
            }
            lastProgressCount = snapshot.progress.length;

            if (snapshot.status === "completed") {
              sendTaskEvent(controller, encoder, { type: "result", ...(snapshot.result as TaskResultMap["terraform_preview"]) });
              close();
              return;
            }

            if (snapshot.status === "failed") {
              sendTaskEvent(controller, encoder, { type: "error", error: snapshot.error ?? "Terraform preview failed." });
              close();
              return;
            }

            sendTaskEvent(controller, encoder, {
              type: "heartbeat",
              progress: snapshot.progress.at(-1),
            });

            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        } catch (error) {
          sendTaskEvent(controller, encoder, {
            type: "error",
            error: error instanceof Error ? error.message : "Terraform preview streaming failed.",
          });
          close();
        }
      })();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export async function POST(req: NextRequest) {
  const scope = "api/github/terraform-pr/preview:POST";
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email;

  const demoBlocked = rejectDemoAi(session);
  if (demoBlocked) return demoBlocked;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { repoFullName } = body;
  const targets = Array.isArray(body.targets)
    ? body.targets
    : Array.isArray(body.findings)
      ? body.findings.map(remediationTargetFromFinding)
      : Array.isArray(body.paths)
        ? body.paths.map(remediationTargetFromAttackPath)
        : [];

  if (!repoFullName || targets.length === 0) {
    return NextResponse.json({ error: "repoFullName and at least one remediation target are required" }, { status: 400 });
  }

  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    return NextResponse.json({ error: "repoFullName must be in 'owner/repo' format" }, { status: 400 });
  }

  logTerraformInfo(scope, "request_received", {
    repoFullName,
    targetCount: targets.length,
    stream: body.stream === true,
    taskId: body.taskId,
  });

  if (shouldAutoSplitRemediationTargets(targets)) {
    const splitResult = createSplitResult(targets);
    debugLog(scope, "preview auto-split", {
      repoFullName,
      targetCount: targets.length,
      batchCount: splitResult.suggestedBatches.length,
    });
    logTerraformInfo(scope, "auto_split", {
      repoFullName,
      targetCount: targets.length,
      batchCount: splitResult.suggestedBatches.length,
    });

    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "result", ...splitResult })}\n`));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    return NextResponse.json(splitResult);
  }

  const task = createBackgroundTask("terraform_preview", {
    repoFullName,
    defaultBranch: body.defaultBranch,
    targets,
  }, {
    id: body.taskId,
    status: "queued",
  });

  await upsertBackgroundTask(email, task);
  logTerraformInfo(scope, "task_queued", {
    taskId: task.id,
    repoFullName,
    targetCount: targets.length,
  });

  try {
    const runningTask = {
      ...task,
      status: "running" as const,
      updatedAt: new Date().toISOString(),
      lastProgressAt: task.lastProgressAt ?? task.updatedAt,
    };
    await upsertBackgroundTask(email, runningTask);
    logTerraformInfo(scope, "task_running", {
      taskId: task.id,
      repoFullName,
    });

    const execution = (async () => {
      try {
        const [owner, repoName] = repoFullName.split("/");
        const [creds, ai] = await Promise.all([
          getUserCloudCredentials(email, "github"),
          resolveAI(email),
        ]);
        if (!creds?.token) {
          throw new Error("GitHub token not configured");
        }
        logTerraformInfo(scope, "credentials_loaded", {
          taskId: task.id,
          repoFullName,
          aiProvider: ai.provider,
        });

        const progressPersists: Promise<void>[] = [];
        const plan = await buildRemediationPlan(
          creds.token,
          owner,
          repoName,
          targets,
          ai.provider,
          ai.key,
          {
            scope: `api/github/terraform-pr/preview:${task.id}`,
            onProgress: (progress: RemediationProgressEvent) => {
              if (isTerraformVerboseEnabled()) {
                logTerraformInfo(scope, "progress", {
                  taskId: task.id,
                  repoFullName,
                  stage: progress.stage,
                  percent: progress.percent,
                  message: progress.message,
                  metadata: progress.metadata,
                });
              }
              const now = new Date().toISOString();
              const updatedTask = {
                ...runningTask,
                updatedAt: now,
                lastProgressAt: now,
                status: "running" as const,
                percent: progress.percent ?? runningTask.percent,
                progress: [...runningTask.progress, progress].slice(-12),
              };
              runningTask.updatedAt = updatedTask.updatedAt;
              runningTask.lastProgressAt = updatedTask.lastProgressAt;
              runningTask.percent = updatedTask.percent;
              runningTask.progress = updatedTask.progress;
              progressPersists.push(upsertBackgroundTask(email, updatedTask).catch(() => {}));
            },
          }
        );

        await Promise.allSettled(progressPersists);
        logTerraformInfo(scope, "plan_ready", {
          taskId: task.id,
          repoFullName,
          patchCount: plan.patches.length,
          failureCount: plan.failures.length,
          coveredTargetCount: plan.coveredTargetIds.length,
          uncoveredTargetCount: plan.uncoveredTargets.length,
          fullyAddressed: plan.fullyAddressed,
        });
        const result: TaskResultMap["terraform_preview"] = {
          ok: true,
          repoFullName,
          defaultBranch: body.defaultBranch,
          patches: plan.patches,
          failures: plan.failures,
          coveredTargetIds: plan.coveredTargetIds,
          uncoveredTargets: plan.uncoveredTargets,
          fullyAddressed: plan.fullyAddressed,
          suggestedBatches: plan.suggestedBatches,
          summary: plan.summary,
          targets,
        };

        const completedTask = {
          ...runningTask,
          status: "completed" as const,
          updatedAt: new Date().toISOString(),
          lastProgressAt: runningTask.lastProgressAt ?? runningTask.updatedAt,
          percent: 100,
          result,
        };
        await upsertBackgroundTask(email, completedTask);
        logTerraformInfo(scope, "task_completed", {
          taskId: task.id,
          repoFullName,
          patchCount: result.patches.length,
          failureCount: result.failures.length,
          fullyAddressed: result.fullyAddressed,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Analysis failed";
        logTerraformError(scope, "task_failed", error, {
          taskId: task.id,
          repoFullName,
        });
        await upsertBackgroundTask(email, {
          ...task,
          ...runningTask,
          status: "failed",
          error: message,
          updatedAt: new Date().toISOString(),
        });
        throw error;
      }
    })();

    if (body.stream) {
      void execution.catch(() => {});
      return createTaskStream(email, task.id);
    }

    const result = await execution;
    return NextResponse.json({ taskId: task.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    console.error("[api/github/terraform-pr/preview] error:", error);
    logTerraformError(scope, "request_failed", error, {
      repoFullName,
      taskId: task.id,
    });
    await upsertBackgroundTask(email, {
      ...task,
      status: "failed",
      error: message,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
