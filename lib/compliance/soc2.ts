import type { GcpSnapshot } from "@/lib/gcp/types";
import type { ComplianceReport, ComplianceCategory, ControlResult } from "./types";
import {
  makeControl,
  checkPrivilegedHumanAccess,
  checkSAPrimitiveRoles,
  checkSAKeyRotation,
  checkDisabledSAInBindings,
  checkMultipleSAKeys,
  checkCloudSQLPublicIP,
  checkFirewallOpenInternet,
  checkSSHRDPOpenInternet,
  checkPublicBuckets,
  checkPublicSecrets,
  checkPublicCloudRun,
  checkGKEVersion,
  checkVMExternalIP,
  checkGKEWorkloadIdentity,
  checkCloudSQLSSL,
  checkGKEPrivateCluster,
  checkCloudSQLBackup,
  checkBucketVersioning,
} from "./checks";

// ── CC6 — Logical and Physical Access Controls ─────────────────────────────

function buildCC6Controls(snapshot: GcpSnapshot): ControlResult[] {
  return [
    makeControl(
      "CC6.1.a",
      "Privileged Human Access Across Projects",
      "No human users should hold owner or editor roles on two or more projects simultaneously.",
      "high",
      "Review and reduce roles to least-privilege; use project-specific roles instead of primitive roles.",
      checkPrivilegedHumanAccess(snapshot)
    ),
    makeControl(
      "CC6.1.b",
      "Service Account Primitive Roles",
      "Service accounts should not be granted owner or editor roles.",
      "high",
      "Replace owner/editor with purpose-specific predefined roles for each service account.",
      checkSAPrimitiveRoles(snapshot)
    ),
    makeControl(
      "CC6.3.a",
      "Service Account Key Rotation",
      "User-managed service account keys must be rotated within 90 days.",
      "high",
      "Delete and recreate keys older than 90 days. Consider using Workload Identity Federation to eliminate keys.",
      checkSAKeyRotation(snapshot)
    ),
    makeControl(
      "CC6.3.b",
      "Disabled Service Accounts in IAM",
      "Disabled service accounts should not remain in any IAM policy binding.",
      "medium",
      "Remove disabled service account entries from all resource IAM policies.",
      checkDisabledSAInBindings(snapshot)
    ),
    makeControl(
      "CC6.3.c",
      "Multiple User-Managed SA Keys",
      "Service accounts should not have more than one active user-managed key.",
      "medium",
      "Consolidate to a single key per service account and rotate it regularly.",
      checkMultipleSAKeys(snapshot)
    ),
    makeControl(
      "CC6.3.d",
      "GKE Workload Identity",
      "GKE clusters should use Workload Identity to avoid mounting long-lived service account keys into pods.",
      "high",
      "Enable Workload Identity on all GKE clusters and migrate workloads to use Workload Identity bindings.",
      checkGKEWorkloadIdentity(snapshot)
    ),
    makeControl(
      "CC6.6.a",
      "Cloud SQL Public IP",
      "Cloud SQL instances should not expose a public IP address.",
      "medium",
      "Disable public IP on Cloud SQL instances and use Cloud SQL Auth Proxy or private IP.",
      checkCloudSQLPublicIP(snapshot)
    ),
    makeControl(
      "CC6.7.a",
      "Firewall Rules Open to Internet",
      "No firewall ingress rules should allow traffic from 0.0.0.0/0 or ::/0.",
      "critical",
      "Restrict source IP ranges to known CIDR blocks. Use Cloud Armor for public-facing services.",
      checkFirewallOpenInternet(snapshot)
    ),
    makeControl(
      "CC6.7.b",
      "SSH/RDP Open to Internet",
      "SSH (port 22) and RDP (port 3389) must not be reachable from all internet IPs.",
      "critical",
      "Remove 0.0.0.0/0 from firewall rules allowing port 22 or 3389. Use IAP TCP forwarding instead.",
      checkSSHRDPOpenInternet(snapshot)
    ),
    makeControl(
      "CC6.7.c",
      "Cloud SQL SSL Required",
      "Cloud SQL instances must require SSL for all client connections to encrypt data in transit.",
      "high",
      "Enable 'Require SSL' in the Cloud SQL instance settings and update all client connection strings.",
      checkCloudSQLSSL(snapshot)
    ),
  ];
}

// ── C1 — Confidentiality ──────────────────────────────────────────────────

