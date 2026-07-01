import { fetchAwsSnapshot } from "@/lib/aws";
import { useMockAwsData } from "@/lib/aws/client";
import type { AwsSnapshot, AwsSecurityFinding } from "@/lib/aws/types";
import { computeAwsFindings } from "@/lib/aws-findings";
import { callAI, type AIProvider } from "@/lib/ai/client";
import { runAwsIso27001 } from "@/lib/compliance/aws-iso27001";
import { runAwsSoc2 } from "@/lib/compliance/aws-soc2";
import { runIso27001 } from "@/lib/compliance/iso27001";
import { runSoc2 } from "@/lib/compliance/soc2";
import type { ControlResult } from "@/lib/compliance/types";
import { ensureAwsSnapshotTable, ensureGcpSnapshotTable, sql } from "@/lib/db";
import { computeFindings } from "@/lib/findings";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import type { GcpSnapshot, SecurityFinding } from "@/lib/gcp/types";
import { recordAgentStep } from "@/lib/agent/store";
import type { AgentCloudFinding, AgentEvidenceItem, AgentFindingInput } from "@/lib/agent/types";

type SnapshotBundle = {
  gcp?: { snapshot: GcpSnapshot; fetchedAt?: string | null };
  aws?: { snapshot: AwsSnapshot; fetchedAt?: string | null };
  warnings: string[];
};

type InvestigationContext = {
  finding: AgentCloudFinding;
  matchedCurrentFinding: boolean;
  snapshotFreshness: Record<string, string | null>;
  relatedFindings: AgentCloudFinding[];
  complianceControls: Array<ControlResult & { standard: string; cloud: "gcp" | "aws" }>;
  resourceEvidence: AgentEvidenceItem[];
  missingData: string[];
};

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

function normalizeInput(input: AgentFindingInput): Partial<AgentCloudFinding> {
  return {
    id: input.id,
    cloud: input.cloud,
    resourceName: input.resourceName,
    resourceType: input.resourceType,
    projectId: input.projectId ?? input.accountId,
    title: input.title,
  };
}

