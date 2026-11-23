/** @jest-environment node */

import { NextRequest } from "next/server";
import type { RuntimeRequestEvent, RuntimeSecurityRule } from "@/lib/runtime-security";

const mockAuth = jest.fn();
const mockSql = jest.fn();
const mockEnsureAgentInstallTables = jest.fn();
const mockPublishLiveTraceEvent = jest.fn();
const mockEnsureLiveTraceBusListener = jest.fn();
const mockGetRecentLiveTraceEventsAsync = jest.fn();
const mockSubscribeLiveTraceEvents = jest.fn();
const mockVerifyPubsubPushRequest = jest.fn();
const mockListUsersForGcpStreamingProject = jest.fn();
const mockSaveUserGcpTraceSourceConfig = jest.fn();

const mockRules: RuntimeSecurityRule[] = [];
const savedRuntimeEvents: RuntimeRequestEvent[] = [];

jest.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

jest.mock("@/lib/db", () => ({
  sql: mockSql,
  ensureAgentInstallTables: mockEnsureAgentInstallTables,
}));

jest.mock("@/lib/live-trace-bus", () => ({
  publishLiveTraceEvent: mockPublishLiveTraceEvent,
  ensureLiveTraceBusListener: mockEnsureLiveTraceBusListener,
  getRecentLiveTraceEventsAsync: mockGetRecentLiveTraceEventsAsync,
  subscribeLiveTraceEvents: mockSubscribeLiveTraceEvents,
}));

jest.mock("@/lib/pubsub-auth", () => ({
  verifyPubsubPushRequest: mockVerifyPubsubPushRequest,
}));

jest.mock("@/lib/trace-source", () => ({
  listUsersForGcpStreamingProject: mockListUsersForGcpStreamingProject,
  saveUserGcpTraceSourceConfig: mockSaveUserGcpTraceSourceConfig,
}));

jest.mock("@/lib/runtime-security-store", () => ({
  getRuntimeSecurityRulesForEvaluation: jest.fn(async () => [...mockRules]),
  saveRuntimeRequestEvent: jest.fn(async (_email: string, event: RuntimeRequestEvent) => {
    savedRuntimeEvents.push(event);
  }),
}));

const { POST: tracePost } = require("@/app/api/trace/route");
const { POST: proxyPost } = require("@/app/api/proxy/route");
const { POST: agentEventsPost } = require("@/app/api/agents/events/route");
const { POST: pubsubPost } = require("@/app/api/ingest/gcp/pubsub/route");
const { GET: liveTraceGet } = require("@/app/api/trace/live/route");
const { GET: traceHistoryGet } = require("@/app/api/trace/history/route");