function buildC1Controls(snapshot: GcpSnapshot): ControlResult[] {
  return [
    makeControl(
      "C1.1.a",
      "Public Storage Buckets",
      "Storage buckets must not grant access to allUsers or allAuthenticatedUsers.",
      "critical",
      "Remove allUsers/allAuthenticatedUsers from bucket IAM policies. Enable uniform bucket-level access.",
      checkPublicBuckets(snapshot)
    ),
    makeControl(
      "C1.1.b",
      "Public Secret Access",
      "Secrets Manager secrets must not be accessible to allUsers or allAuthenticatedUsers.",
      "high",
      "Remove public IAM bindings from all secrets. Grant access only to specific service accounts or users.",
      checkPublicSecrets(snapshot)
    ),
    makeControl(
      "C1.1.c",
      "Unauthenticated Cloud Run Invocations",
      "Cloud Run services should require authentication to prevent unintended public exposure.",
      "medium",
      "Remove the allUsers Cloud Run Invoker binding. Use Cloud Endpoints or IAP for public APIs.",
      checkPublicCloudRun(snapshot)
    ),
  ];
}

// ── CC7 — System Operations ───────────────────────────────────────────────

function buildCC7Controls(snapshot: GcpSnapshot): ControlResult[] {
  return [
    makeControl(
      "CC7.1.a",
      "GKE Cluster Version Currency",
      "GKE clusters must run a supported Kubernetes version (≥1.27) to receive security patches.",
      "medium",
      "Upgrade clusters below 1.27 to a currently supported GKE channel version.",
      checkGKEVersion(snapshot)
    ),
    makeControl(
      "CC7.1.b",
      "GKE Private Cluster",
      "GKE clusters should use private nodes to enforce network boundary and reduce attack surface.",
      "medium",
      "Recreate clusters with private nodes enabled, or migrate existing workloads to a private cluster.",
      checkGKEPrivateCluster(snapshot)
    ),
    makeControl(
      "CC7.2.a",
      "VM External IP Exposure",
      "VMs with external IP addresses increase attack surface and should be reviewed.",
      "low",
      "Remove external IPs where not required. Use Cloud NAT for outbound traffic and IAP for admin access.",
      checkVMExternalIP(snapshot)
    ),
  ];
}

// ── A1 — Availability ────────────────────────────────────────────────────

function buildA1Controls(snapshot: GcpSnapshot): ControlResult[] {
  return [
    makeControl(
      "A1.2.a",
      "Cloud SQL Automated Backup",
      "Cloud SQL instances must have automated backups enabled to ensure data availability and recovery.",
      "high",
      "Enable automated backups in Cloud SQL instance settings and configure a suitable retention window.",
      checkCloudSQLBackup(snapshot)
    ),
    makeControl(
      "A1.2.b",
      "Storage Bucket Versioning",
      "Storage buckets should have versioning enabled to support data recovery from accidental deletion or corruption.",
      "medium",
      "Enable object versioning on critical storage buckets and configure lifecycle rules to manage version retention.",
      checkBucketVersioning(snapshot)
    ),
  ];
}

// ── Report builder ────────────────────────────────────────────────────────

export function runSoc2(snapshot: GcpSnapshot): ComplianceReport {
  const categories: ComplianceCategory[] = [
    {
      id: "CC6",
      name: "Logical and Physical Access Controls",
      description: "Controls that restrict access to information assets to authorized individuals only.",
      controls: buildCC6Controls(snapshot),
    },
    {
      id: "C1",
      name: "Confidentiality",
      description: "Controls that protect confidential information from unauthorized disclosure.",
      controls: buildC1Controls(snapshot),
    },
    {
      id: "CC7",
      name: "System Operations",
      description: "Controls that detect and respond to security events and maintain system health.",
      controls: buildCC7Controls(snapshot),
    },
    {
      id: "A1",
      name: "Availability",
      description: "Controls that ensure the system is available for operation and use as committed or agreed.",
      controls: buildA1Controls(snapshot),
    },
  ];

  const allControls = categories.flatMap((c) => c.controls);
  const totalControls = allControls.length;
  const passingControls = allControls.filter((c) => c.status === "pass").length;
  const failingControls = allControls.filter((c) => c.status === "fail").length;
  const warningControls = allControls.filter((c) => c.status === "warning").length;
  const suppressedControls = allControls.filter((c) => c.status === "suppressed").length;
  const score =
    totalControls === 0
      ? 100
      : Math.round(((passingControls + suppressedControls + warningControls * 0.5) / totalControls) * 100);

  return {
    standard: "SOC 2 Type II",
    generatedAt: new Date().toISOString(),
    totalControls,
    passingControls,
    failingControls,
    warningControls,
    suppressedControls,
    score,
    categories,
  };
}
