import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchAwsSnapshot } from "@/lib/aws";
import { useMockAwsData } from "@/lib/aws/client";
import { sql, ensureAwsSnapshotTable } from "@/lib/db";
import type { AwsSnapshot } from "@/lib/aws/types";

function summarizeTraceableAwsEndpoints(snapshot: AwsSnapshot): Record<string, number> {
  return {
    traceableAwsTargets:
      snapshot.loadBalancers.filter((lb) => lb.dnsName && lb.scheme === "internet-facing" && lb.state !== "failed").length +
      snapshot.ec2Instances.filter((instance) => instance.state === "running" && Boolean(instance.publicIpAddress)).length +
      snapshot.lambdaFunctions.filter((fn) => Boolean(fn.functionUrl)).length +
      snapshot.eksClusters.filter((cluster) => cluster.endpointPublicAccess && Boolean(cluster.endpoint)).length,
    internetFacingLoadBalancers: snapshot.loadBalancers.filter((lb) => lb.dnsName && lb.scheme === "internet-facing" && lb.state !== "failed").length,
    publicEc2Instances: snapshot.ec2Instances.filter((instance) => instance.state === "running" && Boolean(instance.publicIpAddress)).length,
    lambdaFunctionUrls: snapshot.lambdaFunctions.filter((fn) => Boolean(fn.functionUrl)).length,
    publicEksApiEndpoints: snapshot.eksClusters.filter((cluster) => cluster.endpointPublicAccess && Boolean(cluster.endpoint)).length,
    totalLoadBalancers: snapshot.loadBalancers.length,
    totalEc2Instances: snapshot.ec2Instances.length,
    totalLambdaFunctions: snapshot.lambdaFunctions.length,
    totalEksClusters: snapshot.eksClusters.length,
  };
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mock mode: return live mock data
  if (useMockAwsData() || session.isDemoUser) {
    try {
      const snapshot = await fetchAwsSnapshot({ forceMock: true });
      console.info("[api/aws/snapshot] mock snapshot served", {
        ...summarizeTraceableAwsEndpoints(snapshot),
        fetchedAt: snapshot.fetchedAt,
      });
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
    await ensureAwsSnapshotTable();
    const result = await sql`
      SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${email}
    `;

    if (result.rows.length === 0) {
      console.info("[api/aws/snapshot] no stored snapshot", { email });
      return NextResponse.json(
        { error: "No AWS snapshot found. A scan will start shortly." },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    const snapshot = row.snapshot as AwsSnapshot;
    console.info("[api/aws/snapshot] stored snapshot served", {
      email,
      fetchedAt: row.fetched_at,
      ...summarizeTraceableAwsEndpoints(snapshot),
    });
    return NextResponse.json({ ...snapshot, fetchedAt: row.fetched_at });
  } catch (err) {
    console.error("[api/aws/snapshot] error:", err);
    return NextResponse.json({ error: "Failed to fetch AWS data." }, { status: 500 });
  }
}
