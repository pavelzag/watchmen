import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GcpSnapshot } from "@/lib/gcp/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

function getModel() {
  return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
    | "firewall";
  resourceName?: string;
  projectId?: string;
  region?: string;
}

/**
 * Pass 1 — Extract structured intent from a natural language query.
 */
export async function extractIntent(query: string): Promise<QueryIntent> {
  const model = getModel();
  const result = await model.generateContent(
    `You are a GCP IAM query parser. Extract the intent from the following natural language query and return ONLY valid JSON (no markdown, no explanation).

Query: "${query}"

Return JSON matching this exact schema:
{
  "queryType": "user_access" | "resource_owners" | "specific_resource_access" | "list_users" | "list_resources" | "security_findings" | "principal_overview" | "unknown",
  "user": "<email or null>",
  "resourceType": "bucket" | "gke_cluster" | "project" | "service_account" | "vm" | "cloud_run" | "cloud_sql" | "bigquery" | "pubsub" | "secret" | "firewall" | null,
  "resourceName": "<name or null>",
  "projectId": "<project ID or null>",
  "region": "<region or null>"
}

queryType guide:
- user_access: asking what a specific user/SA can access
- resource_owners: asking who controls/owns a specific resource
- specific_resource_access: asking what access a user has on a specific resource
- list_users: asking to list all users
- list_resources: asking to list all resources of a type (buckets, VMs, secrets, firewall rules, etc.)
- security_findings: asking about security issues, risks, public access, expired keys, vulnerabilities
- principal_overview: asking for a complete overview of what a principal can access across all resource types
- unknown: cannot determine

resourceType guide:
- bucket: GCS storage buckets
- gke_cluster: Google Kubernetes Engine clusters
- project: GCP projects
- service_account: service accounts
- vm: Compute Engine VMs / instances
- cloud_run: Cloud Run services
- cloud_sql: Cloud SQL instances / databases
- bigquery: BigQuery datasets
- pubsub: Pub/Sub topics
- secret: Secret Manager secrets
- firewall: VPC firewall rules`
  );

  const text = result.response.text();
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  try {
    return JSON.parse(cleaned) as QueryIntent;
  } catch {
    return { queryType: "unknown" };
  }
}

/**
 * Pass 2 — Answer the original query using GCP snapshot data.
 */
export async function generateAnswer(
  query: string,
  intent: QueryIntent,
  snapshot: GcpSnapshot
): Promise<string> {
  const context = buildContext(intent, snapshot);
  const model = getModel();

  const result = await model.generateContent(
    `You are a GCP IAM security analyst assistant. Answer the user's question using ONLY the provided GCP data below.

Be specific and factual. Format your answer clearly:
- Use **bold** for roles, resource names, and emails
- Use bullet points for lists
- If a user has no access, say so explicitly
- Mention which project each access is in
- For security findings questions, highlight critical and high severity issues first

GCP Data:
${JSON.stringify(context, null, 2)}

User question: "${query}"`
  );

  return result.response.text();
}

/**
 * Builds a minimal context object focused on the query intent.
 */
