import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getUserCloudCredentials } from "@/lib/credentials";
import {
  getDefaultBranchSha,
  createBranch,
  createFile,
  updateFile,
  createPullRequest,
} from "@/lib/github/client";
import { buildRemediationPlan } from "@/lib/github/terraform-remediation";
import { resolveAI, type AIProvider } from "@/lib/ai/client";
import { postToSlack } from "@/lib/alerting";
import type { AttackPath } from "@/lib/gcp/attack-paths";
import type { SecurityFinding } from "@/lib/gcp/types";
import { debugError, debugLog, withDebugTiming } from "@/lib/debug";
import {
  remediationTargetFromAttackPath,
  remediationTargetFromFinding,
  type RemediationTarget,
} from "@/lib/github/remediation-targets";
import type { RemediationPlan, RemediationProgressEvent } from "@/lib/github/terraform-remediation";

export const maxDuration = 300;

class IncompleteRemediationError extends Error {
  statusCode = 422;
}

interface RequestBody {
  repoFullName: string;
  defaultBranch: string;
  paths?: AttackPath[];
  findings?: SecurityFinding[];
  targets?: RemediationTarget[];
  stream?: boolean;
}

function sendStreamEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: unknown
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

async function executeCreatePrFlow(
  params: {
    email: string;
    token: string;
    owner: string;
    repo: string;
    repoFullName: string;
    defaultBranch: string;
    targets: RemediationTarget[];
    aiKey: { provider: AIProvider; key: string };
  },
  onProgress?: (progress: RemediationProgressEvent) => void
): Promise<{ remediationPlan: RemediationPlan; pr: { html_url: string; number: number } }> {
  const { email, token, owner, repo, repoFullName, defaultBranch, targets, aiKey } = params;
  const scope = "api/github/terraform-pr:POST";

  onProgress?.({
    stage: "build_plan",
    message: "Building remediation plan",
    percent: 5,
    metadata: { repoFullName, targetCount: targets.length },
  });

  const remediationPlan = await withDebugTiming(scope, "buildRemediationPlan", {
    repoFullName,
    targetCount: targets.length,
    aiProvider: aiKey.provider,
  }, () => buildRemediationPlan(
    token,
    owner,
    repo,
    targets,
    aiKey.provider,
    aiKey.key,
    { scope, onProgress }
  ));

  if (remediationPlan.patches.length === 0) {
    return { remediationPlan, pr: { html_url: "", number: 0 } };
  }

  if (!remediationPlan.fullyAddressed) {
    const uncoveredTitles = remediationPlan.uncoveredTargets.map((target) => target.title);
    throw new IncompleteRemediationError(
      `Refusing to open a partial remediation PR. ${remediationPlan.uncoveredTargets.length} selected item${remediationPlan.uncoveredTargets.length === 1 ? "" : "s"} remain uncovered: ${uncoveredTitles.join(", ")}`
    );
  }

  onProgress?.({
    stage: "create_branch",
    message: `Creating branch from ${defaultBranch}`,
    percent: 78,
    metadata: { defaultBranch },
  });
  const headSha = await withDebugTiming(scope, "getDefaultBranchSha", { repoFullName, defaultBranch }, () =>
    getDefaultBranchSha(token, owner, repo, defaultBranch)
  );

  const branchName = `watchmen-fix-${Date.now()}`;
  await withDebugTiming(scope, "createBranch", { repoFullName, branchName }, () =>
    createBranch(token, owner, repo, branchName, headSha)
  );

  const addressedTargets = targets.filter((target) => remediationPlan.coveredTargetIds.includes(target.id));
  const targetTitles = addressedTargets.map((target) => target.title).join(", ");
  let completed = 0;
  const totalOps = remediationPlan.patches.reduce((sum, patch) => sum + (patch.isNewFile ? 1 : 2), 0);

  for (const patch of remediationPlan.patches) {
    onProgress?.({
      stage: "commit_files",
      message: `Applying ${patch.path}`,
      completed,
      total: totalOps,
      percent: 82 + Math.round((completed / Math.max(totalOps, 1)) * 10),
      metadata: { path: patch.path, isNewFile: patch.isNewFile },
    });

    if (patch.isNewFile) {
      await withDebugTiming(scope, "createFile", { repoFullName, path: patch.path, branchName }, () =>
        createFile(
          token, owner, repo, patch.path, patch.fixedContent,
          `fix: generate ${patch.path} to remediate "${targetTitles}"`,
          branchName
        )
      );
      completed += 1;
    } else {
      const rootDir = patch.path.includes("/") ? patch.path.slice(0, patch.path.lastIndexOf("/") + 1) : "";
      const filename = patch.path.slice(rootDir.length).replace(/-faulty(\.tf)$/, "$1").replace(/\.tf$/, "-faulty.tf");
      const faultyPath = `${rootDir}.terraform-originals/${filename}`;

      await withDebugTiming(scope, "preserveOriginalFile", { repoFullName, path: faultyPath, branchName }, () =>
        createFile(
          token, owner, repo, faultyPath, patch.originalContent,
          `chore: preserve original ${patch.path} as ${faultyPath}`,
          branchName
        )
      );
      completed += 1;

      onProgress?.({
        stage: "commit_files",
        message: `Updating ${patch.path}`,
        completed,
        total: totalOps,
        percent: 82 + Math.round((completed / Math.max(totalOps, 1)) * 10),
        metadata: { path: patch.path, preservedOriginal: true },
      });

      await withDebugTiming(scope, "updateFile", { repoFullName, path: patch.path, branchName }, () =>
        updateFile(
          token, owner, repo, patch.path, patch.fixedContent, patch.sha,
          `fix: remediate "${targetTitles}" in ${patch.path}`,
          branchName
        )
      );
      completed += 1;
    }
  }

  const targetDetails = addressedTargets
    .map(
      (target) =>
        `### ${target.severity === "critical" ? "🔴" : target.severity === "high" ? "🟠" : "🟡"} ${target.title}\n${target.description}\n\n**Context:** ${target.kind === "attack_path" ? "Attack path" : "Finding"}\n\n**Mitigations applied:**\n${(target.mitigations.length > 0 ? target.mitigations : ["AI-generated least-privilege remediation"]).map((m) => `- ${m}`).join("\n")}`
    )
    .join("\n\n---\n\n");

  const changedFiles = remediationPlan.patches
    .map((p) => {
      if (p.isNewFile) return `- \`${p.path}\` — new file generated`;
      const rootDir = p.path.includes("/") ? p.path.slice(0, p.path.lastIndexOf("/") + 1) : "";
      const filename = p.path.slice(rootDir.length).replace(/-faulty(\.tf)$/, "$1").replace(/\.tf$/, "-faulty.tf");
      const faulty = `${rootDir}.terraform-originals/${filename}`;
      return `- \`${p.path}\` — fixed _(original preserved as \`${faulty}\`)_`;
    })
    .join("\n");

  const prBody = `## Watchmen Security Remediation

This pull request was automatically generated by [Watchmen](https://watchmen.app) to address the following attack paths detected in your cloud infrastructure.

### Files Changed
${changedFiles}

---

${targetDetails}

---

> **Note:** Review all changes carefully before merging. The AI-generated fixes apply the principle of least privilege but may need adjustment for your specific environment.`;

  onProgress?.({
    stage: "open_pull_request",
    message: "Opening GitHub pull request",
    percent: 94,
    metadata: { branchName },
  });
  const pr = await withDebugTiming(scope, "createPullRequest", { repoFullName, branchName }, () =>
    createPullRequest(
      token,
      owner,
      repo,
      `fix(security): remediate ${targets.length} security item${targets.length === 1 ? "" : "s"} [Watchmen]`,
      prBody,
      branchName,
      defaultBranch
    )
  );

  onProgress?.({
    stage: "notify",
    message: "Sending notifications",
    percent: 97,
    metadata: { prNumber: pr.number },
  });
  try {
    const alertResult = await sql`
      SELECT slack_bot_token, slack_channel_id FROM alert_rules WHERE user_email = ${email}
    `;
    if (alertResult.rows.length > 0) {
      const { slack_bot_token, slack_channel_id } = alertResult.rows[0];
      if (slack_bot_token && slack_channel_id) {
        const slackPayload = {
          text: `🔧 *Watchmen Security PR Created*`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🔧 *Watchmen Security PR Created*\n<${pr.html_url}|PR #${pr.number}> — ${remediationPlan.patches.length} Terraform file${remediationPlan.patches.length === 1 ? "" : "s"} updated in \`${repoFullName}\``,
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Security items addressed:*\n${addressedTargets.map((target) => `• ${target.title}`).join("\n")}`,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "View Pull Request" },
                  url: pr.html_url,
                  style: "primary",
                },
              ],
            },
          ],
        };
        await postToSlack(slack_bot_token, slack_channel_id, slackPayload);
      }
    }
  } catch {
    // Slack notification failure is non-fatal
  }

  onProgress?.({
    stage: "complete",
      message: `Pull request #${pr.number} created${remediationPlan.failures.length > 0 ? ` with ${remediationPlan.failures.length} failed file${remediationPlan.failures.length === 1 ? "" : "s"}` : ""}`,
    percent: 100,
    metadata: {
      prNumber: pr.number,
      prUrl: pr.html_url,
      patchCount: remediationPlan.patches.length,
      failureCount: remediationPlan.failures.length,
      coveredTargetCount: remediationPlan.coveredTargetIds.length,
    },
  });

  return { remediationPlan, pr };
}

export async function POST(req: NextRequest) {
  const scope = "api/github/terraform-pr:POST";
  // Auth
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email;

  // Parse body
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { repoFullName, defaultBranch } = body;
  const targets = Array.isArray(body.targets)
    ? body.targets
    : Array.isArray(body.findings)
      ? body.findings.map(remediationTargetFromFinding)
      : Array.isArray(body.paths)
        ? body.paths.map(remediationTargetFromAttackPath)
        : [];

  if (!repoFullName || !defaultBranch || targets.length === 0) {
    return NextResponse.json(
      { error: "repoFullName, defaultBranch, and at least one remediation target are required" },
      { status: 400 }
    );
  }

  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    return NextResponse.json({ error: "repoFullName must be in 'owner/repo' format" }, { status: 400 });
  }

  // GitHub token
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
  const token = creds.token;
  debugLog(scope, "request received", {
    email,
    repoFullName,
    defaultBranch,
    targetCount: targets.length,
    targetKinds: [...new Set(targets.map((target) => target.kind))],
  });

  // Resolve AI provider and key (user's configured key, or server demo fallback)
  let aiKey: { provider: AIProvider; key: string };
  try {
    aiKey = await resolveAI(email);
  } catch {
    return NextResponse.json(
      { error: "No AI API key configured. Please add one in Settings → AI Keys." },
      { status: 422 }
    );
  }

  try {
    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          const send = (event: unknown) => {
            if (closed) return;
            try {
              sendStreamEvent(controller, encoder, event);
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
                message: "Still running Terraform remediation workflow",
                percent: undefined,
              },
            });
          }, 10_000);
          void (async () => {
            try {
              const { remediationPlan, pr } = await executeCreatePrFlow(
                { email, token, owner, repo, repoFullName, defaultBranch, targets, aiKey },
                (progress) => send({ type: "progress", progress })
              );

              if (remediationPlan.patches.length === 0) {
                send({
                  type: "result",
                  ok: true,
                  message: remediationPlan.summary,
                  patchCount: 0,
                  failures: remediationPlan.failures,
                  coveredTargetIds: remediationPlan.coveredTargetIds,
                  uncoveredTargets: remediationPlan.uncoveredTargets,
                  fullyAddressed: remediationPlan.fullyAddressed,
                  suggestedBatches: remediationPlan.suggestedBatches,
                });
              } else {
                send({
                  type: "result",
                  ok: true,
                  prUrl: pr.html_url,
                  prNumber: pr.number,
                  patchCount: remediationPlan.patches.length,
                  message: remediationPlan.summary,
                  failures: remediationPlan.failures,
                  coveredTargetIds: remediationPlan.coveredTargetIds,
                  uncoveredTargets: remediationPlan.uncoveredTargets,
                  fullyAddressed: remediationPlan.fullyAddressed,
                  suggestedBatches: remediationPlan.suggestedBatches,
                });
              }
              close();
            } catch (err) {
              debugError(scope, "streamed terraform remediation PR flow failed", err, { email, repoFullName, defaultBranch, targetCount: targets.length });
              const msg = err instanceof Error ? err.message : "Failed to create PR";
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

    const { remediationPlan, pr } = await executeCreatePrFlow({
      email,
      token,
      owner,
      repo,
      repoFullName,
      defaultBranch,
      targets,
      aiKey,
    });

    if (remediationPlan.patches.length === 0) {
      debugLog(scope, "no patches generated", { repoFullName, summary: remediationPlan.summary });
      return NextResponse.json({
        ok: true,
        message: remediationPlan.summary,
        patchCount: 0,
        failures: remediationPlan.failures,
        coveredTargetIds: remediationPlan.coveredTargetIds,
        uncoveredTargets: remediationPlan.uncoveredTargets,
        fullyAddressed: remediationPlan.fullyAddressed,
        suggestedBatches: remediationPlan.suggestedBatches,
      });
    }

    return NextResponse.json({
      ok: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
      patchCount: remediationPlan.patches.length,
      message: remediationPlan.summary,
      failures: remediationPlan.failures,
      coveredTargetIds: remediationPlan.coveredTargetIds,
      uncoveredTargets: remediationPlan.uncoveredTargets,
      fullyAddressed: remediationPlan.fullyAddressed,
      suggestedBatches: remediationPlan.suggestedBatches,
    });
  } catch (err) {
    debugError(scope, "terraform remediation PR flow failed", err, { email, repoFullName, defaultBranch, targetCount: targets.length });
    console.error("[api/github/terraform-pr] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to create PR";
    const status =
      err instanceof IncompleteRemediationError
        ? err.statusCode
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
