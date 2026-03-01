import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { listUserKeys } from "@/lib/ai/client";

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider } = await req.json() as { provider: string };
  const email = session.user.email;

  // Set all to false, then activate the chosen one
  await sql`UPDATE user_api_keys SET is_active = FALSE WHERE user_email = ${email}`;
  await sql`UPDATE user_api_keys SET is_active = TRUE WHERE user_email = ${email} AND provider = ${provider}`;

  const keys = await listUserKeys(email);
  return NextResponse.json({ ok: true, keys });
}
