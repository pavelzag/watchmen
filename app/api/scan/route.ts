import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot, extractUsers, extractServiceAccountEmails } from "@/lib/gcp";
import { sql, ensureGcpSnapshotTable } from "@/lib/db";
import { useMockData } from "@/lib/gcp/client";
import { getUserCloudCredentials } from "@/lib/credentials";
import { debugError, debugLog, withDebugTiming } from "@/lib/debug";
import type { TaskProgressEvent } from "@/lib/tasks/types";
import type { GcpSnapshot } from "@/lib/gcp/types";

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

function summarizeGcpSnapshot(snapshot: GcpSnapshot): Record<string, number | string> {
  return {
    projects: snapshot.projects.length,
    serviceAccounts: snapshot.serviceAccounts.length,
    storageBuckets: snapshot.storageBuckets.length,
    gkeClusters: snapshot.gkeClusters.length,
    vms: snapshot.vms.length,
    cloudRunServices: snapshot.cloudRunServices.length,
    cloudSqlInstances: snapshot.cloudSqlInstances.length,
    bigqueryDatasets: snapshot.bigqueryDatasets.length,
    pubsubTopics: snapshot.pubsubTopics.length,
    secrets: snapshot.secrets.length,
    firewallRules: snapshot.firewallRules.length,
    loadBalancers: snapshot.loadBalancers.length,
    scanWarnings: snapshot.scanWarnings.length,
  };
}

