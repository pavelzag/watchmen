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

interface RequestBody {
  repoFullName: string;
  defaultBranch: string;
  paths: AttackPath[];
}

export async function POST(req: NextRequest) {
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

  const { repoFullName, defaultBranch, paths } = body;

  if (!repoFullName || !defaultBranch || !paths?.length) {
    return NextResponse.json(
      { error: "repoFullName, defaultBranch, and paths are required" },
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
    // Build remediation plan (AI-powered)
    const remediationPlan = await buildRemediationPlan(token, owner, repo, paths, aiKey.provider, aiKey.key);

    if (remediationPlan.patches.length === 0) {
      return NextResponse.json({
        ok: true,
        message: remediationPlan.summary,
        patchCount: 0,
      });
    }

    // Get HEAD SHA of default branch
    const headSha = await getDefaultBranchSha(token, owner, repo, defaultBranch);

    // Create a new branch
    const branchName = `watchmen-fix-${Date.now()}`;
    await createBranch(token, owner, repo, branchName, headSha);

    // Commit each changed file:
    //  1. Save the original as <name>-faulty.tf for reference
    //  2. Overwrite the original path with the fixed content
    const attackPathTitles = paths.map((p) => p.title).join(", ");
    const faultyPaths: string[] = [];

    for (const patch of remediationPlan.patches) {
      if (patch.isNewFile) {
        await createFile(
          token, owner, repo, patch.path, patch.fixedContent,
          `fix: generate ${patch.path} to remediate "${attackPathTitles}"`,
          branchName
        );
      } else {
        const dir = patch.path.includes("/") ? patch.path.slice(0, patch.path.lastIndexOf("/") + 1) : "";
        const basename = patch.path.slice(dir.length).replace(/\.tf$/, "-faulty.tf");
        const faultyPath = `${dir}.terraform-originals/${basename}`;
        faultyPaths.push(faultyPath);

        await createFile(
          token, owner, repo, faultyPath, patch.originalContent,
          `chore: preserve original ${patch.path} as ${faultyPath}`,
          branchName
        );
        await updateFile(
          token, owner, repo, patch.path, patch.fixedContent, patch.sha,
          `fix: remediate "${attackPathTitles}" in ${patch.path}`,
          branchName
        );
      }
    }

    // Build PR body
    const pathDetails = paths
      .map(
        (p) =>
          `### ${p.severity === "critical" ? "🔴" : "🟠"} ${p.title}\n${p.description}\n\n**Mitigations applied:**\n${p.mitigations.map((m) => `- ${m}`).join("\n")}`
      )
      .join("\n\n---\n\n");

    const changedFiles = remediationPlan.patches
      .map((p) => {
        if (p.isNewFile) return `- \`${p.path}\` — new file generated`;
        const dir = p.path.includes("/") ? p.path.slice(0, p.path.lastIndexOf("/") + 1) : "";
        const basename = p.path.slice(dir.length).replace(/\.tf$/, "-faulty.tf");
        const faulty = `${dir}.terraform-originals/${basename}`;
        return `- \`${p.path}\` — fixed _(original preserved as \`${faulty}\`)_`;
      })
      .join("\n");

    const prBody = `## Watchmen Security Remediation

This pull request was automatically generated by [Watchmen](https://watchmen.app) to address the following attack paths detected in your cloud infrastructure.

### Files Changed
${changedFiles}

---

${pathDetails}

---

> **Note:** Review all changes carefully before merging. The AI-generated fixes apply the principle of least privilege but may need adjustment for your specific environment.`;

    // Open pull request
    const pr = await createPullRequest(
      token,
      owner,
      repo,
      `fix(security): remediate ${paths.length} attack path${paths.length === 1 ? "" : "s"} [Watchmen]`,
      prBody,
      branchName,
      defaultBranch
    );

    // Try to notify via Slack (best-effort)
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
                  text: `*Attack paths addressed:*\n${paths.map((p) => `• ${p.title}`).join("\n")}`,
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

    return NextResponse.json({
      ok: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
      patchCount: remediationPlan.patches.length,
    });
  } catch (err) {
    console.error("[api/github/terraform-pr] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to create PR";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
