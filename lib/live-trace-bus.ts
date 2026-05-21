export type LiveTraceResourceKind = "cloudrun" | "vm" | "gke";

export interface LiveTraceIngressEvent {
  id: string;
  cloud: "gcp";
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
  count: number;
}

type Listener = (event: LiveTraceIngressEvent) => void;

const listenersByUser = new Map<string, Set<Listener>>();
const recentEventsByUser = new Map<string, LiveTraceIngressEvent[]>();
const MAX_RECENT_EVENTS = 64;

export function publishLiveTraceEvent(userEmail: string, event: LiveTraceIngressEvent) {
  const recent = recentEventsByUser.get(userEmail) ?? [];
  recent.push(event);
  while (recent.length > MAX_RECENT_EVENTS) recent.shift();
  recentEventsByUser.set(userEmail, recent);

  const listeners = listenersByUser.get(userEmail);
  if (!listeners) return;
  listeners.forEach((listener) => listener(event));
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
  return [...(recentEventsByUser.get(userEmail) ?? [])];
}
