import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchAwsSnapshot } from "@/lib/aws";
import { sql, ensureAwsSnapshotTable } from "@/lib/db";
import { useMockAwsData } from "@/lib/aws/client";
import { getUserCloudCredentials } from "@/lib/credentials";
import type { TaskProgressEvent } from "@/lib/tasks/types";
import type { AwsSnapshot } from "@/lib/aws/types";

function sendStreamEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: unknown
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function emitProgress(
  onProgress: ((event: TaskProgressEvent) => void) | undefined,
  event: TaskProgressEvent
) {
  onProgress?.(event);
}

function summarizeAwsSnapshot(snapshot: AwsSnapshot): Record<string, number | string> {
  return {
    accounts: snapshot.accounts.length,
    regions: snapshot.regions.length,
    iamUsers: snapshot.iamUsers.length,
    iamRoles: snapshot.iamRoles.length,
    s3Buckets: snapshot.s3Buckets.length,
    eksClusters: snapshot.eksClusters.length,
    ec2Instances: snapshot.ec2Instances.length,
    lambdaFunctions: snapshot.lambdaFunctions.length,
    rdsInstances: snapshot.rdsInstances.length,
    redshiftClusters: snapshot.redshiftClusters.length,
    snsTopics: snapshot.snsTopics.length,
    secrets: snapshot.secrets.length,
    securityGroups: snapshot.securityGroups.length,
    loadBalancers: snapshot.loadBalancers.length,
  };
}

function summarizeTraceableAwsEndpoints(snapshot: AwsSnapshot): Record<string, number> {
  const internetFacingLoadBalancers = snapshot.loadBalancers.filter(
    (lb) => lb.dnsName && lb.scheme === "internet-facing" && lb.state !== "failed"
  );
  const publicEc2Instances = snapshot.ec2Instances.filter(
    (instance) => instance.state === "running" && Boolean(instance.publicIpAddress)
  );
  const lambdaFunctionUrls = snapshot.lambdaFunctions.filter((fn) => Boolean(fn.functionUrl));
  const publicEksClusters = snapshot.eksClusters.filter((cluster) => cluster.endpointPublicAccess);
  const publicEksApiEndpoints = snapshot.eksClusters.filter((cluster) => cluster.endpointPublicAccess && Boolean(cluster.endpoint));

  return {
    traceableAwsTargets: internetFacingLoadBalancers.length + publicEc2Instances.length + lambdaFunctionUrls.length + publicEksApiEndpoints.length,
    internetFacingLoadBalancers: internetFacingLoadBalancers.length,
    publicEc2Instances: publicEc2Instances.length,
    lambdaFunctionUrls: lambdaFunctionUrls.length,
    publicEksClusters: publicEksClusters.length,
    publicEksApiEndpoints: publicEksApiEndpoints.length,
    totalLoadBalancers: snapshot.loadBalancers.length,
    totalEc2Instances: snapshot.ec2Instances.length,
    totalLambdaFunctions: snapshot.lambdaFunctions.length,
    totalEksClusters: snapshot.eksClusters.length,
  };
}

function logAwsTraceDiscovery(scanId: string, mode: string, snapshot: AwsSnapshot): Record<string, number> {
  const summary = summarizeTraceableAwsEndpoints(snapshot);
  console.info(`[api/aws/scan:${scanId}] trace endpoint discovery`, {
    mode,
    ...summary,
    loadBalancerSamples: snapshot.loadBalancers.slice(0, 5).map((lb) => ({
      name: lb.name,
      region: lb.region,
      scheme: lb.scheme,
      state: lb.state,
      hasDnsName: Boolean(lb.dnsName),
      traceable: Boolean(lb.dnsName) && lb.scheme === "internet-facing" && lb.state !== "failed",
    })),
    ec2Samples: snapshot.ec2Instances.slice(0, 5).map((instance) => ({
      instanceId: instance.instanceId,
      region: instance.region,
      state: instance.state,
      hasPublicIp: Boolean(instance.publicIpAddress),
      traceable: instance.state === "running" && Boolean(instance.publicIpAddress),
    })),
    lambdaSamples: snapshot.lambdaFunctions.slice(0, 5).map((fn) => ({
      functionName: fn.functionName,
      region: fn.region,
      state: fn.state,
      hasFunctionUrl: Boolean(fn.functionUrl),
      functionUrlError: fn.functionUrlError,
      traceable: Boolean(fn.functionUrl),
    })),
    eksSamples: snapshot.eksClusters.slice(0, 5).map((cluster) => ({
      clusterName: cluster.clusterName,
      region: cluster.region,
      endpointPublicAccess: cluster.endpointPublicAccess,
      hasEndpoint: Boolean(cluster.endpoint),
    })),
  });
  return summary;
}

