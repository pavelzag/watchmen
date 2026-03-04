import type { GcpSnapshot } from "@/lib/gcp/types";
import type { AwsSnapshot } from "@/lib/aws/types"; // Added AWS
import type { AIProvider } from "@/lib/ai/client";
import { callAI } from "@/lib/ai/client";
import { runSoc2 } from "@/lib/compliance/soc2";
import { runIso27001 } from "@/lib/compliance/iso27001";
import { runAwsSoc2 } from "@/lib/compliance/aws-soc2"; // Added AWS SOC2
import { runAwsIso27001 } from "@/lib/compliance/aws-iso27001"; // Added AWS ISO

export interface ResourceItem {
  name: string;
  projectId: string;
  type: QueryIntent["resourceType"];
  extra?: string; // e.g. direction for firewall, zone for VM, region for Cloud Run
  cloud?: "gcp" | "aws";
}

export interface QueryIntent {
  queryType:
  | "user_access"
  | "resource_owners"
  | "specific_resource_access"
  | "list_users"
  | "list_resources"
  | "security_findings"
  | "principal_overview"
  | "compliance"
  | "unknown";
  user?: string;
  resourceType?:
  | "bucket"
  | "gke_cluster"
  | "project"
  | "service_account"
  | "vm"
  | "cloud_run"
  | "cloud_sql"
  | "bigquery"
  | "pubsub"
  | "secret"
  | "firewall"
  | "service_account"
  | "s3_bucket"
  | "ec2_instance"
  | "rds_instance"
  | "eks_cluster"
  | "lambda_function"
  | "iam_user"
  | "iam_role"
  | "aws_account";
  resourceName?: string;
  projectId?: string;
  region?: string;
}

export type CombinedSnapshot = {
  gcp?: GcpSnapshot | null;
  aws?: AwsSnapshot | null;
};

/**
 * Pass 1 — Extract structured intent from a natural language query.
 */
export async function extractIntent(
  query: string,
  provider: AIProvider,
  apiKey: string
): Promise<QueryIntent> {
  const prompt = `You are a Cloud Infrastructure (GCP and AWS) query parser. Extract the intent from the following natural language query and return ONLY valid JSON.

Query: "${query}"

Return JSON matching this exact schema:
{
  "queryType": "user_access" | "resource_owners" | "specific_resource_access" | "list_users" | "list_resources" | "security_findings" | "principal_overview" | "compliance" | "unknown",
  "user": "<email or null>",
  "resourceType": "bucket" | "gke_cluster" | "project" | "service_account" | "vm" | "cloud_run" | "cloud_sql" | "bigquery" | "pubsub" | "secret" | "firewall" | "s3_bucket" | "ec2_instance" | "rds_instance" | "eks_cluster" | "lambda_function" | null,
  "resourceName": "<name or null>",
  "projectId": "<GCP project ID or AWS account ID or null>",
  "region": "<region or null>"
}

resourceType mapping:
GCP: bucket, gke_cluster, vm, cloud_run, cloud_sql, bigquery, pubsub, secret, firewall, service_account
AWS: s3_bucket, eks_cluster, ec2_instance, lambda_function, rds_instance, iam_user, iam_role, aws_account (also secret, firewall mapped to AWS equivalents)`;

  const text = await callAI(provider, apiKey, prompt);
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  try {
    return JSON.parse(cleaned) as QueryIntent;
  } catch {
    return { queryType: "unknown" };
  }
}

/**
 * Pass 2 — Answer the original query using Cloud snapshot data.
 */
export async function generateAnswer(
  query: string,
  intent: QueryIntent,
  snapshot: CombinedSnapshot,
  provider: AIProvider,
  apiKey: string
): Promise<string> {
  const context = buildContext(intent, snapshot);

  const prompt = `You are a Cloud Security analyst assistant. Answer the user's question using ONLY the provided GCP/AWS data below.

Be specific and factual. Format your answer clearly:
- Use **bold** for roles, resource names, and emails
- Use bullet points for lists
- Mention the Cloud Provider (GCP or AWS) and the Project/Account ID

Cloud Data:
${JSON.stringify(context, null, 2)}

User question: "${query}"`;

  return callAI(provider, apiKey, prompt);
}

/**
 * Builds a minimal context object focused on the query intent.
 */
function buildContext(intent: QueryIntent, snapshot: CombinedSnapshot): unknown {
  const { queryType, resourceType, resourceName, projectId } = intent;
  const context: any = {};

  if (snapshot.gcp) {
    context.gcp = buildGcpContext(intent, snapshot.gcp);
  }
  if (snapshot.aws) {
    context.aws = buildAwsContext(intent, snapshot.aws);
  }

  return context;
}

