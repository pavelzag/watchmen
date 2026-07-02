import { fetchAwsSnapshot } from "@/lib/aws";
import { useMockAwsData } from "@/lib/aws/client";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import { callAI, type AIProvider } from "@/lib/ai/client";
import { recordAgentStep } from "@/lib/agent/store";
import type { AgentCloudFinding, AgentEvidenceItem } from "@/lib/agent/types";
import type { RemediationTarget } from "@/lib/github/remediation-targets";
import { runAwsIso27001 } from "@/lib/compliance/aws-iso27001";
import { runAwsSoc2 } from "@/lib/compliance/aws-soc2";
import { runIso27001 } from "@/lib/compliance/iso27001";
import { runSoc2 } from "@/lib/compliance/soc2";
import type { ControlResult } from "@/lib/compliance/types";
import { ensureAwsSnapshotTable, ensureGcpSnapshotTable, sql } from "@/lib/db";
import { computeAwsFindings } from "@/lib/aws-findings";
import { computeFindings } from "@/lib/findings";
import type { AwsSnapshot, AwsSecurityFinding } from "@/lib/aws/types";
import type { GcpSnapshot, SecurityFinding } from "@/lib/gcp/types";

type SnapshotBundle = {
  gcp?: { snapshot: GcpSnapshot; fetchedAt?: string | null };
  aws?: { snapshot: AwsSnapshot; fetchedAt?: string | null };
  warnings: string[];
};

export interface VerifyFixInput {
  sourceTaskId?: string;
  sourceTaskKind?: "terraform_preview" | "terraform_pr";
  repoFullName?: string;
  defaultBranch?: string;
  targets: RemediationTarget[];
}

