/** @jest-environment node */

const mockSql = jest.fn(async () => ({ rows: [] as any[] }));

jest.mock("@/lib/db", () => ({
  sql: (...args: any[]) => (mockSql as any)(...args),
  ensureAgentInstallTables: jest.fn(async () => {}),
  ensureRuntimeSecurityTables: jest.fn(async () => {}),
}));

import { NextRequest } from "next/server";
import { POST as registerVm } from "@/app/api/agents/vm/register/route";
import { GET as installVmScript } from "@/app/api/agents/vm/install/route";
import { POST as ingestAgentEvent } from "@/app/api/agents/events/route";
import { subscribeLiveTraceEvents, type LiveTraceIngressEvent } from "@/lib/live-trace-bus";

describe("GCE VM eBPF agent endpoints", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockSql.mockResolvedValue({ rows: [] });
  });

  it("validates required fields on POST /api/agents/vm/register", async () => {
    const req = new NextRequest("http://localhost:3000/api/agents/vm/register", {
      method: "POST",
      body: JSON.stringify({ projectId: "acme-dev" }),
    });
    const res = await registerVm(req);
    expect(res.status).toBe(400);
  });

  it("registers a GCE VM host in agent_hosts with provider gcp_vm", async () => {
    const req = new NextRequest("http://localhost:3000/api/agents/vm/register", {
      method: "POST",
      body: JSON.stringify({
        projectId: "acme-dev",
        zone: "europe-west3-b",
        instanceName: "cms-dev-vm",
        agentSecret: "super-secret-value",
        agentVersion: "0.3.19",
      }),
    });
    const res = await registerVm(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, agentId: "vm:acme-dev:cms-dev-vm" });
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("renders a systemd installer script from GET /api/agents/vm/install", async () => {
    const req = new NextRequest(
      "https://watchmen.acme.dev/api/agents/vm/install?project=acme-dev&zone=europe-west3-b&instance=cms-dev-vm",
    );
    const res = await installVmScript(req);
    expect(res.status).toBe(200);
    const script = await res.text();
    expect(script).toContain("AGENT_ID=\"vm:${PROJECT_ID}:${INSTANCE_NAME}\"");
    expect(script).toContain("/api/agents/vm/register");
    expect(script).toContain("WATCHMEN_REDACT_SECRETS=1");
    expect(script).toContain("watchmen-ebpf-agent.service");
  });

  it("emits kind=vm live trace events with redacted query secrets for gcp_vm hosts", async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [
          {
            id: "vm:acme-dev:cms-dev-vm",
            user_email: "pavel@acme.dev",
            provider: "gcp_vm",
            project_id: "acme-dev",
            instance_name: "cms-dev-vm",
            cluster_name: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 42, received_at: new Date() }] })
      .mockResolvedValue({ rows: [] });

    const received: LiveTraceIngressEvent[] = [];
    const unsub = subscribeLiveTraceEvents("pavel@acme.dev", (ev) => received.push(ev));

    const req = new NextRequest("http://localhost:3000/api/agents/events", {
      method: "POST",
      headers: {
        "x-watchmen-agent-id": "vm:acme-dev:cms-dev-vm",
        "x-watchmen-agent-secret": "vm-secret",
      },
      body: JSON.stringify({
        type: "http_request",
        comm: "nginx",
        method: "GET",
        path: "/preview?token=leak123&page=home",
        status: 200,
        sourceIp: "10.52.0.2",
        data: "GET /preview?token=leak123&page=home HTTP/1.1\nAuthorization: Bearer topsecret",
      }),
    });

    const res = await ingestAgentEvent(req);
    unsub();

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].cloud).toBe("gcp");
    expect(received[0].kind).toBe("vm");
    expect(received[0].resourceName).toBe("cms-dev-vm");
    expect(received[0].container).toBe("nginx");
    expect(received[0].path).toBe("/preview?token=REDACTED&page=home");
    expect(received[0].rawData).toContain("Authorization: REDACTED");
    expect(received[0].rawData).not.toContain("topsecret");
  });
});
