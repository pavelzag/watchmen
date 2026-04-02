import type { AttackPath, AttackNode } from "@/lib/gcp/attack-paths";
import type { SecurityFinding, SecurityFindingSeverity } from "@/lib/gcp/types";

export type RemediationTargetKind = "attack_path" | "finding";

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

function attackPathProjectIds(path: AttackPath): string[] {
  return [...new Set(path.nodes.map((node) => node.projectId).filter(Boolean))];
}

function describeAttackNode(node: AttackNode): string {
  return `    - [${node.resourceType}] ${node.label} (project: ${node.projectId || "unknown"}) — ${node.detail}`;
}

export function remediationTargetFromAttackPath(path: AttackPath): RemediationTarget {
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
  };
}

export function remediationTargetFromFinding(finding: SecurityFinding): RemediationTarget {
  return {
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
  };
}