function buildContext(intent: QueryIntent, snapshot: GcpSnapshot): unknown {
  const { queryType, user, resourceType, resourceName, projectId, region } = intent;

  if (
    (queryType === "user_access" || queryType === "specific_resource_access" || queryType === "principal_overview") &&
    user
  ) {
    const userTag = `user:${user}`;
    const saTag = `serviceAccount:${user}`;
    const tags = [userTag, saTag];

    const rolesFor = (bindings: { role: string; members: string[] }[]) =>
      bindings.filter((b) => b.members.some((m) => tags.includes(m))).map((b) => b.role);

    const projectAccess = snapshot.projects
      .filter((p) => !projectId || p.projectId === projectId)
      .map((p) => ({ projectId: p.projectId, projectName: p.projectName, roles: rolesFor(p.bindings) }))
      .filter((p) => p.roles.length > 0);

    const bucketAccess = snapshot.storageBuckets
      .filter((b) => !resourceName || b.name === resourceName)
      .filter((b) => !projectId || b.projectId === projectId)
      .map((b) => ({ bucket: b.name, project: b.projectId, roles: rolesFor(b.iamPolicy.bindings) }))
      .filter((b) => b.roles.length > 0);

    const gkeAccess = snapshot.gkeClusters
      .filter((c) => !resourceName || c.name === resourceName)
      .filter((c) => !projectId || c.projectId === projectId)
      .filter((c) => !region || c.location.startsWith(region))
      .map((c) => ({ cluster: c.name, project: c.projectId, location: c.location, roles: rolesFor(c.iamPolicy.bindings) }))
      .filter((c) => c.roles.length > 0);

    const cloudRunAccess = snapshot.cloudRunServices
      .map((s) => ({ service: s.name, project: s.projectId, region: s.region, roles: rolesFor(s.iamPolicy.bindings) }))
      .filter((s) => s.roles.length > 0);

    const bigqueryAccess = snapshot.bigqueryDatasets
      .map((d) => ({ dataset: d.datasetId, project: d.projectId, roles: rolesFor(d.iamPolicy.bindings) }))
      .filter((d) => d.roles.length > 0);

    const secretAccess = snapshot.secrets
      .map((s) => ({ secret: s.name.split("/").pop(), project: s.projectId, roles: rolesFor(s.iamPolicy.bindings) }))
      .filter((s) => s.roles.length > 0);

    const saInfo = snapshot.serviceAccounts.find((sa) => sa.email === user);

    return { user, projectAccess, bucketAccess, gkeAccess, cloudRunAccess, bigqueryAccess, secretAccess, serviceAccountInfo: saInfo ?? null };
  }

  if (queryType === "security_findings") {
    // Build a security-focused context
    const publicBuckets = snapshot.storageBuckets.filter((b) =>
      b.iamPolicy.bindings.some((bind) =>
        bind.members.some((m) => m === "allUsers" || m === "allAuthenticatedUsers")
      )
    ).map((b) => ({ name: b.name, project: b.projectId }));

    const openFirewalls = snapshot.firewallRules.filter(
      (r) => !r.disabled && r.direction === "INGRESS" &&
        (r.sourceRanges ?? []).some((x) => x === "0.0.0.0/0" || x === "::/0")
    ).map((r) => ({ name: r.name, project: r.projectId, protocols: r.allowed.map((a) => a.IPProtocol) }));

    const sqlWithPublicIp = snapshot.cloudSqlInstances.filter((i) => i.publicIp)
      .map((i) => ({ name: i.name, project: i.projectId, publicIp: i.publicIp }));

    const expiredKeys = snapshot.serviceAccounts.filter((sa) =>
      sa.keys.some((k) => k.validBeforeTime && new Date(k.validBeforeTime) < new Date())
    ).map((sa) => sa.email);

    const publicRunServices = snapshot.cloudRunServices.filter((s) =>
      s.iamPolicy.bindings.some((b) => b.members.some((m) => m === "allUsers"))
    ).map((s) => ({ name: s.name, project: s.projectId }));

    const publicSecrets = snapshot.secrets.filter((s) =>
      s.iamPolicy.bindings.some((b) => b.members.some((m) => m === "allUsers" || m === "allAuthenticatedUsers"))
    ).map((s) => ({ name: s.name.split("/").pop(), project: s.projectId }));

    return { publicBuckets, openFirewalls, sqlWithPublicIp, expiredKeys, publicRunServices, publicSecrets };
  }

  if (queryType === "resource_owners" && resourceName) {
    if (resourceType === "bucket" || !resourceType) {
      const bucket = snapshot.storageBuckets.find((b) =>
        b.name.toLowerCase().includes(resourceName.toLowerCase())
      );
      if (bucket) return { resource: "bucket", name: bucket.name, project: bucket.projectId, iamPolicy: bucket.iamPolicy };
    }
    if (resourceType === "gke_cluster" || !resourceType) {
      const cluster = snapshot.gkeClusters.find(
        (c) =>
          c.name.toLowerCase().includes(resourceName.toLowerCase()) &&
          (!region || c.location.startsWith(region))
      );
      if (cluster) return { resource: "gke_cluster", name: cluster.name, project: cluster.projectId, location: cluster.location, iamPolicy: cluster.iamPolicy };
    }
    if (resourceType === "cloud_run" || !resourceType) {
      const svc = snapshot.cloudRunServices.find((s) =>
        s.name.toLowerCase().includes(resourceName.toLowerCase())
      );
      if (svc) return { resource: "cloud_run", name: svc.name, project: svc.projectId, region: svc.region, iamPolicy: svc.iamPolicy };
    }
    if (resourceType === "secret" || !resourceType) {
      const secret = snapshot.secrets.find((s) =>
        s.name.toLowerCase().includes(resourceName.toLowerCase())
      );
      if (secret) return { resource: "secret", name: secret.name, project: secret.projectId, iamPolicy: secret.iamPolicy };
    }
    if (resourceType === "project" || !resourceType) {
      const project = snapshot.projects.find(
        (p) =>
          p.projectId.toLowerCase().includes(resourceName.toLowerCase()) ||
          p.projectName.toLowerCase().includes(resourceName.toLowerCase())
      );
      if (project) return { resource: "project", ...project };
    }
    return { message: `No resource found matching: ${resourceName}` };
  }

  if (queryType === "list_users") {
    const users = new Set<string>();
    for (const project of snapshot.projects) {
      for (const binding of project.bindings) {
        for (const member of binding.members) {
          if (member.startsWith("user:")) users.add(member.slice(5));
        }
      }
    }
    return { users: Array.from(users).sort() };
  }

  if (queryType === "list_resources") {
    if (resourceType === "bucket")
      return { buckets: snapshot.storageBuckets.map((b) => ({ name: b.name, project: b.projectId, location: b.location })) };
    if (resourceType === "gke_cluster")
      return { clusters: snapshot.gkeClusters.map((c) => ({ name: c.name, project: c.projectId, location: c.location, status: c.status })) };
    if (resourceType === "service_account")
      return { serviceAccounts: snapshot.serviceAccounts.map((sa) => ({ email: sa.email, displayName: sa.displayName, project: sa.projectId, disabled: sa.disabled })) };
    if (resourceType === "vm")
      return { vms: snapshot.vms.map((v) => ({ name: v.name, project: v.projectId, zone: v.zone, status: v.status, externalIp: v.externalIp })) };
    if (resourceType === "cloud_run")
      return { cloudRunServices: snapshot.cloudRunServices.map((s) => ({ name: s.name, project: s.projectId, region: s.region, status: s.status })) };
    if (resourceType === "cloud_sql")
      return { cloudSqlInstances: snapshot.cloudSqlInstances.map((i) => ({ name: i.name, project: i.projectId, region: i.region, state: i.state, publicIp: i.publicIp })) };
    if (resourceType === "bigquery")
      return { datasets: snapshot.bigqueryDatasets.map((d) => ({ datasetId: d.datasetId, project: d.projectId, location: d.location })) };
    if (resourceType === "pubsub")
      return { topics: snapshot.pubsubTopics.map((t) => ({ name: t.name, project: t.projectId })) };
    if (resourceType === "secret")
      return { secrets: snapshot.secrets.map((s) => ({ name: s.name, project: s.projectId, createTime: s.createTime })) };
    if (resourceType === "firewall")
      return { firewallRules: snapshot.firewallRules.map((r) => ({ name: r.name, project: r.projectId, direction: r.direction, sourceRanges: r.sourceRanges, disabled: r.disabled })) };
    return {
      summary: {
        projects: snapshot.projects.length,
        serviceAccounts: snapshot.serviceAccounts.length,
        storageBuckets: snapshot.storageBuckets.length,
        gkeClusters: snapshot.gkeClusters.length,
        vms: snapshot.vms.length,
        cloudRunServices: snapshot.cloudRunServices.length,
        cloudSqlInstances: snapshot.cloudSqlInstances.length,
        bigqueryDatasets: snapshot.bigqueryDatasets.length,
        pubsubTopics: snapshot.pubsubTopics.length,
        secrets: snapshot.secrets.length,
        firewallRules: snapshot.firewallRules.length,
      },
    };
  }

  return snapshot;
}
