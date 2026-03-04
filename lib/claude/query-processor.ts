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
  | "s3_bucket"
  | "ec2_instance"
  | "rds_instance"
  | "eks_cluster"
  | "lambda_function";
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
GCP: bucket, gke_cluster, vm, cloud_run, cloud_sql, bigquery, pubsub, secret, firewall
AWS: s3_bucket, eks_cluster, ec2_instance, lambda_function, rds_instance (also secret, firewall mapped to AWS equivalents)`;

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
  const { queryType, resourceType } = intent;

  const publicBuckets = snapshot.storageBuckets.filter(b =>
    b.iamPolicy.bindings.some(bind => bind.members.some(m => m === "allUsers" || m === "allAuthenticatedUsers"))
  );

  const openFirewalls = snapshot.firewallRules.filter(r =>
    !r.disabled && r.direction === "INGRESS" && (r.sourceRanges ?? []).includes("0.0.0.0/0")
  );

  if (queryType === "security_findings" || (queryType === "list_resources" && (resourceType === "bucket" || !resourceType))) {
    return {
      buckets: {
        total: snapshot.storageBuckets.length,
        publicCount: publicBuckets.length,
        publicBucketNames: publicBuckets.map(b => b.name),
        privateCount: snapshot.storageBuckets.length - publicBuckets.length,
      },
      firewalls: {
        total: snapshot.firewallRules.length,
        openToInternetCount: openFirewalls.length,
        openFirewallNames: openFirewalls.map(r => r.name),
      }
    };
  }

  if (queryType === "list_resources") {
    return {
      bucketCount: snapshot.storageBuckets.length,
      vmCount: snapshot.vms.length,
      projectCount: snapshot.projects.length,
      gkeClusterCount: snapshot.gkeClusters.length,
    };
  }

  if (queryType === "compliance") {
    return { soc2: runSoc2(snapshot) };
  }

  return {
    projectCount: snapshot.projects.length,
    bucketCount: snapshot.storageBuckets.length,
    vmCount: snapshot.vms.length
  };
}

function buildAwsContext(intent: QueryIntent, snapshot: AwsSnapshot): any {
  const { queryType, resourceType } = intent;

  const publicS3 = snapshot.s3Buckets.filter(b =>
    !b.publicAccessBlock.blockPublicPolicy || !b.publicAccessBlock.blockPublicAcls
  );

  const openSecurityGroups = snapshot.securityGroups.filter(sg =>
    sg.inboundRules.some(r => r.cidrRanges.includes("0.0.0.0/0"))
  );

  if (queryType === "security_findings" || (queryType === "list_resources" && (resourceType === "s3_bucket" || resourceType === "bucket" || !resourceType))) {
    return {
      s3Buckets: {
        total: snapshot.s3Buckets.length,
        publicCount: publicS3.length,
        publicBucketNames: publicS3.map(b => b.bucketName),
        privateCount: snapshot.s3Buckets.length - publicS3.length,
      },
      securityGroups: {
        total: snapshot.securityGroups.length,
        openToInternetCount: openSecurityGroups.length,
        openGroupNames: openSecurityGroups.map(sg => sg.groupName),
      }
    };
  }

  if (queryType === "compliance") {
    return { soc2: runAwsSoc2(snapshot) };
  }

  return {
    accountCount: snapshot.accounts.length,
    s3BucketCount: snapshot.s3Buckets.length,
    ec2InstanceCount: snapshot.ec2Instances.length
  };
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
    // ... add more as needed, but keep it manageable
  }

  return resources;
}

function extractAwsResources(intent: QueryIntent, snapshot: AwsSnapshot): ResourceItem[] {
  const resources: ResourceItem[] = [];
  const { resourceType, resourceName } = intent;

  const add = (name: string, accountId: string, type: ResourceItem["type"]) => {
    resources.push({ name, projectId: accountId, type, cloud: "aws" });
  };

  if (resourceName) {
    const s3 = snapshot.s3Buckets.find(b => b.bucketName.includes(resourceName));
    if (s3) add(s3.bucketName, s3.accountId, "s3_bucket");

    const ec2 = snapshot.ec2Instances.find(i => i.instanceId.includes(resourceName) || i.tags.Name?.includes(resourceName));
    if (ec2) add(ec2.instanceId, ec2.accountId, "ec2_instance");
  }

  if (intent.queryType === "list_resources" || intent.queryType === "security_findings") {
    if (!resourceType || resourceType === "bucket" || resourceType === "s3_bucket") {
      snapshot.s3Buckets.forEach(b => add(b.bucketName, b.accountId, "s3_bucket"));
    }
    if (!resourceType || resourceType === "vm" || resourceType === "ec2_instance") {
      snapshot.ec2Instances.forEach(i => add(i.instanceId, i.accountId, "ec2_instance"));
    }
  }

  return resources;
}
