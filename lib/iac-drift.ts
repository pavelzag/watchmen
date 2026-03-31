/**
 * IaC Drift Detection engine.
 *
 * Parses a Terraform state file (JSON) and compares the declared resources
 * against a live GCP or AWS snapshot to identify:
 *   - "phantom"  — resources running live that are NOT tracked in Terraform
 *   - "orphaned" — resources in Terraform state that no longer exist live
 */

import type { GcpSnapshot } from "@/lib/gcp/types";
import type { AwsSnapshot } from "@/lib/aws/types";

// ─── Terraform state types ────────────────────────────────────────────────────

interface TerraformInstance {
  attributes?: Record<string, unknown>;
}

interface TerraformResource {
  type: string;
  name: string;
  provider: string;
  instances: TerraformInstance[];
}

interface TerraformState {
  version?: number;
  resources?: TerraformResource[];
}

// ─── Drift item ───────────────────────────────────────────────────────────────

export type DriftType = "phantom" | "orphaned";

export interface DriftItem {
  id: string;
  driftType: DriftType;
  resourceType: string;
  /** Terraform resource type (e.g. "google_storage_bucket") */
  tfType: string;
  /** Resource name/identifier */
  resourceId: string;
  description: string;
  severity: "high" | "medium";
  cloud: "gcp" | "aws";
}

// ─── State parsing ────────────────────────────────────────────────────────────

export function parseTerraformState(json: string): TerraformResource[] {
  let state: TerraformState;
  try {
    state = JSON.parse(json) as TerraformState;
  } catch {
    throw new Error("Invalid Terraform state file — could not parse JSON.");
  }

  if (!state.resources) {
    throw new Error("No 'resources' array found in Terraform state. Is this a valid tfstate file?");
  }

  return state.resources;
}

/** Extract the first string attribute value from a resource instance */
function attr(resource: TerraformResource, key: string): string {
  return String(resource.instances?.[0]?.attributes?.[key] ?? "");
}

// ─── GCP drift ───────────────────────────────────────────────────────────────

