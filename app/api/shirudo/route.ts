import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import { useMockData } from "@/lib/gcp/client";
import { getMockShirudoOverview } from "@/lib/shirudo/exposure";
import {
  deleteShirudoUpatchFix,
  getShirudoOverview,
  upsertShirudoUpatchFix,
} from "@/lib/shirudo/store";

export async function GET(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (actor.isDemoUser || useMockData()) {
    return NextResponse.json({
      ...getMockShirudoOverview(),
      demoMode: true,
    });
  }

  try {
    const overview = await getShirudoOverview(actor.email);
    return NextResponse.json({ ...overview, demoMode: false });
  } catch (err) {
    console.error("[api/shirudo] GET error:", err);
    return NextResponse.json({ error: "Failed to load Shirudo fleet overview." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.isDemoUser || useMockData()) {
    return NextResponse.json(
      { error: "Modifying Shirudo shield mappings is disabled in Demo/Mock mode." },
      { status: 403 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      upatchId?: string;
      advisoryId?: string;
      treeId?: string;
      shieldKind?: "bpf_upatch" | "java_agent";
    };

    const upatchId = typeof body.upatchId === "string" ? body.upatchId.trim() : "";
    const advisoryId = typeof body.advisoryId === "string" ? body.advisoryId.trim().toUpperCase() : "";

    if (!upatchId || !advisoryId) {
      return NextResponse.json(
        { error: "Both upatchId and advisoryId (e.g. CVE-2024-3094) are required." },
        { status: 400 }
      );
    }

    const fix = await upsertShirudoUpatchFix({
      userEmail: actor.email,
      upatchId,
      advisoryId,
      treeId: typeof body.treeId === "string" ? body.treeId : "",
      shieldKind: body.shieldKind === "java_agent" ? "java_agent" : "bpf_upatch",
      source: actor.authMethod === "api_token" ? "cli" : "manual",
    });

    return NextResponse.json({ ok: true, fix });
  } catch (err) {
    console.error("[api/shirudo] POST error:", err);
    return NextResponse.json({ error: "Failed to save Shirudo shield mapping." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.isDemoUser || useMockData()) {
    return NextResponse.json(
      { error: "Modifying Shirudo shield mappings is disabled in Demo/Mock mode." },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const upatchId = searchParams.get("upatchId")?.trim() ?? "";
    const advisoryId = searchParams.get("advisoryId")?.trim().toUpperCase() ?? "";

    if (!upatchId || !advisoryId) {
      return NextResponse.json({ error: "upatchId and advisoryId query parameters are required." }, { status: 400 });
    }

    const removed = await deleteShirudoUpatchFix({
      userEmail: actor.email,
      upatchId,
      advisoryId,
    });

    if (!removed) {
      return NextResponse.json({ error: "Shield mapping not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/shirudo] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete Shirudo shield mapping." }, { status: 500 });
  }
}
