import {
  buildRemediationBatchSuggestions,
  remediationTargetFromAttackPath,
  remediationTargetFromFinding,
  type RemediationBatchCategory,
  type RemediationTarget,
} from "@/lib/github/remediation-targets";
import type { AttackPath } from "@/lib/gcp/attack-paths";
import type { SecurityFinding, SecurityFindingSeverity } from "@/lib/gcp/types";

export type HandoffTool = "any" | "opencode" | "claude" | "codex";
export type HandoffBatchMode = "grouped" | "combined" | "individual";
export type HandoffTaskStatus = "open" | "claimed" | "in_progress" | "completed" | "dismissed";

export interface HandoffIssueItem {
  id: string;
  kind: "finding" | "attack_path";
  cloud: "gcp" | "aws";
  severity: SecurityFindingSeverity;
  title: string;
  description: string;
  resourceName: string;
  resourceType?: string;
  projectId: string;
  region?: string;
  remediationHint?: string;
  mitigations?: string[];
  investigationReport?: string;
  proposedPlan?: string;
}

export interface LastVerificationSummary {
  verifiedAt: string;
  allResolved: boolean;
  resolvedCount: number;
  remainingCount: number;
  resolvedIds: string[];
  remainingIds: string[];
  summary: string;
  report?: string;
  runId?: string;
}

export interface HandoffTaskPayload {
  version: "0.9";
  category: RemediationBatchCategory | "combined" | "individual";
  batchMode: HandoffBatchMode;
  targetTool: HandoffTool;
  clouds: Array<"gcp" | "aws">;
  projectIds: string[];
  issues: HandoffIssueItem[];
  lastVerification?: LastVerificationSummary;
}

export interface HandoffTaskDraft {
  fingerprint: string;
  title: string;
  targetTool: HandoffTool;
  batchMode: HandoffBatchMode;
  severity: SecurityFindingSeverity;
  issueCount: number;
  payload: HandoffTaskPayload;
  promptMarkdown: string;
}

export interface HandoffTaskRecord {
  id: string;
  fingerprint: string;
  title: string;
  targetTool: HandoffTool;
  batchMode: HandoffBatchMode;
  status: HandoffTaskStatus;
  severity: SecurityFindingSeverity;
  issueCount: number;
  payload: HandoffTaskPayload;
  promptMarkdown: string;
  prUrl: string | null;
  sessionRef: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HandoffCliCommands {
  opencode: string;
  claude: string;
  claudeHeadless: string;
  codex: string;
  codexHeadless: string;
  curl: string;
}

const SEVERITY_RANK: Record<SecurityFindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function maxSeverity(severities: SecurityFindingSeverity[]): SecurityFindingSeverity {
  let best: SecurityFindingSeverity = "low";
  for (const sev of severities) {
    if (SEVERITY_RANK[sev] > SEVERITY_RANK[best]) {
      best = sev;
    }
  }
  return best;
}

/**
 * Scrubs raw secret patterns before pushing findings to external CLI prompts/files.
 */
export function redactHandoffText(input: string | undefined): string {
  if (!input) return "";
  return input
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/g, "$1[REDACTED]$3")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]")
    .replace(/\b(AIza[0-9A-Za-z_-]{20,})\b/g, "[REDACTED_GCP_KEY]")
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{16,})\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\b(AKIA[0-9A-Z]{16})\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\b(xox[baprs]-[0-9A-Za-z-]{12,})\b/g, "[REDACTED_SLACK_TOKEN]")
    .replace(/\b(wm_[0-9a-f]{24,})\b/gi, "[REDACTED_WATCHMEN_TOKEN]");
}

export function sanitizeHandoffIssue(issue: HandoffIssueItem): HandoffIssueItem {
  return {
    ...issue,
    title: redactHandoffText(issue.title),
    description: redactHandoffText(issue.description),
    remediationHint: issue.remediationHint ? redactHandoffText(issue.remediationHint) : undefined,
    mitigations: issue.mitigations?.map((m) => redactHandoffText(m)),
    investigationReport: issue.investigationReport ? redactHandoffText(issue.investigationReport) : undefined,
    proposedPlan: issue.proposedPlan ? redactHandoffText(issue.proposedPlan) : undefined,
  };
}

export function handoffIssueFromFinding(
  finding: SecurityFinding & { cloud?: "gcp" | "aws"; region?: string },
  extras?: { investigationReport?: string; proposedPlan?: string }
): HandoffIssueItem {
  return sanitizeHandoffIssue({
    id: finding.id,
    kind: "finding",
    cloud: finding.cloud ?? (finding.id.startsWith("aws:") ? "aws" : "gcp"),
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    resourceName: finding.resourceName,
    resourceType: finding.resourceType,
    projectId: finding.projectId,
    region: finding.region,
    remediationHint: finding.remediationHint,
    mitigations: finding.remediationHint ? [finding.remediationHint] : [],
    investigationReport: extras?.investigationReport,
    proposedPlan: extras?.proposedPlan,
  });
}

