import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserCloudCredentials } from "@/lib/credentials";
import { buildRemediationPlan } from "@/lib/github/terraform-remediation";
import type { AttackPath } from "@/lib/gcp/attack-paths";

interface RequestBody {
  repoFullName: string;
  defaultBranch: string;
  paths: AttackPath[];
}

/**
 * POST /api/github/terraform-pr/preview
 * Returns the remediation plan (patches) without creating a branch or PR.
 * Used by the UI to show a diff preview before the user confirms.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { repoFullName, paths } = body;
  if (!repoFullName || !paths?.length) {
    return NextResponse.json({ error: "repoFullName and paths are required" }, { status: 400 });
  }

  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    return NextResponse.json({ error: "repoFullName must be in 'owner/repo' format" }, { status: 400 });
  }

  let creds: Record<string, string> | null = null;
  try {
    creds = await Promise.race([
      getUserCloudCredentials(email, "github"),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("DB timeout")), 8_000)
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load credentials";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  if (!creds?.token) {
    return NextResponse.json(
      { error: "GitHub token not configured", tokenRequired: true },
      { status: 422 }
    );
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not configured on the server" }, { status: 500 });
  }

  try {
    const plan = await buildRemediationPlan(creds.token, owner, repo, paths, geminiApiKey);
    return NextResponse.json({ patches: plan.patches, summary: plan.summary });
  } catch (err) {
    console.error("[api/github/terraform-pr/preview] error:", err);
    const msg = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
