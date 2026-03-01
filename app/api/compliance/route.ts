import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import { sql } from "@/lib/db";
import { runSoc2 } from "@/lib/compliance/soc2";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let snapshot;

    if (useMockData()) {
      snapshot = await fetchGcpSnapshot();
    } else {
      const result = await sql`
        SELECT snapshot FROM user_snapshots WHERE user_email = ${session.user.email}
      `;
      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: "No snapshot yet. Please wait for the initial scan." },
          { status: 404 }
        );
      }
      snapshot = result.rows[0].snapshot;
    }

    const report = runSoc2(snapshot);
    return NextResponse.json(report);
  } catch (err) {
    console.error("[api/compliance] error:", err);
    return NextResponse.json({ error: "Failed to generate compliance report." }, { status: 500 });
  }
}
