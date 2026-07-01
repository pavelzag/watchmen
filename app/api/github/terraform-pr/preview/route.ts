import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCloudCredentials } from "@/lib/credentials";
import { buildRemediationPlan } from "@/lib/github/terraform-remediation";
import {
  buildRemediationBatchSuggestions,
  remediationTargetFromAttackPath,
  remediationTargetFromFinding,
  shouldAutoSplitRemediationTargets,
  type RemediationTarget,
} from "@/lib/github/remediation-targets";
import { debugError, debugLog, withDebugTiming } from "@/lib/debug";
import { resolveAI } from "@/lib/ai/client";
import type { AttackPath } from "@/lib/gcp/attack-paths";
import type { SecurityFinding } from "@/lib/gcp/types";

export const maxDuration = 300;

interface RequestBody {
  repoFullName: string;
  defaultBranch: string;
  paths?: AttackPath[];
  findings?: SecurityFinding[];
  targets?: RemediationTarget[];
  stream?: boolean;
}

/**
 * POST /api/github/terraform-pr/preview
 * Returns the remediation plan (patches) without creating a branch or PR.
 * Used by the UI to show a diff preview before the user confirms.
 */
export async function POST(req: NextRequest) {
  const scope = "api/github/terraform-pr/preview:POST";
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email;

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

  if (shouldAutoSplitRemediationTargets(targets)) {
    const suggestedBatches = buildRemediationBatchSuggestions(targets);
    const splitResult = {
      patches: [],
      summary: `Split ${targets.length} selected items into ${suggestedBatches.length} smaller remediation batch${suggestedBatches.length === 1 ? "" : "es"}.`,
      failures: [],
      coveredTargetIds: [],
      uncoveredTargets: targets,
      fullyAddressed: false,
      suggestedBatches,
    };

    debugLog(scope, "preview auto-split", {
      repoFullName,
      targetCount: targets.length,
      batchCount: suggestedBatches.length,
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

  let creds: Record<string, string> | null = null;
  try {
    creds = await Promise.race([
      getUserCloudCredentials(email, "github"),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("DB timeout")), 8_000)
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load credentials";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  if (!creds?.token) {
    return NextResponse.json(
      { error: "GitHub token not configured", tokenRequired: true },
      { status: 422 }
    );
  }

  let aiKey: Awaited<ReturnType<typeof resolveAI>>;
  try {
    aiKey = await resolveAI(email);
  } catch {
    return NextResponse.json(
      { error: "No AI API key configured. Please add one in Settings → AI Keys." },
      { status: 422 }
    );
  }

  try {
    debugLog(scope, "request received", {
      email,
      repoFullName,
      defaultBranch: body.defaultBranch,
      targetCount: targets.length,
      targetKinds: [...new Set(targets.map((target) => target.kind))],
    });
    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          const send = (event: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            } catch {
              closed = true;
            }
          };
          const close = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            try {
              controller.close();
            } catch {
              // Ignore double-close and late close races.
            }
          };
          const heartbeat = setInterval(() => {
            send({
              type: "heartbeat",
              progress: {
                stage: "build_plan",
                message: "Still building Terraform preview",
                percent: undefined,
              },
            });
          }, 10_000);

          void (async () => {
            try {
              const plan = await withDebugTiming(scope, "buildRemediationPlan", {
                repoFullName,
                targetCount: targets.length,
                aiProvider: aiKey.provider,
              }, () => buildRemediationPlan(
                creds.token,
                owner,
                repo,
                targets,
                aiKey.provider,
                aiKey.key,
                {
                  scope,
                  onProgress: (progress) => send({ type: "progress", progress }),
                }
              ));
              if (plan.patches.length === 0) {
                debugLog(scope, "no patches generated", {
                  repoFullName,
                  summary: plan.summary,
                  targetCount: targets.length,
                  suggestedBatchCount: plan.suggestedBatches.length,
                });
              }
              send({
                type: "result",
                patches: plan.patches,
                summary: plan.summary,
                failures: plan.failures,
                coveredTargetIds: plan.coveredTargetIds,
                uncoveredTargets: plan.uncoveredTargets,
                fullyAddressed: plan.fullyAddressed,
                suggestedBatches: plan.suggestedBatches,
              });
              close();
            } catch (err) {
              debugError(scope, "streamed preview generation failed", err, { email, repoFullName, targetCount: targets.length });
              const msg = err instanceof Error ? err.message : "Analysis failed";
              send({ type: "error", error: msg });
              close();
            }
          })();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    const plan = await withDebugTiming(scope, "buildRemediationPlan", {
      repoFullName,
      targetCount: targets.length,
      aiProvider: aiKey.provider,
    }, () => buildRemediationPlan(creds.token, owner, repo, targets, aiKey.provider, aiKey.key, { scope }));
    if (plan.patches.length === 0) {
      debugLog(scope, "no patches generated", {
        repoFullName,
        summary: plan.summary,
        targetCount: targets.length,
        suggestedBatchCount: plan.suggestedBatches.length,
      });
    }
    return NextResponse.json({
      patches: plan.patches,
      summary: plan.summary,
      failures: plan.failures,
      coveredTargetIds: plan.coveredTargetIds,
      uncoveredTargets: plan.uncoveredTargets,
      fullyAddressed: plan.fullyAddressed,
      suggestedBatches: plan.suggestedBatches,
    });
  } catch (err) {
    debugError(scope, "preview generation failed", err, { email, repoFullName, targetCount: targets.length });
    console.error("[api/github/terraform-pr/preview] error:", err);
    const msg = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
