import type { AttackPath, AttackNode } from "@/lib/gcp/attack-paths";
import type { SecurityFinding, SecurityFindingSeverity } from "@/lib/gcp/types";
import type { ContainerVulnerability, ImageScanResult } from "@/lib/container-scanning";
import type { ControlResult } from "@/lib/compliance/types";
import type { DriftItem } from "@/lib/iac-drift";

export type RemediationTargetKind = "attack_path" | "finding" | "container_cve";
export type RemediationBatchCategory =
  | "iam"
  | "firewall"
  | "cloud_run"
  | "cloud_sql"
  | "storage"
  | "service_accounts"
  | "container_images"
  | "other";

export interface RemediationBatchSuggestion {
  id: string;
  title: string;
  reason: string;
  category: RemediationBatchCategory;
  targets: RemediationTarget[];
}

const MAX_BATCH_TARGETS = 8;
const AUTO_SPLIT_TARGET_THRESHOLD = 10;

export interface RemediationTarget {
  id: string;
  kind: RemediationTargetKind;
  severity: SecurityFindingSeverity;
  title: string;
  description: string;
  mitigations: string[];
  projectIds: string[];
  resourceType?: string;
  resourceName?: string;
  searchTerms: string[];
  promptDetails: string[];
  autoRemediable?: boolean;
}

function categorizeTarget(target: RemediationTarget): RemediationBatchCategory {
  const id = target.id.toLowerCase();
  const title = target.title.toLowerCase();
  const description = target.description.toLowerCase();
  const resourceType = target.resourceType?.toLowerCase() ?? "";
  const detailBlob = target.promptDetails.join(" ").toLowerCase();

  if (
    target.kind === "container_cve" ||
    resourceType === "container_image" ||
    id.startsWith("container-cve:")
  ) {
    return "container_images";
  }
  if (resourceType === "firewall_rule" || id.includes("firewall") || title.includes("firewall")) {
    return "firewall";
  }
  if (resourceType === "cloud_run" || id.includes("cloudrun") || title.includes("cloud run")) {
    return "cloud_run";
  }
  if (resourceType === "cloud_sql" || id.includes("sql_") || title.includes("cloud sql")) {
    return "cloud_sql";
  }
  if (resourceType === "storage_bucket" || id.includes("bucket") || title.includes("bucket")) {
    return "storage";
  }
  if (
    resourceType === "service_account" ||
    id.startsWith("sa_not_in_list:") ||
    title.includes("service account not in list")
  ) {
    return "service_accounts";
  }
  if (
    resourceType === "iam" ||
    id.includes("owner_editor") ||
    id.includes("user_owner_editor") ||
    id.includes("user-lateral") ||
    title.includes("iam") ||
    title.includes("lateral") ||
    description.includes("iam") ||
    detailBlob.includes("[iam]")
  ) {
    return "iam";
  }

  return "other";
}

function batchTitle(category: RemediationBatchCategory): string {
  if (category === "iam") return "IAM issues";
  if (category === "firewall") return "Firewall issues";
  if (category === "cloud_run") return "Cloud Run issues";
  if (category === "cloud_sql") return "Cloud SQL issues";
  if (category === "storage") return "Storage issues";
  if (category === "service_accounts") return "Service account inventory issues";
  if (category === "container_images") return "Container image vulnerabilities";
  return "Other issues";
}

function batchReason(category: RemediationBatchCategory): string {
  if (category === "iam") return "Least-privilege IAM fixes work better as a focused batch.";
  if (category === "firewall") return "Firewall rules need targeted network-specific remediation.";
  if (category === "cloud_run") return "Cloud Run secrets and exposure fixes are best handled separately.";
  if (category === "cloud_sql") return "Cloud SQL changes should be reviewed as a dedicated batch.";
  if (category === "storage") return "Bucket exposure changes fit a dedicated storage batch.";
  if (category === "service_accounts") return "Service-account inventory findings usually require separate review.";
  if (category === "container_images") return "Container package and base-image updates belong in Dockerfile or manifest PRs.";
  return "These issues are better handled in a smaller dedicated batch.";
}

