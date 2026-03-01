import type { GcpSnapshot } from "@/lib/gcp/types";
import type { ComplianceReport, ComplianceCategory, ControlResult, ControlStatus } from "./types";

const PUBLIC_MEMBERS = new Set(["allUsers", "allAuthenticatedUsers"]);

function hasPublicBinding(bindings: { role: string; members: string[] }[]): boolean {
  return bindings.some((b) => b.members.some((m) => PUBLIC_MEMBERS.has(m)));
}

function pass(): Pick<ControlResult, "status" | "evidence"> {
  return { status: "pass", evidence: [] };
}

function result(status: ControlStatus, evidence: ControlResult["evidence"]): Pick<ControlResult, "status" | "evidence"> {
  return { status, evidence };
}

// ── CC6 — Logical and Physical Access Controls ─────────────────────────────

function cc61a(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // No human users with owner/editor on 2+ projects
  const userProjects = new Map<string, Set<string>>();
  for (const project of snapshot.projects) {
    for (const binding of project.bindings) {
      if (binding.role !== "roles/owner" && binding.role !== "roles/editor") continue;
      for (const member of binding.members) {
        if (!member.startsWith("user:")) continue;
        const email = member.slice(5);
        const set = userProjects.get(email) ?? new Set();
        set.add(project.projectId);
        userProjects.set(email, set);
      }
    }
  }
  const failing = [...userProjects.entries()]
    .filter(([, projects]) => projects.size >= 2)
    .map(([email, projects]) => ({ name: email, projectId: [...projects][0] }));
  return failing.length === 0 ? pass() : result("fail", failing);
}