export interface VerifyFixResult {
  report: string;
  verification: {
    ok: boolean;
    sourceTaskId?: string;
    sourceTaskKind?: "terraform_preview" | "terraform_pr";
    repoFullName?: string;
    defaultBranch?: string;
    fetchedAt?: string | null;
    snapshotFreshness: {
      gcp?: string | null;
      aws?: string | null;
    };
    resolvedTargets: RemediationTarget[];
    remainingTargets: RemediationTarget[];
    complianceControls: Array<{
      cloud: "gcp" | "aws";
      standard: string;
      category: string;
      id: string;
      title: string;
      status: string;
    }>;
    missingData: string[];
    summary: string;
  };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function gcpFindingToCloudFinding(finding: SecurityFinding): AgentCloudFinding {
  return { ...finding, cloud: "gcp" };
}

function awsFindingToCloudFinding(finding: AwsSecurityFinding): AgentCloudFinding {
  return {
    id: `aws:${finding.id}`,
    cloud: "aws",
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    resourceName: finding.resourceName,
    projectId: finding.accountId,
    resourceType: finding.resourceType,
    remediationHint: finding.remediationHint,
    region: finding.region,
  };
}

async function loadSnapshots(userEmail: string, isDemoUser?: boolean): Promise<SnapshotBundle> {
  const warnings: string[] = [];
  const bundle: SnapshotBundle = { warnings };

  if (useMockData() || isDemoUser) {
    bundle.gcp = { snapshot: await fetchGcpSnapshot({ forceMock: true }), fetchedAt: new Date().toISOString() };
  } else {
    await ensureGcpSnapshotTable();
    const result = await sql`
      SELECT snapshot, fetched_at FROM user_snapshots WHERE user_email = ${userEmail}
    `;
    if (result.rows[0]) {
      bundle.gcp = { snapshot: result.rows[0].snapshot as GcpSnapshot, fetchedAt: toIso(result.rows[0].fetched_at) };
    } else {
      warnings.push("No stored GCP snapshot is available.");
    }
  }

  if (useMockAwsData() || isDemoUser) {
    bundle.aws = { snapshot: await fetchAwsSnapshot({ forceMock: true }), fetchedAt: new Date().toISOString() };
  } else {
    await ensureAwsSnapshotTable();
    const result = await sql`
      SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${userEmail}
    `;
    if (result.rows[0]) {
      bundle.aws = { snapshot: result.rows[0].snapshot as AwsSnapshot, fetchedAt: toIso(result.rows[0].fetched_at) };
    } else {
      warnings.push("No stored AWS snapshot is available.");
    }
  }

  return bundle;
}

function collectCurrentFindings(snapshots: SnapshotBundle): AgentCloudFinding[] {
  return [
    ...(snapshots.gcp ? computeFindings(snapshots.gcp.snapshot).map(gcpFindingToCloudFinding) : []),
    ...(snapshots.aws ? computeAwsFindings(snapshots.aws.snapshot).map(awsFindingToCloudFinding) : []),
  ];
}

function collectComplianceControls(snapshots: SnapshotBundle, targets: RemediationTarget[]): VerifyFixResult["verification"]["complianceControls"] {
  const targetResourceNames = new Set(targets.map((target) => target.resourceName?.toLowerCase()).filter(Boolean) as string[]);
  const targetProjectIds = new Set(targets.flatMap((target) => target.projectIds).filter(Boolean));

  const gcpReports = snapshots.gcp
    ? [
        { cloud: "gcp" as const, report: runSoc2(snapshots.gcp.snapshot) },
        { cloud: "gcp" as const, report: runIso27001(snapshots.gcp.snapshot) },
      ]
    : [];
  const awsReports = snapshots.aws
    ? [
        { cloud: "aws" as const, report: runAwsSoc2(snapshots.aws.snapshot) },
        { cloud: "aws" as const, report: runAwsIso27001(snapshots.aws.snapshot) },
      ]
    : [];

  return [...gcpReports, ...awsReports].flatMap(({ cloud, report }) =>
    report.categories.flatMap((category) =>
      category.controls
        .filter((control) =>
          control.status !== "pass" &&
          control.evidence.some((item: any) => {
            const evidenceName = typeof item.name === "string" ? item.name.toLowerCase() : "";
            const evidenceProjectId = typeof item.projectId === "string" ? item.projectId : "";
            return targetResourceNames.has(evidenceName) || targetProjectIds.has(evidenceProjectId);
          })
        )
        .map((control) => ({
          cloud,
          standard: report.standard,
          category: category.name,
          id: control.id,
          title: control.title,
          status: control.status,
        }))
    )
  ).slice(0, 10);
}

function buildPrompt(context: VerifyFixResult["verification"] & { resolvedTitles: string[]; remainingTitles: string[] }) {
  return `You are Watchmen's verification agent. Use only the provided JSON.

Return concise markdown with exactly these sections:

### Verification Summary
State whether the remediation appears resolved, partially resolved, or unresolved.

### Resolved Targets
List the targets that no longer appear in the latest snapshots.

### Remaining Targets
List the targets still present in the latest snapshots.

### Evidence
Summarize the latest snapshot evidence, compliance signals, and any missing data.

### Recommended Next Action
State the safest next step.

Rules:
- Do not claim a fix was applied if the target still exists in the latest snapshot.
- Mention stale or missing data explicitly.
- Do not invent resources or compliance outcomes.

Input:
${JSON.stringify(context, null, 2)}`;
}

export async function verifyFix(params: {
  runId: string;
  userEmail: string;
  isDemoUser?: boolean;
  input: VerifyFixInput;
  provider: AIProvider;
  apiKey: string;
}): Promise<VerifyFixResult> {
  let stepIndex = 1;
  const snapshots = await loadSnapshots(params.userEmail, params.isDemoUser);
  await recordAgentStep({
    runId: params.runId,
    stepIndex: stepIndex++,
    toolName: "load_latest_snapshots",
    status: "completed",
    input: { includeGcp: true, includeAws: true },
    output: {
      gcpFetchedAt: snapshots.gcp?.fetchedAt ?? null,
      awsFetchedAt: snapshots.aws?.fetchedAt ?? null,
      warnings: snapshots.warnings,
    },
  });

  const currentFindings = collectCurrentFindings(snapshots);
  const currentIds = new Set(currentFindings.map((finding) => finding.id));
  const resolvedTargets = params.input.targets.filter((target) => !currentIds.has(target.id));
  const remainingTargets = params.input.targets.filter((target) => currentIds.has(target.id));

  await recordAgentStep({
    runId: params.runId,
    stepIndex: stepIndex++,
    toolName: "compare_targets_against_latest_snapshots",
    status: "completed",
    input: {
      sourceTaskId: params.input.sourceTaskId,
      sourceTaskKind: params.input.sourceTaskKind,
      targetIds: params.input.targets.map((target) => target.id),
    },
    output: {
      resolvedTargetIds: resolvedTargets.map((target) => target.id),
      remainingTargetIds: remainingTargets.map((target) => target.id),
      currentFindingCount: currentFindings.length,
    },
  });

  const complianceControls = collectComplianceControls(snapshots, params.input.targets);
  const missingData = [
    ...snapshots.warnings,
    ...(params.input.targets.length === 0 ? ["No remediation targets were supplied."] : []),
    ...(resolvedTargets.length === 0 ? ["No supplied targets were resolved in the latest snapshot."] : []),
  ];

  const verification = {
    ok: true,
    sourceTaskId: params.input.sourceTaskId,
    sourceTaskKind: params.input.sourceTaskKind,
    repoFullName: params.input.repoFullName,
    defaultBranch: params.input.defaultBranch,
    fetchedAt: snapshots.gcp?.fetchedAt ?? snapshots.aws?.fetchedAt ?? null,
    snapshotFreshness: {
      gcp: snapshots.gcp?.fetchedAt ?? null,
      aws: snapshots.aws?.fetchedAt ?? null,
    },
    resolvedTargets,
    remainingTargets,
    complianceControls,
    missingData,
    summary:
      remainingTargets.length === 0
        ? `Verified ${resolvedTargets.length} target${resolvedTargets.length === 1 ? "" : "s"} as resolved in the latest snapshots.`
        : `${resolvedTargets.length} target${resolvedTargets.length === 1 ? "" : "s"} resolved; ${remainingTargets.length} still appear in the latest snapshots.`,
  };

  await recordAgentStep({
    runId: params.runId,
    stepIndex: stepIndex++,
    toolName: "assemble_verification_context",
    status: "completed",
    input: { targetCount: params.input.targets.length },
    output: verification,
  });

  const report = await callAI(params.provider, params.apiKey, buildPrompt({
    ...verification,
    resolvedTitles: resolvedTargets.map((target) => target.title),
    remainingTitles: remainingTargets.map((target) => target.title),
  }));

  await recordAgentStep({
    runId: params.runId,
    stepIndex,
    toolName: "generate_verification_report",
    status: "completed",
    input: { provider: params.provider },
    output: { report },
  });

  return { report, verification };
}
