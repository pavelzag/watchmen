import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { controlId, justification } = body as { controlId: string; justification: string };
  if (!controlId) {
    return NextResponse.json({ error: "controlId is required" }, { status: 400 });
  }

  try {
    await sql`
      INSERT INTO compliance_suppressions (user_email, control_id, justification)
      VALUES (${session.user.email}, ${controlId}, ${justification ?? ""})
      ON CONFLICT (user_email, control_id) DO UPDATE
        SET justification = EXCLUDED.justification,
            suppressed_at = NOW()
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/compliance/suppress] POST error:", err);
    return NextResponse.json({ error: "Failed to save suppression." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { controlId } = body as { controlId: string };
  if (!controlId) {
    return NextResponse.json({ error: "controlId is required" }, { status: 400 });
  }

  try {
    await sql`
      DELETE FROM compliance_suppressions
      WHERE user_email = ${session.user.email} AND control_id = ${controlId}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/compliance/suppress] DELETE error:", err);
    return NextResponse.json({ error: "Failed to remove suppression." }, { status: 500 });
  }
}
