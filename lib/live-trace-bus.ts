import type { Client as PgClient } from "pg";

export type LiveTraceResourceKind = "cloudrun" | "vm" | "gke";

export interface LiveTraceIngressEvent {
  id: string;
  cloud: "gcp" | "aws" | "kubernetes";
  kind: LiveTraceResourceKind;
  projectId: string;
  region?: string;
  resourceName: string;
  container?: string;
  timestamp: string;
  method?: string;
  path?: string;
  status?: number;
  latency?: string;
  remoteIp?: string;
  userAgent?: string;
  rawData?: string;
  count: number;
}

type Listener = (event: LiveTraceIngressEvent) => void;

const PROCESS_ID = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
const LIVE_TRACE_CHANNEL = "watchmen_live_trace";
const listenersByUser = new Map<string, Set<Listener>>();
const recentEventsByUser = new Map<string, LiveTraceIngressEvent[]>();
const MAX_RECENT_EVENTS = 64;
// Keep in sync with LIVE_EVENT_RETENTION_MS in app/dashboard/trace/RequestTracer.tsx —
// events older than this are stale (e.g. from a source that has since been stopped)
// and must not be replayed to newly-opened streams.
const MAX_RECENT_EVENT_AGE_MS = 120_000;

let listenerClient: PgClient | null = null;
let listenerStartPromise: Promise<void> | null = null;
let liveTraceTableReady: Promise<void> | null = null;

function isPostgresLiveBusEnabled(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  if (process.env.USE_MOCK_DATA === "true" || process.env.DEMO_MODE === "true") return false;
  return Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
}

function isFresh(event: LiveTraceIngressEvent): boolean {
  const ts = Date.parse(event.timestamp);
  return Number.isNaN(ts) || Date.now() - ts < MAX_RECENT_EVENT_AGE_MS;
}

function dispatchLocal(userEmail: string, event: LiveTraceIngressEvent) {
  const push = (key: string) => {
    const recent = recentEventsByUser.get(key) ?? [];
    if (!recent.some((existing) => existing.id === event.id)) {
      recent.push(event);
      while (recent.length > MAX_RECENT_EVENTS) recent.shift();
      recentEventsByUser.set(key, recent);
    }
    const listeners = listenersByUser.get(key);
    if (listeners) listeners.forEach((l) => l(event));
  };
  push(userEmail);
  // Fan-out to global so anonymous port-forward traffic (published as "anonymous") is visible to logged-in users
  if (userEmail !== "global") push("global");
  if (userEmail !== "anonymous" && userEmail !== "global") {
    // also ensure anonymous listeners see it
    push("anonymous");
  }
}

async function ensureLiveTraceTable(): Promise<void> {
  if (!liveTraceTableReady) {
    liveTraceTableReady = (async () => {
      const { sql } = await import("@/lib/db");
      await sql`
        CREATE TABLE IF NOT EXISTS live_trace_events (
          id          TEXT NOT NULL,
          user_email  TEXT NOT NULL,
          event       JSONB NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_email, id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_live_trace_events_lookup
          ON live_trace_events (user_email, created_at DESC)
      `;
    })().catch((err) => {
      liveTraceTableReady = null;
      throw err;
    });
  }
  await liveTraceTableReady;
}

async function persistAndNotify(userEmail: string, event: LiveTraceIngressEvent): Promise<void> {
  try {
    await ensureLiveTraceTable();
    const { sql } = await import("@/lib/db");
    const payload = JSON.stringify({
      originId: PROCESS_ID,
      userEmail,
      event,
    });
    // pg_notify has an 8000-byte payload limit; strip rawData if needed for NOTIFY while DB holds full event.
    const notifyPayload = Buffer.byteLength(payload, "utf8") <= 7500
      ? payload
      : JSON.stringify({
          originId: PROCESS_ID,
          userEmail,
          event: { ...event, rawData: undefined },
        });

    await Promise.all([
      sql`
        INSERT INTO live_trace_events (id, user_email, event, created_at)
        VALUES (${event.id}, ${userEmail}, ${JSON.stringify(event)}::jsonb, NOW())
        ON CONFLICT (user_email, id) DO UPDATE
          SET event = EXCLUDED.event,
              created_at = NOW()
      `,
      sql`SELECT pg_notify(${LIVE_TRACE_CHANNEL}, ${notifyPayload})`,
    ]);

    // Best-effort retention cleanup (keep last 5 minutes)
    if (Math.random() < 0.05) {
      await sql`DELETE FROM live_trace_events WHERE created_at < NOW() - INTERVAL '5 minutes'`;
    }
  } catch (err) {
    console.warn("[live-trace-bus] Postgres notify/persist failed (continuing local-only):", err instanceof Error ? err.message : String(err));
  }
}