export function handoffIssueFromAttackPath(
  path: AttackPath & { cloud?: "gcp" | "aws"; region?: string }
): HandoffIssueItem {
  const target = remediationTargetFromAttackPath(path);
  return sanitizeHandoffIssue({
    id: path.id,
    kind: "attack_path",
    cloud: path.cloud ?? (path.id.startsWith("aws:") ? "aws" : "gcp"),
    severity: path.severity,
    title: path.title,
    description: path.description,
    resourceName: target.resourceName ?? path.nodes[0]?.label ?? path.id,
    resourceType: target.resourceType ?? path.nodes[0]?.resourceType,
    projectId: target.projectIds[0] ?? path.nodes.find((n) => n.projectId)?.projectId ?? "unknown",
    region: path.region,
    remediationHint: path.mitigations[0],
    mitigations: path.mitigations,
  });
}

export function issueToRemediationTarget(issue: HandoffIssueItem): RemediationTarget {
  if (issue.kind === "attack_path") {
    return {
      id: issue.id,
      kind: "attack_path",
      severity: issue.severity,
      title: issue.title,
      description: issue.description,
      mitigations: issue.mitigations ?? (issue.remediationHint ? [issue.remediationHint] : []),
      projectIds: [issue.projectId],
      resourceType: issue.resourceType,
      resourceName: issue.resourceName,
      searchTerms: [issue.resourceName, issue.projectId].filter(Boolean),
      promptDetails: [
        `- [${issue.cloud.toUpperCase()}] ${issue.title} (${issue.severity})`,
        `- Resource: ${issue.resourceType ?? "resource"} ${issue.resourceName} in ${issue.projectId}`,
      ],
    };
  }

  return remediationTargetFromFinding({
    id: issue.id,
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
    resourceName: issue.resourceName,
    projectId: issue.projectId,
    resourceType: issue.resourceType ?? "resource",
    remediationHint: issue.remediationHint ?? "",
  });
}

/**
 * Pure-TS deterministic 128-bit FNV-1a hex fingerprint (works identically in browser & Node).
 */
