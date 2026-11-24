import { NextRequest, NextResponse } from "next/server";
import { resolveHandoffActor } from "@/lib/handoff/store";
import { useMockData } from "@/lib/gcp/client";
import {
  createShirudoAttestationChallenge,
  listShirudoAttestationChallenges,
  verifyShirudoAttestationChallenge,
} from "@/lib/shirudo/store";

export async function GET(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.isDemoUser || useMockData()) {
    return NextResponse.json({ challenges: [], demoMode: true });
  }
  try {
    const challenges = await listShirudoAttestationChallenges(actor.email);
    return NextResponse.json({ challenges, demoMode: false });
  } catch (err) {
    console.error("[api/shirudo/attest] GET error:", err);
    return NextResponse.json({ error: "Failed to load attestation challenges." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.isDemoUser || useMockData()) {
    return NextResponse.json(
      { error: "TPM challenge attestation is disabled in Demo/Mock mode." },
      { status: 403 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: "issue" | "verify";
      nodeKey?: string;
      challengeId?: string;
      quote?: string;
    };

    if (body.action === "verify") {
      const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
      const quoteRaw = typeof body.quote === "string" ? body.quote.trim() : "";
      if (!challengeId || !quoteRaw) {
        return NextResponse.json({ error: "challengeId and quote are required." }, { status: 400 });
      }
      const result = await verifyShirudoAttestationChallenge({
        userEmail: actor.email,
        challengeId,
        quoteRaw,
      });
      if (!result) {
        return NextResponse.json({ error: "Attestation challenge not found." }, { status: 404 });
      }
      return NextResponse.json({ ok: result.verified, ...result });
    }

    const nodeKey = typeof body.nodeKey === "string" ? body.nodeKey.trim() : "";
    if (!nodeKey) {
      return NextResponse.json({ error: "nodeKey is required to issue a TPM challenge." }, { status: 400 });
    }

    const challenge = await createShirudoAttestationChallenge({
      userEmail: actor.email,
      nodeKey,
    });
    return NextResponse.json({
      ok: true,
      challenge,
      command: `shirudo attest --nonce=${challenge.nonce}`,
    });
  } catch (err) {
    console.error("[api/shirudo/attest] POST error:", err);
    return NextResponse.json({ error: "Failed to process TPM attestation challenge." }, { status: 500 });
  }
}
