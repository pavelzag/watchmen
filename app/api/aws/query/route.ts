import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchAwsSnapshot } from "@/lib/aws";
import { useMockAwsData } from "@/lib/aws/client";
import { computeAwsFindings } from "@/lib/aws-findings";
import { runAwsSoc2 } from "@/lib/compliance/aws-soc2";
import { runAwsIso27001 } from "@/lib/compliance/aws-iso27001";
import { callAI, resolveAI } from "@/lib/ai/client";
import { sql, ensureAwsSnapshotTable } from "@/lib/db";
import type { AwsSnapshot } from "@/lib/aws/types";

interface AwsQueryIntent {
  queryType:
  | "list_iam_users"
  | "list_iam_roles"
  | "list_s3_buckets"
  | "list_eks_clusters"
  | "list_ec2_instances"
  | "list_lambda_functions"
  | "list_rds_instances"
  | "list_redshift_clusters"
  | "list_sns_topics"
  | "list_secrets"
  | "list_security_groups"
  | "security_findings"
  | "compliance"
  | "user_access"
  | "unknown";
  resourceName?: string;
  accountId?: string;
  region?: string;
  user?: string;
}

async function extractAwsIntent(
  query: string,
  provider: Parameters<typeof callAI>[0],
  apiKey: string
): Promise<AwsQueryIntent> {
  const prompt = `You are an AWS security query parser. Extract the intent from the following natural language query and return ONLY valid JSON (no markdown, no explanation).

Query: "${query}"

Return JSON matching this exact schema:
{
  "queryType": "list_iam_users" | "list_iam_roles" | "list_s3_buckets" | "list_eks_clusters" | "list_ec2_instances" | "list_lambda_functions" | "list_rds_instances" | "list_redshift_clusters" | "list_sns_topics" | "list_secrets" | "list_security_groups" | "security_findings" | "user_access" | "unknown",
  "resourceName": "<name or null>",
  "accountId": "<AWS account ID or null>",
  "region": "<AWS region or null>",
  "user": "<IAM username or null>"
}

queryType guide:
- list_iam_users: asking to list IAM users
- list_iam_roles: asking to list IAM roles
- list_s3_buckets: asking to list S3 buckets
- list_eks_clusters: asking to list EKS clusters
- list_ec2_instances: asking to list EC2 instances
- list_lambda_functions: asking to list Lambda functions
- list_rds_instances: asking to list RDS instances
- list_redshift_clusters: asking to list Redshift clusters
- list_sns_topics: asking to list SNS topics
- list_secrets: asking to list Secrets Manager secrets
- list_security_groups: asking to list security groups
- security_findings: asking about security issues, risks, public access, open ports, vulnerabilities, findings
- compliance: asking about compliance status, SOC2, ISO 27001, compliance score, failing controls, audit readiness
- user_access: asking what a specific IAM user can access or about their permissions
- unknown: cannot determine`;

  const text = await callAI(provider, apiKey, prompt);
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  try {
    return JSON.parse(cleaned) as AwsQueryIntent;
  } catch {
    return { queryType: "unknown" };
  }
}

