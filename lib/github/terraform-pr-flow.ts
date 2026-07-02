import { sql } from "@/lib/db";
import { getDefaultBranchSha, createBranch, createFile, updateFile, createPullRequest } from "@/lib/github/client";
import { buildRemediationPlan, type RemediationPlan, type RemediationProgressEvent } from "@/lib/github/terraform-remediation";
import { debugLog, withDebugTiming } from "@/lib/debug";
import { logTerraformError, logTerraformInfo, logTerraformWarn } from "@/lib/github/terraform-logging";
import { postToSlack } from "@/lib/alerting";
import type { AIProvider } from "@/lib/ai/client";
import type { RemediationTarget } from "@/lib/github/remediation-targets";

export class IncompleteRemediationError extends Error {
  statusCode = 422;
}

export async function executeTerraformPrFlow(
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

  logTerraformInfo(scope, "flow_start", {
    repoFullName,
    owner,
    repo,
    defaultBranch,
    targetCount: targets.length,
    aiProvider: aiKey.provider,
  });

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

  logTerraformInfo(scope, "plan_ready", {
    repoFullName,
    patchCount: remediationPlan.patches.length,
    failureCount: remediationPlan.failures.length,
    coveredTargetCount: remediationPlan.coveredTargetIds.length,
    uncoveredTargetCount: remediationPlan.uncoveredTargets.length,
    fullyAddressed: remediationPlan.fullyAddressed,
    summary: remediationPlan.summary,
  });

  if (remediationPlan.patches.length === 0) {
    logTerraformWarn(scope, "no_patches_generated", {
      repoFullName,
      targetCount: targets.length,
      failureCount: remediationPlan.failures.length,
    });
    return { remediationPlan, pr: { html_url: "", number: 0 } };
  }

  if (!remediationPlan.fullyAddressed) {
    const uncoveredTitles = remediationPlan.uncoveredTargets.map((target) => target.title);
    logTerraformWarn(scope, "partial_remediation_blocked", {
      repoFullName,
      uncoveredCount: remediationPlan.uncoveredTargets.length,
      uncoveredTitles,
    });
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
  logTerraformInfo(scope, "create_branch_start", {
    repoFullName,
    defaultBranch,
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
  logTerraformInfo(scope, "commit_phase_start", {
    repoFullName,
    branchName,
    patchCount: remediationPlan.patches.length,
    totalOps,
    addressedTargetCount: addressedTargets.length,
  });

  for (const patch of remediationPlan.patches) {
    logTerraformInfo(scope, "apply_patch_start", {
      repoFullName,
      branchName,
      path: patch.path,
      isNewFile: patch.isNewFile === true,
      completed,
      totalOps,
    });
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
      logTerraformInfo(scope, "apply_patch_created", {
        repoFullName,
        branchName,
        path: patch.path,
      });
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
      logTerraformInfo(scope, "apply_patch_preserved_original", {
        repoFullName,
        branchName,
        path: faultyPath,
        sourcePath: patch.path,
      });

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
      logTerraformInfo(scope, "apply_patch_updated", {
        repoFullName,
        branchName,
        path: patch.path,
      });
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
  logTerraformInfo(scope, "pr_creation_start", {
    repoFullName,
    branchName,
    defaultBranch,
    addressedTargetCount: addressedTargets.length,
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
  logTerraformInfo(scope, "pr_created", {
    repoFullName,
    branchName,
    prNumber: pr.number,
    prUrl: pr.html_url,
  });

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
        await postToSlack(slack_bot_token, slack_channel_id, {
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
        });
      }
    }
  } catch (error) {
    debugLog(scope, "slack notification skipped", { error: error instanceof Error ? error.message : String(error) });
    logTerraformWarn(scope, "slack_notification_skipped", {
      repoFullName,
      branchName,
    });
  }

  onProgress?.({
    stage: "complete",
    message: pr.html_url ? `Created PR #${pr.number}` : "Remediation completed",
    percent: 100,
    metadata: { prNumber: pr.number, prUrl: pr.html_url },
  });
  logTerraformInfo(scope, "flow_complete", {
    repoFullName,
    branchName,
    prNumber: pr.number,
    prUrl: pr.html_url,
    patchCount: remediationPlan.patches.length,
    failureCount: remediationPlan.failures.length,
  });

  return { remediationPlan, pr };
}
