import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const standard = req.nextUrl.searchParams.get("standard") ?? "soc2";

  try {
    const result = await sql`
      SELECT score, recorded_at
      FROM compliance_history
      WHERE user_email = ${session.user.email} AND standard = ${standard}
      ORDER BY recorded_at DESC
      LIMIT 30
    `;
    // Return in chronological order for charting
    const rows = result.rows.slice().reverse();
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[api/compliance/history] error:", err);
    return NextResponse.json({ error: "Failed to load compliance history." }, { status: 500 });
  }
}
