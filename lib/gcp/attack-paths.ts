import type { GcpSnapshot, ServiceAccount } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AttackNodeKind = "entry" | "pivot" | "target";
export type AttackPathSeverity = "critical" | "high";

export interface AttackNode {
  id: string;
  kind: AttackNodeKind;
  resourceType: string;
  label: string;
  detail: string;
  projectId: string;
  risk: string;
}

export interface AttackPath {
  id: string;
  severity: AttackPathSeverity;
  title: string;
  description: string;
  nodes: AttackNode[];
  mitigations: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PUBLIC_MEMBERS = new Set(["allUsers", "allAuthenticatedUsers"]);
const ADMIN_ROLES = new Set(["roles/owner", "roles/editor"]);
const SENSITIVE_ROLES = /admin|owner|editor|secretmanager\.secretAccessor|storage\.admin|iam\.serviceAccountTokenCreator/;
const OPEN_RANGES = new Set(["0.0.0.0/0", "::/0"]);
const SENSITIVE_PORTS = new Set(["22", "3389", "5432", "3306", "1433", "27017", "6379"]);

function isPublic(bindings: { role: string; members: string[] }[]): boolean {
  return bindings.some((b) => b.members.some((m) => PUBLIC_MEMBERS.has(m)));
}

function publicRoles(bindings: { role: string; members: string[] }[]): string[] {
  return bindings
    .filter((b) => b.members.some((m) => PUBLIC_MEMBERS.has(m)))
    .map((b) => b.role.replace("roles/", ""));
}

function saPrivilege(sa: ServiceAccount): "critical" | "high" | null {
  if (sa.roles.some((r) => ADMIN_ROLES.has(r))) return "critical";
  if (sa.roles.some((r) => SENSITIVE_ROLES.test(r))) return "high";
  return null;
}

function saNode(sa: ServiceAccount, risk: string): AttackNode {
  return {
    id: `sa:${sa.email}`,
    kind: "pivot",
    resourceType: "service_account",
    label: sa.email,
    detail: sa.roles.slice(0, 2).map((r) => r.replace("roles/", "")).join(", "),
    projectId: sa.projectId,
    risk,
  };
}

// ─── Path generators ──────────────────────────────────────────────────────────

function pathsFirewallVmSa(snapshot: GcpSnapshot, saByEmail: Map<string, ServiceAccount>): AttackPath[] {
  const paths: AttackPath[] = [];

  const openFirewalls = snapshot.firewallRules.filter(
    (r) => !r.disabled && r.direction === "INGRESS" &&
    (r.sourceRanges ?? []).some((rng) => OPEN_RANGES.has(rng))
  );

  for (const fw of openFirewalls) {
    const sensitivePortsHit = fw.allowed.flatMap((a) =>
      (a.ports ?? []).filter((p) => SENSITIVE_PORTS.has(p))
    );
    const isAllProtocols = fw.allowed.some((a) => a.IPProtocol === "all");

    if (!isAllProtocols && sensitivePortsHit.length === 0) continue;

    const exposedVMs = snapshot.vms.filter(
      (vm) => vm.projectId === fw.projectId && vm.externalIp && vm.serviceAccount
    );

    for (const vm of exposedVMs) {
      const saEmail = vm.serviceAccount!;
      const sa = saByEmail.get(saEmail);
      if (!sa) continue;
      const priv = saPrivilege(sa);
      if (!priv) continue;

      const secretsInProject = snapshot.secrets.filter((s) => s.projectId === sa.projectId);
      const sqlInProject = snapshot.cloudSqlInstances.filter((s) => s.projectId === sa.projectId);
      const crownJewels = [
        ...secretsInProject.map((s) => s.name.split("/").pop() ?? s.name),
        ...sqlInProject.map((s) => s.name),
      ];

      const ports = isAllProtocols ? "all protocols" : sensitivePortsHit.join(", ");

      paths.push({
        id: `fw-vm-sa:${fw.name}:${vm.name}`,
        severity: priv,
        title: "Internet → Open Firewall → VM → Privileged SA",
        description: `Firewall "${fw.name}" opens port(s) ${ports} to the internet. VM "${vm.name}" is reachable and runs as service account "${saEmail}" which holds ${priv} permissions — giving an attacker full access to ${crownJewels.length > 0 ? crownJewels.length + " sensitive resource(s)" : "all project resources"}.`,
        nodes: [
          {
            id: "internet",
            kind: "entry",
            resourceType: "internet",
            label: "Internet",
            detail: "External attacker",
            projectId: fw.projectId,
            risk: "World-reachable entry point",
          },
          {
            id: `fw:${fw.name}`,
            kind: "entry",
            resourceType: "firewall_rule",
            label: fw.name,
            detail: `Opens ${ports} → 0.0.0.0/0`,
            projectId: fw.projectId,
            risk: "Allows unrestricted inbound traffic on sensitive port(s)",
          },
          {
            id: `vm:${vm.name}`,
            kind: "pivot",
            resourceType: "vm",
            label: vm.name,
            detail: `External IP: ${vm.externalIp}`,
            projectId: vm.projectId,
            risk: "VM is internet-reachable and runs a privileged SA",
          },
          saNode(sa, `SA holds ${priv} permissions — full project access`),
          {
            id: `target:project:${sa.projectId}`,
            kind: "target",
            resourceType: crownJewels.length > 0 ? "secrets" : "project",
            label: crownJewels.length > 0 ? `${crownJewels.length} Secret(s) / DB(s)` : `Project ${sa.projectId}`,
            detail: crownJewels.slice(0, 3).join(", ") || "All project resources",
            projectId: sa.projectId,
            risk: "Crown jewel — full data access possible",
          },
        ],
        mitigations: [
          `Restrict firewall rule "${fw.name}" to known IP ranges instead of 0.0.0.0/0.`,
          `Remove the external IP from VM "${vm.name}" and use Cloud IAP or a bastion host for SSH access.`,
          `Replace "${saEmail}" owner/editor role with least-privilege roles scoped to specific resources.`,
        ],
      });
    }
  }

  return paths;
}

function pathsPublicCloudRunSa(snapshot: GcpSnapshot, saByEmail: Map<string, ServiceAccount>): AttackPath[] {
  const paths: AttackPath[] = [];

  for (const svc of snapshot.cloudRunServices) {
    if (!isPublic(svc.iamPolicy.bindings)) continue;
    if (!svc.serviceAccount) continue;

    const sa = saByEmail.get(svc.serviceAccount);
    if (!sa) continue;
    const priv = saPrivilege(sa);
    if (!priv) continue;

    const secretsInProject = snapshot.secrets.filter((s) => s.projectId === sa.projectId);

    paths.push({
      id: `cloudrun-sa:${svc.name}`,
      severity: priv,
      title: "Unauthenticated Cloud Run → Privileged SA",
      description: `Cloud Run service "${svc.name}" allows unauthenticated invocations and runs as "${svc.serviceAccount}", which holds ${priv} permissions. An attacker can invoke the service and potentially extract credentials or trigger actions with full ${priv} access.`,
      nodes: [
        {
          id: "internet",
          kind: "entry",
          resourceType: "internet",
          label: "Internet",
          detail: "Unauthenticated caller",
          projectId: svc.projectId,
          risk: "No authentication required",
        },
        {
          id: `cloudrun:${svc.name}`,
          kind: "entry",
          resourceType: "cloud_run",
          label: svc.name,
          detail: svc.url ?? svc.region,
          projectId: svc.projectId,
          risk: "allUsers can invoke — no auth required",
        },
        saNode(sa, `SA holds ${priv} permissions reachable from Cloud Run runtime`),
        {
          id: `target:secrets:${svc.projectId}`,
          kind: "target",
          resourceType: "secrets",
          label: secretsInProject.length > 0 ? `${secretsInProject.length} Secret(s)` : `Project ${svc.projectId}`,
          detail: secretsInProject.map((s) => s.name.split("/").pop()).slice(0, 3).join(", ") || "All project resources",
          projectId: svc.projectId,
          risk: "Sensitive credentials / data accessible via SA",
        },
      ],
      mitigations: [
        `Remove the allUsers binding from Cloud Run service "${svc.name}" to require authentication.`,
        `Replace the "${svc.serviceAccount}" ${priv} role with a least-privilege role scoped only to what "${svc.name}" needs.`,
        `Enable Cloud Armor or Identity-Aware Proxy in front of the service.`,
      ],
    });
  }

  return paths;
}

function pathsPublicBucket(snapshot: GcpSnapshot, saByEmail: Map<string, ServiceAccount>): AttackPath[] {
  const paths: AttackPath[] = [];

  for (const bucket of snapshot.storageBuckets) {
    const pubRoles = publicRoles(bucket.iamPolicy.bindings);
    if (pubRoles.length === 0) continue;

    const writeable = pubRoles.some((r) =>
      r.includes("admin") || r.includes("creator") || r.includes("owner") || r === "storage.objectUser"
    );

    if (writeable) {
      // Writable public bucket → find any SA with storage.admin / owner → privilege escalation
      const adminSas = snapshot.serviceAccounts.filter((sa) =>
        sa.projectId === bucket.projectId && saPrivilege(sa) !== null
      );

      for (const sa of adminSas.slice(0, 2)) {
        paths.push({
          id: `bucket-write-sa:${bucket.name}:${sa.email}`,
          severity: "critical",
          title: "Public Writable Bucket → SA Privilege Escalation",
          description: `Bucket "${bucket.name}" is publicly writable (roles: ${pubRoles.join(", ")}). An attacker can upload malicious objects. Service account "${sa.email}" has ${saPrivilege(sa)} access and could read or execute content from this bucket, enabling privilege escalation.`,
          nodes: [
            {
              id: "internet",
              kind: "entry",
              resourceType: "internet",
              label: "Internet",
              detail: "Any unauthenticated user",
              projectId: bucket.projectId,
              risk: "No authentication required to write",
            },
            {
              id: `bucket:${bucket.name}`,
              kind: "entry",
              resourceType: "storage_bucket",
              label: bucket.name,
              detail: `Public roles: ${pubRoles.join(", ")}`,
              projectId: bucket.projectId,
              risk: "World-writable — attacker can plant malicious content",
            },
            saNode(sa, `SA with ${saPrivilege(sa)} permissions can read/execute bucket content`),
            {
              id: `target:project:${sa.projectId}`,
              kind: "target",
              resourceType: "project",
              label: `Project ${sa.projectId}`,
              detail: "Full project access",
              projectId: sa.projectId,
              risk: "Attacker can escalate to full project control",
            },
          ],
          mitigations: [
            `Remove allUsers / allAuthenticatedUsers write permissions from bucket "${bucket.name}" immediately.`,
            `Enable Object Versioning and audit logs on the bucket.`,
            `Replace "${sa.email}" ${saPrivilege(sa)} role with least-privilege roles.`,
          ],
        });
      }
    } else {
      // Read-only public bucket → direct data exposure
      paths.push({
        id: `bucket-read:${bucket.name}`,
        severity: "high",
        title: "Public Readable Bucket → Direct Data Exposure",
        description: `Bucket "${bucket.name}" grants public read access (roles: ${pubRoles.join(", ")}). Any unauthenticated user on the internet can enumerate and download all objects it contains.`,
        nodes: [
          {
            id: "internet",
            kind: "entry",
            resourceType: "internet",
            label: "Internet",
            detail: "Any unauthenticated user",
            projectId: bucket.projectId,
            risk: "No authentication required",
          },
          {
            id: `bucket:${bucket.name}`,
            kind: "pivot",
            resourceType: "storage_bucket",
            label: bucket.name,
            detail: `Public roles: ${pubRoles.join(", ")}`,
            projectId: bucket.projectId,
            risk: "Publicly readable — all objects exposed",
          },
          {
            id: `target:bucket-data:${bucket.name}`,
            kind: "target",
            resourceType: "data",
            label: "Bucket Contents",
            detail: bucket.name,
            projectId: bucket.projectId,
            risk: "All objects downloadable without credentials",
          },
        ],
        mitigations: [
          `Remove allUsers / allAuthenticatedUsers from the IAM policy on "${bucket.name}".`,
          `Enable uniform bucket-level access and audit logging.`,
          `Use signed URLs for time-limited public sharing instead of open IAM bindings.`,
        ],
      });
    }
  }

  return paths;
}

function pathsPublicSecret(snapshot: GcpSnapshot): AttackPath[] {
  return snapshot.secrets
    .filter((s) => isPublic(s.iamPolicy.bindings))
    .map((s) => {
      const shortName = s.name.split("/").pop() ?? s.name;
      return {
        id: `public-secret:${s.projectId}:${shortName}`,
        severity: "critical" as AttackPathSeverity,
        title: "Public Secret Manager Secret → Direct Credential Exposure",
        description: `Secret "${shortName}" in project "${s.projectId}" is accessible to allUsers or allAuthenticatedUsers — any Google-authenticated (or completely unauthenticated) user can read the secret value directly.`,
        nodes: [
          {
            id: "internet",
            kind: "entry" as AttackNodeKind,
            resourceType: "internet",
            label: "Internet",
            detail: "Any (authenticated) user",
            projectId: s.projectId,
            risk: "Publicly accessible via Google APIs",
          },
          {
            id: `secret:${shortName}`,
            kind: "target" as AttackNodeKind,
            resourceType: "secret",
            label: shortName,
            detail: `Project: ${s.projectId}`,
            projectId: s.projectId,
            risk: "Secret value directly readable — credentials exposed",
          },
        ],
        mitigations: [
          `Remove allUsers / allAuthenticatedUsers from the IAM policy on secret "${shortName}" immediately.`,
          `Rotate all credentials stored in this secret.`,
          `Grant secretmanager.secretAccessor only to specific service accounts that require it.`,
        ],
      };
    });
}

function pathsUserLateralMovement(snapshot: GcpSnapshot): AttackPath[] {
  const paths: AttackPath[] = [];
  const userProjects = new Map<string, { role: string; projectId: string }[]>();

  for (const project of snapshot.projects) {
    for (const binding of project.bindings) {
      if (!ADMIN_ROLES.has(binding.role)) continue;
      for (const member of binding.members) {
        if (!member.startsWith("user:")) continue;
        const email = member.slice(5);
        const existing = userProjects.get(email) ?? [];
        existing.push({ role: binding.role, projectId: project.projectId });
        userProjects.set(email, existing);
      }
    }
  }

  for (const [email, projectEntries] of userProjects) {
    if (projectEntries.length < 2) continue;
    const projectIds = projectEntries.map((e) => e.projectId);
    const secretsReachable = snapshot.secrets.filter((s) => projectIds.includes(s.projectId));
    const sqlReachable = snapshot.cloudSqlInstances.filter((s) => projectIds.includes(s.projectId));

    paths.push({
      id: `user-lateral:${email}`,
      severity: "high",
      title: "Single User Account → Lateral Movement Across Projects",
      description: `User "${email}" holds owner/editor on ${projectEntries.length} projects (${projectIds.join(", ")}). A single compromised account grants access to ${secretsReachable.length} secrets and ${sqlReachable.length} databases across all these projects.`,
      nodes: [
        {
          id: `user:${email}`,
          kind: "entry",
          resourceType: "user",
          label: email,
          detail: `Owner/editor on ${projectEntries.length} projects`,
          projectId: projectIds[0],
          risk: "Single point of failure — account compromise = multi-project breach",
        },
        ...projectIds.slice(0, 3).map((pid) => ({
          id: `project:${pid}`,
          kind: "pivot" as AttackNodeKind,
          resourceType: "project",
          label: pid,
          detail: projectEntries.find((e) => e.projectId === pid)?.role.replace("roles/", "") ?? "",
          projectId: pid,
          risk: "Full admin access granted",
        })),
        {
          id: `target:multiproject:${email}`,
          kind: "target",
          resourceType: "data",
          label: `${secretsReachable.length} Secret(s), ${sqlReachable.length} DB(s)`,
          detail: `Across ${projectIds.length} projects`,
          projectId: projectIds[0],
          risk: "All sensitive resources across all projects exposed",
        },
      ],
      mitigations: [
        `Enforce MFA on "${email}" immediately.`,
        `Replace owner/editor with least-privilege roles scoped to individual resources.`,
        `Split responsibilities — no single user should hold admin on more than one production project.`,
        `Enable login alerts and audit logs for this account.`,
      ],
    });
  }

  return paths;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function computeAttackPaths(snapshot: GcpSnapshot): AttackPath[] {
  const saByEmail = new Map<string, ServiceAccount>(
    snapshot.serviceAccounts.map((sa) => [sa.email, sa])
  );

  const all = [
    ...pathsPublicSecret(snapshot),
    ...pathsFirewallVmSa(snapshot, saByEmail),
    ...pathsPublicCloudRunSa(snapshot, saByEmail),
    ...pathsPublicBucket(snapshot, saByEmail),
    ...pathsUserLateralMovement(snapshot),
  ];

  // Deduplicate by id, sort critical first
  const seen = new Set<string>();
  return all
    .filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}
