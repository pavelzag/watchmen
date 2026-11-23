/** @jest-environment node */

import { NextRequest } from "next/server";
import type { RuntimeRequestEvent, RuntimeSecurityRule } from "@/lib/runtime-security";

const mockResolveHandoffActor = jest.fn();
const mockAuth = jest.fn();
const mockPublishLiveTraceEvent = jest.fn();

const memoryRules = new Map<string, RuntimeSecurityRule>();
const memoryEvents = new Map<string, RuntimeRequestEvent>();

jest.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

jest.mock("@/lib/live-trace-bus", () => ({
  publishLiveTraceEvent: mockPublishLiveTraceEvent,
}));

jest.mock("@/lib/handoff/store", () => ({
  resolveHandoffActor: mockResolveHandoffActor,
}));

jest.mock("@/lib/runtime-security-store", () => {
  const actual = jest.requireActual("@/lib/runtime-security-store");
  return {
    getRuntimeSecurityRules: jest.fn(async () => Array.from(memoryRules.values())),
    getRuntimeSecurityRulesForEvaluation: jest.fn(async () => Array.from(memoryRules.values())),
    getRuntimeSecurityRule: jest.fn(async (_email: string, id: string) => memoryRules.get(id) ?? null),
    createRuntimeSecurityRule: jest.fn(async (_email: string, rule: Omit<RuntimeSecurityRule, "id"> & { id?: string }) => {
      const created: RuntimeSecurityRule = {
        ...rule,
        id: rule.id || `rule-${memoryRules.size + 1}`,
        mode: rule.mode ?? "detect",
      };
      memoryRules.set(created.id, created);
      return created;
    }),
    updateRuntimeSecurityRule: jest.fn(async (_email: string, id: string, patch: Partial<RuntimeSecurityRule>) => {
      const current = memoryRules.get(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      memoryRules.set(id, next);
      return next;
    }),
    deleteRuntimeSecurityRule: jest.fn(async (_email: string, id: string) => memoryRules.delete(id)),
    saveRuntimeRequestEvent: jest.fn(async (_email: string, event: RuntimeRequestEvent) => {
      memoryEvents.set(event.id, event);
    }),
    queryRuntimeRequestEvents: jest.fn(async (_email: string, filters: Record<string, unknown>) =>
      actual.filterRuntimeRequestEvents(Array.from(memoryEvents.values()), filters)
    ),
    getRuntimeRequestEventById: jest.fn(async (_email: string, id: string) => memoryEvents.get(id) ?? null),
    getRuntimeSecuritySummary: jest.fn(async () => {
      const events = Array.from(memoryEvents.values());
      return {
        totalRequests: events.length,
        byDecision: {
          allow: events.filter((e) => e.decision === "allow").length,
          flagged: events.filter((e) => e.decision === "flagged").length,
          would_block: events.filter((e) => e.decision === "would_block").length,
          blocked: events.filter((e) => e.decision === "blocked").length,
        },
      };
    }),
  };
});

const { GET: getRules, POST: createRule } = require("@/app/api/watchmen/v1/runtime/rules/route");
const { PATCH: patchRule, DELETE: deleteRule } = require("@/app/api/watchmen/v1/runtime/rules/[id]/route");
const { GET: getRequests, POST: postRequest } = require("@/app/api/watchmen/v1/runtime/requests/route");
const { GET: getRequestById } = require("@/app/api/watchmen/v1/runtime/requests/[id]/route");
const { GET: getAlerts } = require("@/app/api/watchmen/v1/runtime/alerts/route");
const { GET: getSummary } = require("@/app/api/watchmen/v1/runtime/summary/route");
const { POST: proxyPost } = require("@/app/api/proxy/route");
const { POST: tracePost } = require("@/app/api/trace/route");

describe("Watchmen v0.9 Runtime API & Inline Enforcement", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    memoryRules.clear();
    memoryEvents.clear();
    mockResolveHandoffActor.mockResolvedValue({
      email: "sec@example.com",
      authMethod: "api_token",
      isDemoUser: false,
      tokenId: "tok_1",
    });
    mockAuth.mockResolvedValue({
      user: { email: "sec@example.com" },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("supports rule CRUD, detect-mode would_block, enforce-mode 403 blocking, alerts, and summary", async () => {
    // 1. Create detect-mode block rule for /admin
    const createRes = await createRule(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "rule-admin",
          name: "Protect admin",
          action: "block",
          mode: "detect",
          severity: "critical",
          condition: { kind: "path_prefix", value: "/admin" },
        }),
      })
    );
    expect(createRes.status).toBe(201);

    // 2. Simulate request in detect mode -> 201 with decision=would_block
    const detectRes = await postRequest(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "req-detect-1", method: "GET", path: "/admin/users" }),
      })
    );
    const detectBody = await detectRes.json();
    expect(detectRes.status).toBe(201);
    expect(detectBody.event.decision).toBe("would_block");
    expect(detectBody.event.matchedRuleIds).toContain("rule-admin");

    // 3. Switch rule to enforce mode
    const patchRes = await patchRule(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/rules/rule-admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "enforce" }),
      }),
      { params: Promise.resolve({ id: "rule-admin" }) }
    );
    expect(patchRes.status).toBe(200);

    // 4. Simulate request in enforce mode -> HTTP 403 and decision=blocked persisted
    const blockRes = await postRequest(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "req-block-1", method: "GET", path: "/admin/users" }),
      })
    );
    const blockBody = await blockRes.json();
    expect(blockRes.status).toBe(403);
    expect(blockBody.blocked).toBe(true);
    expect(blockBody.event.decision).toBe("blocked");
    expect(blockBody.event.matchedRuleIds).toContain("rule-admin");

    // 5. Nonmatching request remains allowed
    const allowRes = await postRequest(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "req-allow-1", method: "GET", path: "/health" }),
      })
    );
    const allowBody = await allowRes.json();
    expect(allowRes.status).toBe(201);
    expect(allowBody.event.decision).toBe("allow");

    // 6. Query requests & single event & alerts & summary
    const listRes = await getRequests(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/requests?decision=blocked")
    );
    const listBody = await listRes.json();
    expect(listBody.events).toHaveLength(1);
    expect(listBody.events[0].id).toBe("req-block-1");

    const singleRes = await getRequestById(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/requests/req-block-1"),
      { params: Promise.resolve({ id: "req-block-1" }) }
    );
    const singleBody = await singleRes.json();
    expect(singleRes.status).toBe(200);
    expect(singleBody.matchedRules[0].id).toBe("rule-admin");

    const alertsRes = await getAlerts(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/alerts")
    );
    const alertsBody = await alertsRes.json();
    expect(alertsBody.total).toBe(2);

    const summaryRes = await getSummary(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/summary")
    );
    const summaryBody = await summaryRes.json();
    expect(summaryBody.byDecision.blocked).toBe(1);
    expect(summaryBody.byDecision.would_block).toBe(1);
    expect(summaryBody.byDecision.allow).toBe(1);

    const rulesRes = await getRules(new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/rules"));
    const rulesBody = await rulesRes.json();
    expect(rulesBody.rules).toHaveLength(1);
    expect(rulesBody.attackVectors.sql_injection_probe).toBeDefined();

    const delRes = await deleteRule(
      new NextRequest("http://localhost:3000/api/watchmen/v1/runtime/rules/rule-admin", { method: "DELETE" }),
      { params: Promise.resolve({ id: "rule-admin" }) }
    );
    expect(delRes.status).toBe(200);
  });

  it("blocks matching requests with HTTP 403 inline in /api/proxy and /api/trace", async () => {
    memoryRules.set("rule-rce", {
      id: "rule-rce",
      name: "Block RCE probes",
      enabled: true,
      action: "block",
      mode: "enforce",
      severity: "critical",
      condition: { kind: "known_attack_vector", value: "rce_probe" },
    });

    const mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    const proxyBlocked = await proxyPost(
      new NextRequest("http://localhost:3000/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://api.example.com/cgi-bin/test",
          method: "GET",
        }),
      })
    );
    const proxyBody = await proxyBlocked.json();
    expect(proxyBlocked.status).toBe(403);
    expect(proxyBody.blocked).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();

    const traceBlocked = await tracePost(
      new NextRequest("http://localhost:3000/api/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "trace-rce-1",
          path: "/cgi-bin/exploit",
          data: { hello: "world" },
        }),
      })
    );
    const traceBody = await traceBlocked.json();
    expect(traceBlocked.status).toBe(403);
    expect(traceBody.blocked).toBe(true);
    expect(memoryEvents.get("trace-rce-1")?.decision).toBe("blocked");
  });
});