export function computeTaskFingerprint(batchMode: HandoffBatchMode, issueIds: string[]): string {
  const sorted = [...issueIds].sort().join("|");
  const input = `v0.9:${batchMode}:${sorted}`;

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `fp_${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export function renderTaskPromptMarkdown(params: {
  title: string;
  severity: SecurityFindingSeverity;
  issues: HandoffIssueItem[];
  taskId?: string;
  watchmenUrl?: string;
}): string {
  const clouds = [...new Set(params.issues.map((i) => i.cloud.toUpperCase()))].join(", ");
  const projects = [...new Set(params.issues.map((i) => i.projectId).filter(Boolean))];

  const lines: string[] = [
    `# Watchmen Security Task: ${params.title}`,
    "",
    `- **Highest Severity**: ${params.severity.toUpperCase()}`,
    `- **Clouds**: ${clouds || "GCP/AWS"}`,
    `- **Projects / Accounts**: ${projects.join(", ") || "N/A"}`,
    `- **Issue Count**: ${params.issues.length}`,
  ];

  if (params.taskId) {
    lines.push(`- **Watchmen Task ID**: \`${params.taskId}\``);
  }
  if (params.watchmenUrl && params.taskId) {
    lines.push(`- **Watchmen Task Endpoint**: \`${params.watchmenUrl}/api/handoff/tasks/${params.taskId}\``);
  }

  lines.push(
    "",
    "## Instructions for Coding Agent",
    "1. Inspect the repository (Terraform / IaC / Kubernetes / application config) for the affected resources listed below.",
    "2. Propose and implement minimal, least-privilege fixes without breaking legitimate service dependencies.",
    "3. Run relevant validation checks (`terraform fmt -check`, `terraform validate`, tests, or linters) before finishing.",
    "4. Summarize each modified file and any manual cloud console steps that cannot be expressed in code.",
    "",
    "## Issues to Remediate",
    ""
  );

  params.issues.forEach((issue, index) => {
    lines.push(`### ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.title}`);
    lines.push(`- **ID**: \`${issue.id}\``);
    lines.push(`- **Cloud / Project**: ${issue.cloud.toUpperCase()} / \`${issue.projectId}\`${issue.region ? ` (${issue.region})` : ""}`);
    lines.push(`- **Resource**: \`${issue.resourceName}\`${issue.resourceType ? ` (${issue.resourceType})` : ""}`);
    lines.push(`- **Details**: ${issue.description}`);
    if (issue.remediationHint) {
      lines.push(`- **Recommended Fix**: ${issue.remediationHint}`);
    }
    if (issue.mitigations && issue.mitigations.length > 0) {
      const extraMitigations = issue.mitigations.filter((m) => m !== issue.remediationHint);
      if (extraMitigations.length > 0) {
        lines.push(`- **Mitigations**:`);
        for (const m of extraMitigations) {
          lines.push(`  - ${m}`);
        }
      }
    }
    if (issue.investigationReport) {
      lines.push("", "#### Watchmen Investigation Notes", "", issue.investigationReport);
    }
    if (issue.proposedPlan) {
      lines.push("", "#### Watchmen Proposed Plan", "", issue.proposedPlan);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

export function buildHandoffTaskDrafts(params: {
  issues: HandoffIssueItem[];
  batchMode?: HandoffBatchMode;
  targetTool?: HandoffTool;
}): HandoffTaskDraft[] {
  const sanitized = params.issues.map(sanitizeHandoffIssue);
  if (sanitized.length === 0) return [];

  const batchMode: HandoffBatchMode = params.batchMode ?? "grouped";
  const targetTool: HandoffTool = params.targetTool ?? "any";

  const makeDraft = (
    title: string,
    category: HandoffTaskPayload["category"],
    groupIssues: HandoffIssueItem[]
  ): HandoffTaskDraft => {
    const severity = maxSeverity(groupIssues.map((i) => i.severity));
    const clouds = [...new Set(groupIssues.map((i) => i.cloud))];
    const projectIds = [...new Set(groupIssues.map((i) => i.projectId).filter(Boolean))];
    const fingerprint = computeTaskFingerprint(batchMode, groupIssues.map((i) => i.id));
    return {
      fingerprint,
      title,
      targetTool,
      batchMode,
      severity,
      issueCount: groupIssues.length,
      payload: {
        version: "0.9",
        category,
        batchMode,
        targetTool,
        clouds,
        projectIds,
        issues: groupIssues,
      },
      promptMarkdown: renderTaskPromptMarkdown({
        title,
        severity,
        issues: groupIssues,
      }),
    };
  };

  if (batchMode === "individual") {
    return sanitized.map((issue) =>
      makeDraft(`[${issue.cloud.toUpperCase()}] ${issue.title} · ${issue.resourceName}`, "individual", [issue])
    );
  }

  if (batchMode === "combined") {
    const title = sanitized.length === 1
      ? `[${sanitized[0].cloud.toUpperCase()}] ${sanitized[0].title} · ${sanitized[0].resourceName}`
      : `Watchmen Security Bundle (${sanitized.length} issues)`;
    return [makeDraft(title, "combined", sanitized)];
  }

  // Grouped by category via RemediationBatchSuggestions
  const issueById = new Map<string, HandoffIssueItem>();
  for (const issue of sanitized) {
    issueById.set(issue.id, issue);
  }
  const targets = sanitized.map(issueToRemediationTarget);
  const batches = buildRemediationBatchSuggestions(targets);

  return batches.map((batch) => {
    const groupIssues = batch.targets
      .map((t) => issueById.get(t.id))
      .filter((item): item is HandoffIssueItem => Boolean(item));
    return makeDraft(batch.title, batch.category, groupIssues);
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildCliCommandsForTask(params: {
  taskId?: string;
  title: string;
  promptMarkdown: string;
  origin?: string;
  preferApiFetch?: boolean;
  mode?: "mcp" | "api" | "inline";
}): HandoffCliCommands {
  const origin = (params.origin ?? "http://localhost:3000").replace(/\/+$/, "");
  const effectiveMode = params.mode ?? (params.taskId && params.preferApiFetch ? "api" : "inline");

  const instruction =
    effectiveMode === "mcp" && params.taskId
      ? `Use Watchmen MCP tools to inspect task ${params.taskId} (watchmen_get_task), claim it (watchmen_claim_task), remediate the issues in this repo, and mark it complete (watchmen_complete_task).`
      : effectiveMode === "api" && params.taskId
        ? `Fetch the Watchmen security task from ${origin}/api/handoff/tasks/${params.taskId} using header "Authorization: Bearer $WATCHMEN_API_TOKEN" (JSON field promptMarkdown), remediate the issues in this repo, and report the changes or PR URL back via PATCH ${origin}/api/handoff/tasks/${params.taskId}.`
        : params.promptMarkdown;

  const quoted = shellQuote(instruction);
  const taskEndpoint = params.taskId ? `${origin}/api/handoff/tasks/${params.taskId}` : `${origin}/api/handoff/tasks`;

  return {
    opencode: `opencode run ${quoted}`,
    claude: `claude ${quoted}`,
    claudeHeadless: `claude -p ${quoted}`,
    codex: `codex ${quoted}`,
    codexHeadless: `codex exec ${quoted}`,
    curl: `curl -sS -H "Authorization: Bearer $WATCHMEN_API_TOKEN" ${shellQuote(taskEndpoint)}`,
  };
}

export function buildTasksMarkdownPack(drafts: Array<{ id?: string; title: string; severity: string; promptMarkdown: string }>): string {
  const header = [
    "# Watchmen Security Task Pack (v0.9)",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Total Tasks: ${drafts.length}`,
    "",
    "---",
    "",
  ].join("\n");

  const body = drafts
    .map((draft, idx) => {
      const idLine = draft.id ? `> Task ID: \`${draft.id}\` · Severity: \`${draft.severity}\`\n\n` : "";
      return `<!-- Task ${idx + 1}: ${draft.title} -->\n${idLine}${draft.promptMarkdown}`;
    })
    .join("\n\n---\n\n");

  return `${header}${body}\n`;
}
