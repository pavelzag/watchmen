import { NextRequest, NextResponse } from "next/server";
import {
  deleteHandoffTask,
  getHandoffTask,
  resolveHandoffActor,
  updateHandoffTask,
} from "@/lib/handoff/store";
import type { HandoffTaskStatus, HandoffTool } from "@/lib/handoff/tasks";

const VALID_STATUSES = new Set<HandoffTaskStatus>([
  "open",
  "claimed",
  "in_progress",
  "completed",
  "dismissed",
]);
const VALID_TOOLS = new Set<HandoffTool>(["any", "opencode", "claude", "codex"]);

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.isDemoUser) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { id } = await context.params;
    const task = await getHandoffTask(actor.email, id);
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (err) {
    console.error("[api/handoff/tasks/[id]] GET error:", err);
    return NextResponse.json({ error: "Failed to fetch task." }, { status: 500 });
  }
}

export async function PATCH(
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
    const body = (await req.json().catch(() => ({}))) as {
      status?: HandoffTaskStatus;
      targetTool?: HandoffTool;
      prUrl?: string | null;
      sessionRef?: string | null;
      claimedBy?: string | null;
    };

    if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Invalid task status." }, { status: 400 });
    }
    if (body.targetTool !== undefined && !VALID_TOOLS.has(body.targetTool)) {
      return NextResponse.json({ error: "Invalid target tool." }, { status: 400 });
    }

    const updated = await updateHandoffTask({
      userEmail: actor.email,
      taskId: id,
      status: body.status,
      targetTool: body.targetTool,
      prUrl: body.prUrl,
      sessionRef: body.sessionRef,
      claimedBy: body.claimedBy,
    });

    if (!updated) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, task: updated });
  } catch (err) {
    console.error("[api/handoff/tasks/[id]] PATCH error:", err);
    return NextResponse.json({ error: "Failed to update task." }, { status: 500 });
  }
}

export async function DELETE(
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
    const deleted = await deleteHandoffTask(actor.email, id);
    if (!deleted) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/handoff/tasks/[id]] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete task." }, { status: 500 });
  }
}
