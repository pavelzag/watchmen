import {
  DEMO_RUNTIME_RULES,
  getDemoCloudLogs,
  getDemoLiveTraceEvents,
  getDemoRuntimeRequestEvents,
  getDemoTraceHistory,
} from "@/lib/mock/runtime-events";

describe("Extended demo runtime data & fake problems", () => {
  it("evaluates demo requests into allow, flagged, would_block, and blocked (403) decisions", () => {
    const events = getDemoRuntimeRequestEvents(DEMO_RUNTIME_RULES);
    expect(events.length).toBeGreaterThanOrEqual(12);

    const decisions = new Set(events.map((e) => e.decision));
    expect(decisions.has("blocked")).toBe(true);
    expect(decisions.has("would_block")).toBe(true);
    expect(decisions.has("flagged")).toBe(true);
    expect(decisions.has("allow")).toBe(true);
    expect(events.every((e) => Boolean(e.sourceGeo?.lat && e.sourceGeo?.lon))).toBe(true);
  });

  it("provides demo live trace events, trace history, and cloud logs", () => {
    const live = getDemoLiveTraceEvents();
    expect(live.length).toBeGreaterThanOrEqual(4);
    expect(live.some((e) => e.status === 403)).toBe(true);

    const history = getDemoTraceHistory();
    expect(history.length).toBeGreaterThanOrEqual(3);

    const logs = getDemoCloudLogs({ service: "web-api-gateway" });
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(logs.some((l) => l.path === "/admin/export-users" && l.status === 403)).toBe(true);
  });
});
