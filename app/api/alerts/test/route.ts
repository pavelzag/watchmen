import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fireWebhook, buildTestPayload } from "@/lib/alerting";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const webhookUrl = String(body?.webhookUrl ?? "").trim();

  if (!webhookUrl) {
    return NextResponse.json({ error: "webhookUrl is required." }, { status: 400 });
  }

  if (!webhookUrl.startsWith("http")) {
    return NextResponse.json({ error: "Invalid webhook URL." }, { status: 400 });
  }

  try {
    await fireWebhook(webhookUrl, buildTestPayload());
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook delivery failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
