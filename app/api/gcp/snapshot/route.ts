import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot, extractUsers, extractServiceAccountEmails } from "@/lib/gcp";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await fetchGcpSnapshot();
    return NextResponse.json({
      ...snapshot,
      users: extractUsers(snapshot),
      serviceAccountEmails: extractServiceAccountEmails(snapshot),
    });
  } catch (err) {
    console.error("[api/gcp/snapshot] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch GCP data." },
      { status: 500 }
    );
  }
}
