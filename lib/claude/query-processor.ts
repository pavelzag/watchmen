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
  | "container_vulnerabilities"
  | "principal_overview"
  | "compliance"
  | "auth_logs"
  | "request_logs"
  | "connected_projects"
  | "data_sources"
  | "unknown";
  logHours?: number; // for auth_logs: how many hours back to look
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
  | "aws_account"
  | "load_balancer"
  | "container_image";
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
  "queryType": "user_access" | "resource_owners" | "specific_resource_access" | "list_users" | "list_resources" | "security_findings" | "container_vulnerabilities" | "principal_overview" | "compliance" | "auth_logs" | "request_logs" | "connected_projects" | "data_sources" | "unknown",
  "user": "<email or null>",
  "resourceType": "bucket" | "gke_cluster" | "project" | "service_account" | "vm" | "cloud_run" | "cloud_sql" | "bigquery" | "pubsub" | "secret" | "firewall" | "s3_bucket" | "ec2_instance" | "rds_instance" | "eks_cluster" | "lambda_function" | "load_balancer" | "container_image" | null,
  "resourceName": "<name or null>",
  "projectId": "<GCP project ID or AWS account ID or null>",
  "region": "<region or null>",
  "logHours": <number or null>
}

queryType rules:
- Use "auth_logs" for questions about authentication failures, login failures, access denied errors, permission denied events, or unauthorized access attempts. Set logHours to the number of hours to look back (default 2 if unspecified).
- Use "request_logs" for questions about HTTP requests, responses, request traces, application traffic, paths, status codes, failed/error/erroneous requests, or logs for requests received since the system started.
- Use "connected_projects" for questions about the state of connected cloud projects, accounts, clusters, endpoints, agents, or discovered infrastructure inventory.
- Use "data_sources" for questions about where information is stored, where Ask AI searches, which database tables/APIs are used, or data retention/coverage.
- Use "security_findings" for general security posture questions (firewalls, public buckets).
- Use "container_vulnerabilities" for questions about CVEs, container image scans, or package vulnerabilities.
- Use "compliance" for SOC 2 / ISO 27001 questions.
- Use all other types for IAM/resource questions.

resourceType mapping:
GCP: bucket, gke_cluster, vm, cloud_run, cloud_sql, bigquery, pubsub, secret, firewall, service_account, load_balancer, container_image
AWS: s3_bucket, eks_cluster, ec2_instance, lambda_function, rds_instance, iam_user, iam_role, aws_account, load_balancer, container_image (also secret, firewall mapped to AWS equivalents)`;

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

  const isAuthLogs = intent.queryType === "auth_logs";
  const isRequestLogs = intent.queryType === "request_logs";
  const isDataSources = intent.queryType === "data_sources";
  const hasGkeEndpointAnalysis = Boolean((snapshot as any).gkeEntryPoints);
  const prompt = `You are a Cloud Security analyst assistant. Answer the user's question using ONLY the provided GCP/AWS data below.

Be specific and factual. Format your answer clearly:
- Use **bold** for roles, resource names, and emails
- Use bullet points for lists
- Mention the Cloud Provider (GCP or AWS) and the Project/Account ID
${isAuthLogs ? "- Group failures by principal, show counts, highlight any suspicious patterns (repeated failures, unknown principals, unusual IPs)\n- Show the time window and total count prominently at the top" : ""}
${isRequestLogs ? "- Summarize request volume, methods, paths, response status classes, clusters/hosts, and the oldest/newest timestamps covered\n- Distinguish durable agent event logs from the request processor's in-memory recent history\n- If only sampled detail is present, say so explicitly and use aggregate totals for the full log set" : ""}
${isDataSources ? "- Explain where each data category is stored or fetched from, and call out any retention or coverage limits in the provided metadata" : ""}
${hasGkeEndpointAnalysis ? "- For GKE endpoint questions, list each public entry point with cluster name, type, IP/name, Kubernetes service, and whether it is public. Also state if live endpoint discovery failed or was skipped." : ""}

Cloud Data:
${JSON.stringify(context, null, 2)}

