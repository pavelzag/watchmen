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
});
