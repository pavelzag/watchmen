import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createPersonalApiToken,
  listPersonalApiTokens,
  revokePersonalApiToken,
} from "@/lib/handoff/store";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.isDemoUser) {
    return NextResponse.json({ tokens: [] });
  }

  try {
    const tokens = await listPersonalApiTokens(email);
    return NextResponse.json({ tokens });
  } catch (err) {
    console.error("[api/settings/api-tokens] GET error:", err);
    return NextResponse.json({ error: "Failed to load API tokens." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.isDemoUser) {
    return NextResponse.json(
      { error: "Personal API tokens are disabled in Demo mode." },
      { status: 403 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "CLI Token";
    const created = await createPersonalApiToken({ userEmail: email, name });
    const tokens = await listPersonalApiTokens(email);
    return NextResponse.json({ ok: true, token: created.token, record: created.record, tokens });
  } catch (err) {
    console.error("[api/settings/api-tokens] POST error:", err);
    return NextResponse.json({ error: "Failed to create API token." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.isDemoUser) {
    return NextResponse.json({ error: "Personal API tokens are disabled in Demo mode." }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "Missing token id." }, { status: 400 });
    }
    const revoked = await revokePersonalApiToken(email, id);
    if (!revoked) {
      return NextResponse.json({ error: "Token not found or already revoked." }, { status: 404 });
    }
    const tokens = await listPersonalApiTokens(email);
    return NextResponse.json({ ok: true, tokens });
  } catch (err) {
    console.error("[api/settings/api-tokens] DELETE error:", err);
    return NextResponse.json({ error: "Failed to revoke API token." }, { status: 500 });
  }
}