function buildGcpContext(intent: QueryIntent, snapshot: GcpSnapshot): any {
  const { queryType, resourceType, resourceName } = intent;

  const publicBuckets = snapshot.storageBuckets.filter(b =>
    b.iamPolicy.bindings.some(bind => bind.members.some(m => m === "allUsers" || m === "allAuthenticatedUsers"))
  );

  const openFirewalls = snapshot.firewallRules.filter(r =>
    !r.disabled && r.direction === "INGRESS" && (r.sourceRanges ?? []).includes("0.0.0.0/0")
  );

  const ctx: any = {
    counts: {
      projects: snapshot.projects.length,
      serviceAccounts: snapshot.serviceAccounts.length,
      buckets: snapshot.storageBuckets.length,
      vms: snapshot.vms.length,
      functions: snapshot.cloudRunServices.length,
      gkeClusters: snapshot.gkeClusters.length,
      bigqueryDatasets: snapshot.bigqueryDatasets.length,
    }
  };

  // 1. Service Accounts (Critical for identity queries)
  if (queryType === "list_resources" && (resourceType === "service_account" || !resourceType)) {
    ctx.serviceAccounts = snapshot.serviceAccounts.map(sa => ({
      email: sa.email,
      roles: sa.roles,
      disabled: sa.disabled
    }));
  }

  // 2. BigQuery Datasets
  if (queryType === "list_resources" && (resourceType === "bigquery" || !resourceType)) {
    ctx.bigqueryDatasets = snapshot.bigqueryDatasets.map(ds => ({
      id: ds.datasetId,
      location: ds.location,
      roles: ds.iamPolicy.bindings.map(b => ({ role: b.role, members: b.members }))
    }));
  }

  // 3. Buckets & Security
  if (queryType === "security_findings" || (queryType === "list_resources" && (resourceType === "bucket" || !resourceType))) {
    ctx.bucketDetails = {
      total: snapshot.storageBuckets.length,
      publicCount: publicBuckets.length,
      publicBucketNames: publicBuckets.map(b => b.name),
    };
    ctx.firewalls = {
      openToInternetCount: openFirewalls.length,
      openFirewallNames: openFirewalls.map(r => r.name),
    };
  }

  // 3. Specific Resource match
  if (resourceName) {
    const saMatch = snapshot.serviceAccounts.find(sa => sa.email.includes(resourceName) || sa.name.includes(resourceName));
    if (saMatch) ctx.matchedServiceAccount = saMatch;
  }

  if (queryType === "compliance") {
    ctx.soc2 = runSoc2(snapshot);
  }

  return ctx;
}

function buildAwsContext(intent: QueryIntent, snapshot: AwsSnapshot): any {
  const { queryType, resourceType, resourceName } = intent;

  const publicS3 = snapshot.s3Buckets.filter(b =>
    !b.publicAccessBlock.blockPublicPolicy || !b.publicAccessBlock.blockPublicAcls
  );

  const openSecurityGroups = snapshot.securityGroups.filter(sg =>
    sg.inboundRules.some(r => r.cidrRanges.includes("0.0.0.0/0"))
  );

  const ctx: any = {
    counts: {
      accounts: snapshot.accounts.length,
      iamUsers: snapshot.iamUsers.length,
      iamRoles: snapshot.iamRoles.length,
      s3Buckets: snapshot.s3Buckets.length,
      ec2Instances: snapshot.ec2Instances.length,
      rdsInstances: snapshot.rdsInstances.length,
    }
  };

  // 1. IAM (Identity)
  if (queryType === "list_resources" && (resourceType === "iam_user" || !resourceType)) {
    ctx.iamUsers = snapshot.iamUsers.map(u => ({
      userName: u.userName,
      accountId: u.accountId,
      mfaEnabled: u.mfaEnabled,
      keyCount: u.accessKeys.length
    }));
  }

  // 2. S3 & Security
  if (queryType === "security_findings" || (queryType === "list_resources" && (resourceType === "s3_bucket" || resourceType === "bucket" || !resourceType))) {
    ctx.s3Details = {
      total: snapshot.s3Buckets.length,
      publicCount: publicS3.length,
      publicBucketNames: publicS3.map(b => b.bucketName),
    };
    ctx.securityGroups = {
      openToInternetCount: openSecurityGroups.length,
      openGroupNames: openSecurityGroups.map(sg => sg.groupName),
    };
  }

  // 3. Specific resource match
  if (resourceName) {
    const userMatch = snapshot.iamUsers.find(u => u.userName.includes(resourceName));
    if (userMatch) ctx.matchedIamUser = userMatch;
  }

  if (queryType === "compliance") {
    ctx.soc2 = runAwsSoc2(snapshot);
  }

  return ctx;
}

/**
 * Extracts a flat list of named resource items from snapshots based on the intent.
 */
