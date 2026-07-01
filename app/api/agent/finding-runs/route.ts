import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listFindingAgentRuns } from "@/lib/agent/store";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ids = req.nextUrl.searchParams
    .get("ids")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 300) ?? [];

  const runs = await listFindingAgentRuns({
    userEmail: session.user.email,
    findingIds: ids,
  });

  return NextResponse.json({ runs });
}