export function computeGcpDrift(tfResources: TerraformResource[], snapshot: GcpSnapshot): DriftItem[] {
  const items: DriftItem[] = [];

  // ── Storage buckets ──
  const liveBuckets = new Set(snapshot.storageBuckets.map((b) => b.name));
  const tfBuckets = tfResources.filter((r) => r.type === "google_storage_bucket");
  const tfBucketNames = new Set(tfBuckets.map((r) => attr(r, "name") || r.name));

  for (const tfR of tfBuckets) {
    const name = attr(tfR, "name") || tfR.name;
    if (name && !liveBuckets.has(name)) {
      items.push({
        id: `orphaned:gcs:${name}`,
        driftType: "orphaned",
        resourceType: "storage_bucket",
        tfType: "google_storage_bucket",
        resourceId: name,
        description: `Bucket "${name}" is tracked in Terraform state but was not found live. It may have been deleted outside Terraform.`,
        severity: "medium",
        cloud: "gcp",
      });
    }
  }

  for (const bucket of snapshot.storageBuckets) {
    if (!tfBucketNames.has(bucket.name)) {
      items.push({
        id: `phantom:gcs:${bucket.name}`,
        driftType: "phantom",
        resourceType: "storage_bucket",
        tfType: "google_storage_bucket",
        resourceId: bucket.name,
        description: `Bucket "${bucket.name}" in project "${bucket.projectId}" exists live but is NOT tracked in Terraform — shadow infrastructure.`,
        severity: "high",
        cloud: "gcp",
      });
    }
  }

  // ── Firewall rules ──
  const liveFirewalls = new Set(snapshot.firewallRules.map((r) => r.name));
  const tfFirewalls = tfResources.filter((r) => r.type === "google_compute_firewall");
  const tfFirewallNames = new Set(tfFirewalls.map((r) => attr(r, "name") || r.name));

  for (const tfR of tfFirewalls) {
    const name = attr(tfR, "name") || tfR.name;
    if (name && !liveFirewalls.has(name)) {
      items.push({
        id: `orphaned:fw:${name}`,
        driftType: "orphaned",
        resourceType: "firewall_rule",
        tfType: "google_compute_firewall",
        resourceId: name,
        description: `Firewall rule "${name}" is in Terraform state but was not found live.`,
        severity: "medium",
        cloud: "gcp",
      });
    }
  }

  for (const fw of snapshot.firewallRules) {
    if (!tfFirewallNames.has(fw.name)) {
      items.push({
        id: `phantom:fw:${fw.projectId}:${fw.name}`,
        driftType: "phantom",
        resourceType: "firewall_rule",
        tfType: "google_compute_firewall",
        resourceId: fw.name,
        description: `Firewall rule "${fw.name}" (project "${fw.projectId}") exists live but is NOT in Terraform state.`,
        severity: "high",
        cloud: "gcp",
      });
    }
  }

  // ── VMs ──
  const liveVms = new Set(snapshot.vms.map((v) => v.name));
  const tfVms = tfResources.filter((r) => r.type === "google_compute_instance");
  const tfVmNames = new Set(tfVms.map((r) => attr(r, "name") || r.name));

  for (const tfR of tfVms) {
    const name = attr(tfR, "name") || tfR.name;
    if (name && !liveVms.has(name)) {
      items.push({
        id: `orphaned:vm:${name}`,
        driftType: "orphaned",
        resourceType: "vm",
        tfType: "google_compute_instance",
        resourceId: name,
        description: `VM "${name}" is in Terraform state but was not found live.`,
        severity: "medium",
        cloud: "gcp",
      });
    }
  }

  for (const vm of snapshot.vms) {
    if (!tfVmNames.has(vm.name)) {
      items.push({
        id: `phantom:vm:${vm.projectId}:${vm.name}`,
        driftType: "phantom",
        resourceType: "vm",
        tfType: "google_compute_instance",
        resourceId: vm.name,
        description: `VM "${vm.name}" (project "${vm.projectId}", zone "${vm.zone}") exists live but is NOT in Terraform state.`,
        severity: "high",
        cloud: "gcp",
      });
    }
  }

  // ── Cloud SQL ──
  const liveSql = new Set(snapshot.cloudSqlInstances.map((i) => i.name));
  const tfSql = tfResources.filter((r) => r.type === "google_sql_database_instance");
  const tfSqlNames = new Set(tfSql.map((r) => attr(r, "name") || r.name));

  for (const tfR of tfSql) {
    const name = attr(tfR, "name") || tfR.name;
    if (name && !liveSql.has(name)) {
      items.push({
        id: `orphaned:sql:${name}`,
        driftType: "orphaned",
        resourceType: "cloud_sql",
        tfType: "google_sql_database_instance",
        resourceId: name,
        description: `Cloud SQL instance "${name}" is in Terraform state but was not found live.`,
        severity: "medium",
        cloud: "gcp",
      });
    }
  }

  for (const inst of snapshot.cloudSqlInstances) {
    if (!tfSqlNames.has(inst.name)) {
      items.push({
        id: `phantom:sql:${inst.projectId}:${inst.name}`,
        driftType: "phantom",
        resourceType: "cloud_sql",
        tfType: "google_sql_database_instance",
        resourceId: inst.name,
        description: `Cloud SQL instance "${inst.name}" (project "${inst.projectId}") exists live but is NOT in Terraform state.`,
        severity: "high",
        cloud: "gcp",
      });
    }
  }

  return items;
}

// ─── AWS drift ────────────────────────────────────────────────────────────────

