import { publishLiveTraceEvent, getRecentLiveTraceEvents, subscribeLiveTraceEvents } from "@/lib/live-trace-bus";
import type { LiveTraceIngressEvent } from "@/lib/live-trace-bus";

function makeEvent(overrides: Partial<LiveTraceIngressEvent> & { id: string }): LiveTraceIngressEvent {
  return {
    cloud: "kubernetes",
    kind: "gke",
    projectId: "test-project",
    resourceName: "watchmen-shop-frontend",
    timestamp: new Date().toISOString(),
    count: 1,
    ...overrides,
  };
}

describe("live-trace-bus staleness filtering", () => {
  const user = `test-user-${Math.random()}@example.com`;

  it("does not replay events older than the retention window on a fresh connection", () => {
    const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    publishLiveTraceEvent(user, makeEvent({ id: `stale-${user}`, timestamp: staleTs }));

    const recent = getRecentLiveTraceEvents(user);
    expect(recent.find(e => e.id === `stale-${user}`)).toBeUndefined();
  });

  it("still replays genuinely recent events", () => {
    const freshTs = new Date(Date.now() - 5_000).toISOString(); // 5 seconds ago
    publishLiveTraceEvent(user, makeEvent({ id: `fresh-${user}`, timestamp: freshTs }));

    const recent = getRecentLiveTraceEvents(user);
    expect(recent.find(e => e.id === `fresh-${user}`)).toBeDefined();
  });

  it("still delivers live-published events to active subscribers regardless of age", () => {
    // A subscriber listening right now should still see an event as it's published,
    // even if (for some reason) its own timestamp is old -- the age filter only
    // applies to the backlog replayed on (re)connect, not to the live fan-out.
    const received: LiveTraceIngressEvent[] = [];
    const unsub = subscribeLiveTraceEvents(user, (e) => received.push(e));
    const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    publishLiveTraceEvent(user, makeEvent({ id: `live-push-${user}`, timestamp: staleTs }));
    unsub();

    expect(received.find(e => e.id === `live-push-${user}`)).toBeDefined();
  });
});
