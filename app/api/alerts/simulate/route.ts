import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql, ensureAlertRulesTable } from "@/lib/db";
import { postToSlack, fireWebhook, type AlertFinding } from "@/lib/alerting";

type FindingId =
  | "public_bucket"
  | "public_firewall"
  | "secret_in_env"
  | "expired_sa_key"
  | "sa_owner_editor"
  | "user_owner_editor"
  | "secret_public"
  | "vm_external_ip_no_sa"
  | "multiple_sa_keys"
  | "sql_public_ip"
  | "cloud_run_public"
  | "orphaned_sa"
  | "sa_not_in_list";

const MOCK_FINDINGS: Record<FindingId, AlertFinding> = {
  public_bucket: {
    id: "sim:public_bucket:demo-project:demo-public-assets",
    severity: "critical",
    title: "Publicly Accessible Storage Bucket",
    resourceName: "demo-public-assets",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  public_firewall: {
    id: "sim:public_firewall:demo-project:allow-all-ingress",
    severity: "critical",
    title: "Firewall Rule Open to the Internet",
    resourceName: "allow-all-ingress",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  secret_in_env: {
    id: "sim:secret_in_env:cloudrun:demo-project:api-server:STRIPE_SECRET_KEY",
    severity: "critical",
    title: "Secret Detected in Cloud Run Environment Variable",
    resourceName: "api-server",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  expired_sa_key: {
    id: "sim:expired_sa_key:demo-project:ci-deploy@demo-project.iam.gserviceaccount.com",
    severity: "high",
    title: "Expired Service Account Key",
    resourceName: "ci-deploy@demo-project.iam.gserviceaccount.com",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  sa_owner_editor: {
    id: "sim:sa_owner_editor:demo-project:app-backend@demo-project.iam.gserviceaccount.com",
    severity: "high",
    title: "Service Account with Owner/Editor Role",
    resourceName: "app-backend@demo-project.iam.gserviceaccount.com",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  user_owner_editor: {
    id: "sim:user_owner_editor:john.doe@example.com",
    severity: "high",
    title: "User with Owner/Editor on Multiple Projects",
    resourceName: "john.doe@example.com",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  secret_public: {
    id: "sim:secret_public:demo-project:db-password",
    severity: "high",
    title: "Publicly Accessible Secret",
    resourceName: "db-password",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  vm_external_ip_no_sa: {
    id: "sim:vm_external_ip_no_sa:demo-project:legacy-bastion",
    severity: "medium",
    title: "VM with External IP but No Service Account",
    resourceName: "legacy-bastion",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  multiple_sa_keys: {
    id: "sim:multiple_sa_keys:demo-project:data-pipeline@demo-project.iam.gserviceaccount.com",
    severity: "medium",
    title: "Service Account with Multiple Keys",
    resourceName: "data-pipeline@demo-project.iam.gserviceaccount.com",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  sql_public_ip: {
    id: "sim:sql_public_ip:demo-project:prod-postgres",
    severity: "medium",
    title: "Cloud SQL Instance with Public IP",
    resourceName: "prod-postgres",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  cloud_run_public: {
    id: "sim:cloud_run_public:demo-project:public-api",
    severity: "medium",
    title: "Cloud Run Service Publicly Accessible",
    resourceName: "public-api",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  orphaned_sa: {
    id: "sim:orphaned_sa:demo-project:old-worker@demo-project.iam.gserviceaccount.com",
    severity: "low",
    title: "Disabled Service Account Still in IAM Bindings",
    resourceName: "old-worker@demo-project.iam.gserviceaccount.com",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
  sa_not_in_list: {
    id: "sim:sa_not_in_list:ghost-sa@demo-project.iam.gserviceaccount.com",
    severity: "low",
    title: "Unknown Service Account in IAM Bindings",
    resourceName: "ghost-sa@demo-project.iam.gserviceaccount.com",
    projectOrAccount: "demo-project",
    cloud: "gcp",
  },
};

function buildSimulatePayload(findings: AlertFinding[]): object {
  const critCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const medCount = findings.filter((f) => f.severity === "medium").length;
  const lowCount = findings.filter((f) => f.severity === "low").length;

  const parts: string[] = [];
  if (critCount > 0) parts.push(`${critCount} critical`);
  if (highCount > 0) parts.push(`${highCount} high`);
  if (medCount > 0) parts.push(`${medCount} medium`);
  if (lowCount > 0) parts.push(`${lowCount} low`);
  const summary = parts.join(", ");

  const lines = findings.map((f) => {
    const emoji =
      f.severity === "critical" ? "🔴" :
      f.severity === "high" ? "🟠" :
      f.severity === "medium" ? "🟡" : "🔵";
    return `${emoji} *${f.title}* — \`${f.resourceName}\` (${f.projectOrAccount}, ${f.cloud.toUpperCase()})`;
  });

  return {
    text: `🧪 *Watchmen Simulation* — ${summary} finding${findings.length !== 1 ? "s" : ""} (simulated)`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🧪 *Watchmen Alert Simulation*\n${summary} finding${findings.length !== 1 ? "s" : ""} — this is a simulated alert to verify your integration.`,
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: lines.join("\n"),
        },
      },
    ],
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const selected: string[] = Array.isArray(body?.findings) ? body.findings : [];

  if (selected.length === 0) {
    return NextResponse.json({ error: "Select at least one finding to simulate." }, { status: 400 });
  }

  const findings: AlertFinding[] = selected
    .filter((id): id is FindingId => id in MOCK_FINDINGS)
    .map((id) => MOCK_FINDINGS[id]);

  if (findings.length === 0) {
    return NextResponse.json({ error: "No valid finding types selected." }, { status: 400 });
  }

  try {
    await ensureAlertRulesTable();
    const result = await sql`
      SELECT webhook_url, slack_bot_token, slack_channel_id
      FROM alert_rules
      WHERE user_email = ${session.user.email}
    `;

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No alert rules configured. Save your Slack settings first." }, { status: 422 });
    }

    const row = result.rows[0];
    const slackBotToken = row.slack_bot_token as string;
    const slackChannelId = row.slack_channel_id as string;
    const webhookUrl = row.webhook_url as string;

    const payload = buildSimulatePayload(findings);

    if (slackBotToken && slackChannelId) {
      await postToSlack(slackBotToken, slackChannelId, payload);
    } else if (webhookUrl) {
      await fireWebhook(webhookUrl, payload);
    } else {
      return NextResponse.json({ error: "No Slack bot token or webhook URL configured." }, { status: 422 });
    }

    return NextResponse.json({ ok: true, sent: findings.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Simulation failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
