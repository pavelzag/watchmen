import { computeAwsFindings } from "@/lib/aws-findings";
import type { AwsSecurityFinding, AwsSnapshot } from "@/lib/aws/types";
import { runAwsIso27001 } from "@/lib/compliance/aws-iso27001";
import { runAwsSoc2 } from "@/lib/compliance/aws-soc2";
import { runIso27001 } from "@/lib/compliance/iso27001";
import { runSoc2 } from "@/lib/compliance/soc2";
import type { ComplianceReport, ControlStatus } from "@/lib/compliance/types";
import { getUserCloudCredentials } from "@/lib/credentials";
import { ensureAwsSnapshotTable, ensureGcpSnapshotTable, sql } from "@/lib/db";
import { computeFindings } from "@/lib/findings";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { computeAttackPaths, type AttackPath } from "@/lib/gcp/attack-paths";
import { isGcpAdcEnabled } from "@/lib/gcp/client";
import type { GcpSnapshot, SecurityFinding } from "@/lib/gcp/types";

export type CloudSnapshotResourceType =
  | "summary"
  | "vms"
  | "cloud_run"
  | "cloud_sql"
  | "buckets"
  | "iam"
  | "service_accounts"
  | "firewall"
  | "load_balancers"
  | "secrets"
  | "pubsub"
  | "gke"
  | "bigquery"
  | "all";

async function loadStoredGcpSnapshot(userEmail: string): Promise<{ snapshot: GcpSnapshot | null; fetchedAt: string | null }> {
  await ensureGcpSnapshotTable();
  const res = await sql`
    SELECT snapshot, fetched_at FROM user_snapshots WHERE user_email = ${userEmail} LIMIT 1
  `;
  const row = res.rows[0] as { snapshot?: GcpSnapshot; fetched_at?: unknown } | undefined;
  if (!row?.snapshot) return { snapshot: null, fetchedAt: null };
  const fetchedAt = row.fetched_at ? new Date(String(row.fetched_at)).toISOString() : row.snapshot.fetchedAt ?? null;
  return { snapshot: row.snapshot, fetchedAt };
}

async function loadStoredAwsSnapshot(userEmail: string): Promise<{ snapshot: AwsSnapshot | null; fetchedAt: string | null }> {
  await ensureAwsSnapshotTable();
  const res = await sql`
    SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${userEmail} LIMIT 1
  `;
  const row = res.rows[0] as { snapshot?: AwsSnapshot; fetched_at?: unknown } | undefined;
  if (!row?.snapshot) return { snapshot: null, fetchedAt: null };
  const fetchedAt = row.fetched_at ? new Date(String(row.fetched_at)).toISOString() : row.snapshot.fetchedAt ?? null;
  return { snapshot: row.snapshot, fetchedAt };
}

function filterGcpSnapshotByProject(snapshot: GcpSnapshot, projectId?: string): GcpSnapshot {
  const target = projectId?.trim();
  if (!target) return snapshot;
  return {
    ...snapshot,
    projects: (snapshot.projects ?? []).filter((p) => p.projectId === target),
    serviceAccounts: (snapshot.serviceAccounts ?? []).filter((sa) => sa.projectId === target),
    storageBuckets: (snapshot.storageBuckets ?? []).filter((b) => b.projectId === target),
    gkeClusters: (snapshot.gkeClusters ?? []).filter((c) => c.projectId === target),
    vms: (snapshot.vms ?? []).filter((v) => v.projectId === target),
    cloudRunServices: (snapshot.cloudRunServices ?? []).filter((s) => s.projectId === target),
    cloudRunJobs: (snapshot.cloudRunJobs ?? []).filter((j) => j.projectId === target),
    cloudSqlInstances: (snapshot.cloudSqlInstances ?? []).filter((db) => db.projectId === target),
    bigqueryDatasets: (snapshot.bigqueryDatasets ?? []).filter((ds) => ds.projectId === target),
    pubsubTopics: (snapshot.pubsubTopics ?? []).filter((t) => t.projectId === target),
    secrets: (snapshot.secrets ?? []).filter((s) => s.projectId === target),
    firewallRules: (snapshot.firewallRules ?? []).filter((f) => f.projectId === target),
    loadBalancers: (snapshot.loadBalancers ?? []).filter((lb) => lb.projectId === target),
    scanWarnings: (snapshot.scanWarnings ?? []).filter((w) => w.projectId === target),
  };
}

