// ── IAM ───────────────────────────────────────────────────────────────────

export interface AwsIamStatement {
  effect: "Allow" | "Deny";
  principals: string[]; // "*" = public
  actions: string[];
  resources: string[];
  conditions?: Record<string, unknown>;
}

export interface AwsAccessKey {
  accessKeyId: string;
  status: "Active" | "Inactive";
  createDate: string;
  lastUsedDate?: string;
  lastUsedService?: string;
  lastUsedRegion?: string;
}

export interface AwsIamUser {
  userName: string;
  userId: string;
  arn: string;
  accountId: string;
  createDate: string;
  passwordLastUsed?: string;
  mfaEnabled: boolean;
  accessKeys: AwsAccessKey[];
  attachedPolicies: string[]; // policy ARNs
  groups: string[];
  inlinePolicies: string[];
  tags: Record<string, string>;
}

export interface AwsIamRole {
  roleName: string;
  roleId: string;
  arn: string;
  accountId: string;
  createDate: string;
  assumeRolePolicyStatements: AwsIamStatement[];
  attachedPolicies: string[]; // policy ARNs
  inlinePolicies: string[];
  maxSessionDuration: number;
  tags: Record<string, string>;
  lastUsedDate?: string;
  lastUsedRegion?: string;
}

// ── S3 ────────────────────────────────────────────────────────────────────

export interface AwsS3Bucket {
  bucketName: string;
  accountId: string;
  region: string;
  creationDate: string;
  publicAccessBlock: {
    blockPublicAcls: boolean;
    ignorePublicAcls: boolean;
    blockPublicPolicy: boolean;
    restrictPublicBuckets: boolean;
  };
  bucketPolicy: AwsIamStatement[];
  versioning: "Enabled" | "Suspended" | "Disabled";
  encryption: "SSE-S3" | "SSE-KMS" | "DSSE-KMS" | "None";
  acl: string; // "private" | "public-read" | "public-read-write" | ...
  tags: Record<string, string>;
}

// ── EKS ───────────────────────────────────────────────────────────────────

export interface AwsEksCluster {
  clusterName: string;
  accountId: string;
  region: string;
  arn: string;
  endpoint?: string;
  status: string;
  kubernetesVersion: string;
  roleArn: string;
  endpointPublicAccess: boolean;
  endpointPrivateAccess: boolean;
  publicAccessCidrs: string[];
  vpcId: string;
  loggingEnabled: boolean;
  tags: Record<string, string>;
  createdAt: string;
}

// ── EC2 ───────────────────────────────────────────────────────────────────

export interface AwsEc2Instance {
  instanceId: string;
  accountId: string;
  region: string;
  instanceType: string;
  state: string;
  publicIpAddress?: string | null;
  privateIpAddress: string;
  iamInstanceProfileArn?: string | null;
  securityGroupIds: string[];
  vpcId?: string;
  subnetId?: string;
  imageId: string;
  launchTime: string;
  tags: Record<string, string>;
}

// ── Lambda ────────────────────────────────────────────────────────────────

export interface AwsLambdaFunction {
  functionName: string;
  functionArn: string;
  accountId: string;
  region: string;
  runtime: string;
  role: string; // execution role ARN
  lastModified: string;
  codeSize: number;
  timeout: number;
  memorySize: number;
  state?: string;
  functionUrl?: string;
  resourcePolicy: AwsIamStatement[];
  vpcConfig?: {
    vpcId?: string;
    subnetIds: string[];
    securityGroupIds: string[];
  };
  tags: Record<string, string>;
  /** Environment variables (may contain secrets) */
  envVars?: Record<string, string>;
}

// ── RDS ───────────────────────────────────────────────────────────────────

export interface AwsRdsInstance {
  dbInstanceIdentifier: string;
  accountId: string;
  region: string;
  dbInstanceArn: string;
  dbEngine: string;
  dbEngineVersion: string;
  dbInstanceClass: string;
  dbInstanceStatus: string;
  publiclyAccessible: boolean;
  multiAz: boolean;
  storageEncrypted: boolean;
  backupRetentionPeriod: number;
  endpoint?: { address: string; port: number };
  vpcId?: string;
  securityGroupIds: string[];
  tags: Record<string, string>;
  deletionProtection: boolean;
}

// ── Redshift ──────────────────────────────────────────────────────────────

export interface AwsRedshiftCluster {
  clusterIdentifier: string;
  accountId: string;
  region: string;
  nodeType: string;
  numberOfNodes: number;
  clusterStatus: string;
  masterUsername: string;
  dbName: string;
  endpoint?: { address: string; port: number };
  publiclyAccessible: boolean;
  encrypted: boolean;
  vpcId?: string;
  tags: Record<string, string>;
  createdAt?: string;
  enhancedVpcRouting: boolean;
}

// ── SNS ───────────────────────────────────────────────────────────────────

export interface AwsSnsTopic {
  topicArn: string;
  topicName: string;
  accountId: string;
  region: string;
  policy: AwsIamStatement[];
  subscriptionCount: number;
  kmsMasterKeyId?: string;
  tags: Record<string, string>;
}

// ── Secrets Manager ───────────────────────────────────────────────────────

export interface AwsSecret {
  name: string;
  arn: string;
  accountId: string;
  region: string;
  description?: string;
  createdDate: string;
  lastChangedDate?: string;
  lastAccessedDate?: string;
  rotationEnabled: boolean;
  rotationLambdaArn?: string;
  kmsKeyId?: string;
  resourcePolicy: AwsIamStatement[];
  tags: Record<string, string>;
}

// ── Security Groups ───────────────────────────────────────────────────────

export interface AwsSgRule {
  protocol: string; // "tcp" | "udp" | "icmp" | "-1" (all)
  fromPort?: number;
  toPort?: number;
  cidrRanges: string[];
  ipv6CidrRanges: string[];
  description?: string;
}

export interface AwsSecurityGroup {
  groupId: string;
  groupName: string;
  accountId: string;
  region: string;
  vpcId: string;
  description: string;
  inboundRules: AwsSgRule[];
  outboundRules: AwsSgRule[];
  tags: Record<string, string>;
}

// ── Findings ──────────────────────────────────────────────────────────────

export type AwsSecurityFindingSeverity = "critical" | "high" | "medium" | "low";

export interface AwsSecurityFinding {
  id: string;
  severity: AwsSecurityFindingSeverity;
  title: string;
  description: string;
  resourceName: string;
  accountId: string;
  region?: string;
  resourceType: string;
  remediationHint?: string;
}

// ── Snapshot ──────────────────────────────────────────────────────────────

export interface AwsLoadBalancer {
  name: string;
  accountId: string;
  region: string;
  dnsName: string;
  type: "application" | "network" | "classic" | string;
  scheme: "internal" | "internet-facing";
  state: string;
}

export interface AwsSnapshot {
  snapshotId: string;
  accounts: string[];
  regions: string[];
  iamUsers: AwsIamUser[];
  iamRoles: AwsIamRole[];
  s3Buckets: AwsS3Bucket[];
  eksClusters: AwsEksCluster[];
  ec2Instances: AwsEc2Instance[];
  lambdaFunctions: AwsLambdaFunction[];
  rdsInstances: AwsRdsInstance[];
  redshiftClusters: AwsRedshiftCluster[];
  snsTopics: AwsSnsTopic[];
  secrets: AwsSecret[];
  securityGroups: AwsSecurityGroup[];
  loadBalancers: AwsLoadBalancer[];
  fetchedAt: string;
}