const TARGET_SEVERITY_RANK: Record<SecurityFindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function buildRemediationBatchSuggestions(targets: RemediationTarget[]): RemediationBatchSuggestion[] {
  const grouped = new Map<RemediationBatchCategory, RemediationTarget[]>();

  for (const target of targets) {
    const category = categorizeTarget(target);
    const existing = grouped.get(category) ?? [];
    existing.push(target);
    grouped.set(category, existing);
  }

  return [...grouped.entries()]
    .filter(([, groupedTargets]) => groupedTargets.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .flatMap(([category, groupedTargets]) => {
      const sortedTargets = [...groupedTargets].sort(
        (a, b) => (TARGET_SEVERITY_RANK[b.severity] ?? 0) - (TARGET_SEVERITY_RANK[a.severity] ?? 0)
      );
      const totalChunks = Math.ceil(sortedTargets.length / MAX_BATCH_TARGETS);
      return Array.from({ length: totalChunks }, (_, index) => {
        const chunkTargets = sortedTargets.slice(index * MAX_BATCH_TARGETS, (index + 1) * MAX_BATCH_TARGETS);
        const chunkSuffix = totalChunks > 1 ? ` ${index + 1}/${totalChunks}` : "";
        return {
          id: `${category}:${chunkTargets.map((target) => target.id).join(",")}`,
          title: `${batchTitle(category)}${chunkSuffix}`,
          reason: batchReason(category),
          category,
          targets: chunkTargets,
        };
      });
    });
}

export function shouldAutoSplitRemediationTargets(targets: RemediationTarget[]): boolean {
  if (targets.length === 0) return false;
  const suggestions = buildRemediationBatchSuggestions(targets);
  return targets.length >= AUTO_SPLIT_TARGET_THRESHOLD || suggestions.length > 1;
}

const STOP_WORDS = new Set([
  "access",
  "account",
  "accounts",
  "allow",
  "allows",
  "attack",
  "binding",
  "bucket",
  "buckets",
  "cloud",
  "critical",
  "data",
  "direct",
  "editor",
  "exposure",
  "finding",
  "firewall",
  "gcp",
  "google",
  "high",
  "iam",
  "internet",
  "manager",
  "open",
  "owner",
  "path",
  "policy",
  "privileged",
  "project",
  "public",
  "readable",
  "resource",
  "risk",
  "role",
  "roles",
  "rule",
  "rules",
  "secret",
  "security",
  "service",
  "storage",
  "users",
  "writable",
]);

function normalizeTerm(term: string): string | null {
  const normalized = term.trim().toLowerCase();
  if (normalized.length < 4) return null;
  if (STOP_WORDS.has(normalized)) return null;
  return normalized;
}

function collectTerms(...values: Array<string | null | undefined>): string[] {
  const terms = new Set<string>();

  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;

    const direct = normalizeTerm(trimmed);
    if (direct) terms.add(direct);

    const parts = trimmed.match(/[A-Za-z0-9_.@/-]+/g) ?? [];
    for (const part of parts) {
      const normalizedPart = normalizeTerm(part);
      if (normalizedPart) terms.add(normalizedPart);

      if (part.includes("@")) {
        const localPart = part.split("@")[0];
        const normalizedLocalPart = normalizeTerm(localPart);
        if (normalizedLocalPart) terms.add(normalizedLocalPart);
      }

      if (part.includes("/") || part.includes(":")) {
        for (const segment of part.split(/[/:]/)) {
          const normalizedSegment = normalizeTerm(segment);
          if (normalizedSegment) terms.add(normalizedSegment);
        }
      }
    }
  }

  return [...terms];
}

function expiredServiceAccountKeyGuard(target: RemediationTarget): string | null {
  if (target.id.toLowerCase().startsWith("expired_sa_key:") || target.title === "Expired Service Account Key") {
    return "    - Guard: only treat keys as expired when the input explicitly provides a USER_MANAGED key with a past validBeforeTime. Do not invent key IDs, resource names, or Terraform resources; if the key ID is missing, recommend manual review.";
  }
  return null;
}

