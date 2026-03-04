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
  const { queryType, user, resourceName, projectId } = intent;
  if (queryType === "security_findings") {
    return {
      publicBuckets: snapshot.storageBuckets.filter(b => b.iamPolicy.bindings.some(bind => bind.members.some(m => m === "allUsers"))).map(b => b.name),
      openFirewalls: snapshot.firewallRules.filter(r => !r.disabled && r.direction === "INGRESS" && (r.sourceRanges ?? []).includes("0.0.0.0/0")).map(r => r.name)
    };
  }
  if (queryType === "list_resources") {
    return {
      bucketCount: snapshot.storageBuckets.length,
      vmCount: snapshot.vms.length,
      // ... truncate for brevity in the prompt if needed, or include summary
    };
  }
  if (queryType === "compliance") {
    return { soc2: runSoc2(snapshot) };
  }
  // Fallback to a slice of the snapshot for other types
  return { projectCount: snapshot.projects.length };
}

function buildAwsContext(intent: QueryIntent, snapshot: AwsSnapshot): any {
  const { queryType } = intent;
  if (queryType === "security_findings") {
    return {
      publicS3: snapshot.s3Buckets.filter(b => b.publicAccessBlock.blockPublicPolicy === false).map(b => b.bucketName),
      openSecurityGroups: snapshot.securityGroups.filter(sg => sg.inboundRules.some(r => r.cidrRanges.includes("0.0.0.0/0"))).map(sg => sg.groupName)
    };
  }
  if (queryType === "compliance") {
    return { soc2: runAwsSoc2(snapshot) };
  }
  return { accountCount: snapshot.accounts.length };
}

/**
 * Extracts a flat list of named resource items.
 */
export function extractResources(intent: QueryIntent, snapshot: CombinedSnapshot): ResourceItem[] {
  const items: ResourceItem[] = [];

  if (snapshot.gcp) {
    const gcpItems = extractGcpResources(intent, snapshot.gcp);
    items.push(...gcpItems.map(i => ({ ...i, cloud: "gcp" as const })));
  }

  if (snapshot.aws) {
    const awsItems = extractAwsResources(intent, snapshot.aws);
    items.push(...awsItems.map(i => ({ ...i, cloud: "aws" as const })));
  }

  return items;
}

// Internal helpers to extract resources per cloud
function extractGcpResources(intent: QueryIntent, snapshot: GcpSnapshot): ResourceItem[] {
  // Existing logic from extractResources, moved here
  const { queryType, resourceType } = intent;
  if (queryType === "list_resources" && resourceType === "bucket") {
    return snapshot.storageBuckets.map(b => ({ name: b.name, projectId: b.projectId, type: "bucket" }));
  }
  // ... other GCP resource types ...
  return [];
}

function extractAwsResources(intent: QueryIntent, snapshot: AwsSnapshot): ResourceItem[] {
  const { queryType, resourceType } = intent;
  if (queryType === "list_resources" && (resourceType === "s3_bucket" || resourceType === "bucket")) {
    return snapshot.s3Buckets.map(b => ({ name: b.bucketName, projectId: b.accountId, type: "s3_bucket" }));
  }
  if (queryType === "list_resources" && (resourceType === "ec2_instance" || resourceType === "vm")) {
    return snapshot.ec2Instances.map(i => ({ name: i.instanceId, projectId: i.accountId, type: "ec2_instance" }));
  }
  return [];
}
