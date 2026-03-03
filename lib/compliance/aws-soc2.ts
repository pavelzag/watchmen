import type { AwsSnapshot } from "@/lib/aws/types";
import type { ComplianceReport, ComplianceCategory, ControlResult } from "./types";
import { makeControl } from "./checks";
import {
  checkAwsIamMfa,
  checkAwsAdminUsers,
  checkAwsStaleAccessKeys,
  checkAwsMultipleActiveKeys,
  checkAwsPublicS3,
  checkAwsS3Encryption,
  checkAwsS3Versioning,
  checkAwsEksPublicEndpoint,
  checkAwsEksLogging,
  checkAwsSshRdpOpenInternet,
  checkAwsOpenAllTraffic,
  checkAwsPublicRds,
  checkAwsRdsEncryption,
  checkAwsRdsBackup,
  checkAwsRdsMultiAz,
  checkAwsPublicRedshift,
  checkAwsRedshiftEncryption,
  checkAwsSecretsRotation,
  checkAwsPublicSecrets,
  checkAwsLambdaPublicPolicy,
  checkAwsSnsPublicPublish,
} from "./aws-checks";

// ── CC6 — Logical and Physical Access Controls ─────────────────────────────

function buildCC6Controls(snapshot: AwsSnapshot): ControlResult[] {
  return [
    makeControl(
      "CC6.1.a",
      "IAM Users Without MFA",
      "All IAM users must have multi-factor authentication enabled to satisfy logical access control requirements.",
      "critical",
      "Enable MFA for all IAM users. Consider enforcing MFA via an IAM policy condition.",
      checkAwsIamMfa(snapshot)
    ),
    makeControl(
      "CC6.1.b",
      "IAM Users With AdministratorAccess",
      "Human users with AdministratorAccess should be minimized and reviewed. Prefer scoped roles and assume-role patterns.",
      "high",
      "Remove AdministratorAccess from regular users. Use roles with scoped permissions and require MFA for privileged actions.",
      checkAwsAdminUsers(snapshot)
    ),
    makeControl(
      "CC6.3.a",
      "Stale Access Keys",
      "Active IAM access keys that have not been used in 90+ days represent unused credentials that should be rotated or deactivated.",
      "high",
      "Deactivate or delete access keys unused for more than 90 days. Rotate active keys regularly.",
      checkAwsStaleAccessKeys(snapshot)
    ),
    makeControl(
      "CC6.3.b",
      "Multiple Active Access Keys",
      "IAM users should not have more than one active access key, which increases credential exposure risk.",
      "medium",
      "Remove duplicate active access keys. Each user should have at most one active key at a time.",
      checkAwsMultipleActiveKeys(snapshot)
    ),
    makeControl(
      "CC6.6.a",
      "Publicly Accessible RDS Instances",
      "RDS database instances must not be publicly accessible to prevent unauthorized network-level access.",
      "critical",
      "Disable the 'Publicly Accessible' setting on RDS instances and place them in a private subnet.",
      checkAwsPublicRds(snapshot)
    ),
    makeControl(
      "CC6.6.b",
      "Publicly Accessible Redshift Clusters",
      "Redshift clusters must not be publicly accessible to prevent unauthorized network-level access.",
      "critical",
      "Disable 'Publicly Accessible' on Redshift clusters and restrict access via VPC security groups.",
      checkAwsPublicRedshift(snapshot)
    ),
    makeControl(
      "CC6.7.a",
      "SSH/RDP Open to Internet",
      "Security groups must not allow SSH (port 22) or RDP (port 3389) traffic from 0.0.0.0/0 or ::/0.",
      "critical",
      "Remove 0.0.0.0/0 from inbound rules for ports 22 and 3389. Use AWS Systems Manager Session Manager or a VPN instead.",
      checkAwsSshRdpOpenInternet(snapshot)
    ),
    makeControl(
      "CC6.7.b",
      "Security Groups Allowing All Traffic",
      "Security groups must not allow all inbound traffic (protocol -1) from any IP address.",
      "critical",
      "Replace all-traffic rules with specific protocol and port rules scoped to known CIDRs.",
      checkAwsOpenAllTraffic(snapshot)
    ),
    makeControl(
      "CC6.7.c",
      "EKS Cluster Public Endpoint Unrestricted",
      "EKS cluster public API endpoints should not be accessible from 0.0.0.0/0.",
      "high",
      "Restrict publicAccessCidrs to known corporate CIDRs or disable the public endpoint entirely.",
      checkAwsEksPublicEndpoint(snapshot)
    ),
  ];
}

// ── C1 — Confidentiality ──────────────────────────────────────────────────

