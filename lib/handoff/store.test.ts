/** @jest-environment node */

const mockSql = jest.fn();
const mockEnsureHandoffTables = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  sql: mockSql,
  ensureHandoffTables: mockEnsureHandoffTables,
}));

const { getHandoffTaskSummary, listHandoffTasks } = require("@/lib/handoff/store");

describe("lib/handoff/store", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("filters by severity in SQL and orders highest-severity tasks first", async () => {
    mockSql.mockResolvedValueOnce({
      rows: [
        {
          id: "wm_tsk_crit",
          fingerprint: "fp_crit",
          title: "Container image vulnerabilities 1/695",
          target_tool: "opencode",
          batch_mode: "grouped",
          status: "open",
          severity: "critical",
          issue_count: 8,
          payload: { version: "0.9", issues: [] },
          prompt_markdown: "# Critical",
          pr_url: null,
          session_ref: null,
          claimed_by: null,
          claimed_at: null,
          completed_at: null,
          created_at: "2026-11-25T04:55:00Z",
          updated_at: "2026-11-25T04:55:00Z",
        },
      ],
    });

    const tasks = await listHandoffTasks({
      userEmail: "pavel@acme.dev",
      status: "open,claimed,in_progress",
      severity: "critical,medium",
      tool: "all",
      limit: 50,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].severity).toBe("critical");

    const [strings, ...values] = mockSql.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const queryText = strings.join("?");
    expect(queryText).toContain("CASE severity");
    expect(queryText).toContain("WHEN 'critical' THEN 4");
    expect(queryText).toContain("status = ANY(string_to_array");
    expect(queryText).toContain("severity = ANY(string_to_array");
    expect(values).toContain("pavel@acme.dev");
    expect(values).toContain("open,claimed,in_progress");
    expect(values).toContain("critical,medium");
  });

  it("aggregates total and per-severity counts across all matching tasks", async () => {
    mockSql.mockResolvedValueOnce({
      rows: [
        { severity: "critical", count: 3 },
        { severity: "high", count: 12 },
        { severity: "medium", count: 20 },
        { severity: "low", count: 660 },
      ],
    });

    const summary = await getHandoffTaskSummary({
      userEmail: "pavel@acme.dev",
      status: "open",
    });

    expect(summary).toEqual({
      total: 695,
      countsBySeverity: { critical: 3, high: 12, medium: 20, low: 660 },
    });
  });
});
