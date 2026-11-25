/** @jest-environment node */

export {};

jest.mock("@/lib/db", () => ({
  sql: jest.fn(),
}));

jest.mock("@/lib/github/terraform-remediation", () => ({
  buildRemediationPlan: jest.fn(),
}));

jest.mock("@/lib/github/client", () => ({
  getDefaultBranchSha: jest.fn(),
  getFileContent: jest.fn(),
  createBranch: jest.fn(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  createPullRequest: jest.fn(),
}));

const { sql: mockFlowSql } = require("@/lib/db") as { sql: jest.Mock };
const { buildRemediationPlan: mockBuildRemediationPlan } = require("@/lib/github/terraform-remediation") as {
  buildRemediationPlan: jest.Mock;
};
const {
  getDefaultBranchSha: mockGetDefaultBranchSha,
  getFileContent: mockGetFileContent,
  createBranch: mockCreateBranch,
  updateFile: mockUpdateFile,
  createPullRequest: mockCreatePullRequest,
} = require("@/lib/github/client") as {
  getDefaultBranchSha: jest.Mock;
  getFileContent: jest.Mock;
  createBranch: jest.Mock;
  updateFile: jest.Mock;
  createPullRequest: jest.Mock;
};
const { executeTerraformPrFlow } = require("@/lib/github/terraform-pr-flow") as typeof import("@/lib/github/terraform-pr-flow");

describe("lib/github/terraform-pr-flow multi-repo mirror", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlowSql.mockResolvedValue({ rows: [] });
  });

  it("generates remediation once, creates primary PR, pushes to identical mirror repo, and skips differing mirror repo", async () => {
    const originalDockerfile = "FROM node:20-alpine\nRUN apk add --no-cache openssl=3.0.0\n";
    const fixedDockerfile = "FROM node:22-alpine\nRUN apk add --no-cache openssl=3.0.2\n";

    mockBuildRemediationPlan.mockResolvedValueOnce({
      patches: [
        {
          path: "Dockerfile",
          originalContent: originalDockerfile,
          fixedContent: fixedDockerfile,
          sha: "sha-primary-file",
          isNewFile: false,
        },
      ],
      failures: [],
      coveredTargetIds: ["cve-1"],
      uncoveredTargets: [],
      fullyAddressed: true,
      suggestedBatches: [],
      summary: "Updated Dockerfile",
    });

    mockGetDefaultBranchSha
      .mockResolvedValueOnce("sha-primary-head")
      .mockResolvedValueOnce("sha-identical-head");

    mockGetFileContent
      // Identical mirror repo (CRLF line ending variant should still match!)
      .mockResolvedValueOnce({
        content: originalDockerfile.replace(/\n/g, "\r\n"),
        sha: "sha-mirror-identical-file",
      })
      // Differing mirror repo
      .mockResolvedValueOnce({
        content: "FROM python:3.12-slim\n",
        sha: "sha-mirror-different-file",
      });

    mockCreatePullRequest
      .mockResolvedValueOnce({ number: 101, html_url: "https://github.com/org/app-dev/pull/101" })
      .mockResolvedValueOnce({ number: 202, html_url: "https://github.com/org/app-prod/pull/202" });

    const result = await executeTerraformPrFlow({
      email: "pavel@theinsite.dev",
      token: "ghp_test",
      owner: "org",
      repo: "app-dev",
      repoFullName: "org/app-dev",
      defaultBranch: "main",
      targets: [
        {
          id: "cve-1",
          kind: "container_cve",
          severity: "critical",
          title: "CVE-2026-1001: openssl",
          description: "Critical OpenSSL flaw",
          mitigations: ["Upgrade openssl"],
          projectIds: ["theinsite-dev", "theinsite-prod"],
          resourceType: "container_image",
          resourceName: "web:v1",
          searchTerms: ["Dockerfile"],
          promptDetails: ["CVE-2026-1001"],
          autoRemediable: true,
        },
      ],
      additionalRepos: [
        { repoFullName: "org/app-prod", defaultBranch: "main" },
        { repoFullName: "org/app-legacy", defaultBranch: "main" },
      ],
      aiKey: { provider: "anthropic", key: "sk-ant-test" },
    });

    // AI remediation ran only ONCE
    expect(mockBuildRemediationPlan).toHaveBeenCalledTimes(1);
    expect(result.pr).toEqual({ number: 101, html_url: "https://github.com/org/app-dev/pull/101" });
    expect(result.mirrorResults).toEqual([
      {
        repoFullName: "org/app-prod",
        defaultBranch: "main",
        status: "created",
        prNumber: 202,
        prUrl: "https://github.com/org/app-prod/pull/202",
      },
      {
        repoFullName: "org/app-legacy",
        defaultBranch: "main",
        status: "skipped",
        reason: "Code in Dockerfile differs from org/app-dev; skipped to avoid overwriting environment-specific code.",
      },
    ]);

    // updateFile called once for primary and once for identical mirror (with mirror's sha!)
    expect(mockUpdateFile).toHaveBeenCalledTimes(2);
    expect(mockUpdateFile).toHaveBeenNthCalledWith(
      2,
      "ghp_test",
      "org",
      "app-prod",
      "Dockerfile",
      fixedDockerfile,
      "sha-mirror-identical-file",
      expect.any(String),
      expect.stringMatching(/^watchmen-fix-/)
    );
    expect(mockCreateBranch).toHaveBeenCalledTimes(2);
  });
});
