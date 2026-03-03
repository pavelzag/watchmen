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

// ── A.5 — Organizational Controls ────────────────────────────────────────

function buildA5Controls(snapshot: AwsSnapshot): ControlResult[] {
  return [
    makeControl(
      "A.5.15.a",
      "IAM Users Without MFA",
      "Access to information and other associated assets shall be restricted in accordance with the established policy on access control. All IAM users must have MFA enabled.",
      "critical",
      "Enable MFA for all IAM users. Consider enforcing MFA via an IAM policy condition.",
      checkAwsIamMfa(snapshot)
    ),
    makeControl(
      "A.5.15.b",
      "IAM Users With AdministratorAccess",
      "Access rights shall be restricted to the minimum necessary. Human users with AdministratorAccess should be minimized and reviewed regularly.",
      "high",
      "Remove AdministratorAccess from regular users. Use scoped IAM roles and require MFA for privileged actions.",
      checkAwsAdminUsers(snapshot)
    ),
    makeControl(
      "A.5.16.a",
      "Stale Access Keys",
      "The full lifecycle of identities shall be managed. Active access keys unused for 90+ days represent unmanaged credentials that should be rotated or deactivated.",
      "high",
      "Deactivate or delete access keys unused for more than 90 days. Rotate active keys regularly.",
      checkAwsStaleAccessKeys(snapshot)
    ),
    makeControl(
      "A.5.17.a",
      "Multiple Active Access Keys",
      "Management of authentication information shall prevent unnecessary credential proliferation. IAM users should have at most one active access key.",
      "medium",
      "Remove duplicate active access keys. Each user should have at most one active key at a time.",
      checkAwsMultipleActiveKeys(snapshot)
    ),
    makeControl(
      "A.5.17.b",
      "Secrets Without Rotation",
      "Management of authentication information shall include regular rotation of credentials. Secrets Manager secrets must have automatic rotation enabled.",
      "medium",
      "Enable automatic rotation for all secrets using an appropriate Lambda rotation function.",
      checkAwsSecretsRotation(snapshot)
    ),
  ];
}

// ── A.8 — Technological Controls ─────────────────────────────────────────

