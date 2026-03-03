import { useMockAwsData } from "./client";
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
import type { AwsSnapshot } from "./types";

export * from "./types";

/**
 * Fetches the full AWS snapshot across all configured regions.
 * Switch between real and mock via USE_MOCK_AWS_DATA=true env var.
 */
export async function fetchAwsSnapshot(): Promise<AwsSnapshot> {
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
  ] = await Promise.all([
    getIamUsers(),
    getIamRoles(),
    getS3Buckets(),
    getEksClusters(),
    getEc2Instances(),
    getLambdaFunctions(),
    getRdsInstances(),
    getRedshiftClusters(),
    getSnsTopics(),
    getSecrets(),
    getSecurityGroups(),
  ]);

  const accounts = [...new Set([
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
  ])].filter(Boolean);

  const regions = [...new Set([
    ...eksClusters.map((c) => c.region),
    ...ec2Instances.map((i) => i.region),
    ...lambdaFunctions.map((f) => f.region),
    ...rdsInstances.map((d) => d.region),
    ...s3Buckets.map((b) => b.region),
    ...securityGroups.map((sg) => sg.region),
  ])].filter(Boolean);

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
    fetchedAt: new Date().toISOString(),
  };
}