export async function ensureLiveTraceBusListener(): Promise<void> {
  if (!isPostgresLiveBusEnabled()) return;
  if (listenerClient) return;
  if (listenerStartPromise) return listenerStartPromise;

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) return;

  listenerStartPromise = (async () => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString });
    client.on("notification", (msg) => {
      if (msg.channel !== LIVE_TRACE_CHANNEL || !msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as {
          originId?: string;
          userEmail?: string;
          event?: LiveTraceIngressEvent;
        };
        if (!parsed.event || !parsed.userEmail) return;
        if (parsed.originId === PROCESS_ID) return;
        dispatchLocal(parsed.userEmail, parsed.event);
      } catch {
        // Ignore malformed notifications
      }
    });
    client.on("error", (err) => {
      console.warn("[live-trace-bus] Postgres LISTEN error:", err.message);
      listenerClient = null;
      listenerStartPromise = null;
      try {
        void client.end();
      } catch {}
    });
    client.on("end", () => {
      if (listenerClient === client) {
        listenerClient = null;
        listenerStartPromise = null;
      }
    });

    await client.connect();
    await client.query(`LISTEN ${LIVE_TRACE_CHANNEL}`);
    listenerClient = client;
  })().catch((err) => {
    console.warn("[live-trace-bus] Failed to start Postgres LISTEN:", err instanceof Error ? err.message : String(err));
    listenerClient = null;
    listenerStartPromise = null;
  });

  await listenerStartPromise;
}

export function publishLiveTraceEvent(userEmail: string, event: LiveTraceIngressEvent) {
  dispatchLocal(userEmail, event);
  if (isPostgresLiveBusEnabled()) {
    void persistAndNotify(userEmail, event);
  }
}

export function subscribeLiveTraceEvents(userEmail: string, listener: Listener): () => void {
  const listeners = listenersByUser.get(userEmail) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByUser.set(userEmail, listeners);

  return () => {
    const current = listenersByUser.get(userEmail);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByUser.delete(userEmail);
    }
  };
}

export function getRecentLiveTraceEvents(userEmail: string): LiveTraceIngressEvent[] {
  const own = recentEventsByUser.get(userEmail) ?? [];
  const global = recentEventsByUser.get("global") ?? [];
  const anon = userEmail !== "anonymous" && userEmail !== "global" ? (recentEventsByUser.get("anonymous") ?? []) : [];
  // Merge and dedupe by id, keep chronological
  const merged = [...global, ...anon, ...own];
  const seen = new Set<string>();
  const deduped = merged.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  // Drop stale events so a stream that just (re)connected doesn't replay traffic
  // from a source that has since stopped sending (e.g. an undeployed test app).
  return deduped.filter(isFresh).slice(-MAX_RECENT_EVENTS);
}

export async function getRecentLiveTraceEventsAsync(userEmail: string): Promise<LiveTraceIngressEvent[]> {
  const local = getRecentLiveTraceEvents(userEmail);
  if (!isPostgresLiveBusEnabled()) return local;

  try {
    await ensureLiveTraceTable();
    const { sql } = await import("@/lib/db");
    const res = await sql<{ event: LiveTraceIngressEvent }>`
      SELECT event
      FROM live_trace_events
      WHERE created_at > NOW() - INTERVAL '2 minutes'
        AND user_email IN (${userEmail}, 'global', 'anonymous')
      ORDER BY created_at ASC
      LIMIT ${MAX_RECENT_EVENTS}
    `;
    const merged = [...res.rows.map((r) => r.event), ...local];
    const seen = new Set<string>();
    const deduped = merged.filter((e) => {
      if (!e?.id || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    return deduped.filter(isFresh).slice(-MAX_RECENT_EVENTS);
  } catch (err) {
    console.warn("[live-trace-bus] Failed to query recent DB trace events:", err instanceof Error ? err.message : String(err));
    return local;
  }
}