export async function POST(req: NextRequest) {
  const scanId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  // Demo user with browser-supplied credentials → real scan, no DB credential storage
  const body = await req.json().catch(() => ({})) as {
    stream?: boolean;
    demoCredentials?: { aws?: { accessKeyId?: string; secretAccessKey?: string; region?: string } };
  };
  const demoCreds = body?.demoCredentials?.aws;
  console.info(`[api/aws/scan:${scanId}] POST start`, {
    email,
    stream: Boolean(body.stream),
    isDemoUser: Boolean(session.isDemoUser),
    hasDemoCredentials: Boolean(demoCreds?.accessKeyId && demoCreds?.secretAccessKey),
    mockData: useMockAwsData(),
  });

  const runScan = async (onProgress?: (event: TaskProgressEvent) => void) => {
    const emit = (event: TaskProgressEvent) => {
      console.info(`[api/aws/scan:${scanId}] progress`, {
        stage: event.stage,
        message: event.message,
        completed: event.completed,
        total: event.total,
        percent: event.percent,
        metadata: event.metadata,
      });
      emitProgress(onProgress, event);
    };

    if (session.isDemoUser && demoCreds?.accessKeyId && demoCreds?.secretAccessKey) {
      emit({
        stage: "start",
        message: "Starting AWS scan with supplied demo credentials",
        percent: 0,
      });
      const snapshot = await fetchAwsSnapshot({
        accessKeyId: demoCreds.accessKeyId,
        secretAccessKey: demoCreds.secretAccessKey,
        region: demoCreds.region,
        onProgress: emit,
      });
      const snapshotSummary = summarizeAwsSnapshot(snapshot);
      const traceSummary = logAwsTraceDiscovery(scanId, "demo_credentials", snapshot);
      console.info(`[api/aws/scan:${scanId}] POST complete`, {
        mode: "demo_credentials",
        durationMs: Date.now() - startedAt,
        fetchedAt: snapshot.fetchedAt,
        ...snapshotSummary,
        ...traceSummary,
      });
      return { ok: true as const, snapshot, fetchedAt: snapshot.fetchedAt, snapshotSummary };
    }

    if (useMockAwsData() || session.isDemoUser) {
      emit({
        stage: "start",
        message: "Starting mock AWS scan",
        percent: 0,
      });
      const snapshot = await fetchAwsSnapshot({ forceMock: true, onProgress: emit });
      const snapshotSummary = summarizeAwsSnapshot(snapshot);
      const traceSummary = logAwsTraceDiscovery(scanId, "mock", snapshot);
      console.info(`[api/aws/scan:${scanId}] POST complete`, {
        mode: "mock",
        durationMs: Date.now() - startedAt,
        fetchedAt: snapshot.fetchedAt,
        ...snapshotSummary,
        ...traceSummary,
      });
      return { ok: true as const, snapshot, fetchedAt: snapshot.fetchedAt, snapshotSummary };
    }

    const awsCreds = await getUserCloudCredentials(email, "aws");
    if (!awsCreds) {
      console.info(`[api/aws/scan:${scanId}] no AWS credentials configured`, { email });
      return {
        ok: false as const,
        error: "No AWS credentials configured. Go to Settings → Cloud Credentials.",
        credentialsRequired: true,
        status: 422,
      };
    }

    emit({
      stage: "start",
      message: "Starting live AWS scan",
      percent: 0,
      metadata: { region: awsCreds.region ?? "default" },
    });

    const snapshot = await fetchAwsSnapshot({
      accessKeyId: awsCreds.accessKeyId,
      secretAccessKey: awsCreds.secretAccessKey,
      region: awsCreds.region,
      onProgress: emit,
    });

    emit({
      stage: "persist_snapshot",
      message: "Persisting AWS snapshot",
      percent: 97,
      metadata: { snapshotId: snapshot.snapshotId },
    });

    await ensureAwsSnapshotTable();
    await sql`
      INSERT INTO aws_snapshots (user_email, snapshot, fetched_at)
      VALUES (${email}, ${JSON.stringify(snapshot)}, NOW())
      ON CONFLICT (user_email) DO UPDATE
        SET snapshot = EXCLUDED.snapshot,
            fetched_at = EXCLUDED.fetched_at
    `;

    const snapshotSummary = summarizeAwsSnapshot(snapshot);
    const traceSummary = logAwsTraceDiscovery(scanId, "live", snapshot);
    console.info(`[api/aws/scan:${scanId}] POST complete`, {
      mode: "live",
      durationMs: Date.now() - startedAt,
      fetchedAt: snapshot.fetchedAt,
      ...snapshotSummary,
      ...traceSummary,
    });

    return { ok: true as const, snapshot, fetchedAt: snapshot.fetchedAt, snapshotSummary };
  };

  if (body.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => sendStreamEvent(controller, encoder, event);
        void (async () => {
          try {
            const result = await runScan((progress) => send({ type: "progress", progress }));
            if (!result.ok) send({ type: "error", scanId, error: result.error, credentialsRequired: result.credentialsRequired });
            else send({ type: "result", ...result });
          } catch (err) {
            console.error("[api/aws/scan] streamed POST error:", err);
            send({ type: "error", error: "AWS scan failed. Check server logs." });
          } finally {
            console.info(`[api/aws/scan:${scanId}] stream closed`, { durationMs: Date.now() - startedAt });
            controller.close();
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  try {
    const result = await runScan();
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, credentialsRequired: result.credentialsRequired },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/aws/scan] POST error:", err);
    return NextResponse.json({ error: "AWS scan failed. Check server logs." }, { status: 500 });
  }
}

export async function GET() {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  console.info(`[api/aws/scan:${requestId}] GET start`, {
    email,
    isDemoUser: Boolean(session.isDemoUser),
    mockData: useMockAwsData(),
  });

  // Demo user: always return mock — real snapshots are returned inline from POST and cached in sessionStorage
  if (session.isDemoUser) {
    try {
      const snapshot = await fetchAwsSnapshot({ forceMock: true });
      console.info(`[api/aws/scan:${requestId}] GET mock complete`, {
        durationMs: Date.now() - startedAt,
        fetchedAt: snapshot.fetchedAt,
      });
      return NextResponse.json({ snapshot, fetchedAt: snapshot.fetchedAt });
    } catch (err) {
      console.error("[api/aws/scan] GET mock error:", err);
      return NextResponse.json({ error: "Failed to load mock AWS data." }, { status: 500 });
    }
  }

  if (useMockAwsData()) {
    try {
      const snapshot = await fetchAwsSnapshot({ forceMock: true });
      console.info(`[api/aws/scan:${requestId}] GET mock complete`, {
        durationMs: Date.now() - startedAt,
        fetchedAt: snapshot.fetchedAt,
      });
      return NextResponse.json({ snapshot, fetchedAt: snapshot.fetchedAt });
    } catch (err) {
      console.error("[api/aws/scan] GET mock error:", err);
      return NextResponse.json({ error: "Failed to load mock AWS data." }, { status: 500 });
    }
  }

  try {
    await ensureAwsSnapshotTable();
    const result = await sql`
      SELECT snapshot, fetched_at FROM aws_snapshots WHERE user_email = ${email}
    `;

    if (result.rows.length === 0) {
      console.info(`[api/aws/scan:${requestId}] GET no snapshot`, { durationMs: Date.now() - startedAt });
      return NextResponse.json({ snapshot: null, fetchedAt: null });
    }

    const row = result.rows[0];
    console.info(`[api/aws/scan:${requestId}] GET snapshot complete`, {
      durationMs: Date.now() - startedAt,
      fetchedAt: row.fetched_at,
    });
    return NextResponse.json({ snapshot: row.snapshot, fetchedAt: row.fetched_at });
  } catch (err) {
    console.error("[api/aws/scan] GET error:", err);
    return NextResponse.json({ error: "Failed to load AWS snapshot." }, { status: 500 });
  }
}
