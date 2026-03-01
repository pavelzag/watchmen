import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { listUserKeys } from "@/lib/ai/client";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider } = await params;
  const email = session.user.email;

  await sql`
    DELETE FROM user_api_keys WHERE user_email = ${email} AND provider = ${provider}
  `;

  // If we deleted the active key, activate the first remaining key (if any)
  const remaining = await sql`
    SELECT provider FROM user_api_keys WHERE user_email = ${email} ORDER BY created_at ASC LIMIT 1
  `;
  if (remaining.rows.length > 0) {
    await sql`
      UPDATE user_api_keys SET is_active = (provider = ${remaining.rows[0].provider})
      WHERE user_email = ${email}
    `;
  }

  const keys = await listUserKeys(email);
  return NextResponse.json({ ok: true, keys });
}
