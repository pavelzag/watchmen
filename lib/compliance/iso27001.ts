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
  checkCloudSQLBackup,
  checkBucketVersioning,
  checkGKEPrivateCluster,
  checkCloudSQLSSL,
} from "./checks";

// ── A.5 — Organizational Controls ────────────────────────────────────────

function buildA5Controls(snapshot: GcpSnapshot): ControlResult[] {
  return [
    makeControl(
      "A.5.15.a",
      "Privileged Human Access Across Projects",
      "Access to information and other associated assets shall be restricted in accordance with the established policy on access control. Human users must not hold owner or editor roles across multiple projects.",
      "high",
      "Review and reduce roles to least-privilege; use project-specific roles instead of primitive roles.",
      checkPrivilegedHumanAccess(snapshot)
    ),
    makeControl(
      "A.5.16.a",
      "Disabled Identity Cleanup",
      "The full lifecycle of identities shall be managed. Disabled service accounts must be removed from all IAM bindings to prevent orphaned access.",
      "medium",
      "Remove disabled service account entries from all resource IAM policies.",
      checkDisabledSAInBindings(snapshot)
    ),
    makeControl(
      "A.5.17.a",
      "Authentication Credential Rotation",
      "Management of authentication information shall include rotation of service account keys. User-managed keys must be rotated within 90 days.",
      "high",
      "Delete and recreate keys older than 90 days. Consider Workload Identity Federation to eliminate long-lived keys.",
      checkSAKeyRotation(snapshot)
    ),
    makeControl(
      "A.5.17.b",
      "GKE Workload Identity",
      "Management of authentication information shall avoid long-lived credentials. GKE clusters should use Workload Identity to eliminate long-lived service account keys mounted into pods.",
      "high",
      "Enable Workload Identity on all GKE clusters and migrate workloads to use Workload Identity bindings.",
      checkGKEWorkloadIdentity(snapshot)
    ),
    makeControl(
      "A.5.18.a",
      "Service Account Access Rights",
      "Access rights shall be provisioned according to the principle of least privilege. Service accounts must not hold primitive owner or editor roles.",
      "high",
      "Replace owner/editor with purpose-specific predefined roles for each service account.",
      checkSAPrimitiveRoles(snapshot)
    ),
  ];
}

// ── A.8 — Technological Controls ─────────────────────────────────────────

