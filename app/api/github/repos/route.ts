import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCloudCredentials } from "@/lib/credentials";
import { listRepos } from "@/lib/github/client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email;

  try {
    const creds = await getUserCloudCredentials(email, "github");
    if (!creds?.token) {
      return NextResponse.json(
        { error: "GitHub token not configured", tokenRequired: true },
        { status: 422 }
      );
    }

    const repos = await listRepos(creds.token);
    return NextResponse.json({
      repos: repos.map((r) => ({
        full_name: r.full_name,
        default_branch: r.default_branch,
        private: r.private,
        html_url: r.html_url,
      })),
    });
  } catch (err) {
    console.error("[api/github/repos] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to list repos";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
