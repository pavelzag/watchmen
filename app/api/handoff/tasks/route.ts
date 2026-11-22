import { NextRequest, NextResponse } from "next/server";
import {
  listHandoffTasks,
  pushHandoffTasks,
  resolveHandoffActor,
} from "@/lib/handoff/store";
import {
  buildHandoffTaskDrafts,
  type HandoffBatchMode,
  type HandoffIssueItem,
  type HandoffTool,
} from "@/lib/handoff/tasks";

const VALID_TOOLS = new Set<HandoffTool>(["any", "opencode", "claude", "codex"]);
const VALID_BATCH_MODES = new Set<HandoffBatchMode>(["grouped", "combined", "individual"]);

export async function GET(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.isDemoUser) {
    return NextResponse.json({ tasks: [] });
  }

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "open,claimed,in_progress";
    const severity = searchParams.get("severity") ?? "all";
    const tool = searchParams.get("tool") ?? "all";
    const limitParam = Number(searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitParam) ? limitParam : 50;

    const tasks = await listHandoffTasks({
      userEmail: actor.email,
      status,
      severity,
      tool,
      limit,
    });

    return NextResponse.json({ tasks });
  } catch (err) {
    console.error("[api/handoff/tasks] GET error:", err);
    return NextResponse.json({ error: "Failed to load CLI handoff tasks." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.isDemoUser) {
    return NextResponse.json(
      { error: "Saving tasks to the Watchmen CLI queue is disabled in Demo mode. You can still copy CLI commands or download the task pack locally." },
      { status: 403 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      issues?: HandoffIssueItem[];
      batchMode?: HandoffBatchMode;
      targetTool?: HandoffTool;
    };

    const issues = Array.isArray(body.issues)
      ? body.issues.filter((item): item is HandoffIssueItem => Boolean(item?.id && item?.title && item?.resourceName))
      : [];

    if (issues.length === 0) {
      return NextResponse.json({ error: "At least one valid issue is required." }, { status: 400 });
    }

    const batchMode: HandoffBatchMode =
      body.batchMode && VALID_BATCH_MODES.has(body.batchMode) ? body.batchMode : "grouped";
    const targetTool: HandoffTool =
      body.targetTool && VALID_TOOLS.has(body.targetTool) ? body.targetTool : "any";

    const drafts = buildHandoffTaskDrafts({ issues, batchMode, targetTool });
    const origin = new URL(req.url).origin;

    const result = await pushHandoffTasks({
      userEmail: actor.email,
      drafts,
      watchmenUrl: origin,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("[api/handoff/tasks] POST error:", err);
    return NextResponse.json({ error: "Failed to push tasks to CLI queue." }, { status: 500 });
  }
}
