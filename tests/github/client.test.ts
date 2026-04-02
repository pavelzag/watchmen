/** @jest-environment node */

import {
  listRepos,
  getDefaultBranchSha,
  searchTfFiles,
  getFileContent,
  createBranch,
  createFile,
  updateFile,
  createPullRequest,
} from "@/lib/github/client";

const TOKEN = "test-token";
const OWNER = "owner";
const REPO = "repo";

function mockFetch(responseData: unknown, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => responseData,
    text: async () => (ok ? "" : String(responseData)),
  });
}

describe("GitHub client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. listRepos ────────────────────────────────────────────────────────────
  describe("listRepos", () => {
    it("returns repos with correct full_name values and sends Authorization header", async () => {
      const fakeRepos = [
        { full_name: "owner/repo-a", name: "repo-a", private: false, default_branch: "main", html_url: "https://github.com/owner/repo-a" },
        { full_name: "owner/repo-b", name: "repo-b", private: true, default_branch: "main", html_url: "https://github.com/owner/repo-b" },
      ];
      global.fetch = mockFetch(fakeRepos);

      const repos = await listRepos(TOKEN);

      expect(repos).toHaveLength(2);
      expect(repos[0].full_name).toBe("owner/repo-a");
      expect(repos[1].full_name).toBe("owner/repo-b");

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain("/user/repos");
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        Authorization: "Bearer test-token",
      });
    });
  });

  // ── 2. getDefaultBranchSha ─────────────────────────────────────────────────
  describe("getDefaultBranchSha", () => {
    it("returns the sha from the ref object", async () => {
      global.fetch = mockFetch({ object: { sha: "abc123def456" } });

      const sha = await getDefaultBranchSha(TOKEN, OWNER, REPO, "main");

      expect(sha).toBe("abc123def456");
    });
  });

  // ── 3. searchTfFiles ───────────────────────────────────────────────────────
  describe("searchTfFiles", () => {
    it("returns only .tf blob paths from the tree", async () => {
      const treeData = {
        tree: [
          { path: "main.tf", type: "blob" },
          { path: "modules/vpc/main.tf", type: "blob" },
          { path: "README.md", type: "blob" },
          { path: "modules", type: "tree" },
        ],
        truncated: false,
      };

      // searchTfFiles with a branch calls getDefaultBranchSha first (one fetch),
      // then fetches the git tree (second fetch).
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: "sha-head" } }),
          text: async () => "",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => treeData,
          text: async () => "",
        });

      const files = await searchTfFiles(TOKEN, OWNER, REPO, "main");

      expect(files).toEqual(["main.tf", "modules/vpc/main.tf"]);
    });

    it("uses the repository default branch when no branch is provided", async () => {
      const treeData = {
        tree: [{ path: "infra/main.tf", type: "blob" }],
        truncated: false,
      };

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ default_branch: "main" }),
          text: async () => "",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: "sha-main" } }),
          text: async () => "",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => treeData,
          text: async () => "",
        });

      const files = await searchTfFiles(TOKEN, OWNER, REPO);

      expect(files).toEqual(["infra/main.tf"]);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(`/repos/${OWNER}/${REPO}`);
    });
  });

  // ── 4. getFileContent ──────────────────────────────────────────────────────
  describe("getFileContent", () => {
    it("returns decoded content and sha", async () => {
      const originalText = 'resource "google_storage_bucket" "test" {}';
      const encoded = Buffer.from(originalText).toString("base64") + "\n";

      global.fetch = mockFetch({ content: encoded, sha: "fileSha123", encoding: "base64" });

      const { content, sha } = await getFileContent(TOKEN, OWNER, REPO, "main.tf");

      expect(content).toBe(originalText);
      expect(sha).toBe("fileSha123");
    });

    it("throws with a message containing 'File not found' on 404", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "Not found",
      });

      await expect(getFileContent(TOKEN, OWNER, REPO, "missing.tf")).rejects.toThrow(
        /missing\.tf.*404|404.*missing\.tf/i
      );
    });
  });

  // ── 5. createBranch ────────────────────────────────────────────────────────
  describe("createBranch", () => {
    it("sends POST to the git/refs endpoint with correct ref and sha", async () => {
      global.fetch = mockFetch({}, true, 201);

      await createBranch(TOKEN, OWNER, REPO, "fix/security", "deadbeef");

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain(`repos/${OWNER}/${REPO}/git/refs`);
      expect((init as RequestInit).method).toBe("POST");

      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.ref).toBe("refs/heads/fix/security");
      expect(body.sha).toBe("deadbeef");
    });
  });

  // ── 6. createFile ─────────────────────────────────────────────────────────
  describe("createFile", () => {
    it("sends PUT without sha for a new file", async () => {
      global.fetch = mockFetch({}, true, 201);

      await createFile(TOKEN, OWNER, REPO, "generated.tf", 'resource "x" "y" {}', "add file", "fix/security");

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain(`repos/${OWNER}/${REPO}/contents/generated.tf`);
      expect((init as RequestInit).method).toBe("PUT");

      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.branch).toBe("fix/security");
      expect(body.message).toBe("add file");
      expect(body.sha).toBeUndefined();
      expect(body.content).toBe(Buffer.from('resource "x" "y" {}', "utf-8").toString("base64"));
    });
  });

  // ── 7. updateFile ──────────────────────────────────────────────────────────
  describe("updateFile", () => {
    it("sends PUT with base64-encoded content", async () => {
      global.fetch = mockFetch({});

      await updateFile(TOKEN, OWNER, REPO, "main.tf", "new content", "fileSha", "fix: security", "fix/security");

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect((init as RequestInit).method).toBe("PUT");

      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toBe(Buffer.from("new content", "utf-8").toString("base64"));
      expect(body.sha).toBe("fileSha");
      expect(body.branch).toBe("fix/security");
    });
  });

  // ── 8. createPullRequest ───────────────────────────────────────────────────
  describe("createPullRequest", () => {
    it("returns number and html_url from the API response", async () => {
      global.fetch = mockFetch({ number: 42, html_url: "https://github.com/owner/repo/pull/42" });

      const pr = await createPullRequest(TOKEN, OWNER, REPO, "Fix security", "Details here", "fix/security", "main");

      expect(pr.number).toBe(42);
      expect(pr.html_url).toBe("https://github.com/owner/repo/pull/42");

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain(`repos/${OWNER}/${REPO}/pulls`);
      expect((init as RequestInit).method).toBe("POST");
    });
  });

  // ── 9. Error handling ──────────────────────────────────────────────────────
  describe("error handling", () => {
    it("throws an error containing the status code on non-ok responses", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "Not found",
      });

      await expect(getFileContent(TOKEN, OWNER, REPO, "missing.tf")).rejects.toThrow("404");
    });
  });
});
