/** @jest-environment node */

import { NextRequest } from "next/server";

const mockResolveHandoffActor = jest.fn();
const mockListHandoffTasks = jest.fn();
const mockPushHandoffTasks = jest.fn();
const mockGetHandoffTask = jest.fn();
const mockUpdateHandoffTask = jest.fn();
const mockDeleteHandoffTask = jest.fn();
const mockVerifyHandoffTask = jest.fn();

jest.mock("@/lib/handoff/store", () => ({
  resolveHandoffActor: mockResolveHandoffActor,
  listHandoffTasks: mockListHandoffTasks,
  pushHandoffTasks: mockPushHandoffTasks,
  getHandoffTask: mockGetHandoffTask,
  updateHandoffTask: mockUpdateHandoffTask,
  deleteHandoffTask: mockDeleteHandoffTask,
}));

jest.mock("@/lib/handoff/verify", () => ({
  verifyHandoffTask: mockVerifyHandoffTask,
}));

const { GET: getTasks, POST: postTasks } = require("@/app/api/handoff/tasks/route");
const { GET: getTaskById, PATCH: patchTaskById, DELETE: deleteTaskById } = require("@/app/api/handoff/tasks/[id]/route");
const { POST: verifyTaskById } = require("@/app/api/handoff/tasks/[id]/verify/route");

describe("Handoff Tasks API routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects unauthenticated GET /api/handoff/tasks", async () => {
    mockResolveHandoffActor.mockResolvedValueOnce(null);
    const req = new NextRequest("http://localhost:3000/api/handoff/tasks");
    const res = await getTasks(req);
    expect(res.status).toBe(401);
  });

  it("pushes tasks for authenticated user via POST /api/handoff/tasks", async () => {
    mockResolveHandoffActor.mockResolvedValueOnce({
      email: "dev@example.com",
      authMethod: "session",
      isDemoUser: false,
    });
    mockPushHandoffTasks.mockResolvedValueOnce({
      tasks: [{ id: "wm_tsk_1", title: "Firewall issues", status: "open" }],
      createdCount: 1,
      updatedCount: 0,
    });

    const req = new NextRequest("http://localhost:3000/api/handoff/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetTool: "opencode",
        batchMode: "grouped",
        issues: [
          {
            id: "public_firewall:proj-1:ssh",
            kind: "finding",
            cloud: "gcp",
            severity: "critical",
            title: "Firewall Rule Open to the Internet",
            description: "Allows 0.0.0.0/0",
            resourceName: "ssh",
            resourceType: "firewall_rule",
            projectId: "proj-1",
          },
        ],
      }),
    });

    const res = await postTasks(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.createdCount).toBe(1);
    expect(mockPushHandoffTasks).toHaveBeenCalledTimes(1);
  });

  it("supports API token GET and PATCH on /api/handoff/tasks/[id]", async () => {
    mockResolveHandoffActor.mockResolvedValue({
      email: "dev@example.com",
      authMethod: "api_token",
      isDemoUser: false,
      tokenId: "tok_1",
    });
    mockGetHandoffTask.mockResolvedValueOnce({
      id: "wm_tsk_1",
      status: "open",
      title: "Firewall issues",
    });
    mockUpdateHandoffTask.mockResolvedValueOnce({
      id: "wm_tsk_1",
      status: "completed",
      prUrl: "https://github.com/org/repo/pull/42",
    });
    mockDeleteHandoffTask.mockResolvedValueOnce(true);

    const getRes = await getTaskById(
      new NextRequest("http://localhost:3000/api/handoff/tasks/wm_tsk_1"),
      { params: Promise.resolve({ id: "wm_tsk_1" }) }
    );
    expect(getRes.status).toBe(200);

    const patchRes = await patchTaskById(
      new NextRequest("http://localhost:3000/api/handoff/tasks/wm_tsk_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", prUrl: "https://github.com/org/repo/pull/42" }),
      }),
      { params: Promise.resolve({ id: "wm_tsk_1" }) }
    );
    const patchData = await patchRes.json();
    expect(patchRes.status).toBe(200);
    expect(patchData.task.status).toBe("completed");

    const delRes = await deleteTaskById(
      new NextRequest("http://localhost:3000/api/handoff/tasks/wm_tsk_1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "wm_tsk_1" }) }
    );
    expect(delRes.status).toBe(200);

    mockVerifyHandoffTask.mockResolvedValueOnce({
      task: { id: "wm_tsk_1", status: "completed" },
      verification: {
        verifiedAt: "2026-11-22T12:00:00.000Z",
        allResolved: true,
        resolvedCount: 1,
        remainingCount: 0,
        resolvedIds: ["public_firewall:proj-1:ssh"],
        remainingIds: [],
        summary: "Verified 1 issue as resolved in the latest snapshots.",
      },
    });
    const verifyRes = await verifyTaskById(
      new NextRequest("http://localhost:3000/api/handoff/tasks/wm_tsk_1/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoComplete: true }),
      }),
      { params: Promise.resolve({ id: "wm_tsk_1" }) }
    );
    const verifyData = await verifyRes.json();
    expect(verifyRes.status).toBe(200);
    expect(verifyData.verification.allResolved).toBe(true);
  });
});
