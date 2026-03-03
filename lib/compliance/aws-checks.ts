import type { AwsSnapshot } from "@/lib/aws/types";
import type { ControlResult } from "./types";
import { pass, result } from "./checks";

// ── IAM ───────────────────────────────────────────────────────────────────

/** IAM users without MFA enabled. */
export function checkAwsIamMfa(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.iamUsers
    .filter((u) => !u.mfaEnabled)
    .map((u) => ({ name: u.userName, projectId: u.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** IAM users with AdministratorAccess policy attached (warning). */
export function checkAwsAdminUsers(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.iamUsers
    .filter((u) => u.attachedPolicies.some((p) => p.includes("AdministratorAccess")))
    .map((u) => ({ name: u.userName, projectId: u.accountId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}

/** IAM users with active access keys unused for 90+ days. */
export function checkAwsStaleAccessKeys(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const now = new Date();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  const evidence = snapshot.iamUsers
    .filter((u) =>
      u.accessKeys.some((k) => {
        if (k.status !== "Active") return false;
        if (!k.lastUsedDate) return false;
        return now.getTime() - new Date(k.lastUsedDate).getTime() > ninetyDays;
      })
    )
    .map((u) => ({ name: u.userName, projectId: u.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** IAM users with more than one active access key. */
export function checkAwsMultipleActiveKeys(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.iamUsers
    .filter((u) => u.accessKeys.filter((k) => k.status === "Active").length > 1)
    .map((u) => ({ name: u.userName, projectId: u.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

// ── S3 ────────────────────────────────────────────────────────────────────

/** S3 buckets with public access block not fully enabled. */
export function checkAwsPublicS3(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.s3Buckets
    .filter(
      (b) =>
        !b.publicAccessBlock.blockPublicAcls ||
        !b.publicAccessBlock.ignorePublicAcls ||
        !b.publicAccessBlock.blockPublicPolicy ||
        !b.publicAccessBlock.restrictPublicBuckets
    )
    .map((b) => ({ name: b.bucketName, projectId: b.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** S3 buckets without server-side encryption. */
export function checkAwsS3Encryption(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.s3Buckets
    .filter((b) => b.encryption === "None")
    .map((b) => ({ name: b.bucketName, projectId: b.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** S3 buckets without versioning enabled (warning). */
export function checkAwsS3Versioning(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.s3Buckets
    .filter((b) => b.versioning !== "Enabled")
    .map((b) => ({ name: b.bucketName, projectId: b.accountId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}

// ── EKS ───────────────────────────────────────────────────────────────────

/** EKS clusters with public endpoint open to 0.0.0.0/0. */
export function checkAwsEksPublicEndpoint(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.eksClusters
    .filter(
      (c) =>
        c.endpointPublicAccess &&
        (c.publicAccessCidrs.includes("0.0.0.0/0") || c.publicAccessCidrs.length === 0)
    )
    .map((c) => ({ name: c.clusterName, projectId: c.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** EKS clusters without control-plane logging enabled (warning). */
export function checkAwsEksLogging(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.eksClusters
    .filter((c) => !c.loggingEnabled)
    .map((c) => ({ name: c.clusterName, projectId: c.accountId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}

// ── Security Groups ───────────────────────────────────────────────────────

/** Security groups with SSH (22) or RDP (3389) open to 0.0.0.0/0 or ::/0. */
export function checkAwsSshRdpOpenInternet(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.securityGroups
    .filter((sg) =>
      sg.inboundRules.some((r) => {
        const openToWorld =
          r.cidrRanges.includes("0.0.0.0/0") || r.ipv6CidrRanges.includes("::/0");
        if (!openToWorld) return false;
        if (r.protocol === "-1") return true;
        return (
          r.fromPort === 22 ||
          r.toPort === 22 ||
          r.fromPort === 3389 ||
          r.toPort === 3389
        );
      })
    )
    .map((sg) => ({ name: sg.groupName, projectId: sg.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** Security groups allowing all traffic (protocol -1) from 0.0.0.0/0. */
export function checkAwsOpenAllTraffic(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.securityGroups
    .filter((sg) =>
      sg.inboundRules.some(
        (r) =>
          r.protocol === "-1" &&
          (r.cidrRanges.includes("0.0.0.0/0") || r.ipv6CidrRanges.includes("::/0"))
      )
    )
    .map((sg) => ({ name: sg.groupName, projectId: sg.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

// ── RDS ───────────────────────────────────────────────────────────────────

/** RDS instances that are publicly accessible. */
export function checkAwsPublicRds(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.rdsInstances
    .filter((d) => d.publiclyAccessible)
    .map((d) => ({ name: d.dbInstanceIdentifier, projectId: d.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** RDS instances without storage encryption. */
export function checkAwsRdsEncryption(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.rdsInstances
    .filter((d) => !d.storageEncrypted)
    .map((d) => ({ name: d.dbInstanceIdentifier, projectId: d.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** RDS instances without automated backups (retention = 0). */
export function checkAwsRdsBackup(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.rdsInstances
    .filter((d) => d.backupRetentionPeriod === 0)
    .map((d) => ({ name: d.dbInstanceIdentifier, projectId: d.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** RDS instances without Multi-AZ (warning). */
export function checkAwsRdsMultiAz(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.rdsInstances
    .filter((d) => !d.multiAz)
    .map((d) => ({ name: d.dbInstanceIdentifier, projectId: d.accountId }));
  return evidence.length === 0 ? pass() : result("warning", evidence);
}

// ── Redshift ──────────────────────────────────────────────────────────────

/** Redshift clusters that are publicly accessible. */
export function checkAwsPublicRedshift(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.redshiftClusters
    .filter((c) => c.publiclyAccessible)
    .map((c) => ({ name: c.clusterIdentifier, projectId: c.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** Redshift clusters without encryption. */
export function checkAwsRedshiftEncryption(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.redshiftClusters
    .filter((c) => !c.encrypted)
    .map((c) => ({ name: c.clusterIdentifier, projectId: c.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

// ── Secrets Manager ───────────────────────────────────────────────────────

/** Secrets without rotation enabled. */
export function checkAwsSecretsRotation(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.secrets
    .filter((s) => !s.rotationEnabled)
    .map((s) => ({ name: s.name, projectId: s.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

/** Secrets with a public resource policy (Principal: *). */
export function checkAwsPublicSecrets(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.secrets
    .filter((s) =>
      s.resourcePolicy.some((p) => p.effect === "Allow" && p.principals.includes("*"))
    )
    .map((s) => ({ name: s.name, projectId: s.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

// ── Lambda ────────────────────────────────────────────────────────────────

/** Lambda functions with a public resource policy (Principal: *). */
export function checkAwsLambdaPublicPolicy(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.lambdaFunctions
    .filter((f) => f.resourcePolicy.some((s) => s.principals.includes("*")))
    .map((f) => ({ name: f.functionName, projectId: f.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}

// ── SNS ───────────────────────────────────────────────────────────────────

/** SNS topics allowing public Publish (Principal: *). */
export function checkAwsSnsPublicPublish(snapshot: AwsSnapshot): Pick<ControlResult, "status" | "evidence"> {
  const evidence = snapshot.snsTopics
    .filter((t) =>
      t.policy.some(
        (s) =>
          s.effect === "Allow" &&
          s.principals.includes("*") &&
          s.actions.some((a) => a === "SNS:Publish" || a === "sns:Publish" || a === "*")
      )
    )
    .map((t) => ({ name: t.topicName, projectId: t.accountId }));
  return evidence.length === 0 ? pass() : result("fail", evidence);
}