export function summarizeGcpForMcp(snapshot: GcpSnapshot, fetchedAt: string | null) {
  return {
    snapshotId: snapshot.snapshotId,
    fetchedAt: fetchedAt ?? snapshot.fetchedAt ?? null,
    projects: (snapshot.projects ?? []).map((p) => p.projectId),
    counts: {
      projects: (snapshot.projects ?? []).length,
      vms: (snapshot.vms ?? []).length,
      cloudRunServices: (snapshot.cloudRunServices ?? []).length,
      cloudRunJobs: (snapshot.cloudRunJobs ?? []).length,
      cloudSqlInstances: (snapshot.cloudSqlInstances ?? []).length,
      storageBuckets: (snapshot.storageBuckets ?? []).length,
      serviceAccounts: (snapshot.serviceAccounts ?? []).length,
      secrets: (snapshot.secrets ?? []).length,
      firewallRules: (snapshot.firewallRules ?? []).length,
      loadBalancers: (snapshot.loadBalancers ?? []).length,
      pubsubTopics: (snapshot.pubsubTopics ?? []).length,
      gkeClusters: (snapshot.gkeClusters ?? []).length,
      bigqueryDatasets: (snapshot.bigqueryDatasets ?? []).length,
      scanWarnings: (snapshot.scanWarnings ?? []).length,
    },
    scanWarnings: snapshot.scanWarnings ?? [],
  };
}

export function summarizeAwsForMcp(snapshot: AwsSnapshot, fetchedAt: string | null) {
  return {
    snapshotId: snapshot.snapshotId,
    fetchedAt: fetchedAt ?? snapshot.fetchedAt ?? null,
    accounts: snapshot.accounts ?? [],
    regions: snapshot.regions ?? [],
    counts: {
      ec2Instances: (snapshot.ec2Instances ?? []).length,
      eksClusters: (snapshot.eksClusters ?? []).length,
      lambdaFunctions: (snapshot.lambdaFunctions ?? []).length,
      rdsInstances: (snapshot.rdsInstances ?? []).length,
      redshiftClusters: (snapshot.redshiftClusters ?? []).length,
      s3Buckets: (snapshot.s3Buckets ?? []).length,
      iamUsers: (snapshot.iamUsers ?? []).length,
      iamRoles: (snapshot.iamRoles ?? []).length,
      secrets: (snapshot.secrets ?? []).length,
      securityGroups: (snapshot.securityGroups ?? []).length,
      loadBalancers: (snapshot.loadBalancers ?? []).length,
      snsTopics: (snapshot.snsTopics ?? []).length,
    },
  };
}

export async function getCloudSnapshotForMcp(
  userEmail: string,
  options: {
    cloud?: "gcp" | "aws" | "all";
    projectId?: string;
    resourceType?: CloudSnapshotResourceType;
  } = {}
) {
  const cloud = options.cloud ?? "gcp";
  const resourceType = options.resourceType ?? "summary";
  const result: Record<string, unknown> = { cloud, resourceType };

  if (cloud === "gcp" || cloud === "all") {
    const { snapshot, fetchedAt } = await loadStoredGcpSnapshot(userEmail);
    if (!snapshot) {
      result.gcp = null;
    } else {
      const filtered = filterGcpSnapshotByProject(snapshot, options.projectId);
      const summary = summarizeGcpForMcp(filtered, fetchedAt);
      if (resourceType === "summary") {
        result.gcp = summary;
      } else if (resourceType === "all") {
        result.gcp = { ...summary, snapshot: filtered };
      } else {
        const sliceMap: Record<Exclude<CloudSnapshotResourceType, "summary" | "all">, Record<string, unknown>> = {
          vms: { vms: filtered.vms ?? [] },
          cloud_run: { cloudRunServices: filtered.cloudRunServices ?? [], cloudRunJobs: filtered.cloudRunJobs ?? [] },
          cloud_sql: { cloudSqlInstances: filtered.cloudSqlInstances ?? [] },
          buckets: { storageBuckets: filtered.storageBuckets ?? [] },
          iam: { projects: filtered.projects ?? [] },
          service_accounts: { serviceAccounts: filtered.serviceAccounts ?? [] },
          firewall: { firewallRules: filtered.firewallRules ?? [] },
          load_balancers: { loadBalancers: filtered.loadBalancers ?? [] },
          secrets: { secrets: filtered.secrets ?? [] },
          pubsub: { pubsubTopics: filtered.pubsubTopics ?? [] },
          gke: { gkeClusters: filtered.gkeClusters ?? [] },
          bigquery: { bigqueryDatasets: filtered.bigqueryDatasets ?? [] },
        };
        result.gcp = { ...summary, ...(sliceMap[resourceType] ?? {}) };
      }
    }
  }

  if (cloud === "aws" || cloud === "all") {
    const { snapshot, fetchedAt } = await loadStoredAwsSnapshot(userEmail);
    if (!snapshot) {
      result.aws = null;
    } else {
      const summary = summarizeAwsForMcp(snapshot, fetchedAt);
      result.aws = resourceType === "all" ? { ...summary, snapshot } : summary;
    }
  }

  return result;
}

