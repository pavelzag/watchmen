/** @jest-environment node */

import { createHash } from "crypto";
import { NextRequest } from "next/server";

const mockSql = jest.fn();
const mockEnsureHandoffTables = jest.fn();
const mockEnsureGcpSnapshotTable = jest.fn();
const mockEnsureAwsSnapshotTable = jest.fn();
const mockAuth = jest.fn();
const mockResolveAI = jest.fn();
const mockComputeFindings = jest.fn();
const mockComputeAwsFindings = jest.fn();
const mockComputeAttackPaths = jest.fn();
const mockRunSoc2 = jest.fn();
const mockRunIso27001 = jest.fn();
const mockRunAwsSoc2 = jest.fn();
const mockRunAwsIso27001 = jest.fn();

jest.mock("@/lib/db", () => ({
  sql: mockSql,
  ensureHandoffTables: mockEnsureHandoffTables,
  ensureGcpSnapshotTable: mockEnsureGcpSnapshotTable,
  ensureAwsSnapshotTable: mockEnsureAwsSnapshotTable,
}));

jest.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

jest.mock("@/lib/ai/client", () => ({
  resolveAI: mockResolveAI,
}));

jest.mock("@/lib/findings", () => ({
  computeFindings: mockComputeFindings,
}));

jest.mock("@/lib/aws-findings", () => ({
  computeAwsFindings: mockComputeAwsFindings,
}));

jest.mock("@/lib/gcp/attack-paths", () => ({
  computeAttackPaths: mockComputeAttackPaths,
}));

jest.mock("@/lib/compliance/soc2", () => ({
  runSoc2: mockRunSoc2,
}));

jest.mock("@/lib/compliance/iso27001", () => ({
  runIso27001: mockRunIso27001,
}));

jest.mock("@/lib/compliance/aws-soc2", () => ({
  runAwsSoc2: mockRunAwsSoc2,
}));

jest.mock("@/lib/compliance/aws-iso27001", () => ({
  runAwsIso27001: mockRunAwsIso27001,
}));

const { pushHandoffTasks, resolveHandoffActor } = require("@/lib/handoff/store");
const { buildHandoffTaskDrafts, handoffIssueFromComplianceControl } = require("@/lib/handoff/tasks");
const { verifyHandoffTask } = require("@/lib/handoff/verify");

