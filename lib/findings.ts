import type { GcpSnapshot, SecurityFinding } from "@/lib/gcp/types";
import { scanEnvVars } from "@/lib/secrets-detection";

const PUBLIC_MEMBERS = new Set(["allUsers", "allAuthenticatedUsers"]);
const SERVICE_ACCOUNT_EMAIL_PROJECT_RE = /^serviceAccount:[^@]+@([^.]+)\.iam\.gserviceaccount\.com$/;

function isPublicMember(member: string): boolean {
  return PUBLIC_MEMBERS.has(member);
}

function hasPublicBinding(bindings: { role: string; members: string[] }[]): boolean {
  return bindings.some((b) => b.members.some(isPublicMember));
}

function inferProjectIdFromServiceAccountEmail(email: string): string | null {
  const match = email.match(SERVICE_ACCOUNT_EMAIL_PROJECT_RE);
  return match ? match[1] : null;
}

/**
 * Computes security findings from a GCP snapshot.
 * All rules are derived purely from snapshot data — no extra API calls.
 */
export function computeFindings(snapshot: GcpSnapshot): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const now = new Date();

  // ── CRITICAL ──────────────────────────────────────────────────────────────

  // public_bucket: storageBuckets with allUsers/allAuthenticatedUsers in any binding
  for (const bucket of snapshot.storageBuckets) {
    if (hasPublicBinding(bucket.iamPolicy.bindings)) {
      const publicRoles = bucket.iamPolicy.bindings
        .filter((b) => b.members.some(isPublicMember))
        .map((b) => b.role.replace("roles/", ""));
      findings.push({
        id: `public_bucket:${bucket.projectId}:${bucket.name}`,
        severity: "critical",
        title: "Publicly Accessible Storage Bucket",
        description: `Bucket "${bucket.name}" grants public access via roles: ${publicRoles.join(", ")}.`,
        resourceName: bucket.name,
        projectId: bucket.projectId,
        resourceType: "storage_bucket",
        remediationHint: `Remove allUsers and allAuthenticatedUsers from the IAM bindings on bucket "${bucket.name}".`,
      });
    }
  }

  // public_firewall: INGRESS rules with 0.0.0.0/0 or ::/0
  for (const rule of snapshot.firewallRules) {
    if (rule.disabled) continue;
    if (rule.direction !== "INGRESS") continue;
    const publicRanges = (rule.sourceRanges ?? []).filter(
      (r) => r === "0.0.0.0/0" || r === "::/0"
    );
    if (publicRanges.length > 0) {
      const protocols = rule.allowed.map((a) => {
        const ports = a.ports?.length ? `:${a.ports.join(",")}` : "";
        return `${a.IPProtocol}${ports}`;
      });
      findings.push({
        id: `public_firewall:${rule.projectId}:${rule.name}`,
        severity: "critical",
        title: "Firewall Rule Open to the Internet",
        description: `Rule "${rule.name}" allows ${protocols.join(", ")} traffic from ${publicRanges.join(", ")} (all IPs).`,
        resourceName: rule.name,
        projectId: rule.projectId,
        resourceType: "firewall_rule",
        remediationHint: `Restrict source ranges on rule "${rule.name}" to known IP ranges instead of 0.0.0.0/0.`,
      });
    }
  }

  // ── HIGH ──────────────────────────────────────────────────────────────────

  // expired_sa_key: service accounts with any key past validBeforeTime
  for (const sa of snapshot.serviceAccounts) {
    const expiredKeys = sa.keys.filter((k) => {
      if (!k.validBeforeTime) return false;
      return new Date(k.validBeforeTime) < now;
    });
    if (expiredKeys.length > 0) {
      findings.push({
        id: `expired_sa_key:${sa.projectId}:${sa.email}`,
        severity: "high",
        title: "Expired Service Account Key",
        description: `Service account "${sa.email}" has ${expiredKeys.length} expired key(s).`,
        resourceName: sa.email,
        projectId: sa.projectId,
        resourceType: "service_account",
        remediationHint: `Rotate or delete expired keys for "${sa.email}" in the GCP Console > IAM > Service Accounts.`,
      });
    }
  }

  // sa_owner_editor: service accounts with owner or editor role
  for (const sa of snapshot.serviceAccounts) {
    const dangerousRoles = sa.roles.filter(
      (r) => r === "roles/owner" || r === "roles/editor"
    );
    if (dangerousRoles.length > 0) {
      findings.push({
        id: `sa_owner_editor:${sa.projectId}:${sa.email}`,
        severity: "high",
        title: "Service Account with Owner/Editor Role",
        description: `Service account "${sa.email}" has ${dangerousRoles.join(", ")} — overly permissive.`,
        resourceName: sa.email,
        projectId: sa.projectId,
        resourceType: "service_account",
        remediationHint: `Replace owner/editor with least-privilege roles for "${sa.email}".`,
      });
    }
  }

  // user_owner_editor: human users with owner/editor on 2+ projects
  const userDangerousProjects = new Map<string, string[]>();
  for (const project of snapshot.projects) {
    for (const binding of project.bindings) {
      if (binding.role !== "roles/owner" && binding.role !== "roles/editor") continue;
      for (const member of binding.members) {
        if (!member.startsWith("user:")) continue;
        const email = member.slice(5);
        const existing = userDangerousProjects.get(email) ?? [];
        existing.push(project.projectId);
        userDangerousProjects.set(email, existing);
      }
    }
  }
  for (const [email, projectIds] of userDangerousProjects) {
    if (projectIds.length >= 2) {
      findings.push({
        id: `user_owner_editor:${email}`,
        severity: "high",
        title: "User with Owner/Editor on Multiple Projects",
        description: `User "${email}" has owner/editor access on ${projectIds.length} projects: ${projectIds.join(", ")}.`,
        resourceName: email,
        projectId: projectIds[0],
        resourceType: "user",
        remediationHint: `Review and reduce "${email}"'s roles to least-privilege across all projects.`,
      });
    }
  }

  // secret_public: secrets with allUsers/allAuthenticatedUsers
  for (const secret of snapshot.secrets) {
    if (hasPublicBinding(secret.iamPolicy.bindings)) {
      const shortName = secret.name.split("/").pop() ?? secret.name;
      findings.push({
        id: `secret_public:${secret.projectId}:${shortName}`,
        severity: "high",
        title: "Publicly Accessible Secret",
        description: `Secret "${shortName}" in project "${secret.projectId}" is accessible to all users.`,
        resourceName: shortName,
        projectId: secret.projectId,
        resourceType: "secret",
        remediationHint: `Remove allUsers/allAuthenticatedUsers from the IAM policy on secret "${shortName}".`,
      });
    }
  }

  // ── MEDIUM ────────────────────────────────────────────────────────────────

  // vm_external_ip_no_sa: VMs with externalIp and no serviceAccount
  for (const vm of snapshot.vms) {
    if (vm.externalIp && !vm.serviceAccount) {
      findings.push({
        id: `vm_external_ip_no_sa:${vm.projectId}:${vm.name}`,
        severity: "medium",
        title: "VM with External IP but No Service Account",
        description: `VM "${vm.name}" in zone "${vm.zone}" has external IP ${vm.externalIp} but runs without a service account.`,
        resourceName: vm.name,
        projectId: vm.projectId,
        resourceType: "vm",
        remediationHint: `Assign a dedicated service account with least-privilege to VM "${vm.name}" and restrict external IP access.`,
      });
    }
  }

  // multiple_sa_keys: service accounts with >1 user-managed key
  for (const sa of snapshot.serviceAccounts) {
    const userKeys = sa.keys.filter((k) => k.keyType === "USER_MANAGED");
    if (userKeys.length > 1) {
      findings.push({
        id: `multiple_sa_keys:${sa.projectId}:${sa.email}`,
        severity: "medium",
        title: "Service Account with Multiple Keys",
        description: `Service account "${sa.email}" has ${userKeys.length} user-managed keys. More keys increases exposure risk.`,
        resourceName: sa.email,
        projectId: sa.projectId,
        resourceType: "service_account",
        remediationHint: `Consolidate to a single key for "${sa.email}" and rotate regularly.`,
      });
    }
  }

  // sql_public_ip: Cloud SQL instances with public IP
  for (const inst of snapshot.cloudSqlInstances) {
    if (inst.publicIp) {
      findings.push({
        id: `sql_public_ip:${inst.projectId}:${inst.name}`,
        severity: "medium",
        title: "Cloud SQL Instance with Public IP",
        description: `SQL instance "${inst.name}" (${inst.databaseVersion}) has a public IP: ${inst.publicIp}.`,
        resourceName: inst.name,
        projectId: inst.projectId,
        resourceType: "cloud_sql",
        remediationHint: `Disable the public IP for "${inst.name}" and use Cloud SQL Proxy or private IP for connectivity.`,
      });
    }
  }

  // cloud_run_public: Cloud Run services with allUsers binding
  for (const svc of snapshot.cloudRunServices) {
    if (hasPublicBinding(svc.iamPolicy.bindings)) {
      findings.push({
        id: `cloud_run_public:${svc.projectId}:${svc.name}`,
        severity: "medium",
        title: "Cloud Run Service Publicly Accessible",
        description: `Cloud Run service "${svc.name}" in "${svc.region}" allows unauthenticated invocations.`,
        resourceName: svc.name,
        projectId: svc.projectId,
        resourceType: "cloud_run",
        remediationHint: `Remove the allUsers invoker binding from "${svc.name}" and require authentication.`,
      });
    }
  }

  // ── LOW ───────────────────────────────────────────────────────────────────

  // orphaned_sa: disabled service accounts that still appear in IAM bindings
  const disabledSaEmails = new Set(
    snapshot.serviceAccounts.filter((sa) => sa.disabled).map((sa) => `serviceAccount:${sa.email}`)
  );

  if (disabledSaEmails.size > 0) {
    const allBindings: { role: string; members: string[] }[] = [
      ...snapshot.projects.flatMap((p) => p.bindings),
      ...snapshot.storageBuckets.flatMap((b) => b.iamPolicy.bindings),
      ...snapshot.gkeClusters.flatMap((c) => c.iamPolicy.bindings),
      ...snapshot.cloudRunServices.flatMap((s) => s.iamPolicy.bindings),
      ...snapshot.bigqueryDatasets.flatMap((d) => d.iamPolicy.bindings),
      ...snapshot.secrets.flatMap((s) => s.iamPolicy.bindings),
    ];

    const orphanedEmails = new Set<string>();
    for (const binding of allBindings) {
      for (const member of binding.members) {
        if (disabledSaEmails.has(member)) {
          orphanedEmails.add(member.replace("serviceAccount:", ""));
        }
      }
    }

    for (const email of orphanedEmails) {
      const sa = snapshot.serviceAccounts.find((s) => s.email === email);
      findings.push({
        id: `orphaned_sa:${sa?.projectId ?? "unknown"}:${email}`,
        severity: "low",
        title: "Disabled Service Account Still in IAM Bindings",
        description: `Disabled service account "${email}" still appears in resource IAM policies.`,
        resourceName: email,
        projectId: sa?.projectId ?? "unknown",
        resourceType: "service_account",
        remediationHint: `Remove "${email}" from all IAM bindings since it is disabled and should not have active permissions.`,
      });
    }
  }

  // ── SECRETS IN ENV VARS ───────────────────────────────────────────────────

  // cloud_run_secret_env: Cloud Run services with secrets in environment variables
  for (const svc of snapshot.cloudRunServices) {
    if (!svc.envVars || Object.keys(svc.envVars).length === 0) continue;
    const matches = scanEnvVars(svc.envVars);
    for (const match of matches) {
      findings.push({
        id: `secret_in_env:cloudrun:${svc.projectId}:${svc.name}:${match.key}`,
        severity: match.confidence === "high" ? "critical" : "high",
        title: "Secret Detected in Cloud Run Environment Variable",
        description: `Cloud Run service "${svc.name}" has a potential secret in env var "${match.key}" — detected pattern: ${match.patternLabel}. Value starts with: ${match.redactedValue}`,
        resourceName: svc.name,
        projectId: svc.projectId,
        resourceType: "cloud_run",
        remediationHint: `Move the value of "${match.key}" in service "${svc.name}" to Google Secret Manager and reference it as a mounted secret instead of a plain env var.`,
      });
    }
  }

  // sa_not_in_list: SA emails in bindings but absent from serviceAccounts list
  const knownSaEmails = new Set(snapshot.serviceAccounts.map((sa) => sa.email));
  const allIamMembers = [
    ...snapshot.projects.flatMap((p) => p.bindings.flatMap((b) => b.members)),
    ...snapshot.storageBuckets.flatMap((b) => b.iamPolicy.bindings.flatMap((bind) => bind.members)),
    ...snapshot.gkeClusters.flatMap((c) => c.iamPolicy.bindings.flatMap((b) => b.members)),
  ];

  const unknownSas = new Set<string>();
  for (const member of allIamMembers) {
    if (!member.startsWith("serviceAccount:")) continue;
    const email = member.slice("serviceAccount:".length);
    if (!knownSaEmails.has(email) && !email.includes("gserviceaccount.com")) continue;
    if (!knownSaEmails.has(email)) unknownSas.add(email);
  }

  for (const email of unknownSas) {
    const inferredProjectId = inferProjectIdFromServiceAccountEmail(`serviceAccount:${email}`);
    findings.push({
      id: `sa_not_in_list:${email}`,
      severity: "low",
      title: "Unknown Service Account in IAM Bindings",
      description: `Service account "${email}" appears in IAM bindings but is not in the discovered service accounts list.`,
      resourceName: email,
      projectId: inferredProjectId ?? "unknown",
      resourceType: "service_account",
      remediationHint: `Verify that "${email}" still exists and remove it from IAM bindings if it has been deleted.`,
    });
  }

  return findings;
}