export interface NormalizedMcpFinding {
  id: string;
  cloud: "gcp" | "aws";
  severity: string;
  title: string;
  description: string;
  projectOrAccountId: string;
  resourceName: string;
  resourceType: string;
  remediationHint: string;
}

export async function listCloudFindingsForMcp(
  userEmail: string,
  options: {
    cloud?: "gcp" | "aws" | "all";
    projectId?: string;
    severity?: string;
    limit?: number;
  } = {}
) {
  const cloud = options.cloud ?? "all";
  const severity = options.severity?.trim().toLowerCase() || "all";
  const projectId = options.projectId?.trim() || "";
  const limit = typeof options.limit === "number" && Number.isFinite(options.limit)
    ? Math.min(Math.max(Math.trunc(options.limit), 1), 200)
    : 50;

  const items: NormalizedMcpFinding[] = [];
  let gcpFetchedAt: string | null = null;
  let awsFetchedAt: string | null = null;

  if (cloud === "gcp" || cloud === "all") {
    const { snapshot, fetchedAt } = await loadStoredGcpSnapshot(userEmail);
    gcpFetchedAt = fetchedAt;
    if (snapshot) {
      const gcpFindings: SecurityFinding[] = computeFindings(snapshot);
      for (const f of gcpFindings) {
        items.push({
          id: f.id,
          cloud: "gcp",
          severity: f.severity,
          title: f.title,
          description: f.description,
          projectOrAccountId: f.projectId,
          resourceName: f.resourceName,
          resourceType: f.resourceType,
          remediationHint: f.remediationHint ?? "",
        });
      }
    }
  }

  if (cloud === "aws" || cloud === "all") {
    const { snapshot, fetchedAt } = await loadStoredAwsSnapshot(userEmail);
    awsFetchedAt = fetchedAt;
    if (snapshot) {
      const awsFindings: AwsSecurityFinding[] = computeAwsFindings(snapshot);
      for (const f of awsFindings) {
        items.push({
          id: f.id,
          cloud: "aws",
          severity: f.severity,
          title: f.title,
          description: f.description,
          projectOrAccountId: f.accountId,
          resourceName: f.resourceName,
          resourceType: f.resourceType,
          remediationHint: f.remediationHint ?? "",
        });
      }
    }
  }

  const sevSet = severity === "all"
    ? null
    : new Set(severity.split(",").map((s) => s.trim()).filter(Boolean));

  const filtered = items.filter((item) => {
    if (projectId && item.projectOrAccountId !== projectId) return false;
    if (sevSet && !sevSet.has(item.severity.toLowerCase())) return false;
    return true;
  });

  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  filtered.sort((a, b) => (severityOrder[a.severity.toLowerCase()] ?? 9) - (severityOrder[b.severity.toLowerCase()] ?? 9));

  const countsBySeverity = filtered.reduce<Record<string, number>>((acc, f) => {
    const key = f.severity.toLowerCase();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    gcpFetchedAt,
    awsFetchedAt,
    total: filtered.length,
    countsBySeverity,
    findings: filtered.slice(0, limit),
  };
}

export async function listAttackPathsForMcp(
  userEmail: string,
  options: {
    projectId?: string;
    severity?: string;
    limit?: number;
  } = {}
) {
  const projectId = options.projectId?.trim() || "";
  const severity = options.severity?.trim().toLowerCase() || "all";
  const limit = typeof options.limit === "number" && Number.isFinite(options.limit)
    ? Math.min(Math.max(Math.trunc(options.limit), 1), 100)
    : 25;

  const { snapshot, fetchedAt } = await loadStoredGcpSnapshot(userEmail);
  if (!snapshot) {
    return { fetchedAt: null, total: 0, attackPaths: [] as AttackPath[] };
  }

  const sevSet = severity === "all"
    ? null
    : new Set(severity.split(",").map((s) => s.trim()).filter(Boolean));

  const paths = computeAttackPaths(snapshot).filter((path) => {
    if (projectId && !path.nodes.some((n) => n.projectId === projectId)) return false;
    if (sevSet && !sevSet.has(path.severity.toLowerCase())) return false;
    return true;
  });

  return {
    fetchedAt,
    total: paths.length,
    attackPaths: paths.slice(0, limit),
  };
}

function filterReportControls(report: ComplianceReport, statusFilter?: string) {
  const target = statusFilter?.trim().toLowerCase() || "all";
  if (target === "all") return report;
  const allowed = new Set(target.split(",").map((s) => s.trim()).filter(Boolean) as ControlStatus[]);
  return {
    ...report,
    categories: report.categories
      .map((cat) => ({
        ...cat,
        controls: cat.controls.filter((c) => allowed.has(c.status)),
      }))
      .filter((cat) => cat.controls.length > 0),
  };
}

export async function getComplianceForMcp(
  userEmail: string,
  options: {
    standard?: "soc2" | "iso27001" | "all";
    cloud?: "gcp" | "aws" | "all";
    status?: string;
  } = {}
) {
  const standard = options.standard ?? "all";
  const cloud = options.cloud ?? "gcp";
  const status = options.status ?? "all";

  const reports: Record<string, unknown> = {};

  if (cloud === "gcp" || cloud === "all") {
    const { snapshot, fetchedAt } = await loadStoredGcpSnapshot(userEmail);
    if (!snapshot) {
      reports.gcp = null;
    } else {
      const gcpReports: Record<string, unknown> = { fetchedAt };
      if (standard === "soc2" || standard === "all") {
        gcpReports.soc2 = filterReportControls(runSoc2(snapshot), status);
      }
      if (standard === "iso27001" || standard === "all") {
        gcpReports.iso27001 = filterReportControls(runIso27001(snapshot), status);
      }
      reports.gcp = gcpReports;
    }
  }

  if (cloud === "aws" || cloud === "all") {
    const { snapshot, fetchedAt } = await loadStoredAwsSnapshot(userEmail);
    if (!snapshot) {
      reports.aws = null;
    } else {
      const awsReports: Record<string, unknown> = { fetchedAt };
      if (standard === "soc2" || standard === "all") {
        awsReports.soc2 = filterReportControls(runAwsSoc2(snapshot), status);
      }
      if (standard === "iso27001" || standard === "all") {
        awsReports.iso27001 = filterReportControls(runAwsIso27001(snapshot), status);
      }
      reports.aws = awsReports;
    }
  }

  return reports;
}

export async function triggerGcpScanForMcp(userEmail: string) {
  const gcpCreds = await getUserCloudCredentials(userEmail, "gcp");
  const adcEnabled = isGcpAdcEnabled();
  if (!gcpCreds && !adcEnabled) {
    throw new Error("No GCP credentials configured. Enable GCP_USE_ADC=true or save a service account key.");
  }
  const credentialMode = gcpCreds?.serviceAccountKey ? "service_account" : "adc";
  const snapshot = await fetchGcpSnapshot({
    serviceAccountKey: gcpCreds?.serviceAccountKey as string | undefined,
    useAdc: credentialMode === "adc",
  });

  await ensureGcpSnapshotTable();
  await sql`
    INSERT INTO user_snapshots (user_email, snapshot, fetched_at)
    VALUES (${userEmail}, ${JSON.stringify(snapshot)}, NOW())
    ON CONFLICT (user_email) DO UPDATE
      SET snapshot = EXCLUDED.snapshot,
          fetched_at = EXCLUDED.fetched_at
  `;

  return {
    ok: true,
    credentialMode,
    ...summarizeGcpForMcp(snapshot, snapshot.fetchedAt),
  };
}
