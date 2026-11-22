import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import { verifyHandoffTask } from "@/lib/handoff/verify";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.isDemoUser) {
    return NextResponse.json({ error: "Disabled in Demo mode." }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { autoComplete?: boolean };
    const result = await verifyHandoffTask({
      userEmail: actor.email,
      taskId: id,
      autoComplete: body.autoComplete,
    });
    if (!result) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/handoff/tasks/[id]/verify] POST error:", err);
    return NextResponse.json({ error: "Failed to verify task." }, { status: 500 });
  }
}