function buildA8Controls(snapshot: GcpSnapshot): ControlResult[] {
  return [
    makeControl(
      "A.8.2.a",
      "Multiple Privileged Access Keys",
      "The allocation and use of privileged access rights shall be restricted and managed. Service accounts should not have more than one active user-managed key.",
      "medium",
      "Consolidate to a single key per service account and rotate it regularly.",
      checkMultipleSAKeys(snapshot)
    ),
    makeControl(
      "A.8.3.a",
      "Public Storage Bucket Access",
      "Access to information and application system functions shall be restricted in accordance with access control policy. Storage buckets must not be publicly accessible.",
      "critical",
      "Remove allUsers/allAuthenticatedUsers from bucket IAM policies. Enable uniform bucket-level access.",
      checkPublicBuckets(snapshot)
    ),
    makeControl(
      "A.8.5.a",
      "Secret Manager Access Control",
      "Secure authentication technologies and procedures shall be implemented. Secrets must not be accessible to allUsers or allAuthenticatedUsers.",
      "high",
      "Remove public IAM bindings from all secrets. Grant access only to specific service accounts or users.",
      checkPublicSecrets(snapshot)
    ),
    makeControl(
      "A.8.5.b",
      "Unauthenticated Cloud Run Invocations",
      "Secure authentication shall be enforced for all services. Cloud Run services should require authentication to prevent unintended public access.",
      "medium",
      "Remove the allUsers Cloud Run Invoker binding. Use Cloud Endpoints or IAP for public APIs.",
      checkPublicCloudRun(snapshot)
    ),
    makeControl(
      "A.8.8.a",
      "GKE Cluster Vulnerability Management",
      "Information about technical vulnerabilities of systems in use shall be obtained in a timely fashion. GKE clusters must run a supported Kubernetes version (≥1.27).",
      "medium",
      "Upgrade clusters below 1.27 to a currently supported GKE channel version.",
      checkGKEVersion(snapshot)
    ),
    makeControl(
      "A.8.14.a",
      "Cloud SQL Automated Backup",
      "Redundancy of information processing facilities shall be implemented. Cloud SQL instances must have automated backups enabled to ensure data availability and recovery.",
      "high",
      "Enable automated backups in Cloud SQL instance settings and configure a suitable retention window.",
      checkCloudSQLBackup(snapshot)
    ),
    makeControl(
      "A.8.14.b",
      "Storage Bucket Versioning",
      "Redundancy of information processing facilities shall be implemented. Storage buckets should have versioning enabled to support data recovery from accidental deletion or corruption.",
      "medium",
      "Enable object versioning on critical storage buckets and configure lifecycle rules to manage version retention.",
      checkBucketVersioning(snapshot)
    ),
    makeControl(
      "A.8.20.a",
      "Firewall Rules Open to Internet",
      "Networks shall be managed and controlled to protect information in systems and applications. No firewall ingress rules should allow traffic from 0.0.0.0/0 or ::/0.",
      "critical",
      "Restrict source IP ranges to known CIDR blocks. Use Cloud Armor for public-facing services.",
      checkFirewallOpenInternet(snapshot)
    ),
    makeControl(
      "A.8.20.b",
      "SSH/RDP Exposed to Internet",
      "Network boundaries shall be managed with controls including restricting administrative access. SSH (port 22) and RDP (port 3389) must not be reachable from all internet IPs.",
      "critical",
      "Remove 0.0.0.0/0 from firewall rules allowing port 22 or 3389. Use IAP TCP forwarding instead.",
      checkSSHRDPOpenInternet(snapshot)
    ),
    makeControl(
      "A.8.20.c",
      "VM External IP Exposure",
      "Network access controls shall limit exposure. VMs with external IP addresses increase the attack surface and should be reviewed.",
      "low",
      "Remove external IPs where not required. Use Cloud NAT for outbound traffic and IAP for admin access.",
      checkVMExternalIP(snapshot)
    ),
    makeControl(
      "A.8.20.d",
      "GKE Private Cluster",
      "Network boundaries shall be enforced for all compute resources. GKE clusters should use private nodes to reduce the network attack surface.",
      "medium",
      "Recreate clusters with private nodes enabled, or migrate existing workloads to a private cluster.",
      checkGKEPrivateCluster(snapshot)
    ),
    makeControl(
      "A.8.21.a",
      "Cloud SQL Public IP",
      "Security mechanisms, service levels and management requirements for all network services shall be identified. Cloud SQL instances must not expose a public IP address.",
      "medium",
      "Disable public IP on Cloud SQL instances and use Cloud SQL Auth Proxy or private IP.",
      checkCloudSQLPublicIP(snapshot)
    ),
    makeControl(
      "A.8.24.a",
      "Cloud SQL SSL Required",
      "Rules for the effective use of cryptography shall be defined. Cloud SQL instances must require SSL for all client connections to protect data in transit.",
      "high",
      "Enable 'Require SSL' in the Cloud SQL instance settings and update all client connection strings.",
      checkCloudSQLSSL(snapshot)
    ),
  ];
}

// ── Report builder ────────────────────────────────────────────────────────

export function runIso27001(snapshot: GcpSnapshot): ComplianceReport {
  const categories: ComplianceCategory[] = [
    {
      id: "A.5",
      name: "Organizational Controls",
      description: "Controls addressing access policy, identity lifecycle, and authentication information management.",
      controls: buildA5Controls(snapshot),
    },
    {
      id: "A.8",
      name: "Technological Controls",
      description: "Controls securing systems, networks, applications, and data through technical mechanisms.",
      controls: buildA8Controls(snapshot),
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
    standard: "ISO 27001:2022",
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
