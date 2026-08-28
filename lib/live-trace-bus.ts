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

const listenersByUser = new Map<string, Set<Listener>>();
const recentEventsByUser = new Map<string, LiveTraceIngressEvent[]>();
const MAX_RECENT_EVENTS = 64;
// Keep in sync with LIVE_EVENT_RETENTION_MS in app/dashboard/trace/RequestTracer.tsx —
// events older than this are stale (e.g. from a source that has since been stopped)
// and must not be replayed to newly-opened streams.
const MAX_RECENT_EVENT_AGE_MS = 120_000;

function isFresh(event: LiveTraceIngressEvent): boolean {
  const ts = Date.parse(event.timestamp);
  return Number.isNaN(ts) || Date.now() - ts < MAX_RECENT_EVENT_AGE_MS;
}

export function publishLiveTraceEvent(userEmail: string, event: LiveTraceIngressEvent) {
  const push = (key: string) => {
    const recent = recentEventsByUser.get(key) ?? [];
    recent.push(event);
    while (recent.length > MAX_RECENT_EVENTS) recent.shift();
    recentEventsByUser.set(key, recent);
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
