/**
 * GitHub REST API v3 wrapper for Watchmen.
 * All functions use the GitHub API with a PAT (Bearer token).
 */

const GITHUB_API = "https://api.github.com";

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Watchmen-Security",
  };
}

export interface GhRepo {
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
}

/** List all repos accessible to the token (up to 100, sorted by updated). */
export async function listRepos(token: string): Promise<GhRepo[]> {
  const res = await fetch(
    `${GITHUB_API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`,
    { headers: ghHeaders(token) }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub listRepos failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as Array<{
    full_name: string;
    name: string;
    private: boolean;
    default_branch: string;
    html_url: string;
  }>;
  return data.map((r) => ({
    full_name: r.full_name,
    name: r.name,
    private: r.private,
    default_branch: r.default_branch,
    html_url: r.html_url,
  }));
}

/** Get the HEAD commit SHA of a branch. */
export async function getDefaultBranchSha(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers: ghHeaders(token) }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub getDefaultBranchSha failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

/** Return all .tf file paths in the repo using the git trees API (recursive). */
export async function searchTfFiles(
  token: string,
  owner: string,
  repo: string,
  branch?: string
): Promise<string[]> {
  // First get the default branch SHA to resolve the tree
  let sha: string;
  if (branch) {
    sha = await getDefaultBranchSha(token, owner, repo, branch);
  } else {
    // Get default branch from repo info
    const repoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      headers: ghHeaders(token),
    });
    if (!repoRes.ok) throw new Error(`Failed to fetch repo info (${repoRes.status})`);
    const repoData = (await repoRes.json()) as { default_branch: string };
    sha = await getDefaultBranchSha(token, owner, repo, repoData.default_branch);
  }

  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    { headers: ghHeaders(token) }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub searchTfFiles failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    tree: Array<{ path: string; type: string }>;
    truncated: boolean;
  };
  return data.tree
    .filter((item) => item.type === "blob" && item.path.endsWith(".tf"))
    .map((item) => item.path);
}

/** Get the content (decoded) and current SHA of a file. */
export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch?: string
): Promise<{ content: string; sha: string }> {
  const url = new URL(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`);
  if (branch) url.searchParams.set("ref", branch);
  const res = await fetch(url.toString(), { headers: ghHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub getFileContent failed for "${path}" (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content: string; sha: string; encoding: string };
  // GitHub returns base64-encoded content with newlines
  const decoded = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
  return { content: decoded, sha: data.sha };
}

/** Create a new branch pointing to a given commit SHA. */
export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  fromSha: string
): Promise<void> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub createBranch failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

/** Update (PUT) a file on a branch with new content (base64-encoded). */
export async function updateFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  sha: string,
  message: string,
  branch: string
): Promise<void> {
  const encoded = Buffer.from(content, "utf-8").toString("base64");
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: encoded, sha, branch }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub updateFile failed for "${path}" (${res.status}): ${body.slice(0, 200)}`);
  }
}

/** Open a pull request and return its number and URL. */
export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<{ number: number; html_url: string }> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, head, base }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub createPullRequest failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { number: number; html_url: string };
  return { number: data.number, html_url: data.html_url };
}
