import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fireWebhook, postToSlack, buildTestPayload } from "@/lib/alerting";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const webhookUrl = String(body?.webhookUrl ?? "").trim();
  const slackBotToken = String(body?.slackBotToken ?? "").trim();
  const slackChannelId = String(body?.slackChannelId ?? "").trim();

  const payload = buildTestPayload();

  try {
    if (slackBotToken && slackChannelId) {
      await postToSlack(slackBotToken, slackChannelId, payload);
    } else if (webhookUrl) {
      let parsedWebhook: URL;
      try { parsedWebhook = new URL(webhookUrl); } catch {
        return NextResponse.json({ error: "Invalid webhook URL." }, { status: 400 });
      }
      if (parsedWebhook.protocol !== "https:") {
        return NextResponse.json({ error: "Webhook URL must use HTTPS." }, { status: 400 });
      }
      const wh = parsedWebhook.hostname.toLowerCase();
      const isPrivate =
        wh === "localhost" || wh === "127.0.0.1" || wh === "::1" ||
        wh === "169.254.169.254" || wh === "metadata.google.internal" ||
        /^10\./.test(wh) || /^172\.(1[6-9]|2\d|3[01])\./.test(wh) || /^192\.168\./.test(wh);
      if (isPrivate) {
        return NextResponse.json({ error: "Webhook URL must be a public HTTPS endpoint." }, { status: 400 });
      }
      await fireWebhook(webhookUrl, payload);
    } else {
      return NextResponse.json({ error: "Provide a Slack bot token + channel ID, or a webhook URL." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delivery failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
