/** @jest-environment node */

import type { RemediationTarget } from "@/lib/github/remediation-targets";
import type { RemediationPlan } from "@/lib/github/terraform-remediation";

const mockAuth = jest.fn();
const mockEnsureCredentialsTable = jest.fn();
const mockGetUserCloudCredentials = jest.fn();
const mockListUserCloudCredentials = jest.fn();
const mockSaveUserCloudCredentials = jest.fn();
const mockListRepos = jest.fn();
const mockBuildRemediationPlan = jest.fn();
const mockResolveAI = jest.fn();
const mockGetDefaultBranchSha = jest.fn();
const mockCreateBranch = jest.fn();
const mockCreateFile = jest.fn();
const mockUpdateFile = jest.fn();
const mockCreatePullRequest = jest.fn();
const mockPostToSlack = jest.fn();
const mockSql = jest.fn();

jest.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

jest.mock("@/lib/credentials", () => ({
  ensureCredentialsTable: mockEnsureCredentialsTable,
  getUserCloudCredentials: mockGetUserCloudCredentials,
  listUserCloudCredentials: mockListUserCloudCredentials,
  saveUserCloudCredentials: mockSaveUserCloudCredentials,
}));

jest.mock("@/lib/github/client", () => ({
  listRepos: mockListRepos,
  getDefaultBranchSha: mockGetDefaultBranchSha,
  createBranch: mockCreateBranch,
  createFile: mockCreateFile,
  updateFile: mockUpdateFile,
  createPullRequest: mockCreatePullRequest,
}));

jest.mock("@/lib/github/terraform-remediation", () => ({
  buildRemediationPlan: mockBuildRemediationPlan,
}));

jest.mock("@/lib/ai/client", () => ({
  resolveAI: mockResolveAI,
}));

jest.mock("@/lib/alerting", () => ({
  postToSlack: mockPostToSlack,
}));

jest.mock("@/lib/db", () => ({
  sql: mockSql,
}));

const { GET: getRepos } = require("@/app/api/github/repos/route");
const { POST: previewTerraformPr } = require("@/app/api/github/terraform-pr/preview/route");
const { POST: createTerraformPr } = require("@/app/api/github/terraform-pr/route");
const { POST: saveCredentials } = require("@/app/api/settings/credentials/route");

const SESSION = {
  user: { email: "dev@example.com" },
};

const TARGETS: RemediationTarget[] = [
  {
    id: "finding-1",
    kind: "finding",
    severity: "critical",
    title: "Public firewall rule",
    description: "Firewall allows ingress from the internet.",
    mitigations: ["Restrict source ranges."],
    projectIds: ["proj-1"],
    resourceType: "firewall_rule",
    resourceName: "fw-open-ssh",
    searchTerms: ["fw-open-ssh", "proj-1"],
    promptDetails: ["- firewall rule fw-open-ssh"],
  },
];

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePlan(overrides: Partial<RemediationPlan> = {}): RemediationPlan {
  return {
    patches: [
      {
        path: "main.tf",
        originalContent: 'resource "google_compute_firewall" "fw-open-ssh" {}',
        fixedContent: 'resource "google_compute_firewall" "fw-open-ssh" { source_ranges = ["10.0.0.0/8"] }',
        sha: "file-sha",
      },
    ],
    failures: [],
    summary: "Prepared 1 patch.",
    ...overrides,
  };
}

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

interface StreamEvent {
  type: string;
  progress?: {
    stage?: string;
    message?: string;
    percent?: number;
  };
  ok?: boolean;
  prUrl?: string;
  prNumber?: number;
  patchCount?: number;
  patches?: unknown[];
  summary?: string;
}