export async function POST(req: NextRequest) {
  const scope = "api/scan:POST";
  const scanId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.error === "RefreshAccessTokenError") {
    return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }

  // Demo user with browser-supplied credentials → real scan, no DB credential storage
  const body = await req.json().catch(() => ({})) as {
    stream?: boolean;
    demoCredentials?: { gcp?: { serviceAccountKey?: string } };
  };
  const demoGcpKey = (body as { demoCredentials?: { gcp?: { serviceAccountKey?: string } } })
    ?.demoCredentials?.gcp?.serviceAccountKey;
  debugLog(scope, "request received", {
    email,
    isDemoUser: session.isDemoUser,
    hasDemoGcpKey: Boolean(demoGcpKey),
    useMockData: useMockData(),
  });
  console.info(`[api/scan:${scanId}] POST start`, {
    email,
    stream: Boolean(body.stream),
    isDemoUser: Boolean(session.isDemoUser),
    hasDemoCredentials: Boolean(demoGcpKey),
    mockData: useMockData(),
  });

  const runScan = async (onProgress?: (event: TaskProgressEvent) => void) => {
    const emit = (event: TaskProgressEvent) => {
      console.info(`[api/scan:${scanId}] progress`, {
        stage: event.stage,
        message: event.message,
        completed: event.completed,
        total: event.total,
        percent: event.percent,
        metadata: event.metadata,
      });
      emitProgress(onProgress, event);
    };

    if (session.isDemoUser && demoGcpKey) {
      emit({
        stage: "start",
        message: "Starting GCP scan with supplied demo credentials",
        percent: 0,
      });
      const snapshot = await withDebugTiming(scope, "fetchGcpSnapshot.demo", { email }, () =>
        fetchGcpSnapshot({ serviceAccountKey: demoGcpKey, onProgress: emit })
      );
      const snapshotSummary = {
        ...summarizeGcpSnapshot(snapshot),
        credentialMode: "demo_service_account",
      };
      console.info(`[api/scan:${scanId}] POST complete`, {
        mode: "demo_credentials",
        durationMs: Date.now() - startedAt,
        fetchedAt: snapshot.fetchedAt,
        ...snapshotSummary,
      });
      return {
        ok: true as const,
        fetchedAt: snapshot.fetchedAt,
        snapshotSummary,
        snapshot: {
          ...snapshot,
          users: extractUsers(snapshot),
          serviceAccountEmails: extractServiceAccountEmails(snapshot),
          fetchedAt: snapshot.fetchedAt,
        },
      };
    }

    const isDemo = session.isDemoUser || session.user?.email === "demo@watchmen.dev";
    if (useMockData() || isDemo) {
      emit({
        stage: "start",
        message: "Starting mock GCP scan",
        percent: 0,
      });
      const snapshot = await withDebugTiming(scope, "fetchGcpSnapshot.mock", { email, isDemo }, () =>
        fetchGcpSnapshot({ forceMock: true, onProgress: emit })
      );
      const snapshotSummary = summarizeGcpSnapshot(snapshot);
      snapshotSummary.credentialMode = "mock";
      console.info(`[api/scan:${scanId}] POST complete`, {
        mode: "mock",
        durationMs: Date.now() - startedAt,
        fetchedAt: snapshot.fetchedAt,
        ...snapshotSummary,
      });
      return {
        ok: true as const,
        fetchedAt: snapshot.fetchedAt,
        snapshotSummary,
        snapshot: {
          ...snapshot,
          users: extractUsers(snapshot),
          serviceAccountEmails: extractServiceAccountEmails(snapshot),
          fetchedAt: snapshot.fetchedAt,
        },
      };
    }

    const gcpCreds = await getUserCloudCredentials(email, "gcp");
    const accessToken = session.accessToken;

    if (!gcpCreds && !accessToken) {
      console.info(`[api/scan:${scanId}] no GCP credentials configured`, { email });
      return {
        ok: false as const,
        error: "No GCP credentials configured (Service Account or Session Login Required).",
        credentialsRequired: true,
        status: 422,
      };
    }

    emit({
      stage: "start",
      message: "Starting live GCP scan",
      percent: 0,
      metadata: {
        credentialMode: gcpCreds ? "service_account" : accessToken ? "session_access_token" : "none",
      },
    });

    const snapshot = await withDebugTiming(scope, "fetchGcpSnapshot.live", {
      email,
      credentialMode: gcpCreds ? "service_account" : accessToken ? "session_access_token" : "none",
    }, () =>
      fetchGcpSnapshot({
        serviceAccountKey: gcpCreds?.serviceAccountKey as string | undefined,
        accessToken: !gcpCreds ? (accessToken as string | undefined) : undefined,
        onProgress: emit,
      })
    );

    emit({
      stage: "persist_snapshot",
      message: "Persisting GCP snapshot",
      percent: 97,
      metadata: { snapshotId: snapshot.snapshotId },
    });

    await withDebugTiming(scope, "persistSnapshot", { email, snapshotId: snapshot.snapshotId }, async () => {
      await ensureGcpSnapshotTable();
      await sql`
        INSERT INTO user_snapshots (user_email, snapshot, fetched_at)
        VALUES (${email}, ${JSON.stringify(snapshot)}, NOW())
        ON CONFLICT (user_email) DO UPDATE
          SET snapshot = EXCLUDED.snapshot,
              fetched_at = EXCLUDED.fetched_at
      `;
    });

    const credentialMode = gcpCreds ? "service_account" : accessToken ? "session_access_token" : "none";
    const snapshotSummary = {
      ...summarizeGcpSnapshot(snapshot),
      credentialMode,
    };
    console.info(`[api/scan:${scanId}] POST complete`, {
      mode: "live",
      durationMs: Date.now() - startedAt,
      fetchedAt: snapshot.fetchedAt,
      ...snapshotSummary,
    });

    return {
      ok: true as const,
      fetchedAt: snapshot.fetchedAt,
      snapshotSummary,
      snapshot: {
        ...snapshot,
        users: extractUsers(snapshot),
        serviceAccountEmails: extractServiceAccountEmails(snapshot),
        fetchedAt: snapshot.fetchedAt,
      },
    };
  };

  if (body.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => sendStreamEvent(controller, encoder, event);
        void (async () => {
          try {
            const result = await runScan((progress) => send({ type: "progress", progress }));
            if (!result.ok) {
              send({ type: "error", scanId, error: result.error, credentialsRequired: result.credentialsRequired });
            } else {
              send({ type: "result", ...result });
            }
          } catch (err) {
            debugError(scope, "streamed scan failed", err, { email });
            send({ type: "error", error: "Scan failed. Check server logs." });
          } finally {
            console.info(`[api/scan:${scanId}] stream closed`, { durationMs: Date.now() - startedAt });
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
    debugError(scope, "scan failed", err, { email });
    console.error("[api/scan] POST error:", err);
    return NextResponse.json({ error: "Scan failed. Check server logs." }, { status: 500 });
  }
}

export async function GET() {
  const scope = "api/scan:GET";
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.error === "RefreshAccessTokenError") {
    return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
  }

  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ error: "No user email in session." }, { status: 400 });
  }
  debugLog(scope, "request received", {
    email,
    isDemoUser: session.isDemoUser,
    useMockData: useMockData(),
  });

  // Demo user: always return mock — real snapshots are returned inline from POST and cached in sessionStorage
  if (session.isDemoUser) {
    try {
      const snapshot = await withDebugTiming(scope, "fetchSnapshot.demoMock", { email }, () =>
        fetchGcpSnapshot({ forceMock: true })
      );
      return NextResponse.json({
        snapshot: { ...snapshot, users: extractUsers(snapshot), serviceAccountEmails: extractServiceAccountEmails(snapshot) },
        fetchedAt: snapshot.fetchedAt,
      });
    } catch (err) {
      debugError(scope, "demo mock load failed", err, { email });
      console.error("[api/scan] GET mock error:", err);
      return NextResponse.json({ error: "Failed to load mock data." }, { status: 500 });
    }
  }

  // Non-demo mock mode
  if (useMockData()) {
    try {
      const snapshot = await withDebugTiming(scope, "fetchSnapshot.mock", { email }, () =>
        fetchGcpSnapshot({ forceMock: true })
      );
      return NextResponse.json({
        snapshot: {
          ...snapshot,
          users: extractUsers(snapshot),
          serviceAccountEmails: extractServiceAccountEmails(snapshot),
        },
        fetchedAt: snapshot.fetchedAt,
      });
    } catch (err) {
      debugError(scope, "mock load failed", err, { email });
      console.error("[api/scan] GET mock error:", err);
      return NextResponse.json({ error: "Failed to load mock data." }, { status: 500 });
    }
  }

  try {
    const result = await withDebugTiming(scope, "loadSnapshotFromDb", { email }, async () => {
      await ensureGcpSnapshotTable();
      return sql`
        SELECT snapshot, fetched_at FROM user_snapshots WHERE user_email = ${email}
      `;
    });

    if (result.rows.length === 0) {
      debugLog(scope, "no snapshot found", { email });
      return NextResponse.json({ snapshot: null, fetchedAt: null });
    }

    const row = result.rows[0];
    const snapshot = row.snapshot;

    return NextResponse.json({
      snapshot: {
        ...snapshot,
        users: extractUsers(snapshot),
        serviceAccountEmails: extractServiceAccountEmails(snapshot),
      },
      fetchedAt: row.fetched_at,
    });
  } catch (err) {
    debugError(scope, "snapshot load failed", err, { email });
    console.error("[api/scan] GET error:", err);
    return NextResponse.json({ error: "Failed to load snapshot." }, { status: 500 });
  }
}
