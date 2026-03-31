import type { AwsSnapshot, AwsSecurityFinding } from "./aws/types";
import { scanEnvVars } from "@/lib/secrets-detection";

let _findingId = 0;
function nextId(): string {
  return `aws-finding-${++_findingId}`;
}

/**
 * Computes AWS security findings from a snapshot. Pure function — no API calls.
 */
export function computeAwsFindings(snapshot: AwsSnapshot): AwsSecurityFinding[] {
  _findingId = 0;
  const findings: AwsSecurityFinding[] = [];

  // ── IAM Users ────────────────────────────────────────────────────────────

  // Rule 1: IAM user without MFA
  for (const user of snapshot.iamUsers) {
    if (!user.mfaEnabled) {
      findings.push({
        id: nextId(),
        severity: "high",
        title: "IAM user without MFA",
        description: `User "${user.userName}" in account ${user.accountId} does not have MFA enabled.`,
        resourceName: user.userName,
        accountId: user.accountId,
        resourceType: "iam_user",
        remediationHint: "Enable MFA for this IAM user via the AWS Console or CLI.",
      });
    }
  }

  // Rule 2: IAM user with AdministratorAccess
  for (const user of snapshot.iamUsers) {
    const hasAdmin = user.attachedPolicies.includes(
      "arn:aws:iam::aws:policy/AdministratorAccess"
    );
    if (hasAdmin) {
      findings.push({
        id: nextId(),
        severity: "critical",
        title: "IAM user with AdministratorAccess",
        description: `User "${user.userName}" in account ${user.accountId} has the AdministratorAccess policy attached.`,
        resourceName: user.userName,
        accountId: user.accountId,
        resourceType: "iam_user",
        remediationHint:
          "Apply least-privilege: remove AdministratorAccess and grant only the permissions required.",
      });
    }
  }

  // Rule 3: Stale access key (not used in 90+ days or never used)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  for (const user of snapshot.iamUsers) {
    for (const key of user.accessKeys) {
      if (key.status === "Active") {
        const lastUsed = key.lastUsedDate ? new Date(key.lastUsedDate) : null;
        if (!lastUsed || lastUsed < ninetyDaysAgo) {
          findings.push({
            id: nextId(),
            severity: "medium",
            title: "Stale active access key",
            description: `User "${user.userName}" has access key ${key.accessKeyId} that ${
              lastUsed ? `was last used on ${lastUsed.toISOString().slice(0, 10)}` : "has never been used"
            }.`,
            resourceName: user.userName,
            accountId: user.accountId,
            resourceType: "iam_user",
            remediationHint:
              "Rotate or deactivate access keys that haven't been used in 90+ days.",
          });
        }
      }
    }
  }

  // Rule 4: Multiple active access keys
  for (const user of snapshot.iamUsers) {
    const activeKeys = user.accessKeys.filter((k) => k.status === "Active");
    if (activeKeys.length > 1) {
      findings.push({
        id: nextId(),
        severity: "medium",
        title: "Multiple active access keys",
        description: `User "${user.userName}" has ${activeKeys.length} active access keys.`,
        resourceName: user.userName,
        accountId: user.accountId,
        resourceType: "iam_user",
        remediationHint:
          "Each IAM user should have at most one active access key.",
      });
    }
  }

  // ── S3 Buckets ───────────────────────────────────────────────────────────

  // Rule 5: S3 bucket with public access
  for (const bucket of snapshot.s3Buckets) {
    const pab = bucket.publicAccessBlock;
    const isPublic =
      !pab.blockPublicAcls ||
      !pab.ignorePublicAcls ||
      !pab.blockPublicPolicy ||
      !pab.restrictPublicBuckets;

    const hasPublicPolicy = bucket.bucketPolicy.some(
      (s) => s.effect === "Allow" && s.principals.includes("*")
    );

    if (isPublic || hasPublicPolicy) {
      findings.push({
        id: nextId(),
        severity: hasPublicPolicy ? "critical" : "high",
        title: "S3 bucket with public access",
        description: `Bucket "${bucket.bucketName}" in account ${bucket.accountId} ${
          hasPublicPolicy
            ? "has a bucket policy granting public access"
            : "does not have all public access block settings enabled"
        }.`,
        resourceName: bucket.bucketName,
        accountId: bucket.accountId,
        region: bucket.region,
        resourceType: "s3_bucket",
        remediationHint:
          "Enable all four public access block settings and remove any bucket policies that allow Principal: '*'.",
      });
    }
  }

  // Rule 6: S3 bucket without encryption
  for (const bucket of snapshot.s3Buckets) {
    if (bucket.encryption === "None") {
      findings.push({
        id: nextId(),
        severity: "medium",
        title: "S3 bucket without server-side encryption",
        description: `Bucket "${bucket.bucketName}" in account ${bucket.accountId} has no server-side encryption configured.`,
        resourceName: bucket.bucketName,
        accountId: bucket.accountId,
        region: bucket.region,
        resourceType: "s3_bucket",
        remediationHint:
          "Enable SSE-S3 or SSE-KMS encryption on this bucket.",
      });
    }
  }

  // ── EKS Clusters ─────────────────────────────────────────────────────────

  // Rule 7: EKS cluster with public endpoint open to all
  for (const cluster of snapshot.eksClusters) {
    if (
      cluster.endpointPublicAccess &&
      cluster.publicAccessCidrs.includes("0.0.0.0/0")
    ) {
      findings.push({
        id: nextId(),
        severity: "high",
        title: "EKS cluster API endpoint open to 0.0.0.0/0",
        description: `EKS cluster "${cluster.clusterName}" in account ${cluster.accountId} (${cluster.region}) has its public endpoint accessible from any IP.`,
        resourceName: cluster.clusterName,
        accountId: cluster.accountId,
        region: cluster.region,
        resourceType: "eks_cluster",
        remediationHint:
          "Restrict publicAccessCidrs to specific trusted IP ranges or disable public endpoint access.",
      });
    }
  }

  // Rule 8: EKS cluster without logging
  for (const cluster of snapshot.eksClusters) {
    if (!cluster.loggingEnabled) {
      findings.push({
        id: nextId(),
        severity: "low",
        title: "EKS cluster without control plane logging",
        description: `EKS cluster "${cluster.clusterName}" in account ${cluster.accountId} has control plane logging disabled.`,
        resourceName: cluster.clusterName,
        accountId: cluster.accountId,
        region: cluster.region,
        resourceType: "eks_cluster",
        remediationHint: "Enable EKS control plane logging (api, audit, authenticator) for observability.",
      });
    }
  }

  // ── Security Groups ──────────────────────────────────────────────────────

  // Rule 9: Security group open SSH/RDP to the world
  for (const sg of snapshot.securityGroups) {
    for (const rule of sg.inboundRules) {
      const opensToWorld =
        rule.cidrRanges.includes("0.0.0.0/0") ||
        rule.ipv6CidrRanges.includes("::/0");
      const isSshOrRdp =
        rule.fromPort === 22 ||
        rule.toPort === 22 ||
        rule.fromPort === 3389 ||
        rule.toPort === 3389;
      if (opensToWorld && isSshOrRdp) {
        const port = rule.fromPort === 22 || rule.toPort === 22 ? 22 : 3389;
        const proto = port === 22 ? "SSH" : "RDP";
        findings.push({
          id: nextId(),
          severity: "critical",
          title: `Security group exposes ${proto} to 0.0.0.0/0`,
          description: `Security group "${sg.groupName}" (${sg.groupId}) in account ${sg.accountId} (${sg.region}) allows ${proto} (port ${port}) from any IP.`,
          resourceName: sg.groupName,
          accountId: sg.accountId,
          region: sg.region,
          resourceType: "security_group",
          remediationHint: `Restrict port ${port} inbound access to specific trusted CIDR blocks.`,
        });
      }
    }
  }

  // Rule 10: Security group allows all traffic on all ports from the world
  for (const sg of snapshot.securityGroups) {
    for (const rule of sg.inboundRules) {
      const opensToWorld =
        rule.cidrRanges.includes("0.0.0.0/0") ||
        rule.ipv6CidrRanges.includes("::/0");
      if (opensToWorld && rule.protocol === "-1") {
        findings.push({
          id: nextId(),
          severity: "critical",
          title: "Security group allows all traffic from 0.0.0.0/0",
          description: `Security group "${sg.groupName}" (${sg.groupId}) in account ${sg.accountId} (${sg.region}) allows all inbound traffic from any IP.`,
          resourceName: sg.groupName,
          accountId: sg.accountId,
          region: sg.region,
          resourceType: "security_group",
          remediationHint: "Restrict inbound rules to only necessary ports and trusted sources.",
        });
      }
    }
  }

  // ── RDS ──────────────────────────────────────────────────────────────────

  // Rule 11: RDS publicly accessible
  for (const db of snapshot.rdsInstances) {
    if (db.publiclyAccessible) {
      findings.push({
        id: nextId(),
        severity: "high",
        title: "RDS instance publicly accessible",
        description: `RDS instance "${db.dbInstanceIdentifier}" in account ${db.accountId} (${db.region}) is configured as publicly accessible.`,
        resourceName: db.dbInstanceIdentifier,
        accountId: db.accountId,
        region: db.region,
        resourceType: "rds_instance",
        remediationHint:
          "Set PubliclyAccessible to false. Access RDS instances only from within the VPC.",
      });
    }
  }

  // Rule 12: RDS without encryption
  for (const db of snapshot.rdsInstances) {
    if (!db.storageEncrypted) {
      findings.push({
        id: nextId(),
        severity: "high",
        title: "RDS instance without storage encryption",
        description: `RDS instance "${db.dbInstanceIdentifier}" in account ${db.accountId} (${db.region}) does not have storage encryption enabled.`,
        resourceName: db.dbInstanceIdentifier,
        accountId: db.accountId,
        region: db.region,
        resourceType: "rds_instance",
        remediationHint:
          "Enable storage encryption. For existing instances, create an encrypted snapshot and restore.",
      });
    }
  }

  // Rule 13: RDS without Multi-AZ (prod only heuristic)
  for (const db of snapshot.rdsInstances) {
    const isProd = db.tags.env === "prod" || db.tags.environment === "prod";
    if (!db.multiAz && isProd) {
      findings.push({
        id: nextId(),
        severity: "medium",
        title: "Production RDS instance without Multi-AZ",
        description: `RDS instance "${db.dbInstanceIdentifier}" in account ${db.accountId} appears to be a production instance but does not have Multi-AZ enabled.`,
        resourceName: db.dbInstanceIdentifier,
        accountId: db.accountId,
        region: db.region,
        resourceType: "rds_instance",
        remediationHint: "Enable Multi-AZ for production RDS instances to improve availability.",
      });
    }
  }

  // ── Redshift ─────────────────────────────────────────────────────────────

  // Rule 14: Redshift publicly accessible
  for (const cluster of snapshot.redshiftClusters) {
    if (cluster.publiclyAccessible) {
      findings.push({
        id: nextId(),
        severity: "high",
        title: "Redshift cluster publicly accessible",
        description: `Redshift cluster "${cluster.clusterIdentifier}" in account ${cluster.accountId} (${cluster.region}) is publicly accessible.`,
        resourceName: cluster.clusterIdentifier,
        accountId: cluster.accountId,
        region: cluster.region,
        resourceType: "redshift_cluster",
        remediationHint:
          "Disable public accessibility and use VPC routing (enhanced VPC routing recommended).",
      });
    }
  }

  // Rule 15: Redshift without encryption
  for (const cluster of snapshot.redshiftClusters) {
    if (!cluster.encrypted) {
      findings.push({
        id: nextId(),
        severity: "medium",
        title: "Redshift cluster without encryption",
        description: `Redshift cluster "${cluster.clusterIdentifier}" in account ${cluster.accountId} (${cluster.region}) is not encrypted at rest.`,
        resourceName: cluster.clusterIdentifier,
        accountId: cluster.accountId,
        region: cluster.region,
        resourceType: "redshift_cluster",
        remediationHint: "Enable encryption at rest using AWS KMS.",
      });
    }
  }

  // ── Secrets Manager ──────────────────────────────────────────────────────

  // Rule 16: Secret without rotation
  for (const secret of snapshot.secrets) {
    if (!secret.rotationEnabled) {
      findings.push({
        id: nextId(),
        severity: "medium",
        title: "Secret without automatic rotation",
        description: `Secret "${secret.name}" in account ${secret.accountId} (${secret.region}) does not have automatic rotation enabled.`,
        resourceName: secret.name,
        accountId: secret.accountId,
        region: secret.region,
        resourceType: "secret",
        remediationHint:
          "Enable automatic rotation for Secrets Manager secrets using a Lambda rotation function.",
      });
    }
  }

  // Rule 17: Secret with public resource policy
  for (const secret of snapshot.secrets) {
    const isPublic = secret.resourcePolicy.some(
      (s) => s.effect === "Allow" && s.principals.includes("*")
    );
    if (isPublic) {
      findings.push({
        id: nextId(),
        severity: "critical",
        title: "Secret with public resource policy",
        description: `Secret "${secret.name}" in account ${secret.accountId} has a resource policy granting public access (Principal: '*').`,
        resourceName: secret.name,
        accountId: secret.accountId,
        region: secret.region,
        resourceType: "secret",
        remediationHint:
          "Remove the public principal from the secret's resource policy immediately.",
      });
    }
  }

  // ── Lambda ───────────────────────────────────────────────────────────────

  // Rule 18: Lambda with public resource policy
  for (const fn of snapshot.lambdaFunctions) {
    const isPublic = fn.resourcePolicy.some(
      (s) => s.effect === "Allow" && s.principals.includes("*")
    );
    if (isPublic) {
      findings.push({
        id: nextId(),
        severity: "high",
        title: "Lambda function with public resource policy",
        description: `Lambda function "${fn.functionName}" in account ${fn.accountId} (${fn.region}) can be invoked by anyone (Principal: '*').`,
        resourceName: fn.functionName,
        accountId: fn.accountId,
        region: fn.region,
        resourceType: "lambda_function",
        remediationHint:
          "Restrict the Lambda resource policy to specific AWS principals or services.",
      });
    }
  }

  // ── Secrets in Lambda env vars ───────────────────────────────────────────

  // Rule: Lambda function with a detected secret in environment variables
  for (const fn of snapshot.lambdaFunctions) {
    if (!fn.envVars || Object.keys(fn.envVars).length === 0) continue;
    const matches = scanEnvVars(fn.envVars);
    for (const match of matches) {
      findings.push({
        id: `secret_in_env:lambda:${fn.accountId}:${fn.functionName}:${match.key}`,
        severity: match.confidence === "high" ? "critical" : "high",
        title: "Secret Detected in Lambda Environment Variable",
        description: `Lambda function "${fn.functionName}" has a potential secret in env var "${match.key}" — detected pattern: ${match.patternLabel}. Value starts with: ${match.redactedValue}`,
        resourceName: fn.functionName,
        accountId: fn.accountId,
        region: fn.region,
        resourceType: "lambda_function",
        remediationHint: `Move the value of "${match.key}" in function "${fn.functionName}" to AWS Secrets Manager or Parameter Store and reference it at runtime instead of storing it as a plain env var.`,
      });
    }
  }

  // ── SNS ──────────────────────────────────────────────────────────────────

  // Rule 19: SNS topic with public publish policy
  for (const topic of snapshot.snsTopics) {
    const isPublic = topic.policy.some(
      (s) =>
        s.effect === "Allow" &&
        s.principals.includes("*") &&
        s.actions.some((a) => a === "SNS:Publish" || a === "sns:Publish" || a === "*")
    );
    if (isPublic) {
      findings.push({
        id: nextId(),
        severity: "high",
        title: "SNS topic allows public publish",
        description: `SNS topic "${topic.topicName}" in account ${topic.accountId} (${topic.region}) allows any principal to publish messages.`,
        resourceName: topic.topicName,
        accountId: topic.accountId,
        region: topic.region,
        resourceType: "sns_topic",
        remediationHint:
          "Restrict the SNS topic policy to specific AWS account principals.",
      });
    }
  }

  return findings;
}