function isServiceAccountKeyHygieneFinding(target: Pick<RemediationTarget, "id" | "title">): boolean {
  const id = target.id.toLowerCase();
  const title = target.title.toLowerCase();
  return (
    id.startsWith("multiple_sa_keys:") ||
    id.startsWith("expired_sa_key:") ||
    title.includes("multiple keys") ||
    title.includes("expired service account key")
  );
}

function attackPathProjectIds(path: AttackPath): string[] {
  return [...new Set(path.nodes.map((node) => node.projectId).filter(Boolean))];
}

function describeAttackNode(node: AttackNode): string {
  return `    - [${node.resourceType}] ${node.label} (project: ${node.projectId || "unknown"}) — ${node.detail}`;
}

export function remediationTargetFromAttackPath(path: AttackPath): RemediationTarget {
  const autoRemediable = !path.id.toLowerCase().startsWith("sa_not_in_list:");
  return {
    id: path.id,
    kind: "attack_path",
    severity: path.severity,
    title: path.title,
    description: path.description,
    mitigations: path.mitigations,
    projectIds: attackPathProjectIds(path),
    searchTerms: collectTerms(
      path.id,
      path.title,
      path.description,
      ...path.mitigations,
      ...path.nodes.flatMap((node) => [node.label, node.detail, node.projectId, node.risk])
    ),
    promptDetails: path.nodes.map((node) => describeAttackNode(node)),
    autoRemediable,
  };
}

export function remediationTargetFromFinding(finding: SecurityFinding): RemediationTarget {
  const autoRemediable =
    !finding.id.toLowerCase().startsWith("sa_not_in_list:") &&
    !isServiceAccountKeyHygieneFinding({ id: finding.id, title: finding.title });
  const target: RemediationTarget = {
    id: finding.id,
    kind: "finding",
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    mitigations: finding.remediationHint ? [finding.remediationHint] : [],
    projectIds: finding.projectId ? [finding.projectId] : [],
    resourceType: finding.resourceType,
    resourceName: finding.resourceName,
    searchTerms: collectTerms(
      finding.id,
      finding.title,
      finding.description,
      finding.resourceName,
      finding.resourceType,
      finding.projectId,
      finding.remediationHint
    ),
    promptDetails: [
      `    - [${finding.resourceType}] ${finding.resourceName} (project: ${finding.projectId})`,
      finding.remediationHint ? `    - Hint: ${finding.remediationHint}` : "",
    ].filter(Boolean),
    autoRemediable,
  };

  const guard = expiredServiceAccountKeyGuard(target);
  if (guard) {
    target.promptDetails.push(guard);
  }

  return target;
}

export function remediationTargetFromContainerCve(params: {
  imageRef: string;
  imageName: string;
  cloud: string;
  accountId: string;
  projectIds?: string[];
  cve: ContainerVulnerability;
}): RemediationTarget {
  const { imageRef, imageName, cloud, accountId, projectIds, cve } = params;
  const allProjectIds = projectIds && projectIds.length > 0
    ? [...new Set(projectIds.filter(Boolean))]
    : accountId
      ? [accountId]
      : [];
  const severity: SecurityFindingSeverity =
    cve.severity === "negligible" ? "low" : cve.severity;
  const fixText = cve.fixedVersion
    ? `Upgrade ${cve.packageName} from ${cve.installedVersion} to ${cve.fixedVersion}`
    : `Patch or replace ${cve.packageName} (${cve.installedVersion}) or update base image`;

  return {
    id: `container-cve:${cloud}:${accountId}:${imageName}:${cve.cveId}:${cve.packageName}`,
    kind: "container_cve",
    severity,
    title: `${cve.cveId}: ${cve.packageName} ${cve.installedVersion} in ${imageName}`,
    description: `${cve.description || cve.cveId} (Image: ${imageRef}${allProjectIds.length > 1 ? `; Environments: ${allProjectIds.join(", ")}` : ""})`,
    mitigations: [fixText],
    projectIds: allProjectIds,
    resourceType: "container_image",
    resourceName: imageName,
    searchTerms: collectTerms(
      imageName,
      imageRef,
      ...allProjectIds,
      cve.cveId,
      cve.packageName,
      cve.installedVersion,
      cve.fixedVersion
    ),
    promptDetails: [
      `    - [container_image] ${imageName} (${imageRef})`,
      ...(allProjectIds.length > 1 ? [`    - Environments: ${allProjectIds.join(", ")}`] : []),
      `    - CVE: ${cve.cveId} (${cve.severity.toUpperCase()})`,
      `    - Package: ${cve.packageName} installed=${cve.installedVersion}${cve.fixedVersion ? ` fixed=${cve.fixedVersion}` : ""}`,
      `    - Action: ${fixText}`,
    ],
    autoRemediable: true,
  };
}

