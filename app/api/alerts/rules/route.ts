import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql, ensureAlertRulesTable } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureAlertRulesTable();
    const result = await sql`
      SELECT webhook_url, on_new_critical, on_new_high, slack_bot_token, slack_channel_id
      FROM alert_rules
      WHERE user_email = ${session.user.email}
    `;

    if (result.rows.length === 0) {
      return NextResponse.json({
        webhookUrl: "",
        onNewCritical: true,
        onNewHigh: false,
        slackBotToken: "",
        slackChannelId: "",
      });
    }

    const row = result.rows[0];
    return NextResponse.json({
      webhookUrl: row.webhook_url,
      onNewCritical: row.on_new_critical,
      onNewHigh: row.on_new_high,
      slackBotToken: row.slack_bot_token,
      slackChannelId: row.slack_channel_id,
    });
  } catch (err) {
    console.error("[api/alerts/rules] GET error:", err);
    return NextResponse.json({ error: "Failed to load alert rules." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const webhookUrl = String(body.webhookUrl ?? "").trim();
  const onNewCritical = Boolean(body.onNewCritical ?? true);
  const onNewHigh = Boolean(body.onNewHigh ?? false);
  const slackBotToken = String(body.slackBotToken ?? "").trim();
  const slackChannelId = String(body.slackChannelId ?? "").trim();

  // Validate webhook URL — must be HTTPS and must not point to internal/private networks.
  if (webhookUrl) {
    let parsed: URL;
    try { parsed = new URL(webhookUrl); } catch {
      return NextResponse.json({ error: "Invalid webhook URL." }, { status: 400 });
    }
    if (parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Webhook URL must use HTTPS." }, { status: 400 });
    }
    const h = parsed.hostname.toLowerCase();
    const isPrivate =
      h === "localhost" || h === "127.0.0.1" || h === "::1" ||
      h === "169.254.169.254" || h === "metadata.google.internal" ||
      /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^192\.168\./.test(h);
    if (isPrivate) {
      return NextResponse.json({ error: "Webhook URL must be a public HTTPS endpoint." }, { status: 400 });
    }
  }

  try {
    await ensureAlertRulesTable();
    await sql`
      INSERT INTO alert_rules (user_email, webhook_url, on_new_critical, on_new_high, slack_bot_token, slack_channel_id, updated_at)
      VALUES (${session.user.email}, ${webhookUrl}, ${onNewCritical}, ${onNewHigh}, ${slackBotToken}, ${slackChannelId}, NOW())
      ON CONFLICT (user_email) DO UPDATE SET
        webhook_url = EXCLUDED.webhook_url,
        on_new_critical = EXCLUDED.on_new_critical,
        on_new_high = EXCLUDED.on_new_high,
        slack_bot_token = EXCLUDED.slack_bot_token,
        slack_channel_id = EXCLUDED.slack_channel_id,
        updated_at = NOW()
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/alerts/rules] PUT error:", err);
    return NextResponse.json({ error: "Failed to save alert rules." }, { status: 500 });
  }
}