describe("Handoff store, token auth, and closed-loop verification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureHandoffTables.mockResolvedValue(undefined);
    mockEnsureGcpSnapshotTable.mockResolvedValue(undefined);
    mockEnsureAwsSnapshotTable.mockResolvedValue(undefined);
    mockComputeFindings.mockReturnValue([]);
    mockComputeAwsFindings.mockReturnValue([]);
    mockComputeAttackPaths.mockReturnValue([]);
    mockRunSoc2.mockReturnValue({ categories: [] });
    mockRunIso27001.mockReturnValue({ categories: [] });
    mockRunAwsSoc2.mockReturnValue({ categories: [] });
    mockRunAwsIso27001.mockReturnValue({ categories: [] });
    mockResolveAI.mockRejectedValue(new Error("NO_KEY"));
  });

  it("authenticates Bearer wm_... API tokens via SHA-256 hash lookup and updates last_used_at", async () => {
    const rawToken = "wm_abcdef1234567890abcdef1234567890";
    const expectedHash = createHash("sha256").update(rawToken).digest("hex");

    mockSql
      .mockResolvedValueOnce({ rows: [{ id: "tok_1", user_email: "cli@example.com" }] })
      .mockResolvedValueOnce({ rows: [] });

    const req = new NextRequest("http://localhost:3000/api/handoff/tasks", {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    const actor = await resolveHandoffActor(req);

    expect(actor).toEqual({
      email: "cli@example.com",
      authMethod: "api_token",
      isDemoUser: false,
      tokenId: "tok_1",
    });
    expect(mockSql.mock.calls[0][1]).toBe(expectedHash);

    mockSql.mockResolvedValueOnce({ rows: [] });
    const badReq = new NextRequest("http://localhost:3000/api/handoff/tasks", {
      headers: { Authorization: "Bearer wm_invalidtoken" },
    });
    expect(await resolveHandoffActor(badReq)).toBeNull();
  });

  it("updates existing open task on duplicate fingerprint instead of creating duplicates", async () => {
    const drafts = buildHandoffTaskDrafts({
      issues: [
        {
          id: "public_firewall:proj-1:ssh",
          kind: "finding",
          cloud: "gcp",
          severity: "critical",
          title: "Open SSH",
          description: "Allows 0.0.0.0/0",
          resourceName: "ssh",
          projectId: "proj-1",
        },
      ],
      batchMode: "grouped",
      targetTool: "opencode",
    });

    const existingRow = {
      id: "wm_tsk_existing",
      fingerprint: drafts[0].fingerprint,
      title: drafts[0].title,
      target_tool: "opencode",
      batch_mode: "grouped",
      status: "open",
      severity: "critical",
      issue_count: 1,
      payload: drafts[0].payload,
      prompt_markdown: drafts[0].promptMarkdown,
      pr_url: null,
      session_ref: null,
      claimed_by: null,
      claimed_at: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockSql
      .mockResolvedValueOnce({ rows: [{ id: "wm_tsk_existing" }] })
      .mockResolvedValueOnce({ rows: [existingRow] });

    const result = await pushHandoffTasks({
      userEmail: "dev@example.com",
      drafts,
      watchmenUrl: "https://watchmen.example.com",
    });

    expect(result.createdCount).toBe(0);
    expect(result.updatedCount).toBe(1);
    expect(result.tasks[0].id).toBe("wm_tsk_existing");
  });

  it("refuses to mark task resolved when required cloud snapshot is missing", async () => {
    const taskRow = {
      id: "wm_tsk_1",
      fingerprint: "fp_1",
      title: "Firewall issues",
      target_tool: "opencode",
      batch_mode: "grouped",
      status: "open",
      severity: "critical",
      issue_count: 1,
      payload: {
        version: "0.9",
        category: "firewall",
        batchMode: "grouped",
        targetTool: "opencode",
        clouds: ["gcp"],
        projectIds: ["proj-1"],
        issues: [
          {
            id: "public_firewall:proj-1:ssh",
            kind: "finding",
            cloud: "gcp",
            severity: "critical",
            title: "Open SSH",
            description: "0.0.0.0/0",
            resourceName: "ssh",
            projectId: "proj-1",
          },
        ],
      },
      prompt_markdown: "# Prompt",
      pr_url: null,
      session_ref: null,
      claimed_by: null,
      claimed_at: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockSql
      .mockResolvedValueOnce({ rows: [taskRow] }) // getHandoffTask
      .mockResolvedValueOnce({ rows: [] })        // user_snapshots (empty!)
      .mockResolvedValueOnce({ rows: [] })        // aws_snapshots
      .mockResolvedValueOnce({ rows: [taskRow] }) // getHandoffTask inside saveHandoffTaskVerification
      .mockResolvedValueOnce({ rows: [taskRow] }); // UPDATE cli_handoff_tasks

    const verified = await verifyHandoffTask({ userEmail: "dev@example.com", taskId: "wm_tsk_1" });
    expect(verified?.verification.allResolved).toBe(false);
    expect(verified?.verification.summary).toContain("run a fresh GCP/AWS scan");
  });

  it("verifies compliance control resolution deterministically and auto-completes task", async () => {
    const issue = handoffIssueFromComplianceControl({
      id: "gcp:CC6.7.a",
      title: "Restrict firewall ingress",
      description: "No 0.0.0.0/0",
      status: "fail",
      impact: "critical",
      evidence: [{ name: "allow-ssh", projectId: "proj-1" }],
      remediationHint: "Remove 0.0.0.0/0",
    });

    const taskRow = {
      id: "wm_tsk_comp",
      fingerprint: "fp_comp",
      title: "Compliance task",
      target_tool: "claude",
      batch_mode: "grouped",
      status: "in_progress",
      severity: "critical",
      issue_count: 1,
      payload: {
        version: "0.9",
        category: "other",
        batchMode: "grouped",
        targetTool: "claude",
        clouds: ["gcp"],
        projectIds: ["proj-1"],
        issues: [issue],
      },
      prompt_markdown: "# Prompt",
      pr_url: null,
      session_ref: null,
      claimed_by: "claude",
      claimed_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Latest snapshot reports CC6.7.a is now passing!
    mockRunSoc2.mockReturnValueOnce({
      categories: [
        {
          id: "CC6.7",
          name: "Network",
          controls: [{ id: "CC6.7.a", status: "pass" }],
        },
      ],
    });

    mockSql
      .mockResolvedValueOnce({ rows: [taskRow] })
      .mockResolvedValueOnce({ rows: [{ snapshot: { projects: [] }, fetched_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [taskRow] })
      .mockResolvedValueOnce({ rows: [{ ...taskRow, status: "completed" }] });

    const verified = await verifyHandoffTask({ userEmail: "dev@example.com", taskId: "wm_tsk_comp" });
    expect(verified?.verification.allResolved).toBe(true);
    expect(verified?.verification.resolvedIds).toEqual(["gcp:CC6.7.a"]);
    expect(verified?.task.status).toBe("completed");
  });
});