function buildAwsContext(intent: AwsQueryIntent, snapshot: AwsSnapshot): unknown {
  const { queryType, resourceName, accountId, region, user } = intent;

  const filterByAccount = <T extends { accountId: string }>(items: T[]) =>
    accountId ? items.filter((i) => i.accountId === accountId) : items;
  const filterByRegion = <T extends { region: string }>(items: T[]) =>
    region ? items.filter((i) => i.region === region) : items;

  if (queryType === "security_findings") {
    return computeAwsFindings(snapshot);
  }

  if (queryType === "compliance") {
    return {
      soc2: runAwsSoc2(snapshot),
      iso27001: runAwsIso27001(snapshot),
    };
  }

  if (queryType === "user_access" && user) {
    const iamUser = snapshot.iamUsers.find((u) => u.userName === user);
    return { user, iamUser: iamUser ?? null };
  }

  if (queryType === "list_iam_users") {
    const users = filterByAccount(snapshot.iamUsers);
    const named = resourceName ? users.filter((u) => u.userName.includes(resourceName)) : users;
    return { iamUsers: named.map((u) => ({ userName: u.userName, accountId: u.accountId, mfaEnabled: u.mfaEnabled, attachedPolicies: u.attachedPolicies, groups: u.groups, activeKeyCount: u.accessKeys.filter((k) => k.status === "Active").length })) };
  }

  if (queryType === "list_iam_roles") {
    const roles = filterByAccount(snapshot.iamRoles);
    const named = resourceName ? roles.filter((r) => r.roleName.includes(resourceName)) : roles;
    return { iamRoles: named.map((r) => ({ roleName: r.roleName, accountId: r.accountId, attachedPolicies: r.attachedPolicies, lastUsedDate: r.lastUsedDate })) };
  }

  if (queryType === "list_s3_buckets") {
    const buckets = filterByRegion(filterByAccount(snapshot.s3Buckets));
    const named = resourceName ? buckets.filter((b) => b.bucketName.includes(resourceName)) : buckets;
    return { s3Buckets: named.map((b) => ({ bucketName: b.bucketName, accountId: b.accountId, region: b.region, encryption: b.encryption, versioning: b.versioning, publicAccess: !b.publicAccessBlock.blockPublicAcls || !b.publicAccessBlock.blockPublicPolicy })) };
  }

  if (queryType === "list_eks_clusters") {
    const clusters = filterByRegion(filterByAccount(snapshot.eksClusters));
    return { eksClusters: clusters.map((c) => ({ clusterName: c.clusterName, accountId: c.accountId, region: c.region, version: c.kubernetesVersion, status: c.status, publicEndpoint: c.endpointPublicAccess })) };
  }

  if (queryType === "list_ec2_instances") {
    const instances = filterByRegion(filterByAccount(snapshot.ec2Instances));
    return { ec2Instances: instances.map((i) => ({ instanceId: i.instanceId, name: i.tags.Name, accountId: i.accountId, region: i.region, state: i.state, publicIp: i.publicIpAddress, instanceType: i.instanceType })) };
  }

  if (queryType === "list_lambda_functions") {
    const fns = filterByRegion(filterByAccount(snapshot.lambdaFunctions));
    return { lambdaFunctions: fns.map((f) => ({ functionName: f.functionName, accountId: f.accountId, region: f.region, runtime: f.runtime, hasPublicPolicy: f.resourcePolicy.some((s) => s.principals.includes("*")) })) };
  }

  if (queryType === "list_rds_instances") {
    const dbs = filterByRegion(filterByAccount(snapshot.rdsInstances));
    return { rdsInstances: dbs.map((d) => ({ identifier: d.dbInstanceIdentifier, accountId: d.accountId, region: d.region, engine: d.dbEngine, publiclyAccessible: d.publiclyAccessible, encrypted: d.storageEncrypted })) };
  }

  if (queryType === "list_redshift_clusters") {
    const clusters = filterByRegion(filterByAccount(snapshot.redshiftClusters));
    return { redshiftClusters: clusters.map((c) => ({ identifier: c.clusterIdentifier, accountId: c.accountId, region: c.region, publiclyAccessible: c.publiclyAccessible, encrypted: c.encrypted })) };
  }

  if (queryType === "list_sns_topics") {
    const topics = filterByRegion(filterByAccount(snapshot.snsTopics));
    return { snsTopics: topics.map((t) => ({ topicName: t.topicName, accountId: t.accountId, region: t.region, subscriptionCount: t.subscriptionCount })) };
  }

  if (queryType === "list_secrets") {
    const secrets = filterByRegion(filterByAccount(snapshot.secrets));
    return { secrets: secrets.map((s) => ({ name: s.name, accountId: s.accountId, region: s.region, rotationEnabled: s.rotationEnabled, lastAccessedDate: s.lastAccessedDate })) };
  }

  if (queryType === "list_security_groups") {
    const sgs = filterByRegion(filterByAccount(snapshot.securityGroups));
    return {
      securityGroups: sgs.map((sg) => ({
        groupId: sg.groupId, groupName: sg.groupName, accountId: sg.accountId, region: sg.region,
        dangerousRules: sg.inboundRules.filter((r) => r.cidrRanges.includes("0.0.0.0/0")).length,
      })),
    };
  }

  // Generic summary
  return {
    accounts: snapshot.accounts,
    regions: snapshot.regions,
    summary: {
      iamUsers: snapshot.iamUsers.length,
      iamRoles: snapshot.iamRoles.length,
      s3Buckets: snapshot.s3Buckets.length,
      eksClusters: snapshot.eksClusters.length,
      ec2Instances: snapshot.ec2Instances.length,
      lambdaFunctions: snapshot.lambdaFunctions.length,
      rdsInstances: snapshot.rdsInstances.length,
      redshiftClusters: snapshot.redshiftClusters.length,
      snsTopics: snapshot.snsTopics.length,
      secrets: snapshot.secrets.length,
      securityGroups: snapshot.securityGroups.length,
    },
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const query: string = body?.query?.trim();

  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Query must be at least 3 characters." }, { status: 400 });
  }
  if (query.length > 500) {
    return NextResponse.json({ error: "Query must be under 500 characters." }, { status: 400 });
  }

  // Resolve the user's AI key: check body first (browser-only), then fallback to DB
  let provider: "openai" | "anthropic" | "google";
  let apiKey: string;
  const browserKey = (body as any)?.demoCredentials?.aiKey;
  const browserProvider = (body as any)?.demoCredentials?.aiProvider;

  if (browserKey && browserProvider) {
    provider = browserProvider as any;
    apiKey = browserKey;
  } else {
    try {
      const resolved = await resolveAI(session.user.email, session.isDemoUser);
      provider = resolved.provider as any;
      apiKey = resolved.key;
    } catch (err: any) {
      if (err.message === "DEMO_LIMIT_REACHED") {
        return NextResponse.json(
          { error: "Daily demo AI limit reached (20 queries). Please provide your own Gemini/Claude key in Settings to continue." },
          { status: 429 }
        );
      }
      const demoMsg = session.isDemoUser
        ? " (or provide your own API key in Settings)"
        : " in Settings";
      return NextResponse.json(
        { error: `No AI key configured${demoMsg}.` },
        { status: 422 }
      );
    }
  }

  try {
    let snapshot: AwsSnapshot;

    if (useMockAwsData() || session.isDemoUser) {
      snapshot = await fetchAwsSnapshot({ forceMock: true });
    } else {
      await ensureAwsSnapshotTable();
      const result = await sql`
        SELECT snapshot FROM aws_snapshots WHERE user_email = ${session.user.email}
      `;
      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: "No AWS snapshot yet. Please wait for the initial scan." },
          { status: 404 }
        );
      }
      snapshot = result.rows[0].snapshot as AwsSnapshot;
    }

    const intent = await extractAwsIntent(query, provider, apiKey);
    const context = buildAwsContext(intent, snapshot);

    const answerPrompt = `You are an AWS security analyst assistant. Answer the user's question using ONLY the provided AWS data below.

Be specific and factual. Format your answer clearly:
- Use **bold** for resource names, account IDs, and usernames
- Use bullet points for lists
- For security findings questions, highlight critical and high severity issues first
- For compliance questions, summarize the overall score, then list failing controls by category with their remediation hints
- Mention the AWS account and region for each resource

AWS Data:
${JSON.stringify(context, null, 2)}

User question: "${query}"`;

    const answer = await callAI(provider, apiKey, answerPrompt);

    return NextResponse.json({ query, intent, answer, resources: [], fetchedAt: snapshot.fetchedAt });
  } catch (err) {
    console.error("[api/aws/query] error:", err);
    return NextResponse.json({ error: "Failed to process AWS query. Check server logs." }, { status: 500 });
  }
}