export function computeAwsDrift(tfResources: TerraformResource[], snapshot: AwsSnapshot): DriftItem[] {
  const items: DriftItem[] = [];

  // ── S3 buckets ──
  const liveS3 = new Set(snapshot.s3Buckets.map((b) => b.bucketName));
  const tfS3 = tfResources.filter((r) => r.type === "aws_s3_bucket");
  const tfS3Names = new Set(tfS3.map((r) => attr(r, "bucket") || attr(r, "id") || r.name));

  for (const tfR of tfS3) {
    const name = attr(tfR, "bucket") || attr(tfR, "id") || tfR.name;
    if (name && !liveS3.has(name)) {
      items.push({
        id: `orphaned:s3:${name}`,
        driftType: "orphaned",
        resourceType: "s3_bucket",
        tfType: "aws_s3_bucket",
        resourceId: name,
        description: `S3 bucket "${name}" is in Terraform state but was not found live.`,
        severity: "medium",
        cloud: "aws",
      });
    }
  }

  for (const bucket of snapshot.s3Buckets) {
    if (!tfS3Names.has(bucket.bucketName)) {
      items.push({
        id: `phantom:s3:${bucket.accountId}:${bucket.bucketName}`,
        driftType: "phantom",
        resourceType: "s3_bucket",
        tfType: "aws_s3_bucket",
        resourceId: bucket.bucketName,
        description: `S3 bucket "${bucket.bucketName}" (account ${bucket.accountId}) exists live but is NOT tracked in Terraform.`,
        severity: "high",
        cloud: "aws",
      });
    }
  }

  // ── EC2 instances ──
  const liveEc2 = new Set(snapshot.ec2Instances.map((i) => i.instanceId));
  const tfEc2 = tfResources.filter((r) => r.type === "aws_instance");
  const tfEc2Ids = new Set(tfEc2.map((r) => attr(r, "id") || r.name));

  for (const tfR of tfEc2) {
    const id = attr(tfR, "id") || tfR.name;
    if (id && !liveEc2.has(id)) {
      items.push({
        id: `orphaned:ec2:${id}`,
        driftType: "orphaned",
        resourceType: "ec2_instance",
        tfType: "aws_instance",
        resourceId: id,
        description: `EC2 instance "${id}" is in Terraform state but was not found live.`,
        severity: "medium",
        cloud: "aws",
      });
    }
  }

  for (const inst of snapshot.ec2Instances) {
    if (!tfEc2Ids.has(inst.instanceId)) {
      items.push({
        id: `phantom:ec2:${inst.accountId}:${inst.instanceId}`,
        driftType: "phantom",
        resourceType: "ec2_instance",
        tfType: "aws_instance",
        resourceId: inst.instanceId,
        description: `EC2 instance "${inst.instanceId}" (account ${inst.accountId}, ${inst.region}) exists live but is NOT in Terraform state.`,
        severity: "high",
        cloud: "aws",
      });
    }
  }

  // ── Lambda functions ──
  const liveLambda = new Set(snapshot.lambdaFunctions.map((f) => f.functionName));
  const tfLambda = tfResources.filter((r) => r.type === "aws_lambda_function");
  const tfLambdaNames = new Set(tfLambda.map((r) => attr(r, "function_name") || attr(r, "id") || r.name));

  for (const tfR of tfLambda) {
    const name = attr(tfR, "function_name") || attr(tfR, "id") || tfR.name;
    if (name && !liveLambda.has(name)) {
      items.push({
        id: `orphaned:lambda:${name}`,
        driftType: "orphaned",
        resourceType: "lambda_function",
        tfType: "aws_lambda_function",
        resourceId: name,
        description: `Lambda function "${name}" is in Terraform state but was not found live.`,
        severity: "medium",
        cloud: "aws",
      });
    }
  }

  for (const fn of snapshot.lambdaFunctions) {
    if (!tfLambdaNames.has(fn.functionName)) {
      items.push({
        id: `phantom:lambda:${fn.accountId}:${fn.functionName}`,
        driftType: "phantom",
        resourceType: "lambda_function",
        tfType: "aws_lambda_function",
        resourceId: fn.functionName,
        description: `Lambda function "${fn.functionName}" (account ${fn.accountId}) exists live but is NOT in Terraform state.`,
        severity: "high",
        cloud: "aws",
      });
    }
  }

  // ── Security groups ──
  const liveSgs = new Set(snapshot.securityGroups.map((sg) => sg.groupId));
  const tfSgs = tfResources.filter((r) => r.type === "aws_security_group");
  const tfSgIds = new Set(tfSgs.map((r) => attr(r, "id") || r.name));

  for (const tfR of tfSgs) {
    const id = attr(tfR, "id") || tfR.name;
    if (id && !liveSgs.has(id)) {
      items.push({
        id: `orphaned:sg:${id}`,
        driftType: "orphaned",
        resourceType: "security_group",
        tfType: "aws_security_group",
        resourceId: id,
        description: `Security group "${id}" is in Terraform state but was not found live.`,
        severity: "medium",
        cloud: "aws",
      });
    }
  }

  for (const sg of snapshot.securityGroups) {
    if (!tfSgIds.has(sg.groupId)) {
      items.push({
        id: `phantom:sg:${sg.accountId}:${sg.groupId}`,
        driftType: "phantom",
        resourceType: "security_group",
        tfType: "aws_security_group",
        resourceId: `${sg.groupName} (${sg.groupId})`,
        description: `Security group "${sg.groupName}" (${sg.groupId}, account ${sg.accountId}) exists live but is NOT in Terraform state.`,
        severity: "high",
        cloud: "aws",
      });
    }
  }

  return items;
}
