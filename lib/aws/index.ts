import { getAwsClientOptions, resolveAwsCredentials, useMockAwsData, type AwsCredentials } from "./client";
import { getIamUsers, getIamRoles } from "./iam";
import { getS3Buckets } from "./s3";
import { getEksClusters } from "./eks";
import { getEc2Instances } from "./ec2";
import { getLambdaFunctions } from "./lambda";
import { getRdsInstances } from "./rds";
import { getRedshiftClusters } from "./redshift";
import { getSnsTopics } from "./sns";
import { getSecrets } from "./secretsmanager";
import { getSecurityGroups } from "./securitygroups";
import { getLoadBalancers } from "./elb";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { AwsSnapshot } from "./types";
import type { TaskProgressEvent } from "@/lib/tasks/types";

export * from "./types";

/**
 * Fetches the full AWS snapshot across all configured regions.
 * Switch between real and mock via USE_MOCK_AWS_DATA=true env var.
 * Pass options to use explicit credentials instead of the default credential chain.
 */
function emitProgress(
  onProgress: ((event: TaskProgressEvent) => void) | undefined,
  event: TaskProgressEvent
): void {
  onProgress?.(event);
}

export async function fetchAwsSnapshot(
  options?: AwsCredentials & { forceMock?: boolean; onProgress?: (event: TaskProgressEvent) => void }
): Promise<AwsSnapshot> {
  const mock = useMockAwsData(options?.forceMock);
  const creds = await resolveAwsCredentials(options);
  let completedServices = 0;
  const totalServices = 12;

  emitProgress(options?.onProgress, {
    stage: "scan_services",
    message: `Scanning ${totalServices} AWS service areas`,
    completed: 0,
    total: totalServices,
    percent: 10,
    metadata: { mock },
  });

  let callerAccountId: string | undefined;
  if (!mock) {
    const sts = new STSClient(getAwsClientOptions(creds?.region ?? "us-east-1", creds));
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    callerAccountId = identity.Account;
    emitProgress(options?.onProgress, {
      stage: "validate_credentials",
      message: "AWS credentials authenticated",
      completed: 0,
      total: totalServices,
      percent: 8,
      metadata: {
        accountId: callerAccountId,
        arn: identity.Arn,
      },
    });
  }

  async function runLoader<T>(resource: string, message: string, fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    completedServices += 1;
    emitProgress(options?.onProgress, {
      stage: "scan_services",
      message,
      completed: completedServices,
      total: totalServices,
      percent: 10 + Math.round((completedServices / totalServices) * 80),
      metadata: { resource },
    });
    return result;
  }

  const [
    iamUsers,
    iamRoles,
    s3Buckets,
    eksClusters,
    ec2Instances,
    lambdaFunctions,
    rdsInstances,
    redshiftClusters,
    snsTopics,
    secrets,
    securityGroups,
    loadBalancers,
  ] = await Promise.all([
    runLoader("iamUsers", "Loading IAM users", () => getIamUsers(creds, mock)),
    runLoader("iamRoles", "Loading IAM roles", () => getIamRoles(creds, mock)),
    runLoader("s3Buckets", "Loading S3 buckets", () => getS3Buckets(creds, mock)),
    runLoader("eksClusters", "Loading EKS clusters", () => getEksClusters(creds, mock)),
    runLoader("ec2Instances", "Loading EC2 instances", () => getEc2Instances(creds, mock)),
    runLoader("lambdaFunctions", "Loading Lambda functions", () => getLambdaFunctions(creds, mock)),
    runLoader("rdsInstances", "Loading RDS instances", () => getRdsInstances(creds, mock)),
    runLoader("redshiftClusters", "Loading Redshift clusters", () => getRedshiftClusters(creds, mock)),
    runLoader("snsTopics", "Loading SNS topics", () => getSnsTopics(creds, mock)),
    runLoader("secrets", "Loading Secrets Manager secrets", () => getSecrets(creds, mock)),
    runLoader("securityGroups", "Loading security groups", () => getSecurityGroups(creds, mock)),
    runLoader("loadBalancers", "Loading load balancers", () => getLoadBalancers(creds, mock)),
  ]);

  const accounts = [...new Set([
    callerAccountId,
    ...iamUsers.map((u) => u.accountId),
    ...iamRoles.map((r) => r.accountId),
    ...s3Buckets.map((b) => b.accountId),
    ...eksClusters.map((c) => c.accountId),
    ...ec2Instances.map((i) => i.accountId),
    ...lambdaFunctions.map((f) => f.accountId),
    ...rdsInstances.map((d) => d.accountId),
    ...redshiftClusters.map((r) => r.accountId),
    ...snsTopics.map((t) => t.accountId),
    ...secrets.map((s) => s.accountId),
    ...securityGroups.map((sg) => sg.accountId),
  ])].filter((account): account is string => Boolean(account));

  const regions = [...new Set([
    ...eksClusters.map((c) => c.region),
    ...ec2Instances.map((i) => i.region),
    ...lambdaFunctions.map((f) => f.region),
    ...rdsInstances.map((d) => d.region),
    ...s3Buckets.map((b) => b.region),
    ...securityGroups.map((sg) => sg.region),
  ])].filter((region): region is string => Boolean(region));

  emitProgress(options?.onProgress, {
    stage: "finalize_snapshot",
    message: "Finalizing AWS snapshot",
    percent: 95,
    metadata: { accountCount: accounts.length, regionCount: regions.length },
  });

  const readableResourceCount =
    iamUsers.length +
    iamRoles.length +
    s3Buckets.length +
    eksClusters.length +
    ec2Instances.length +
    lambdaFunctions.length +
    rdsInstances.length +
    redshiftClusters.length +
    snsTopics.length +
    secrets.length +
    securityGroups.length +
    loadBalancers.length;

  if (!mock && readableResourceCount === 0) {
    throw new Error(
      `AWS credentials authenticated for account ${callerAccountId ?? "unknown"}, but Watchmen could not read any inventory. ` +
      "Use direct scanner access keys with ReadOnlyAccess, SecurityAudit, and IAMReadOnlyAccess, or use Role ARN with credentials that can call sts:AssumeRole. " +
      "Do not paste the assumer-only runtime keys into the Access keys form."
    );
  }

  return {
    snapshotId: crypto.randomUUID(),
    accounts,
    regions,
    iamUsers,
    iamRoles,
    s3Buckets,
    eksClusters,
    ec2Instances,
    lambdaFunctions,
    rdsInstances,
    redshiftClusters,
    snsTopics,
    secrets,
    securityGroups,
    loadBalancers,
    fetchedAt: new Date().toISOString(),
  };
}
