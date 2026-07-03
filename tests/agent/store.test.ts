/** @jest-environment node */

import { listFindingAgentRuns } from "@/lib/agent/store";
import { ensureAgentRunsTables, sql } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  ensureAgentRunsTables: jest.fn(async () => {}),
  sql: jest.fn(),
}));

const mockEnsureAgentRunsTables = ensureAgentRunsTables as jest.MockedFunction<typeof ensureAgentRunsTables>;
const mockSql = sql as jest.MockedFunction<typeof sql>;

describe("listFindingAgentRuns", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("indexes verify-fix runs by every target they cover", async () => {
    mockSql.mockResolvedValueOnce({
      rows: [
        {
          id: "agent-run-verify",
          workflow: "verify_fix",
          status: "completed",
          input: {
            targets: [
              { id: "finding-a" },
              { id: "finding-b" },
            ],
          },
          output: {
            report: "verified",
            verification: {
              ok: true,
            },
          },
          error: null,
          created_at: "2026-07-03T00:00:00.000Z",
          completed_at: "2026-07-03T00:01:00.000Z",
        },
      ],
    } as any);

    const runs = await listFindingAgentRuns({
      userEmail: "local@watchmen.dev",
      findingIds: ["finding-a", "finding-b"],
    });

    expect(mockEnsureAgentRunsTables).toHaveBeenCalled();
    expect(mockSql).toHaveBeenCalled();
    expect(runs["finding-a"]?.verify_fix?.id).toBe("agent-run-verify");
    expect(runs["finding-b"]?.verify_fix?.id).toBe("agent-run-verify");
  });
});