User question: "${query}"`;

  return callAI(provider, apiKey, prompt);
}

/**
 * Builds a minimal context object focused on the query intent.
 */
function buildContext(intent: QueryIntent, snapshot: CombinedSnapshot): unknown {
  const context: any = {};

  // Auth log queries: pass the pre-fetched failures directly, skip snapshot context
  if (intent.queryType === "auth_logs") {
    if ((snapshot as any).authFailures) {
      context.authFailures = (snapshot as any).authFailures;
    }
    return context;
  }

  if (intent.queryType === "request_logs") {
    context.requestLogs = (snapshot as any).requestLogs ?? { available: false };
    context.sourceInventory = (snapshot as any).sourceInventory;
    return context;
  }

  if (intent.queryType === "connected_projects") {
    context.connectedProjects = buildConnectedProjectsContext(snapshot);
    context.sourceInventory = (snapshot as any).sourceInventory;
    if ((snapshot as any).gkeEntryPoints) context.gkeEndpointAnalysis = (snapshot as any).gkeEntryPoints;
    return context;
  }

  if (intent.queryType === "data_sources") {
    context.sourceInventory = (snapshot as any).sourceInventory;
    context.connectedProjects = buildConnectedProjectsContext(snapshot);
    context.requestLogs = (snapshot as any).requestLogs ?? { available: false };
    if ((snapshot as any).gkeEntryPoints) context.gkeEndpointAnalysis = (snapshot as any).gkeEntryPoints;
    return context;
  }

  // Container Vulnerability queries
  if (intent.queryType === "container_vulnerabilities") {
    if ((snapshot as any).containerScans) {
      context.containerScans = (snapshot as any).containerScans;
    }
    return context;
  }

  if (snapshot.gcp) {
    context.gcp = buildGcpContext(intent, snapshot.gcp);
    if ((snapshot as any).gkeEntryPoints) {
      context.gcp.gkeEndpointAnalysis = (snapshot as any).gkeEntryPoints;
    }
  }
  if (snapshot.aws) {
    context.aws = buildAwsContext(intent, snapshot.aws);
  }

  return context;
}

function buildConnectedProjectsContext(snapshot: CombinedSnapshot): unknown {
  const gcp = snapshot.gcp ? {
    source: "user_snapshots.snapshot JSONB",
    fetchedAt: snapshot.gcp.fetchedAt,
    projects: snapshot.gcp.projects.map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      iamBindings: project.bindings.length,
    })),
    inventoryCounts: {
      serviceAccounts: snapshot.gcp.serviceAccounts.length,
      storageBuckets: snapshot.gcp.storageBuckets.length,
      gkeClusters: snapshot.gcp.gkeClusters.length,
      vms: snapshot.gcp.vms.length,
      cloudRunServices: snapshot.gcp.cloudRunServices.length,
      cloudSqlInstances: snapshot.gcp.cloudSqlInstances.length,
      bigQueryDatasets: snapshot.gcp.bigqueryDatasets.length,
      pubSubTopics: snapshot.gcp.pubsubTopics.length,
      secrets: snapshot.gcp.secrets.length,
      firewallRules: snapshot.gcp.firewallRules.length,
      loadBalancers: snapshot.gcp.loadBalancers?.length ?? 0,
      scanWarnings: snapshot.gcp.scanWarnings?.length ?? 0,
    },
    gkeClusters: snapshot.gcp.gkeClusters.map((cluster) => ({
      name: cluster.name,
      projectId: cluster.projectId,
      location: cluster.location,
      status: cluster.status,
      privateCluster: cluster.privateCluster,
      workloadIdentityEnabled: cluster.workloadIdentityEnabled,
    })),
    publicEndpoints: {
      cloudRun: snapshot.gcp.cloudRunServices.filter((service) => service.url).map((service) => ({
        name: service.name,
        projectId: service.projectId,
        region: service.region,
        url: service.url,
      })),
      loadBalancers: (snapshot.gcp.loadBalancers ?? []).filter((lb) => lb.ipAddress).map((lb) => ({
        name: lb.name,
        projectId: lb.projectId,
        region: lb.region,
        ipAddress: lb.ipAddress,
        type: lb.type,
      })),
      vms: snapshot.gcp.vms.filter((vm) => vm.externalIp).map((vm) => ({
        name: vm.name,
        projectId: vm.projectId,
        zone: vm.zone,
        externalIp: vm.externalIp,
        status: vm.status,
      })),
    },
    scanWarnings: snapshot.gcp.scanWarnings ?? [],
  } : null;

  const aws = snapshot.aws ? {
    source: "aws_snapshots.snapshot JSONB",
    fetchedAt: snapshot.aws.fetchedAt,
    accounts: snapshot.aws.accounts,
    regions: snapshot.aws.regions,
    inventoryCounts: {
      iamUsers: snapshot.aws.iamUsers.length,
      iamRoles: snapshot.aws.iamRoles.length,
      s3Buckets: snapshot.aws.s3Buckets.length,
      eksClusters: snapshot.aws.eksClusters.length,
      ec2Instances: snapshot.aws.ec2Instances.length,
      lambdaFunctions: snapshot.aws.lambdaFunctions.length,
      rdsInstances: snapshot.aws.rdsInstances.length,
      redshiftClusters: snapshot.aws.redshiftClusters.length,
      snsTopics: snapshot.aws.snsTopics.length,
      secrets: snapshot.aws.secrets.length,
      securityGroups: snapshot.aws.securityGroups.length,
      loadBalancers: snapshot.aws.loadBalancers?.length ?? 0,
    },
    eksClusters: snapshot.aws.eksClusters.map((cluster) => ({
      name: cluster.clusterName,
      accountId: cluster.accountId,
      region: cluster.region,
      status: cluster.status,
      endpointPublicAccess: cluster.endpointPublicAccess,
      endpointPrivateAccess: cluster.endpointPrivateAccess,
    })),
    publicEndpoints: {
      loadBalancers: (snapshot.aws.loadBalancers ?? []).map((lb) => ({
        name: lb.name,
        accountId: lb.accountId,
        region: lb.region,
        dnsName: lb.dnsName,
        scheme: lb.scheme,
        state: lb.state,
      })),
      ec2Instances: snapshot.aws.ec2Instances.filter((instance) => instance.publicIpAddress).map((instance) => ({
        instanceId: instance.instanceId,
        name: instance.tags.Name,
        accountId: instance.accountId,
        region: instance.region,
        publicIpAddress: instance.publicIpAddress,
        state: instance.state,
      })),
    },
  } : null;

  return { gcp, aws };
}

function buildGcpContext(intent: QueryIntent, snapshot: GcpSnapshot): any {
  const { queryType, resourceType, resourceName } = intent;

  const publicBuckets = snapshot.storageBuckets.filter(b =>
    b.iamPolicy.bindings.some(bind => bind.members.some(m => m === "allUsers" || m === "allAuthenticatedUsers"))
  );

  const openFirewalls = snapshot.firewallRules.filter(r =>
    !r.disabled && r.direction === "INGRESS" && (r.sourceRanges ?? []).includes("0.0.0.0/0")
  );
  const publicCloudRunServices = snapshot.cloudRunServices.filter(service =>
    service.url || service.iamPolicy.bindings.some(bind => bind.members.some(member => member === "allUsers" || member === "allAuthenticatedUsers"))
  );

  const ctx: any = {
    counts: {
      projects: snapshot.projects.length,
      serviceAccounts: snapshot.serviceAccounts.length,
      buckets: snapshot.storageBuckets.length,
      vms: snapshot.vms.length,
      cloudRunServices: snapshot.cloudRunServices.length,
      gkeClusters: snapshot.gkeClusters.length,
      cloudSqlInstances: snapshot.cloudSqlInstances.length,
      bigqueryDatasets: snapshot.bigqueryDatasets.length,
      pubsubTopics: snapshot.pubsubTopics.length,
      secrets: snapshot.secrets.length,
      firewallRules: snapshot.firewallRules.length,
      loadBalancers: snapshot.loadBalancers?.length ?? 0,
      scanWarnings: snapshot.scanWarnings?.length ?? 0,
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

  if (queryType === "list_resources" && (resourceType === "gke_cluster" || !resourceType)) {
    ctx.gkeClusters = snapshot.gkeClusters.map(cluster => ({
      name: cluster.name,
      projectId: cluster.projectId,
      location: cluster.location,
      status: cluster.status,
      privateCluster: cluster.privateCluster,
      workloadIdentityEnabled: cluster.workloadIdentityEnabled,
      endpoint: cluster.endpoint,
    }));
  }

  if (queryType === "list_resources" && (resourceType === "vm" || !resourceType)) {
    ctx.vms = snapshot.vms.map(vm => ({
      name: vm.name,
      projectId: vm.projectId,
      zone: vm.zone,
      status: vm.status,
      externalIp: vm.externalIp,
      serviceAccount: vm.serviceAccount,
    }));
  }

  if (queryType === "list_resources" && (resourceType === "cloud_run" || !resourceType)) {
    ctx.cloudRunServices = snapshot.cloudRunServices.map(service => ({
      name: service.name,
      projectId: service.projectId,
      region: service.region,
      status: service.status,
      url: service.url,
      serviceAccount: service.serviceAccount,
      public: service.iamPolicy.bindings.some(bind => bind.members.some(member => member === "allUsers" || member === "allAuthenticatedUsers")),
      envVarNames: Object.keys(service.envVars ?? {}),
    }));
  }

  if (
    resourceType === "cloud_run" ||
    resourceType === "load_balancer" ||
    queryType === "security_findings" ||
    (queryType === "list_resources" && !resourceType)
  ) {
    ctx.publicEndpoints = {
      cloudRun: publicCloudRunServices.map(service => ({
        name: service.name,
        projectId: service.projectId,
        region: service.region,
        url: service.url ?? null,
        status: service.status,
        publicInvoker: service.iamPolicy.bindings.some(bind => bind.members.some(member => member === "allUsers" || member === "allAuthenticatedUsers")),
        serviceAccount: service.serviceAccount,
      })),
      loadBalancers: (snapshot.loadBalancers ?? []).filter(lb => lb.ipAddress).map(lb => ({
        name: lb.name,
        projectId: lb.projectId,
        region: lb.region,
        ipAddress: lb.ipAddress,
        type: lb.type,
      })),
    };
  }

  if (queryType === "list_resources" && (resourceType === "cloud_sql" || !resourceType)) {
    ctx.cloudSqlInstances = snapshot.cloudSqlInstances.map(db => ({
      name: db.name,
      projectId: db.projectId,
      region: db.region,
      databaseVersion: db.databaseVersion,
      state: db.state,
      publicIp: db.publicIp,
      backupEnabled: db.backupEnabled,
      requireSsl: db.requireSsl,
    }));
  }

  if (queryType === "list_resources" && (resourceType === "pubsub" || !resourceType)) {
    ctx.pubsubTopics = snapshot.pubsubTopics.map(topic => ({
      name: topic.name,
      projectId: topic.projectId,
      bindings: topic.iamPolicy.bindings.length,
      public: topic.iamPolicy.bindings.some(bind => bind.members.some(member => member === "allUsers" || member === "allAuthenticatedUsers")),
    }));
  }

  if (queryType === "list_resources" && (resourceType === "secret" || !resourceType)) {
    ctx.secrets = snapshot.secrets.map(secret => ({
      name: secret.name,
      projectId: secret.projectId,
      replicationPolicy: secret.replicationPolicy,
      createTime: secret.createTime,
      public: secret.iamPolicy.bindings.some(bind => bind.members.some(member => member === "allUsers" || member === "allAuthenticatedUsers")),
    }));
  }

  if (queryType === "list_resources" && (resourceType === "firewall" || !resourceType)) {
    ctx.firewallRules = snapshot.firewallRules.map(rule => ({
      name: rule.name,
      projectId: rule.projectId,
      direction: rule.direction,
      disabled: rule.disabled,
      sourceRanges: rule.sourceRanges,
      allowed: rule.allowed,
      openToInternet: !rule.disabled && rule.direction === "INGRESS" && (rule.sourceRanges ?? []).includes("0.0.0.0/0"),
    }));
  }

  if (queryType === "list_resources" && (resourceType === "load_balancer" || !resourceType)) {
    ctx.loadBalancers = (snapshot.loadBalancers ?? []).map(lb => ({
      name: lb.name,
      projectId: lb.projectId,
      region: lb.region,
      ipAddress: lb.ipAddress,
      type: lb.type,
    }));
  }

  // 3. Buckets & Security
  if (queryType === "security_findings" || (queryType === "list_resources" && (resourceType === "bucket" || !resourceType))) {
    ctx.bucketDetails = {
      total: snapshot.storageBuckets.length,
      publicCount: publicBuckets.length,
      publicBucketNames: publicBuckets.map(b => b.name),
    };
    ctx.cloudRunPublicServices = {
      total: snapshot.cloudRunServices.length,
      publicEndpointCount: publicCloudRunServices.length,
      services: publicCloudRunServices.map(service => ({
        name: service.name,
        projectId: service.projectId,
        region: service.region,
        url: service.url ?? null,
        publicInvoker: service.iamPolicy.bindings.some(bind => bind.members.some(member => member === "allUsers" || member === "allAuthenticatedUsers")),
      })),
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
    ctx.iso27001 = runIso27001(snapshot);
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
      eksClusters: snapshot.eksClusters.length,
      lambdaFunctions: snapshot.lambdaFunctions.length,
      redshiftClusters: snapshot.redshiftClusters.length,
      snsTopics: snapshot.snsTopics.length,
      secrets: snapshot.secrets.length,
      securityGroups: snapshot.securityGroups.length,
      loadBalancers: snapshot.loadBalancers?.length ?? 0,
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

  if (queryType === "list_resources" && (resourceType === "iam_role" || !resourceType)) {
    ctx.iamRoles = snapshot.iamRoles.map(role => ({
      roleName: role.roleName,
      accountId: role.accountId,
      attachedPolicies: role.attachedPolicies,
      inlinePolicies: role.inlinePolicies,
      lastUsedDate: role.lastUsedDate,
    }));
  }

  if (queryType === "list_resources" && (resourceType === "eks_cluster" || !resourceType)) {
    ctx.eksClusters = snapshot.eksClusters.map(cluster => ({
      clusterName: cluster.clusterName,
      accountId: cluster.accountId,
      region: cluster.region,
      status: cluster.status,
      endpointPublicAccess: cluster.endpointPublicAccess,
      endpointPrivateAccess: cluster.endpointPrivateAccess,
      loggingEnabled: cluster.loggingEnabled,
    }));
  }

  if (queryType === "list_resources" && (resourceType === "ec2_instance" || resourceType === "vm" || !resourceType)) {
    ctx.ec2Instances = snapshot.ec2Instances.map(instance => ({
      instanceId: instance.instanceId,
      name: instance.tags.Name,
      accountId: instance.accountId,
      region: instance.region,
      state: instance.state,
      publicIpAddress: instance.publicIpAddress,
      iamInstanceProfileArn: instance.iamInstanceProfileArn,
      securityGroupIds: instance.securityGroupIds,
    }));
  }

  if (queryType === "list_resources" && (resourceType === "lambda_function" || !resourceType)) {
    ctx.lambdaFunctions = snapshot.lambdaFunctions.map(fn => ({
      functionName: fn.functionName,
      accountId: fn.accountId,
      region: fn.region,
      runtime: fn.runtime,
      state: fn.state,
      role: fn.role,
      public: fn.resourcePolicy.some(statement => statement.principals.includes("*")),
      envVarNames: Object.keys(fn.envVars ?? {}),
    }));
  }

  if (queryType === "list_resources" && (resourceType === "rds_instance" || !resourceType)) {
    ctx.rdsInstances = snapshot.rdsInstances.map(db => ({
      identifier: db.dbInstanceIdentifier,
      accountId: db.accountId,
      region: db.region,
      engine: db.dbEngine,
      status: db.dbInstanceStatus,
      publiclyAccessible: db.publiclyAccessible,
      storageEncrypted: db.storageEncrypted,
      deletionProtection: db.deletionProtection,
    }));
  }

  if (queryType === "list_resources" && (resourceType === "secret" || !resourceType)) {
    ctx.secrets = snapshot.secrets.map(secret => ({
      name: secret.name,
      accountId: secret.accountId,
      region: secret.region,
      rotationEnabled: secret.rotationEnabled,
      lastAccessedDate: secret.lastAccessedDate,
      public: secret.resourcePolicy.some(statement => statement.principals.includes("*")),
    }));
  }

  if (queryType === "list_resources" && (resourceType === "load_balancer" || !resourceType)) {
    ctx.loadBalancers = (snapshot.loadBalancers ?? []).map(lb => ({
      name: lb.name,
      accountId: lb.accountId,
      region: lb.region,
      dnsName: lb.dnsName,
      scheme: lb.scheme,
      state: lb.state,
      type: lb.type,
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
    ctx.iso27001 = runAwsIso27001(snapshot);
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

  // Inject container scan item resources
  if (intent.queryType === "container_vulnerabilities" && (snapshot as any).containerScans) {
    const scans: any[] = (snapshot as any).containerScans;
    scans.forEach(s => items.push({ name: s.imageRef, projectId: s.accountId, type: "container_image", cloud: s.cloud as any }));
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
    findByName((snapshot.loadBalancers ?? []).map(lb => ({ name: lb.name, projectId: lb.projectId })), "load_balancer");
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
    if (!resourceType || resourceType === "gke_cluster") {
      resources.push(...snapshot.gkeClusters.map(c => ({ name: c.name, projectId: c.projectId, type: "gke_cluster" as const, cloud: "gcp" as const })));
    }
    if (!resourceType || resourceType === "cloud_run") {
      resources.push(...snapshot.cloudRunServices.map(s => ({ name: s.name, projectId: s.projectId, type: "cloud_run" as const, cloud: "gcp" as const })));
    }
    if (!resourceType || resourceType === "cloud_sql") {
      resources.push(...snapshot.cloudSqlInstances.map(db => ({ name: db.name, projectId: db.projectId, type: "cloud_sql" as const, cloud: "gcp" as const })));
    }
    if (!resourceType || resourceType === "pubsub") {
      resources.push(...snapshot.pubsubTopics.map(topic => ({ name: topic.name, projectId: topic.projectId, type: "pubsub" as const, cloud: "gcp" as const })));
    }
    if (!resourceType || resourceType === "secret") {
      resources.push(...snapshot.secrets.map(secret => ({ name: secret.name, projectId: secret.projectId, type: "secret" as const, cloud: "gcp" as const })));
    }
    if (!resourceType || resourceType === "load_balancer") {
      resources.push(...(snapshot.loadBalancers ?? []).map(lb => ({ name: lb.name, projectId: lb.projectId, type: "load_balancer" as const, cloud: "gcp" as const })));
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

    const lb = (snapshot.loadBalancers ?? []).find(item => item.name.includes(resourceName) || item.dnsName.includes(resourceName));
    if (lb) add(lb.name, lb.accountId, "load_balancer");
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
    if (!resourceType || resourceType === "iam_role") {
      snapshot.iamRoles.forEach(r => add(r.roleName, r.accountId, "iam_role"));
    }
    if (!resourceType || resourceType === "eks_cluster") {
      snapshot.eksClusters.forEach(c => add(c.clusterName, c.accountId, "eks_cluster"));
    }
    if (!resourceType || resourceType === "lambda_function") {
      snapshot.lambdaFunctions.forEach(fn => add(fn.functionName, fn.accountId, "lambda_function"));
    }
    if (!resourceType || resourceType === "rds_instance") {
      snapshot.rdsInstances.forEach(db => add(db.dbInstanceIdentifier, db.accountId, "rds_instance"));
    }
    if (!resourceType || resourceType === "secret") {
      snapshot.secrets.forEach(secret => add(secret.name, secret.accountId, "secret"));
    }
    if (!resourceType || resourceType === "load_balancer") {
      (snapshot.loadBalancers ?? []).forEach(lb => add(lb.name, lb.accountId, "load_balancer"));
    }
  }

  return resources;
}
