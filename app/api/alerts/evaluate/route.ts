import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql, ensureAlertRulesTable } from "@/lib/db";
import { evaluateAlerts, type AlertFinding } from "@/lib/alerting";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.findings)) {
    return NextResponse.json({ error: "findings array required." }, { status: 400 });
  }

  const findings = body.findings as AlertFinding[];
  const email = session.user.email;

  try {
    await ensureAlertRulesTable();

    const result = await sql`
      SELECT webhook_url, on_new_critical, on_new_high, last_finding_ids, slack_bot_token, slack_channel_id
      FROM alert_rules
      WHERE user_email = ${email}
    `;

    if (result.rows.length === 0) {
      // No rules configured — nothing to do
      return NextResponse.json({ alerted: 0, skipped: "no rules configured" });
    }

    const row = result.rows[0];
    const rules = {
      webhookUrl: row.webhook_url as string,
      onNewCritical: row.on_new_critical as boolean,
      onNewHigh: row.on_new_high as boolean,
      slackBotToken: row.slack_bot_token as string,
      slackChannelId: row.slack_channel_id as string,
    };
    const previousIds: string[] = (row.last_finding_ids as string[]) ?? [];

    // Evaluate and potentially fire webhook
    const alerted = await evaluateAlerts(rules, findings, previousIds);

    // Update last_finding_ids with current set
    const currentIds = findings.map((f) => f.id);
    await sql`
      UPDATE alert_rules
      SET last_finding_ids = ${JSON.stringify(currentIds)}::jsonb,
          updated_at = NOW()
      WHERE user_email = ${email}
    `;

    return NextResponse.json({ alerted: alerted.length });
  } catch (err) {
    console.error("[api/alerts/evaluate] error:", err);
    return NextResponse.json({ error: "Failed to evaluate alerts." }, { status: 500 });
  }
}
