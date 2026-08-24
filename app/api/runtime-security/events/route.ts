import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listRuntimeRequestEvents } from "@/lib/runtime-security-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 100, 200);
  const events = await listRuntimeRequestEvents(session.user.email, limit);

  return NextResponse.json({
    events,
    summary: {
      total: events.length,
      flagged: events.filter((event) => event.decision === "flagged").length,
      wouldBlock: events.filter((event) => event.decision === "would_block").length,
    },
  });
}