function buildC1Controls(snapshot: AwsSnapshot): ControlResult[] {
  return [
    makeControl(
      "C1.1.a",
      "Public S3 Buckets",
      "S3 buckets must have all four public access block settings enabled to prevent unintended data exposure.",
      "critical",
      "Enable all four S3 Block Public Access settings at the bucket and account level.",
      checkAwsPublicS3(snapshot)
    ),
    makeControl(
      "C1.1.b",
      "Unencrypted S3 Buckets",
      "S3 buckets must use server-side encryption to protect data at rest.",
      "high",
      "Enable default server-side encryption (SSE-S3 or SSE-KMS) on all S3 buckets.",
      checkAwsS3Encryption(snapshot)
    ),
    makeControl(
      "C1.1.c",
      "Public Secrets Manager Secrets",
      "Secrets Manager secrets must not have resource policies granting access to all principals (*).",
      "critical",
      "Remove wildcard principal statements from secrets resource policies. Grant access only to specific IAM roles.",
      checkAwsPublicSecrets(snapshot)
    ),
    makeControl(
      "C1.1.d",
      "Lambda Functions With Public Invocation Policy",
      "Lambda resource policies granting invoke permissions to all principals expose functions to unauthorized callers.",
      "high",
      "Remove wildcard principal from Lambda resource policies. Use API Gateway with authentication or restrict to specific AWS services.",
      checkAwsLambdaPublicPolicy(snapshot)
    ),
    makeControl(
      "C1.1.e",
      "SNS Topics Allowing Public Publish",
      "SNS topics must not allow any principal to publish messages, as this can be abused for spam or data exfiltration.",
      "high",
      "Remove wildcard principal from SNS topic policies. Restrict publish access to specific IAM roles or services.",
      checkAwsSnsPublicPublish(snapshot)
    ),
    makeControl(
      "C1.2.a",
      "Unencrypted RDS Instances",
      "RDS storage encryption protects data at rest. All production databases must have storage encryption enabled.",
      "high",
      "Enable storage encryption when creating RDS instances. To encrypt existing unencrypted instances, create an encrypted snapshot and restore.",
      checkAwsRdsEncryption(snapshot)
    ),
    makeControl(
      "C1.2.b",
      "Unencrypted Redshift Clusters",
      "Redshift cluster encryption protects data at rest. All clusters must have encryption enabled.",
      "high",
      "Enable cluster encryption in Redshift. Existing clusters require creating a new encrypted cluster and migrating data.",
      checkAwsRedshiftEncryption(snapshot)
    ),
  ];
}

// ── CC7 — System Operations ───────────────────────────────────────────────

function buildCC7Controls(snapshot: AwsSnapshot): ControlResult[] {
  return [
    makeControl(
      "CC7.1.a",
      "Secrets Without Rotation",
      "Secrets Manager secrets should have automatic rotation enabled to limit the impact of credential compromise.",
      "medium",
      "Enable automatic rotation for all secrets using an appropriate Lambda rotation function.",
      checkAwsSecretsRotation(snapshot)
    ),
    makeControl(
      "CC7.1.b",
      "EKS Clusters Without Logging",
      "EKS control-plane logging should be enabled to support security event detection and investigation.",
      "medium",
      "Enable EKS control-plane logging (api, audit, authenticator, controllerManager, scheduler) for all clusters.",
      checkAwsEksLogging(snapshot)
    ),
  ];
}

// ── A1 — Availability ────────────────────────────────────────────────────

function buildA1Controls(snapshot: AwsSnapshot): ControlResult[] {
  return [
    makeControl(
      "A1.2.a",
      "RDS Automated Backups Disabled",
      "RDS automated backups (backup retention period > 0) must be enabled to ensure point-in-time recovery capability.",
      "high",
      "Set backup retention period to at least 7 days on all RDS instances.",
      checkAwsRdsBackup(snapshot)
    ),
    makeControl(
      "A1.2.b",
      "RDS Without Multi-AZ",
      "RDS instances should use Multi-AZ deployment for automatic failover and high availability.",
      "medium",
      "Enable Multi-AZ on production RDS instances to ensure availability during an AZ failure.",
      checkAwsRdsMultiAz(snapshot)
    ),
    makeControl(
      "A1.2.c",
      "S3 Bucket Versioning Disabled",
      "S3 versioning provides object-level recovery from accidental deletion or corruption.",
      "low",
      "Enable S3 versioning on critical buckets and configure lifecycle rules to manage version retention costs.",
      checkAwsS3Versioning(snapshot)
    ),
  ];
}

// ── Report builder ────────────────────────────────────────────────────────

export function runAwsSoc2(snapshot: AwsSnapshot): ComplianceReport {
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
      : Math.round(
          ((passingControls + suppressedControls + warningControls * 0.5) / totalControls) * 100
        );

  return {
    standard: "SOC 2 Type II (AWS)",
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
