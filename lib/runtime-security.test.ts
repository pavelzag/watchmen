import {
  applyRuntimeDecision,
  classifySourceIp,
  evaluateRuntimeRules,
  normalizeAgentEventRow,
  type RuntimeRequestEvent,
  type RuntimeSecurityRule,
} from "./runtime-security";

const baseEvent: RuntimeRequestEvent = {
  id: "req-1",
  ts: "2026-08-24T00:00:00.000Z",
  sourceIp: "10.0.0.15",
  method: "GET",
  path: "/health",
  contentType: "application/json",
  statusCode: 200,
  decision: "allow",
  matchedRuleIds: [],
};

const rules: RuntimeSecurityRule[] = [
  {
    id: "delete",
    name: "DELETE method",
    enabled: true,
    action: "flag",
    condition: { kind: "method", value: "DELETE" },
    severity: "high",
  },
  {
    id: "audio",
    name: "Audio upload",
    enabled: true,
    action: "flag",
    condition: { kind: "content_type", value: "audio/wav" },
    severity: "medium",
  },
  {
    id: "body-red",
    name: "Red marker",
    enabled: true,
    action: "flag",
    condition: { kind: "body_contains", value: "red" },
    severity: "medium",
  },
  {
    id: "public",
    name: "Public source",
    enabled: true,
    action: "flag",
    condition: { kind: "source_ip_class", value: "public" },
    severity: "low",
  },
  {
    id: "admin",
    name: "Admin path",
    enabled: true,
    action: "would_block",
    condition: { kind: "path_prefix", value: "/admin" },
    severity: "critical",
  },
];

describe("runtime security rule engine", () => {
  it("matches DELETE requests", () => {
    const decision = evaluateRuntimeRules({ ...baseEvent, method: "DELETE" }, rules);
    expect(decision.action).toBe("flagged");
    expect(decision.matchedRuleIds).toContain("delete");
    expect(decision.highestSeverity).toBe("high");
  });

  it("matches content-type without parameters", () => {
    const decision = evaluateRuntimeRules({ ...baseEvent, contentType: "audio/wav; charset=binary" }, rules);
    expect(decision.action).toBe("flagged");
    expect(decision.matchedRuleIds).toContain("audio");
  });

  it("matches bounded demo body samples", () => {
    const decision = evaluateRuntimeRules({ ...baseEvent, bodySample: "color=Red" }, rules);
    expect(decision.action).toBe("flagged");
    expect(decision.matchedRuleIds).toContain("body-red");
  });

  it("does not match disabled rules", () => {
    const disabledRules = rules.map((rule) => rule.id === "delete" ? { ...rule, enabled: false } : rule);
    const decision = evaluateRuntimeRules({ ...baseEvent, method: "DELETE" }, disabledRules);
    expect(decision.matchedRuleIds).not.toContain("delete");
  });

  it("matches multiple rules and lets would_block win", () => {
    const decision = evaluateRuntimeRules({
      ...baseEvent,
      sourceIp: "203.0.113.10",
      method: "DELETE",
      path: "/admin/users",
    }, rules);

    expect(decision.action).toBe("would_block");
    expect(decision.matchedRuleIds).toEqual(expect.arrayContaining(["delete", "admin", "public"]));
    expect(decision.highestSeverity).toBe("critical");
  });

  it("classifies source IPs for public/private source rules", () => {
    expect(classifySourceIp("10.1.2.3")).toBe("private");
    expect(classifySourceIp("172.20.2.3")).toBe("private");
    expect(classifySourceIp("192.168.1.2")).toBe("private");
    expect(classifySourceIp("127.0.0.1")).toBe("loopback");
    expect(classifySourceIp("203.0.113.10")).toBe("public");
  });

  it("applies decisions back onto normalized events", () => {
    const event = applyRuntimeDecision({
      id: "req-2",
      ts: "2026-08-24T00:00:00.000Z",
      sourceIp: "203.0.113.10",
      method: "POST",
      path: "/upload",
      contentType: "audio/wav",
    }, rules);

    expect(event.decision).toBe("flagged");
    expect(event.sourceIpClass).toBe("public");
    expect(event.matchedRuleIds).toEqual(expect.arrayContaining(["audio", "public"]));
  });

  it("extracts forwarded source IP headers from agent payloads", () => {
    const event = normalizeAgentEventRow({
      id: 42,
      received_at: "2026-08-24T00:00:00.000Z",
      event: {
        method: "GET",
        path: "/api/products",
        data: "GET /api/products HTTP/1.1\r\nX-Watchmen-Source-IP: 203.0.113.42\r\n",
      },
    }, rules);

    expect(event.sourceIp).toBe("203.0.113.42");
    expect(event.sourceIpClass).toBe("public");
    expect(event.matchedRuleIds).toContain("public");
  });

  it("prefers the kernel tuple over spoofable L7 headers", () => {
    const event = normalizeAgentEventRow({
      id: 43,
      received_at: "2026-08-24T00:00:00.000Z",
      event: {
        method: "GET",
        path: "/api/products",
        sourceIp: "10.0.0.7",
        sourcePort: 45678,
        destIp: "10.0.0.9",
        data: "GET /api/products HTTP/1.1\r\nX-Forwarded-For: 203.0.113.99\r\n",
      },
    }, rules);

    expect(event.sourceIp).toBe("10.0.0.7");
    expect(event.sourceIpClass).toBe("private");
    expect(event.matchedRuleIds).not.toContain("public");
  });

  it("maps dest tuple and container identity onto destinations", () => {
    const event = normalizeAgentEventRow({
      id: 44,
      received_at: "2026-08-24T00:00:00.000Z",
      cluster_name: null,
      event: {
        method: "POST",
        path: "/checkout",
        sourceIp: "10.0.0.7",
        destIp: "10.0.1.20",
        destPort: 8080,
        containerId: "ad8b5c2e1f9a4b6c8d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e",
        hostname: "node-1",
      },
    }, rules);

    expect(event.destinationService).toBe("10.0.1.20:8080");
    expect(event.destinationWorkload).toBe("ad8b5c2e1f9a4b6c8d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e");
  });
});