function cc61b(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // No service accounts with owner/editor roles
  const evidence = snapshot.serviceAccounts
    .filter((sa) => sa.roles.some((r) => r === "roles/owner" || r === "roles/editor"))
    .map((sa) => ({ name: sa.email, projectId: sa.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

function cc63a(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // SA keys rotated within 90 days (validAfterTime must be within 90 days)
  const now = new Date();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  const evidence: ControlResult["evidence"] = [];
  for (const sa of snapshot.serviceAccounts) {
    const staleKeys = sa.keys.filter((k) => {
      if (k.keyType !== "USER_MANAGED") return false;
      if (!k.validAfterTime) return false;
      return now.getTime() - new Date(k.validAfterTime).getTime() > ninetyDays;
    });
    if (staleKeys.length > 0) {
      evidence.push({ name: sa.email, projectId: sa.projectId });
    }
  }
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

function cc63b(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // Disabled SAs removed from IAM bindings
  const disabledEmails = new Set(
    snapshot.serviceAccounts.filter((sa) => sa.disabled).map((sa) => `serviceAccount:${sa.email}`)
  );
  if (disabledEmails.size === 0) return pass();

  const allBindings = [
    ...snapshot.projects.flatMap((p) => p.bindings),
    ...snapshot.storageBuckets.flatMap((b) => b.iamPolicy.bindings),
    ...snapshot.gkeClusters.flatMap((c) => c.iamPolicy.bindings),
    ...snapshot.cloudRunServices.flatMap((s) => s.iamPolicy.bindings),
    ...snapshot.bigqueryDatasets.flatMap((d) => d.iamPolicy.bindings),
    ...snapshot.secrets.flatMap((s) => s.iamPolicy.bindings),
  ];

  const orphaned = new Set<string>();
  for (const binding of allBindings) {
    for (const member of binding.members) {
      if (disabledEmails.has(member)) {
        orphaned.add(member.replace("serviceAccount:", ""));
      }
    }
  }

  if (orphaned.size === 0) return pass();
  const evidence = [...orphaned].map((email) => {
    const sa = snapshot.serviceAccounts.find((s) => s.email === email);
    return { name: email, projectId: sa?.projectId ?? "unknown" };
  });
  return result("fail", evidence);
}

function cc63c(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // No SAs with multiple user-managed keys
  const evidence = snapshot.serviceAccounts
    .filter((sa) => sa.keys.filter((k) => k.keyType === "USER_MANAGED").length > 1)
    .map((sa) => ({ name: sa.email, projectId: sa.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

function cc66a(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // No Cloud SQL with public IP
  const evidence = snapshot.cloudSqlInstances
    .filter((inst) => !!inst.publicIp)
    .map((inst) => ({ name: inst.name, projectId: inst.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

function cc67a(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // No firewall rules open to 0.0.0.0/0
  const evidence = snapshot.firewallRules
    .filter((r) => !r.disabled && r.direction === "INGRESS")
    .filter((r) => (r.sourceRanges ?? []).some((range) => range === "0.0.0.0/0" || range === "::/0"))
    .map((r) => ({ name: r.name, projectId: r.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

function cc67b(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // No SSH (22) or RDP (3389) open to internet
  const SENSITIVE_PORTS = new Set(["22", "3389"]);
  const evidence = snapshot.firewallRules
    .filter((r) => !r.disabled && r.direction === "INGRESS")
    .filter((r) => (r.sourceRanges ?? []).some((range) => range === "0.0.0.0/0" || range === "::/0"))
    .filter((r) =>
      r.allowed.some((a) => {
        if (a.IPProtocol === "all") return true;
        if (!a.ports || a.ports.length === 0) return false;
        return a.ports.some((p) => SENSITIVE_PORTS.has(p));
      })
    )
    .map((r) => ({ name: r.name, projectId: r.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

// ── C1 — Confidentiality ──────────────────────────────────────────────────

function c11a(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // No public storage buckets
  const evidence = snapshot.storageBuckets
    .filter((b) => hasPublicBinding(b.iamPolicy.bindings))
    .map((b) => ({ name: b.name, projectId: b.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

function c11b(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // No secrets accessible to allUsers
  const evidence = snapshot.secrets
    .filter((s) => hasPublicBinding(s.iamPolicy.bindings))
    .map((s) => ({ name: s.name.split("/").pop() ?? s.name, projectId: s.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

function c11c(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // No Cloud Run services invoker-accessible to allUsers (warning, not fail)
  const evidence = snapshot.cloudRunServices
    .filter((svc) => hasPublicBinding(svc.iamPolicy.bindings))
    .map((svc) => ({ name: svc.name, projectId: svc.projectId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}

// ── CC7 — System Operations ───────────────────────────────────────────────

const MIN_GKE_VERSION = 1.27;

function cc71a(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // GKE clusters not on deprecated (<1.27) versions
  const evidence = snapshot.gkeClusters
    .filter((c) => {
      const match = c.currentMasterVersion.match(/^(\d+\.\d+)/);
      if (!match) return false;
      return parseFloat(match[1]) < MIN_GKE_VERSION;
    })
    .map((c) => ({ name: c.name, projectId: c.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

function cc72a(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  // VMs with external IPs flagged for review (warning)
  const evidence = snapshot.vms
    .filter((vm) => !!vm.externalIp)
    .map((vm) => ({ name: vm.name, projectId: vm.projectId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}

// ── Report builder ────────────────────────────────────────────────────────

function makeControl(
  id: string,
  title: string,
  description: string,
  impact: ControlResult["impact"],
  remediationHint: string,
  check: Pick<ControlResult, "status" | "evidence">
): ControlResult {
  return { id, title, description, impact, remediationHint, ...check };
}

export function runSoc2(snapshot: GcpSnapshot): ComplianceReport {
  const cc6Controls: ControlResult[] = [
    makeControl(
      "CC6.1.a",
      "Privileged Human Access Across Projects",
      "No human users should hold owner or editor roles on two or more projects simultaneously.",
      "high",
      "Review and reduce roles to least-privilege; use project-specific roles instead of primitive roles.",
      cc61a(snapshot)
    ),
    makeControl(
      "CC6.1.b",
      "Service Account Primitive Roles",
      "Service accounts should not be granted owner or editor roles.",
      "high",
      "Replace owner/editor with purpose-specific predefined roles for each service account.",
      cc61b(snapshot)
    ),
    makeControl(
      "CC6.3.a",
      "Service Account Key Rotation",
      "User-managed service account keys must be rotated within 90 days.",
      "high",
      "Delete and recreate keys older than 90 days. Consider using Workload Identity Federation to eliminate keys.",
      cc63a(snapshot)
    ),
    makeControl(
      "CC6.3.b",
      "Disabled Service Accounts in IAM",
      "Disabled service accounts should not remain in any IAM policy binding.",
      "medium",
      "Remove disabled service account entries from all resource IAM policies.",
      cc63b(snapshot)
    ),
    makeControl(
      "CC6.3.c",
      "Multiple User-Managed SA Keys",
      "Service accounts should not have more than one active user-managed key.",
      "medium",
      "Consolidate to a single key per service account and rotate it regularly.",
      cc63c(snapshot)
    ),
    makeControl(
      "CC6.6.a",
      "Cloud SQL Public IP",
      "Cloud SQL instances should not expose a public IP address.",
      "medium",
      "Disable public IP on Cloud SQL instances and use Cloud SQL Auth Proxy or private IP.",
      cc66a(snapshot)
    ),
    makeControl(
      "CC6.7.a",
      "Firewall Rules Open to Internet",
      "No firewall ingress rules should allow traffic from 0.0.0.0/0 or ::/0.",
      "critical",
      "Restrict source IP ranges to known CIDR blocks. Use Cloud Armor for public-facing services.",
      cc67a(snapshot)
    ),
    makeControl(
      "CC6.7.b",
      "SSH/RDP Open to Internet",
      "SSH (port 22) and RDP (port 3389) must not be reachable from all internet IPs.",
      "critical",
      "Remove 0.0.0.0/0 from firewall rules allowing port 22 or 3389. Use IAP TCP forwarding instead.",
      cc67b(snapshot)
    ),
  ];

  const c1Controls: ControlResult[] = [
    makeControl(
      "C1.1.a",
      "Public Storage Buckets",
      "Storage buckets must not grant access to allUsers or allAuthenticatedUsers.",
      "critical",
      "Remove allUsers/allAuthenticatedUsers from bucket IAM policies. Enable uniform bucket-level access.",
      c11a(snapshot)
    ),
    makeControl(
      "C1.1.b",
      "Public Secret Access",
      "Secrets Manager secrets must not be accessible to allUsers or allAuthenticatedUsers.",
      "high",
      "Remove public IAM bindings from all secrets. Grant access only to specific service accounts or users.",
      c11b(snapshot)
    ),
    makeControl(
      "C1.1.c",
      "Unauthenticated Cloud Run Invocations",
      "Cloud Run services should require authentication to prevent unintended public exposure.",
      "medium",
      "Remove the allUsers Cloud Run Invoker binding. Use Cloud Endpoints or IAP for public APIs.",
      c11c(snapshot)
    ),
  ];

  const cc7Controls: ControlResult[] = [
    makeControl(
      "CC7.1.a",
      "GKE Cluster Version Currency",
      "GKE clusters must run a supported Kubernetes version (≥1.27) to receive security patches.",
      "medium",
      "Upgrade clusters below 1.27 to a currently supported GKE channel version.",
      cc71a(snapshot)
    ),
    makeControl(
      "CC7.2.a",
      "VM External IP Exposure",
      "VMs with external IP addresses increase attack surface and should be reviewed.",
      "low",
      "Remove external IPs where not required. Use Cloud NAT for outbound traffic and IAP for admin access.",
      cc72a(snapshot)
    ),
  ];

  const categories: ComplianceCategory[] = [
    {
      id: "CC6",
      name: "Logical and Physical Access Controls",
      description: "Controls that restrict access to information assets to authorized individuals only.",
      controls: cc6Controls,
    },
    {
      id: "C1",
      name: "Confidentiality",
      description: "Controls that protect confidential information from unauthorized disclosure.",
      controls: c1Controls,
    },
    {
      id: "CC7",
      name: "System Operations",
      description: "Controls that detect and respond to security events and maintain system health.",
      controls: cc7Controls,
    },
  ];

  const allControls = categories.flatMap((c) => c.controls);
  const totalControls = allControls.length;
  const passingControls = allControls.filter((c) => c.status === "pass").length;
  const failingControls = allControls.filter((c) => c.status === "fail").length;
  const warningControls = allControls.filter((c) => c.status === "warning").length;
  const score =
    totalControls === 0
      ? 100
      : Math.round(((passingControls + warningControls * 0.5) / totalControls) * 100);

  return {
    standard: "SOC 2 Type II",
    generatedAt: new Date().toISOString(),
    totalControls,
    passingControls,
    failingControls,
    warningControls,
    score,
    categories,
  };
}
