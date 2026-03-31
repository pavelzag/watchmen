import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { fetchAwsSnapshot } from "@/lib/aws";
import { useMockData } from "@/lib/gcp/client";
import { useMockAwsData } from "@/lib/aws/client";
import { sql, ensureGcpSnapshotTable, ensureAwsSnapshotTable } from "@/lib/db";
import { parseTerraformState, computeGcpDrift, computeAwsDrift } from "@/lib/iac-drift";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.stateContent || typeof body.stateContent !== "string") {
    return NextResponse.json({ error: "stateContent (Terraform state JSON) is required." }, { status: 400 });
  }

  let tfResources;
  try {
    tfResources = parseTerraformState(body.stateContent);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Parse error" }, { status: 400 });
  }

  const email = session.user.email;
  const isMock = useMockData() || session.isDemoUser;
  const isAwsMock = useMockAwsData() || session.isDemoUser;

  try {
    // Load GCP snapshot
    let gcpSnapshot = null;
    if (isMock) {
      gcpSnapshot = await fetchGcpSnapshot({ forceMock: true });
    } else {
      await ensureGcpSnapshotTable();
      const result = await sql`SELECT snapshot FROM user_snapshots WHERE user_email = ${email}`;
      if (result.rows.length > 0) gcpSnapshot = result.rows[0].snapshot;
    }

    // Load AWS snapshot
    let awsSnapshot = null;
    if (isAwsMock) {
      awsSnapshot = await fetchAwsSnapshot({ forceMock: true });
    } else {
      await ensureAwsSnapshotTable();
      const result = await sql`SELECT snapshot FROM aws_snapshots WHERE user_email = ${email}`;
      if (result.rows.length > 0) awsSnapshot = result.rows[0].snapshot;
    }

    const driftItems = [
      ...(gcpSnapshot ? computeGcpDrift(tfResources, gcpSnapshot) : []),
      ...(awsSnapshot ? computeAwsDrift(tfResources, awsSnapshot) : []),
    ];

    // Sort: phantom (shadow infra) first, then orphaned
    driftItems.sort((a, b) => {
      if (a.driftType !== b.driftType) return a.driftType === "phantom" ? -1 : 1;
      return a.resourceId.localeCompare(b.resourceId);
    });

    return NextResponse.json({ driftItems, tfResourceCount: tfResources.length });
  } catch (err) {
    console.error("[api/iac-drift] error:", err);
    return NextResponse.json({ error: "Failed to compute drift." }, { status: 500 });
  }
}