function buildA8Controls(snapshot: AwsSnapshot): ControlResult[] {
  return [
    makeControl(
      "A.8.3.a",
      "Public S3 Buckets",
      "Access to information and application system functions shall be restricted in accordance with access control policy. S3 buckets must not be publicly accessible.",
      "critical",
      "Enable all four S3 Block Public Access settings at the bucket and account level.",
      checkAwsPublicS3(snapshot)
    ),
    makeControl(
      "A.8.5.a",
      "Public Secrets Manager Secrets",
      "Secure authentication technologies and procedures shall be implemented. Secrets must not be accessible to all principals (*).",
      "critical",
      "Remove wildcard principal statements from secrets resource policies. Grant access only to specific IAM roles.",
      checkAwsPublicSecrets(snapshot)
    ),
    makeControl(
      "A.8.5.b",
      "Lambda Functions With Public Invocation Policy",
      "Secure authentication shall be enforced for all services. Lambda functions must not grant invoke permissions to all principals.",
      "high",
      "Remove wildcard principal from Lambda resource policies. Use API Gateway with authentication or restrict to specific AWS services.",
      checkAwsLambdaPublicPolicy(snapshot)
    ),
    makeControl(
      "A.8.5.c",
      "SNS Topics Allowing Public Publish",
      "Secure authentication shall be enforced for all services. SNS topics must not allow any principal to publish messages.",
      "high",
      "Remove wildcard principal from SNS topic policies. Restrict publish access to specific IAM roles or services.",
      checkAwsSnsPublicPublish(snapshot)
    ),
    makeControl(
      "A.8.24.a",
      "Unencrypted S3 Buckets",
      "Rules for the effective use of cryptography shall be defined. S3 buckets must use server-side encryption to protect data at rest.",
      "high",
      "Enable default server-side encryption (SSE-S3 or SSE-KMS) on all S3 buckets.",
      checkAwsS3Encryption(snapshot)
    ),
    makeControl(
      "A.8.24.b",
      "Unencrypted RDS Instances",
      "Rules for the effective use of cryptography shall be defined. RDS storage encryption must be enabled on all database instances.",
      "high",
      "Enable storage encryption when creating RDS instances. To encrypt existing unencrypted instances, create an encrypted snapshot and restore.",
      checkAwsRdsEncryption(snapshot)
    ),
    makeControl(
      "A.8.24.c",
      "Unencrypted Redshift Clusters",
      "Rules for the effective use of cryptography shall be defined. Redshift clusters must have encryption enabled.",
      "high",
      "Enable cluster encryption in Redshift. Existing clusters require creating a new encrypted cluster and migrating data.",
      checkAwsRedshiftEncryption(snapshot)
    ),
    makeControl(
      "A.8.20.a",
      "SSH/RDP Open to Internet",
      "Networks shall be managed and controlled to protect information in systems and applications. Security groups must not allow SSH or RDP from 0.0.0.0/0.",
      "critical",
      "Remove 0.0.0.0/0 from inbound rules for ports 22 and 3389. Use AWS Systems Manager Session Manager or a VPN instead.",
      checkAwsSshRdpOpenInternet(snapshot)
    ),
    makeControl(
      "A.8.20.b",
      "Security Groups Allowing All Traffic",
      "Network access controls shall restrict unauthorized access. Security groups must not allow all inbound traffic from any IP address.",
      "critical",
      "Replace all-traffic rules with specific protocol and port rules scoped to known CIDRs.",
      checkAwsOpenAllTraffic(snapshot)
    ),
    makeControl(
      "A.8.20.c",
      "EKS Cluster Public Endpoint Unrestricted",
      "Network boundaries shall be managed with controls including restricting administrative access. EKS public API endpoints must not be open to 0.0.0.0/0.",
      "high",
      "Restrict publicAccessCidrs to known corporate CIDRs or disable the public endpoint entirely.",
      checkAwsEksPublicEndpoint(snapshot)
    ),
    makeControl(
      "A.8.20.d",
      "Publicly Accessible RDS Instances",
      "Security mechanisms for all network services shall be identified. RDS instances must not be publicly accessible.",
      "critical",
      "Disable the 'Publicly Accessible' setting on RDS instances and place them in a private subnet.",
      checkAwsPublicRds(snapshot)
    ),
    makeControl(
      "A.8.20.e",
      "Publicly Accessible Redshift Clusters",
      "Security mechanisms for all network services shall be identified. Redshift clusters must not be publicly accessible.",
      "critical",
      "Disable 'Publicly Accessible' on Redshift clusters and restrict access via VPC security groups.",
      checkAwsPublicRedshift(snapshot)
    ),
    makeControl(
      "A.8.8.a",
      "EKS Clusters Without Logging",
      "Information about security events shall be obtained in a timely fashion. EKS control-plane logging should be enabled to support incident investigation.",
      "medium",
      "Enable EKS control-plane logging (api, audit, authenticator, controllerManager, scheduler) for all clusters.",
      checkAwsEksLogging(snapshot)
    ),
    makeControl(
      "A.8.14.a",
      "RDS Automated Backups Disabled",
      "Redundancy of information processing facilities shall be implemented. RDS automated backups must be enabled to ensure point-in-time recovery.",
      "high",
      "Set backup retention period to at least 7 days on all RDS instances.",
      checkAwsRdsBackup(snapshot)
    ),
    makeControl(
      "A.8.14.b",
      "RDS Without Multi-AZ",
      "Redundancy of information processing facilities shall be implemented. RDS instances should use Multi-AZ for high availability.",
      "medium",
      "Enable Multi-AZ on production RDS instances to ensure availability during an AZ failure.",
      checkAwsRdsMultiAz(snapshot)
    ),
    makeControl(
      "A.8.14.c",
      "S3 Bucket Versioning Disabled",
      "Redundancy of information processing facilities shall be implemented. S3 versioning enables object-level recovery from accidental deletion or corruption.",
      "low",
      "Enable S3 versioning on critical buckets and configure lifecycle rules to manage version retention costs.",
      checkAwsS3Versioning(snapshot)
    ),
  ];
}

// ── Report builder ────────────────────────────────────────────────────────

export function runAwsIso27001(snapshot: AwsSnapshot): ComplianceReport {
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
      : Math.round(
          ((passingControls + suppressedControls + warningControls * 0.5) / totalControls) * 100
        );

  return {
    standard: "ISO 27001:2022 (AWS)",
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
