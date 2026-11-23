/** @jest-environment node */

import { NextRequest } from "next/server";

const mockResolveHandoffActor = jest.fn();
const mockListHandoffTasks = jest.fn();
const mockGetHandoffTask = jest.fn();
const mockUpdateHandoffTask = jest.fn();
const mockVerifyHandoffTask = jest.fn();

jest.mock("@/lib/handoff/store", () => ({
  resolveHandoffActor: mockResolveHandoffActor,
  listHandoffTasks: mockListHandoffTasks,
  getHandoffTask: mockGetHandoffTask,
  updateHandoffTask: mockUpdateHandoffTask,
}));

jest.mock("@/lib/handoff/verify", () => ({
  verifyHandoffTask: mockVerifyHandoffTask,
}));

const { GET: getMcp, POST: postMcp } = require("@/app/api/mcp/route");

describe("Watchmen MCP endpoint (/api/mcp)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects unauthenticated requests with 401", async () => {
    mockResolveHandoffActor.mockResolvedValueOnce(null);
    const res = await getMcp(new NextRequest("http://localhost:3000/api/mcp"));
    expect(res.status).toBe(401);
  });

  it("handles initialize, notifications/initialized, and tools/list", async () => {
    mockResolveHandoffActor.mockResolvedValue({
      email: "dev@example.com",
      authMethod: "api_token",
      isDemoUser: false,
    });

    const initRes = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26" },
        }),
      })
    );
    const initData = await initRes.json();
    expect(initRes.status).toBe(200);
    expect(initData.result.serverInfo.name).toBe("watchmen");
    expect(initData.result.protocolVersion).toBe("2025-03-26");

    const notifRes = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      })
    );
    expect(notifRes.status).toBe(202);

    const listRes = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      })
    );
    const listData = await listRes.json();
    const names = listData.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      "watchmen_list_open_tasks",
      "watchmen_get_task",
      "watchmen_claim_task",
      "watchmen_complete_task",
      "watchmen_verify_task",
      "watchmen_list_runtime_requests",
      "watchmen_get_runtime_summary",
      "watchmen_upsert_runtime_rule",
    ]);
  });

  it("executes watchmen_list_open_tasks, watchmen_get_task, watchmen_claim_task, and watchmen_complete_task", async () => {
    mockResolveHandoffActor.mockResolvedValue({
      email: "dev@example.com",
      authMethod: "api_token",
      isDemoUser: false,
    });

    const sampleTask = {
      id: "wm_tsk_123",
      status: "open",
      severity: "critical",
      issueCount: 1,
      targetTool: "opencode",
      title: "Firewall issues",
      promptMarkdown: "# Watchmen Security Task: Firewall issues",
    };

    mockListHandoffTasks.mockResolvedValueOnce([sampleTask]);
    mockGetHandoffTask.mockResolvedValueOnce(sampleTask);
    mockUpdateHandoffTask
      .mockResolvedValueOnce({ ...sampleTask, status: "in_progress", claimedBy: "opencode" })
      .mockResolvedValueOnce({
        ...sampleTask,
        status: "completed",
        prUrl: "https://github.com/org/repo/pull/99",
      });

    const listCall = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: { name: "watchmen_list_open_tasks", arguments: { severity: "critical" } },
        }),
      })
    );
    const listJson = await listCall.json();
    expect(listJson.result.content[0].text).toContain("wm_tsk_123");
    expect(listJson.result.structuredContent.tasks).toHaveLength(1);

    const getCall = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 11,
          method: "tools/call",
          params: { name: "watchmen_get_task", arguments: { taskId: "wm_tsk_123" } },
        }),
      })
    );
    const getJson = await getCall.json();
    expect(getJson.result.content[0].text).toContain("# Watchmen Security Task");

    const claimCall = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 12,
          method: "tools/call",
          params: {
            name: "watchmen_claim_task",
            arguments: { taskId: "wm_tsk_123", claimedBy: "opencode" },
          },
        }),
      })
    );
    const claimJson = await claimCall.json();
    expect(claimJson.result.content[0].text).toContain("in_progress");

    const completeCall = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 13,
          method: "tools/call",
          params: {
            name: "watchmen_complete_task",
            arguments: {
              taskId: "wm_tsk_123",
              prUrl: "https://github.com/org/repo/pull/99",
            },
          },
        }),
      })
    );
    const completeJson = await completeCall.json();
    expect(completeJson.result.content[0].text).toContain("completed");
    expect(completeJson.result.content[0].text).toContain("pull/99");

    mockVerifyHandoffTask.mockResolvedValueOnce({
      task: { ...sampleTask, status: "completed" },
      verification: {
        verifiedAt: "2026-11-22T12:00:00.000Z",
        allResolved: true,
        resolvedCount: 1,
        remainingCount: 0,
        resolvedIds: ["fw-1"],
        remainingIds: [],
        summary: "Verified 1 issue as resolved in the latest snapshots.",
      },
    });

    const verifyCall = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 14,
          method: "tools/call",
          params: {
            name: "watchmen_verify_task",
            arguments: { taskId: "wm_tsk_123" },
          },
        }),
      })
    );
    const verifyJson = await verifyCall.json();
    expect(verifyJson.result.content[0].text).toContain("Verified 1 issue as resolved");
  });
});
