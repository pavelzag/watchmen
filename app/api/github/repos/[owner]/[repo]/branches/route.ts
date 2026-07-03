import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCloudCredentials } from "@/lib/credentials";
import { listBranches } from "@/lib/github/client";

interface RouteParams {
  params: Promise<{
    owner: string;
    repo: string;
  }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email;
  const { owner, repo } = await params;

  try {
    const creds = await getUserCloudCredentials(email, "github");
    if (!creds?.token) {
      return NextResponse.json(
        { error: "GitHub token not configured", tokenRequired: true },
        { status: 422 }
      );
    }

    const branches = await listBranches(creds.token, owner, repo);
    return NextResponse.json({
      branches: branches
        .map((branch) => branch.name)
        .sort((left, right) => left.localeCompare(right)),
    });
  } catch (err) {
    console.error("[api/github/repos/:owner/:repo/branches] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to list branches";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