export function extractResources(intent: QueryIntent, snapshot: CombinedSnapshot): ResourceItem[] {
  const items: ResourceItem[] = [];

  if (snapshot.gcp) {
    items.push(...extractGcpResources(intent, snapshot.gcp));
  }
  if (snapshot.aws) {
    items.push(...extractAwsResources(intent, snapshot.aws));
  }

  // Deduplicate and filter out items without names
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item.name) return false;
    const key = `${item.cloud}:${item.type}:${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractGcpResources(intent: QueryIntent, snapshot: GcpSnapshot): ResourceItem[] {
  const resources: ResourceItem[] = [];
  const { resourceType, resourceName } = intent;

  // If intent has a specific name, try to find that exactly
  if (resourceName) {
    const findByName = (list: { name: string, projectId: string }[], type: ResourceItem["type"]) => {
      const match = list.find(r => r.name === resourceName || r.name.includes(resourceName));
      if (match) resources.push({ name: match.name, projectId: match.projectId, type, cloud: "gcp" });
    };

    findByName(snapshot.storageBuckets, "bucket");
    findByName(snapshot.vms, "vm");
    findByName(snapshot.serviceAccounts.map(sa => ({ name: sa.email, projectId: sa.projectId })), "service_account");
    findByName(snapshot.gkeClusters, "gke_cluster");
    findByName(snapshot.cloudRunServices, "cloud_run");
    findByName(snapshot.cloudSqlInstances, "cloud_sql");
    findByName(snapshot.bigqueryDatasets.map(d => ({ name: d.datasetId, projectId: d.projectId })), "bigquery");
    findByName(snapshot.pubsubTopics.map(t => ({ name: t.name, projectId: t.projectId })), "pubsub");
    findByName(snapshot.secrets.map(s => ({ name: s.name, projectId: s.projectId })), "secret");
    findByName(snapshot.firewallRules, "firewall");
  }

  // Also include all of a type if specified in list_resources
  if (intent.queryType === "list_resources" || intent.queryType === "security_findings") {
    if (!resourceType || resourceType === "bucket") {
      resources.push(...snapshot.storageBuckets.map(b => ({ name: b.name, projectId: b.projectId, type: "bucket" as const, cloud: "gcp" as const })));
    }
    if (!resourceType || resourceType === "vm") {
      resources.push(...snapshot.vms.map(v => ({ name: v.name, projectId: v.projectId, type: "vm" as const, cloud: "gcp" as const })));
    }
    if (!resourceType || resourceType === "service_account") {
      resources.push(...snapshot.serviceAccounts.map(sa => ({ name: sa.email, projectId: sa.projectId, type: "service_account" as const, cloud: "gcp" as const })));
    }
  }

  return resources;
}

function extractAwsResources(intent: QueryIntent, snapshot: AwsSnapshot): ResourceItem[] {
  const resources: ResourceItem[] = [];
  const { resourceType, resourceName, projectId } = intent;

  const add = (name: string, accountId: string, type: string) => {
    resources.push({ name, projectId: accountId, type: type as QueryIntent["resourceType"], cloud: "aws" });
  };

  // 1. Specific resource by name
  if (resourceName) {
    // S3
    const s3 = snapshot.s3Buckets.find(b => b.bucketName.includes(resourceName));
    if (s3) add(s3.bucketName, s3.accountId, "s3_bucket");

    // EC2
    const ec2 = snapshot.ec2Instances.find(i => i.instanceId.includes(resourceName) || i.tags.Name?.includes(resourceName));
    if (ec2) add(ec2.instanceId, ec2.accountId, "ec2_instance");

    // IAM User
    const user = snapshot.iamUsers.find(u => u.userName.includes(resourceName));
    if (user) add(user.userName, user.accountId, "iam_user");

    // IAM Role
    const role = snapshot.iamRoles.find(r => r.roleName.includes(resourceName));
    if (role) add(role.roleName, role.accountId, "iam_role");
  }

  // 2. Account ID as a resource
  if (projectId && snapshot.accounts.includes(projectId)) {
    add(projectId, projectId, "aws_account");
  }

  // 3. List types
  if (intent.queryType === "list_resources" || intent.queryType === "security_findings") {
    if (!resourceType || resourceType === "bucket" || resourceType === "s3_bucket") {
      snapshot.s3Buckets.forEach(b => add(b.bucketName, b.accountId, "s3_bucket"));
    }
    if (!resourceType || resourceType === "vm" || resourceType === "ec2_instance") {
      snapshot.ec2Instances.forEach(i => add(i.instanceId, i.accountId, "ec2_instance"));
    }
    if (!resourceType || resourceType === "iam_user") {
      snapshot.iamUsers.forEach(u => add(u.userName, u.accountId, "iam_user"));
    }
  }

  return resources;
}