describe("GitHub connectivity routes", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockAuth.mockResolvedValue(SESSION);
    mockGetUserCloudCredentials.mockResolvedValue({ token: "gh-token" });
    mockResolveAI.mockResolvedValue({ provider: "google", key: "ai-key" });
    mockSql.mockResolvedValue({ rows: [] });
  });

  describe("repo listing", () => {
    it("returns accessible repositories for the configured GitHub token", async () => {
      mockListRepos.mockResolvedValue([
        {
          full_name: "owner/repo-a",
          name: "repo-a",
          private: true,
          default_branch: "main",
          html_url: "https://github.com/owner/repo-a",
        },
      ]);

      const response = await getRepos();
      const body = await parseJson(response);

      expect(response.status).toBe(200);
      expect(body.repos).toEqual([
        {
          full_name: "owner/repo-a",
          default_branch: "main",
          private: true,
          html_url: "https://github.com/owner/repo-a",
        },
      ]);
      expect(mockGetUserCloudCredentials).toHaveBeenCalledWith("dev@example.com", "github");
      expect(mockListRepos).toHaveBeenCalledWith("gh-token");
    });

    it("returns 422 when the GitHub token is missing", async () => {
      mockGetUserCloudCredentials.mockResolvedValue(null);

      const response = await getRepos();
      const body = await parseJson(response);

      expect(response.status).toBe(422);
      expect(body).toMatchObject({
        error: "GitHub token not configured",
        tokenRequired: true,
      });
    });
  });

  describe("credential validation", () => {
    it("validates and stores GitHub credentials with the discovered login", async () => {
      mockEnsureCredentialsTable.mockResolvedValue(undefined);
      mockSaveUserCloudCredentials.mockResolvedValue(undefined);
      mockListUserCloudCredentials.mockResolvedValue([
        { provider: "github", createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" },
      ]);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ login: "octocat" }),
      } as Response);

      const response = await saveCredentials(jsonRequest("http://localhost/api/settings/credentials", {
        provider: "github",
        credentials: { token: "ghp_test" },
      }));
      const body = await parseJson(response);

      expect(response.status).toBe(200);
      expect(mockSaveUserCloudCredentials).toHaveBeenCalledWith(
        "dev@example.com",
        "github",
        expect.objectContaining({ token: "ghp_test", login: "octocat" })
      );
      expect(body).toMatchObject({ ok: true });
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.github.com/user",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer ghp_test" }),
        })
      );
    });

    it("returns 422 when GitHub token validation fails", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      } as Response);

      const response = await saveCredentials(jsonRequest("http://localhost/api/settings/credentials", {
        provider: "github",
        credentials: { token: "bad-token" },
      }));
      const body = await parseJson(response);

      expect(response.status).toBe(422);
      expect(body.error).toBe("GitHub validation failed: Invalid GitHub token");
      expect(mockSaveUserCloudCredentials).not.toHaveBeenCalled();
    });
  });

  describe("terraform preview", () => {
    it("returns remediation patches for preview requests", async () => {
      mockBuildRemediationPlan.mockResolvedValue(makePlan());

      const response = await previewTerraformPr(jsonRequest("http://localhost/api/github/terraform-pr/preview", {
        repoFullName: "owner/repo",
        defaultBranch: "main",
        targets: TARGETS,
      }));
      const body = await parseJson(response);

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        patches: makePlan().patches,
        summary: "Prepared 1 patch.",
      });
      expect(mockBuildRemediationPlan).toHaveBeenCalledWith(
        "gh-token",
        "owner",
        "repo",
        TARGETS,
        "google",
        "ai-key",
        expect.objectContaining({ scope: "api/github/terraform-pr/preview:POST" })
      );
    });

    it("streams progress and final preview results", async () => {
      mockBuildRemediationPlan.mockImplementation(async (...args: unknown[]) => {
        const options = args[6] as { onProgress?: (event: unknown) => void } | undefined;
        options?.onProgress?.({
          stage: "list_tf_files",
          message: "Found Terraform files",
          percent: 10,
        });
        return makePlan();
      });

      const response = await previewTerraformPr(jsonRequest("http://localhost/api/github/terraform-pr/preview", {
        repoFullName: "owner/repo",
        defaultBranch: "main",
        targets: TARGETS,
        stream: true,
      }));
      const raw = await response.text();
      const events = raw.trim().split("\n").map((line: string) => JSON.parse(line) as StreamEvent);

      expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
      expect(events).toEqual([
        {
          type: "progress",
          progress: {
            stage: "list_tf_files",
            message: "Found Terraform files",
            percent: 10,
          },
        },
        {
          type: "result",
          patches: makePlan().patches,
          failures: [],
          summary: "Prepared 1 patch.",
        },
      ]);
    });
  });

  describe("terraform PR creation", () => {
    it("creates a branch, commits files, and opens a pull request", async () => {
      mockBuildRemediationPlan.mockResolvedValue(makePlan());
      mockGetDefaultBranchSha.mockResolvedValue("head-sha");
      mockCreateBranch.mockResolvedValue(undefined);
      mockCreateFile.mockResolvedValue(undefined);
      mockUpdateFile.mockResolvedValue(undefined);
      mockCreatePullRequest.mockResolvedValue({
        number: 42,
        html_url: "https://github.com/owner/repo/pull/42",
      });

      const response = await createTerraformPr(jsonRequest("http://localhost/api/github/terraform-pr", {
        repoFullName: "owner/repo",
        defaultBranch: "main",
        targets: TARGETS,
      }));
      const body = await parseJson(response);

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        prUrl: "https://github.com/owner/repo/pull/42",
        prNumber: 42,
        patchCount: 1,
      });
      expect(mockGetDefaultBranchSha).toHaveBeenCalledWith("gh-token", "owner", "repo", "main");
      expect(mockCreateBranch).toHaveBeenCalled();
      expect(mockCreateFile).toHaveBeenCalledWith(
        "gh-token",
        "owner",
        "repo",
        ".terraform-originals/main-faulty.tf",
        expect.any(String),
        expect.stringContaining("preserve original main.tf"),
        expect.stringMatching(/^watchmen-fix-/)
      );
      expect(mockUpdateFile).toHaveBeenCalledWith(
        "gh-token",
        "owner",
        "repo",
        "main.tf",
        expect.any(String),
        "file-sha",
        expect.stringContaining('fix: remediate "Public firewall rule"'),
        expect.stringMatching(/^watchmen-fix-/)
      );
      expect(mockPostToSlack).not.toHaveBeenCalled();
    });

    it("streams PR creation progress and final result", async () => {
      mockBuildRemediationPlan.mockImplementation(async (...args: unknown[]) => {
        const options = args[6] as { onProgress?: (event: unknown) => void } | undefined;
        options?.onProgress?.({
          stage: "analyze_files",
          message: "Analyzing Terraform files",
          percent: 55,
        });
        return makePlan();
      });
      mockGetDefaultBranchSha.mockResolvedValue("head-sha");
      mockCreateBranch.mockResolvedValue(undefined);
      mockCreateFile.mockResolvedValue(undefined);
      mockUpdateFile.mockResolvedValue(undefined);
      mockCreatePullRequest.mockResolvedValue({
        number: 7,
        html_url: "https://github.com/owner/repo/pull/7",
      });

      const response = await createTerraformPr(jsonRequest("http://localhost/api/github/terraform-pr", {
        repoFullName: "owner/repo",
        defaultBranch: "main",
        targets: TARGETS,
        stream: true,
      }));
      const raw = await response.text();
      const events = raw.trim().split("\n").map((line: string) => JSON.parse(line) as StreamEvent);

      expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
      expect(events.some((event: StreamEvent) => event.type === "progress" && event.progress?.stage === "build_plan")).toBe(true);
      expect(events.some((event: StreamEvent) => event.type === "progress" && event.progress?.stage === "analyze_files")).toBe(true);
      expect(events.some((event: StreamEvent) => event.type === "progress" && event.progress?.stage === "complete")).toBe(true);
      expect(events).toContainEqual({
        type: "result",
        ok: true,
        prUrl: "https://github.com/owner/repo/pull/7",
        prNumber: 7,
        patchCount: 1,
        message: "Prepared 1 patch.",
        failures: [],
      });
    });

    it("returns a non-PR success payload when no patches are needed", async () => {
      mockBuildRemediationPlan.mockResolvedValue({
        patches: [],
        summary: "No Terraform files found in this repository.",
      });

      const response = await createTerraformPr(jsonRequest("http://localhost/api/github/terraform-pr", {
        repoFullName: "owner/repo",
        defaultBranch: "main",
        targets: TARGETS,
      }));
      const body = await parseJson(response);

      expect(response.status).toBe(200);
      expect(body).toEqual({
        ok: true,
        message: "No Terraform files found in this repository.",
        patchCount: 0,
      });
      expect(mockCreatePullRequest).not.toHaveBeenCalled();
    });
  });
});