describe("Tracing menu incoming request pipelines", () => {
  const originalFetch = global.fetch;
  const originalProcessorUrl = process.env.PROCESSOR_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRules.length = 0;
    savedRuntimeEvents.length = 0;
    delete process.env.PROCESSOR_URL;
    mockAuth.mockResolvedValue({ user: { email: "trace-user@example.com" } });
    mockEnsureAgentInstallTables.mockResolvedValue(undefined);
    mockEnsureLiveTraceBusListener.mockResolvedValue(undefined);
    mockGetRecentLiveTraceEventsAsync.mockResolvedValue([]);
    mockSubscribeLiveTraceEvents.mockReturnValue(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalProcessorUrl !== undefined) process.env.PROCESSOR_URL = originalProcessorUrl;
    else delete process.env.PROCESSOR_URL;
  });

  describe("POST /api/trace", () => {
    it("returns 401 when unauthenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);
      const res = await tracePost(
        new NextRequest("http://localhost:3000/api/trace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { ping: true } }),
        })
      );
      expect(res.status).toBe(401);
    });

    it("processes incoming mock trace requests and persists runtime decision", async () => {
      mockRules.push({
        id: "flag-post",
        name: "Flag POST",
        enabled: true,
        action: "alert",
        mode: "detect",
        severity: "low",
        condition: { kind: "method", value: "POST" },
      });

      const res = await tracePost(
        new NextRequest("http://localhost:3000/api/trace", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "203.0.113.10",
          },
          body: JSON.stringify({ id: "trace-ok-1", data: { hello: "world" } }),
        })
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.request_id).toBe("trace-ok-1");
      expect(body.source).toBe("Mock");
      expect(savedRuntimeEvents).toHaveLength(1);
      expect(savedRuntimeEvents[0].decision).toBe("flagged");
      expect(savedRuntimeEvents[0].sourceIp).toBe("203.0.113.10");
    });

    it("forwards to PROCESSOR_URL when configured and blocks with 403 in enforce mode", async () => {
      process.env.PROCESSOR_URL = "http://processor.internal:8080";
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ processed: true }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const okRes = await tracePost(
        new NextRequest("http://localhost:3000/api/trace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "trace-proc-1", path: "/process", data: { item: 1 } }),
        })
      );
      expect(okRes.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://processor.internal:8080/process",
        expect.objectContaining({ method: "POST" })
      );

      mockRules.push({
        id: "block-admin",
        name: "Block admin",
        enabled: true,
        action: "block",
        mode: "enforce",
        severity: "critical",
        condition: { kind: "path_prefix", value: "/admin" },
      });

      mockFetch.mockClear();
      const blockedRes = await tracePost(
        new NextRequest("http://localhost:3000/api/trace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "trace-block-1", path: "/admin/export", data: {} }),
        })
      );
      expect(blockedRes.status).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(savedRuntimeEvents.find((e) => e.id === "trace-block-1")?.decision).toBe("blocked");
    });
  });

  describe("POST /api/proxy", () => {
    it("blocks SSRF metadata and private-network targets", async () => {
      const metadataRes = await proxyPost(
        new NextRequest("http://localhost:3000/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://169.254.169.254/latest/meta-data/" }),
        })
      );
      expect(metadataRes.status).toBe(400);

      const privateRes = await proxyPost(
        new NextRequest("http://localhost:3000/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://10.0.0.5/internal" }),
        })
      );
      expect(privateRes.status).toBe(400);
    });

    it("forwards allowed requests and publishes live trace events", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        text: async () => '{"ok":true}',
        headers: new Headers({ "content-type": "application/json" }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const res = await proxyPost(
        new NextRequest("http://localhost:3000/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: "https://service.example.com/api/orders?debug=1",
            method: "POST",
            body: { orderId: 123 },
            traceTarget: {
              cloud: "gcp",
              kind: "cloudrun",
              projectId: "proj-1",
              resourceName: "orders-api",
              region: "us-central1",
            },
          }),
        })
      );

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockPublishLiveTraceEvent).toHaveBeenCalledWith(
        "trace-user@example.com",
        expect.objectContaining({
          cloud: "gcp",
          kind: "cloudrun",
          projectId: "proj-1",
          resourceName: "orders-api",
          method: "POST",
          path: "/api/orders",
          status: 200,
        })
      );
    });
  });

  describe("POST /api/agents/events", () => {
    it("authenticates eBPF agent, redacts secrets, publishes live trace, and evaluates runtime policy", async () => {
      const missingRes = await agentEventsPost(
        new NextRequest("http://localhost:3000/api/agents/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "GET", path: "/health" }),
        })
      );
      expect(missingRes.status).toBe(401);

      mockSql.mockResolvedValueOnce({ rows: [] });
      const badSecretRes = await agentEventsPost(
        new NextRequest("http://localhost:3000/api/agents/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-watchmen-agent-id": "agent-1",
            "x-watchmen-agent-secret": "wrong",
          },
          body: JSON.stringify({ method: "GET", path: "/health" }),
        })
      );
      expect(badSecretRes.status).toBe(403);

      mockRules.push({
        id: "detect-sqli",
        name: "Detect SQLi",
        enabled: true,
        action: "block",
        mode: "detect",
        severity: "critical",
        condition: { kind: "known_attack_vector", value: "sql_injection_probe" },
      });

      mockSql
        .mockResolvedValueOnce({
          rows: [
            {
              id: "agent-1",
              user_email: "trace-user@example.com",
              provider: "k8s",
              project_id: "minikube",
              instance_name: "node-1",
              cluster_name: "local-kind",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 99, received_at: new Date("2026-11-23T00:00:00.000Z") }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const okRes = await agentEventsPost(
        new NextRequest("http://localhost:3000/api/agents/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-watchmen-agent-id": "agent-1",
            "x-watchmen-agent-secret": "super-secret",
          },
          body: JSON.stringify({
            type: "http_request",
            method: "GET",
            path: "/search?q=union%20select&token=secret123",
            status: 200,
            sourceIp: "198.51.100.7",
            pod: "echo-pod",
            data: "Authorization: Bearer raw-token-value\r\n",
          }),
        })
      );

      const okData = await okRes.json();
      expect(okRes.status).toBe(200);
      expect(okData).toEqual({ ok: true, durable: true });
      expect(mockPublishLiveTraceEvent).toHaveBeenCalledWith(
        "trace-user@example.com",
        expect.objectContaining({
          cloud: "kubernetes",
          kind: "gke",
          resourceName: "local-kind",
          container: "echo-pod",
        })
      );
      expect(savedRuntimeEvents).toHaveLength(1);
      expect(savedRuntimeEvents[0].path).not.toContain("secret123");
    });
  });

  describe("POST /api/ingest/gcp/pubsub", () => {
    it("normalizes Cloud Run Pub/Sub log entries and delivers live trace events", async () => {
      mockVerifyPubsubPushRequest.mockResolvedValueOnce({ ok: false, status: 401, error: "Invalid token" });
      const unauthRes = await pubsubPost(
        new NextRequest("http://localhost:3000/api/ingest/gcp/pubsub", {
          method: "POST",
          body: JSON.stringify({}),
        })
      );
      expect(unauthRes.status).toBe(401);

      mockVerifyPubsubPushRequest.mockResolvedValueOnce({ ok: true });
      mockListUsersForGcpStreamingProject.mockResolvedValueOnce([
        {
          userEmail: "trace-user@example.com",
          config: { cloud: "gcp", projectId: "prod-proj", setupState: "resources_applied" },
        },
      ]);

      const logEntry = {
        timestamp: "2026-11-23T01:00:00.000Z",
        resource: {
          type: "cloud_run_revision",
          labels: {
            project_id: "prod-proj",
            service_name: "checkout-svc",
            location: "us-central1",
          },
        },
        httpRequest: {
          requestMethod: "POST",
          requestUrl: "https://checkout.run.app/pay?api_key=leakme",
          status: 201,
          latency: "0.042s",
          remoteIp: "203.0.113.55",
        },
      };

      const encoded = Buffer.from(JSON.stringify(logEntry), "utf8").toString("base64");
      const okRes = await pubsubPost(
        new NextRequest("http://localhost:3000/api/ingest/gcp/pubsub", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: { messageId: "msg-1", data: encoded } }),
        })
      );

      const okData = await okRes.json();
      expect(okRes.status).toBe(200);
      expect(okData).toEqual({ ok: true, deliveredTo: 1, eventId: "msg-1" });
      expect(mockPublishLiveTraceEvent).toHaveBeenCalledWith(
        "trace-user@example.com",
        expect.objectContaining({
          id: "msg-1",
          cloud: "gcp",
          kind: "cloudrun",
          resourceName: "checkout-svc",
          status: 201,
        })
      );
      const publishedEvent = mockPublishLiveTraceEvent.mock.calls[0][1];
      expect(publishedEvent.path).not.toContain("leakme");
      expect(mockSaveUserGcpTraceSourceConfig).toHaveBeenCalledWith(
        "trace-user@example.com",
        expect.objectContaining({ setupState: "receiving_events" })
      );
    });
  });

  describe("GET /api/trace/live & GET /api/trace/history", () => {
    it("opens SSE stream and replays recent live trace events", async () => {
      mockGetRecentLiveTraceEventsAsync.mockResolvedValueOnce([
        {
          id: "live-1",
          cloud: "gcp",
          kind: "cloudrun",
          projectId: "proj-1",
          resourceName: "api-svc",
          timestamp: new Date().toISOString(),
          method: "GET",
          path: "/items",
          status: 200,
          count: 1,
        },
      ]);

      const res = await liveTraceGet(new NextRequest("http://localhost:3000/api/trace/live"));
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (let i = 0; i < 6 && !text.includes("api-svc"); i += 1) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value);
      }
      await reader.cancel();

      expect(text).toContain("event: ready");
      expect(text).toContain("event: trace");
      expect(text).toContain("api-svc");
    });

    it("merges durable agent_events and processor history sorted newest-first", async () => {
      const now = Date.now();
      const recentAgentTs = new Date(now - 5_000).toISOString();
      const olderProcTs = new Date(now - 20_000).toISOString();

      mockSql.mockResolvedValueOnce({
        rows: [
          {
            id: 501,
            agent_id: "agent-1",
            cluster_name: "local-kind",
            received_at: recentAgentTs,
            event: { type: "http_request", method: "GET", path: "/echo", hostname: "echo-pod" },
          },
        ],
      });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            request_id: "proc-1",
            source: "processor",
            received_at: olderProcTs,
            trace: [{ component: "Processor", action: "Processed", status: "Success", time: olderProcTs }],
          },
        ],
      }) as unknown as typeof fetch;

      const res = await traceHistoryGet(new NextRequest("http://localhost:3000/api/trace/history"));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
      expect(data[0].request_id).toBe("agent-501");
      expect(data[1].request_id).toBe("proc-1");
    });
  });
});