function findRequestedFinding(input: AgentFindingInput, findings: AgentCloudFinding[]): AgentCloudFinding | null {
  const requested = normalizeInput(input);
  if (requested.id) {
    const byId = findings.find((finding) => finding.id === requested.id);
    if (byId) return byId;
  }

  return findings.find((finding) => {
    if (requested.cloud && finding.cloud !== requested.cloud) return false;
    if (requested.resourceName && finding.resourceName !== requested.resourceName) return false;
    if (requested.resourceType && finding.resourceType !== requested.resourceType) return false;
    if (requested.projectId && finding.projectId !== requested.projectId) return false;
    if (requested.title && finding.title !== requested.title) return false;
    return Boolean(requested.resourceName || requested.title);
  }) ?? null;
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

function collectResourceEvidence(finding: AgentCloudFinding, snapshots: SnapshotBundle): AgentEvidenceItem[] {
  const evidence: AgentEvidenceItem[] = [];

  if (finding.cloud === "gcp" && snapshots.gcp) {
    const snap = snapshots.gcp.snapshot;
    const project = snap.projects.find((item) => item.projectId === finding.projectId);
    if (project) {
      evidence.push({
        name: "GCP project IAM bindings",
        href: `/dashboard/principal?project=${encodeURIComponent(project.projectId)}`,
        value: {
          projectId: project.projectId,
          projectName: project.projectName,
          bindingCount: project.bindings.length,
          highPrivilegeBindings: project.bindings.filter((binding) => binding.role === "roles/owner" || binding.role === "roles/editor"),
        },
      });
    }

    const resourceCollections: Array<[string, string, any[]]> = [
      ["Storage bucket", "/dashboard/buckets", snap.storageBuckets],
      ["Firewall rule", "/dashboard/firewall", snap.firewallRules],
      ["Service account", "/dashboard/service-accounts", snap.serviceAccounts],
      ["Cloud SQL instance", "/dashboard/cloud-sql", snap.cloudSqlInstances],
      ["Cloud Run service", "/dashboard/cloud-run", snap.cloudRunServices],
      ["Secret", "/dashboard/secrets", snap.secrets],
      ["VM", "/dashboard/vms", snap.vms],
      ["GKE cluster", "/dashboard/clusters", snap.gkeClusters],
    ];

    for (const [name, href, collection] of resourceCollections) {
      const match = collection.find((item) =>
        item.name === finding.resourceName ||
        item.email === finding.resourceName ||
        item.projectId === finding.projectId && item.name?.endsWith?.(`/${finding.resourceName}`)
      );
      if (match) evidence.push({ name, href, value: match });
    }
  }

  if (finding.cloud === "aws" && snapshots.aws) {
    const snap = snapshots.aws.snapshot;
    const resourceCollections: Array<[string, string, any[]]> = [
      ["IAM user", "/dashboard/aws/iam-users", snap.iamUsers],
      ["IAM role", "/dashboard/aws/iam-roles", snap.iamRoles],
      ["S3 bucket", "/dashboard/aws/s3", snap.s3Buckets],
      ["Security group", "/dashboard/aws/security-groups", snap.securityGroups],
      ["RDS instance", "/dashboard/aws/rds", snap.rdsInstances],
      ["EKS cluster", "/dashboard/aws/eks", snap.eksClusters],
      ["EC2 instance", "/dashboard/aws/ec2", snap.ec2Instances],
      ["Lambda function", "/dashboard/aws/lambda", snap.lambdaFunctions],
      ["Secret", "/dashboard/aws/secrets", snap.secrets],
    ];

    for (const [name, href, collection] of resourceCollections) {
      const match = collection.find((item) =>
        item.userName === finding.resourceName ||
        item.roleName === finding.resourceName ||
        item.bucketName === finding.resourceName ||
        item.groupName === finding.resourceName ||
        item.groupId === finding.resourceName ||
        item.dbInstanceIdentifier === finding.resourceName ||
        item.clusterName === finding.resourceName ||
        item.instanceId === finding.resourceName ||
        item.instanceName === finding.resourceName ||
        item.functionName === finding.resourceName ||
        item.name === finding.resourceName
      );
      if (match) evidence.push({ name, href, value: match });
    }
  }

  return evidence.slice(0, 8);
}

function collectComplianceControls(finding: AgentCloudFinding, snapshots: SnapshotBundle): InvestigationContext["complianceControls"] {
  const reports =
    finding.cloud === "gcp" && snapshots.gcp
      ? [
          { cloud: "gcp" as const, report: runSoc2(snapshots.gcp.snapshot) },
          { cloud: "gcp" as const, report: runIso27001(snapshots.gcp.snapshot) },
        ]
      : finding.cloud === "aws" && snapshots.aws
        ? [
            { cloud: "aws" as const, report: runAwsSoc2(snapshots.aws.snapshot) },
            { cloud: "aws" as const, report: runAwsIso27001(snapshots.aws.snapshot) },
          ]
        : [];

  return reports.flatMap(({ cloud, report }) =>
    report.categories.flatMap((category) =>
      category.controls
        .filter((control) =>
          control.status !== "pass" &&
          control.evidence.some((item) =>
            item.name === finding.resourceName ||
            item.projectId === finding.projectId ||
            finding.description.includes(item.name)
          )
        )
        .map((control) => ({ ...control, standard: report.standard, cloud }))
    )
  ).slice(0, 10);
}

function buildRelatedFindings(finding: AgentCloudFinding, allFindings: AgentCloudFinding[]): AgentCloudFinding[] {
  return allFindings
    .filter((candidate) => candidate.id !== finding.id)
    .filter((candidate) =>
      candidate.cloud === finding.cloud &&
      (
        candidate.projectId === finding.projectId ||
        candidate.resourceName === finding.resourceName ||
        candidate.resourceType === finding.resourceType
      )
    )
    .slice(0, 8);
}

function buildPrompt(context: InvestigationContext): string {
  return `You are a cloud security investigation agent for Watchmen. Use only the provided JSON evidence.

Return concise markdown with exactly these sections:

### Risk Summary
Explain why this finding matters in 2-4 sentences.

### Evidence
Bullet the concrete evidence from Watchmen. Mention missing or stale data if present.

### Affected Scope
List affected cloud, project/account, resource, related findings, and compliance controls.

### Recommended Next Action
Give the safest next action. Do not claim that any change was made.

Rules:
- Do not invent resources, logs, owners, or permissions.
- If evidence is missing, say what is missing.
- Treat remediation as advisory and require review before any change.

Investigation context:
${JSON.stringify(context, null, 2)}`;
}

export async function investigateFinding(params: {
  runId: string;
  userEmail: string;
  isDemoUser?: boolean;
  input: AgentFindingInput;
  provider: AIProvider;
  apiKey: string;
}): Promise<{ report: string; context: InvestigationContext }> {
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

  const allFindings: AgentCloudFinding[] = [
    ...(snapshots.gcp ? computeFindings(snapshots.gcp.snapshot).map(gcpFindingToCloudFinding) : []),
    ...(snapshots.aws ? computeAwsFindings(snapshots.aws.snapshot).map(awsFindingToCloudFinding) : []),
  ];
  const currentFinding = findRequestedFinding(params.input, allFindings);
  const inputFinding = params.input as AgentCloudFinding;
  const finding = currentFinding ?? inputFinding;
  if (!finding?.id || !finding?.resourceName || !finding?.projectId) {
    throw new Error("Unable to identify the requested finding from the latest snapshots or request input.");
  }

  await recordAgentStep({
    runId: params.runId,
    stepIndex: stepIndex++,
    toolName: "find_current_finding",
    status: "completed",
    input: params.input,
    output: { matchedCurrentFinding: Boolean(currentFinding), finding },
  });

  const relatedFindings = buildRelatedFindings(finding, allFindings);
  const complianceControls = collectComplianceControls(finding, snapshots);
  const resourceEvidence = collectResourceEvidence(finding, snapshots);
  const missingData = [
    ...snapshots.warnings,
    ...(resourceEvidence.length === 0 ? ["No matching resource details were found in the latest snapshot."] : []),
    ...(!currentFinding ? ["The finding was not found in the latest computed findings; the request input may be stale."] : []),
  ];

  const context: InvestigationContext = {
    finding,
    matchedCurrentFinding: Boolean(currentFinding),
    snapshotFreshness: {
      gcp: snapshots.gcp?.fetchedAt ?? null,
      aws: snapshots.aws?.fetchedAt ?? null,
    },
    relatedFindings,
    complianceControls,
    resourceEvidence,
    missingData,
  };

  await recordAgentStep({
    runId: params.runId,
    stepIndex: stepIndex++,
    toolName: "assemble_investigation_evidence",
    status: "completed",
    input: { findingId: finding.id },
    output: context,
  });

  const report = await callAI(params.provider, params.apiKey, buildPrompt(context));
  await recordAgentStep({
    runId: params.runId,
    stepIndex,
    toolName: "generate_investigation_report",
    status: "completed",
    input: { provider: params.provider },
    output: { report },
  });

  return { report, context };
}
