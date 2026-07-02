import { NextRequest, NextResponse } from "next/server";
import { resolveAI } from "@/lib/ai/client";
import { auth } from "@/lib/auth";
import { rejectDemoAi } from "@/lib/ai/demo";
import { getUserCloudCredentials } from "@/lib/credentials";
import { remediationTargetFromAttackPath, remediationTargetFromFinding, type RemediationTarget } from "@/lib/github/remediation-targets";
import { executeTerraformPrFlow } from "@/lib/github/terraform-pr-flow";
import { isTerraformVerboseEnabled, logTerraformError, logTerraformInfo, logTerraformWarn } from "@/lib/github/terraform-logging";
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

function createTaskStream(email: string, taskId: string): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let lastProgressCount = 0;
  let pollCount = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          while (!closed) {
            pollCount += 1;
            logTerraformInfo("api/github/terraform-pr:stream", "poll", {
              email,
              taskId,
              pollCount,
              lastProgressCount,
            });
            const snapshot = await getBackgroundTask(email, taskId);
            if (!snapshot) {
              logTerraformWarn("api/github/terraform-pr:stream", "snapshot_missing", {
                email,
                taskId,
                pollCount,
              });
              sendTaskEvent(controller, encoder, { type: "error", error: "Terraform PR task not found." });
              logTerraformInfo("api/github/terraform-pr:stream", "emit_error", {
                taskId,
                reason: "snapshot_missing",
              });
              closed = true;
              logTerraformInfo("api/github/terraform-pr:stream", "closing", {
                taskId,
                reason: "snapshot_missing",
              });
              controller.close();
              return;
            }

            logTerraformInfo("api/github/terraform-pr:stream", "snapshot", {
              email,
              taskId,
              pollCount,
              status: snapshot.status,
              progressCount: snapshot.progress.length,
              percent: snapshot.percent,
              lastProgressAt: snapshot.lastProgressAt,
            });

            const newProgress = snapshot.progress.slice(lastProgressCount);
            if (newProgress.length > 0) {
              logTerraformInfo("api/github/terraform-pr:stream", "emit_progress", {
                email,
                taskId,
                pollCount,
                newProgressCount: newProgress.length,
                progressCount: snapshot.progress.length,
              });
            }
            for (const progress of newProgress) {
              sendTaskEvent(controller, encoder, { type: "progress", progress });
            }
            lastProgressCount = snapshot.progress.length;

            if (snapshot.status === "completed") {
              const result = snapshot.result as TaskResultMap["terraform_pr"] | undefined;
              logTerraformInfo("api/github/terraform-pr:stream", "emit_result", {
                email,
                taskId,
                pollCount,
                progressCount: snapshot.progress.length,
                hasResult: Boolean(result),
                prNumber: result?.prNumber,
                prUrl: result?.prUrl,
              });
              sendTaskEvent(controller, encoder, { type: "result", ...(result ?? {}) });
              closed = true;
              logTerraformInfo("api/github/terraform-pr:stream", "closing", {
                taskId,
                reason: "completed",
              });
              controller.close();
              return;
            }

            if (snapshot.status === "failed") {
              logTerraformWarn("api/github/terraform-pr:stream", "emit_error", {
                email,
                taskId,
                pollCount,
                error: snapshot.error ?? "Terraform PR creation failed.",
              });
              sendTaskEvent(controller, encoder, { type: "error", error: snapshot.error ?? "Terraform PR creation failed." });
              closed = true;
              logTerraformInfo("api/github/terraform-pr:stream", "closing", {
                taskId,
                reason: "failed",
              });
              controller.close();
              return;
            }

            sendTaskEvent(controller, encoder, {
              type: "heartbeat",
              progress: snapshot.progress.at(-1),
            });
            logTerraformInfo("api/github/terraform-pr:stream", "heartbeat", {
              email,
              taskId,
              pollCount,
              progressCount: snapshot.progress.length,
              percent: snapshot.percent,
            });

            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          logTerraformInfo("api/github/terraform-pr:stream", "closing", {
            taskId,
            reason: "cancelled",
          });
        } catch (error) {
          logTerraformError("api/github/terraform-pr:stream", "stream_failed", error, {
            email,
            taskId,
            pollCount,
          });
          sendTaskEvent(controller, encoder, {
            type: "error",
            error: error instanceof Error ? error.message : "Terraform PR streaming failed.",
          });
          closed = true;
          try {
            controller.close();
          } catch {
            // Ignore close races.
          }
        }
      })();
    },
    cancel() {
      closed = true;
      logTerraformInfo("api/github/terraform-pr:stream", "cancelled", {
        email,
        taskId,
        pollCount,
      });
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
  const scope = "api/github/terraform-pr:POST";
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email;

  const demoBlocked = rejectDemoAi(session);
  if (demoBlocked) return demoBlocked;

  let body: RequestBody;
  try {
    body = (await req.json().catch(() => ({}))) as RequestBody;
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

  const task = createBackgroundTask("terraform_pr", {
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

        const [ownerName, repoName] = repoFullName.split("/");
        const { remediationPlan, pr } = await executeTerraformPrFlow(
          {
            email,
            token: creds.token,
            owner: ownerName,
            repo: repoName,
            repoFullName,
            defaultBranch: body.defaultBranch,
            targets,
            aiKey: {
              provider: ai.provider,
              key: ai.key,
            },
          },
          (progress) => {
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
              status: "running" as const,
              updatedAt: now,
              lastProgressAt: now,
              percent: progress.percent ?? runningTask.percent,
              progress: [...runningTask.progress, progress].slice(-12),
            };
            runningTask.updatedAt = updatedTask.updatedAt;
            runningTask.lastProgressAt = updatedTask.lastProgressAt;
            runningTask.percent = updatedTask.percent;
            runningTask.progress = updatedTask.progress;
            void upsertBackgroundTask(email, updatedTask).catch(() => {});
          }
        );

        const completedTask = {
          ...runningTask,
          status: "completed" as const,
          updatedAt: new Date().toISOString(),
          lastProgressAt: runningTask.lastProgressAt ?? runningTask.updatedAt,
          percent: 100,
          result: {
            ok: true,
            repoFullName,
            defaultBranch: body.defaultBranch,
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
            targets,
          },
        };
        await upsertBackgroundTask(email, completedTask);
        logTerraformInfo(scope, "task_completed", {
          taskId: task.id,
          repoFullName,
          prNumber: pr.number,
          prUrl: pr.html_url,
          patchCount: remediationPlan.patches.length,
          failureCount: remediationPlan.failures.length,
        });
        return completedTask.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create PR";
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
    const message = error instanceof Error ? error.message : "Failed to create PR";
    console.error("[api/github/terraform-pr] error:", error);
    logTerraformError(scope, "request_failed", error, {
      taskId: task.id,
      repoFullName,
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
