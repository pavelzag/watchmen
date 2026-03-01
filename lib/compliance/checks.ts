import type { GcpSnapshot } from "@/lib/gcp/types";
import type { ControlResult, ControlStatus } from "./types";

export const PUBLIC_MEMBERS = new Set(["allUsers", "allAuthenticatedUsers"]);

export function hasPublicBinding(bindings: { role: string; members: string[] }[]): boolean {
  return bindings.some((b) => b.members.some((m) => PUBLIC_MEMBERS.has(m)));
}

export function pass(): Pick<ControlResult, "status" | "evidence"> {
  return { status: "pass", evidence: [] };
}

export function result(
  status: ControlStatus,
  evidence: ControlResult["evidence"]
): Pick<ControlResult, "status" | "evidence"> {
  return { status, evidence };
}

export function makeControl(
  id: string,
  title: string,
  description: string,
  impact: ControlResult["impact"],
  remediationHint: string,
  check: Pick<ControlResult, "status" | "evidence">
): ControlResult {
  return { id, title, description, impact, remediationHint, ...check };
}

// ── Shared GCP checks ─────────────────────────────────────────────────────

/** No human users with owner/editor on 2+ projects. */
export function checkPrivilegedHumanAccess(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
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

/** No service accounts with owner/editor roles. */
export function checkSAPrimitiveRoles(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.serviceAccounts
    .filter((sa) => sa.roles.some((r) => r === "roles/owner" || r === "roles/editor"))
    .map((sa) => ({ name: sa.email, projectId: sa.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** SA keys rotated within 90 days. */
export function checkSAKeyRotation(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const now = new Date();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  const evidence: ControlResult["evidence"] = [];
  for (const sa of snapshot.serviceAccounts) {
    const staleKeys = sa.keys.filter((k) => {
      if (k.keyType !== "USER_MANAGED") return false;
      if (!k.validAfterTime) return false;
      return now.getTime() - new Date(k.validAfterTime).getTime() > ninetyDays;
    });
    if (staleKeys.length > 0) evidence.push({ name: sa.email, projectId: sa.projectId });
  }
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** Disabled SAs removed from IAM bindings. */
export function checkDisabledSAInBindings(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
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
      if (disabledEmails.has(member)) orphaned.add(member.replace("serviceAccount:", ""));
    }
  }

  if (orphaned.size === 0) return pass();
  const evidence = [...orphaned].map((email) => {
    const sa = snapshot.serviceAccounts.find((s) => s.email === email);
    return { name: email, projectId: sa?.projectId ?? "unknown" };
  });
  return result("fail", evidence);
}

/** No SAs with multiple user-managed keys. */
export function checkMultipleSAKeys(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.serviceAccounts
    .filter((sa) => sa.keys.filter((k) => k.keyType === "USER_MANAGED").length > 1)
    .map((sa) => ({ name: sa.email, projectId: sa.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** No Cloud SQL with public IP. */
export function checkCloudSQLPublicIP(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.cloudSqlInstances
    .filter((inst) => !!inst.publicIp)
    .map((inst) => ({ name: inst.name, projectId: inst.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** No firewall rules open to 0.0.0.0/0 or ::/0. */
export function checkFirewallOpenInternet(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.firewallRules
    .filter((r) => !r.disabled && r.direction === "INGRESS")
    .filter((r) => (r.sourceRanges ?? []).some((range) => range === "0.0.0.0/0" || range === "::/0"))
    .map((r) => ({ name: r.name, projectId: r.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** No SSH (22) or RDP (3389) open to internet. */
export function checkSSHRDPOpenInternet(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const SENSITIVE_PORTS = new Set(["22", "3389"]);
  const evidence = snapshot.firewallRules
    .filter((r) => !r.disabled && r.direction === "INGRESS")
    .filter((r) => (r.sourceRanges ?? []).some((range) => range === "0.0.0.0/0" || range === "::/0"))
    .filter((r) =>
      r.allowed.some((a) => {
        if (a.IPProtocol === "all") return true;
        // No ports listed for tcp/udp means all ports are open
        if (!a.ports || a.ports.length === 0) return true;
        return a.ports.some((p) => SENSITIVE_PORTS.has(p));
      })
    )
    .map((r) => ({ name: r.name, projectId: r.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** Cloud SQL instances must have automated backup enabled. */
export function checkCloudSQLBackup(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.cloudSqlInstances
    .filter((inst) => !inst.backupEnabled)
    .map((inst) => ({ name: inst.name, projectId: inst.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** Cloud SQL instances must require SSL connections. */
export function checkCloudSQLSSL(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.cloudSqlInstances
    .filter((inst) => !inst.requireSsl)
    .map((inst) => ({ name: inst.name, projectId: inst.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** GKE clusters should use Workload Identity to avoid long-lived SA keys. */
export function checkGKEWorkloadIdentity(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.gkeClusters
    .filter((c) => !c.workloadIdentityEnabled)
    .map((c) => ({ name: c.name, projectId: c.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** GKE clusters should use private nodes to limit network exposure (warning). */
export function checkGKEPrivateCluster(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.gkeClusters
    .filter((c) => !c.privateCluster)
    .map((c) => ({ name: c.name, projectId: c.projectId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}

/** Storage buckets should have versioning enabled (warning). */
export function checkBucketVersioning(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.storageBuckets
    .filter((b) => !b.versioningEnabled)
    .map((b) => ({ name: b.name, projectId: b.projectId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}

/** No public storage buckets. */
export function checkPublicBuckets(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.storageBuckets
    .filter((b) => hasPublicBinding(b.iamPolicy.bindings))
    .map((b) => ({ name: b.name, projectId: b.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** No secrets accessible to allUsers. */
export function checkPublicSecrets(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.secrets
    .filter((s) => hasPublicBinding(s.iamPolicy.bindings))
    .map((s) => ({ name: s.name.split("/").pop() ?? s.name, projectId: s.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** Cloud Run services invoker-accessible to allUsers (warning). */
export function checkPublicCloudRun(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.cloudRunServices
    .filter((svc) => hasPublicBinding(svc.iamPolicy.bindings))
    .map((svc) => ({ name: svc.name, projectId: svc.projectId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}

/** GKE clusters not on deprecated (<1.27) versions. */
export function checkGKEVersion(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const MIN_VERSION = 1.27;
  const evidence = snapshot.gkeClusters
    .filter((c) => {
      const match = c.currentMasterVersion.match(/^(\d+\.\d+)/);
      if (!match) return false;
      return parseFloat(match[1]) < MIN_VERSION;
    })
    .map((c) => ({ name: c.name, projectId: c.projectId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** VMs with external IPs (warning). */
export function checkVMExternalIP(snapshot: GcpSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.vms
    .filter((vm) => !!vm.externalIp)
    .map((vm) => ({ name: vm.name, projectId: vm.projectId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}
