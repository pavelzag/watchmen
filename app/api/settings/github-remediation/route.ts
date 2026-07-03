import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  deleteGithubRemediationDefaults,
  ensureGithubRemediationDefaultsTable,
  getGithubRemediationDefaults,
  saveGithubRemediationDefaults,
} from "@/lib/credentials";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureGithubRemediationDefaultsTable();
    const defaults = await getGithubRemediationDefaults(session.user.email);
    return NextResponse.json({ defaults });
  } catch (err) {
    console.error("[api/settings/github-remediation] GET error:", err);
    return NextResponse.json({ error: "Failed to load GitHub remediation defaults." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    repoFullName?: string;
    defaultBranch?: string;
    clear?: boolean;
  };

  try {
    await ensureGithubRemediationDefaultsTable();

    if (body.clear) {
      await deleteGithubRemediationDefaults(session.user.email);
      return NextResponse.json({ ok: true, defaults: null });
    }

    const repoFullName = body.repoFullName?.trim();
    const defaultBranch = body.defaultBranch?.trim();
    if (!repoFullName || !defaultBranch) {
      return NextResponse.json(
        { error: "repoFullName and defaultBranch are required." },
        { status: 400 }
      );
    }

    await saveGithubRemediationDefaults(session.user.email, repoFullName, defaultBranch);
    const defaults = await getGithubRemediationDefaults(session.user.email);
    return NextResponse.json({ ok: true, defaults });
  } catch (err) {
    console.error("[api/settings/github-remediation] PUT error:", err);
    return NextResponse.json({ error: "Failed to save GitHub remediation defaults." }, { status: 500 });
  }
}
