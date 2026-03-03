import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchAwsSnapshot } from "@/lib/aws";
import { useMockAwsData } from "@/lib/aws/client";
import { sql } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mock mode: return live fixture data
  if (useMockAwsData()) {
    try {
      const snapshot = await fetchAwsSnapshot();
      return NextResponse.json(snapshot);
    } catch (err) {
      console.error("[api/aws/snapshot] mock error:", err);
      return NextResponse.json({ error: "Failed to fetch AWS data." }, { status: 500 });
    }
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  try {
    const result = await sql`
      SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${email}
    `;

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "No AWS snapshot found. A scan will start shortly." },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    return NextResponse.json({ ...row.snapshot, fetchedAt: row.fetched_at });
  } catch (err) {
    console.error("[api/aws/snapshot] error:", err);
    return NextResponse.json({ error: "Failed to fetch AWS data." }, { status: 500 });
  }
}