export function remediationTargetsFromContainerImage(
  result: ImageScanResult,
  cves?: ContainerVulnerability[]
): RemediationTarget[] {
  const list = cves ?? result.vulnerabilities;
  const projectIds = result.duplicates?.length
    ? [...new Set(result.duplicates.map((d) => d.accountId).filter(Boolean))]
    : result.accountId
      ? [result.accountId]
      : [];
  return list.map((cve) =>
    remediationTargetFromContainerCve({
      imageRef: result.imageRef,
      imageName: result.imageName,
      cloud: result.cloud,
      accountId: result.accountId,
      projectIds,
      cve,
    })
  );
}

export function remediationTargetFromComplianceControl(
  control: ControlResult,
  opts?: { standard?: string; categoryName?: string; aiRecommendation?: string }
): RemediationTarget {
  const rawControlId = control.id.replace(/^(gcp|aws):/, "");
  const projectIds = [...new Set(control.evidence.map((e) => e.projectId).filter(Boolean))];
  const evidenceNames = control.evidence.map((e) => e.name).filter(Boolean);
  const standardPrefix = opts?.standard
    ? `[${opts.standard}${opts.categoryName ? ` · ${opts.categoryName}` : ""}] `
    : "";

  const mitigations = [
    ...(control.remediationHint ? [control.remediationHint] : []),
    ...(opts?.aiRecommendation ? [`AI guidance: ${opts.aiRecommendation.slice(0, 600)}`] : []),
  ];

  return {
    id: control.id,
    kind: "finding",
    severity: control.impact,
    title: `${rawControlId}: ${control.title}`,
    description: `${standardPrefix}${control.description}`,
    mitigations,
    projectIds,
    resourceType: "compliance_control",
    resourceName: evidenceNames[0] ?? rawControlId,
    searchTerms: collectTerms(
      rawControlId,
      control.title,
      control.description,
      control.remediationHint,
      ...evidenceNames,
      ...projectIds
    ),
    promptDetails: [
      `    - Control: ${rawControlId} (${control.status.toUpperCase()}, impact: ${control.impact.toUpperCase()})`,
      ...control.evidence.slice(0, 12).map(
        (e) => `    - Evidence: ${e.name}${e.projectId ? ` (project: ${e.projectId})` : ""}`
      ),
      control.remediationHint ? `    - Hint: ${control.remediationHint}` : "",
    ].filter(Boolean),
    autoRemediable: true,
  };
}

export function remediationTargetFromDriftItem(item: DriftItem): RemediationTarget {
  const actionHint =
    item.driftType === "phantom"
      ? `Import or codify ${item.tfType} resource "${item.resourceId}" in Terraform.`
      : `Remove or reconcile orphaned ${item.tfType} resource "${item.resourceId}" in Terraform.`;

  return {
    id: item.id,
    kind: "finding",
    severity: item.severity,
    title: `${item.driftType === "phantom" ? "Phantom" : "Orphaned"} ${item.tfType}: ${item.resourceId}`,
    description: item.description,
    mitigations: [actionHint],
    projectIds: [],
    resourceType: item.resourceType,
    resourceName: item.resourceId,
    searchTerms: collectTerms(item.resourceId, item.tfType, item.resourceType, item.description),
    promptDetails: [
      `    - [${item.cloud.toUpperCase()} / ${item.driftType.toUpperCase()}] ${item.tfType} (${item.resourceId})`,
      `    - Action: ${actionHint}`,
    ],
    autoRemediable: true,
  };
}
