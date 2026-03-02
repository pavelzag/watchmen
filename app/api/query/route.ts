import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import { extractIntent, generateAnswer, extractResources } from "@/lib/claude/query-processor";
import { resolveAI } from "@/lib/ai/client";
import { sql } from "@/lib/db";

const DEMO_MODE = process.env.DEMO_MODE === "true";
const DEMO_AI_CAP = Number(process.env.DEMO_AI_CAP ?? "10");

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const query: string = body?.query?.trim();

  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Query must be at least 3 characters." }, { status: 400 });
  }
  if (query.length > 500) {
    return NextResponse.json({ error: "Query must be under 500 characters." }, { status: 400 });
  }

  // Demo mode: enforce per-session query cap via HttpOnly cookie
  let demoCookieCount = 0;
  if (DEMO_MODE) {
    const cookieStore = await cookies();
    demoCookieCount = parseInt(cookieStore.get("demo-ai-count")?.value ?? "0", 10);
    if (demoCookieCount >= DEMO_AI_CAP) {
      return NextResponse.json(
        { error: `Demo AI limit reached (${DEMO_AI_CAP} queries per session). Refresh the page or come back later.` },
        { status: 429 }
      );
    }
  }

  // Resolve the user's AI key before doing anything else
  let provider: Awaited<ReturnType<typeof resolveAI>>["provider"];
  let apiKey: string;
  try {
    const resolved = await resolveAI(session.user.email);
    provider = resolved.provider;
    apiKey = resolved.key;
  } catch {
    return NextResponse.json(
      { error: "No AI key configured. Go to Settings → AI Keys to add one." },
      { status: 422 }
    );
  }

  try {
    let snapshot;

    if (useMockData()) {
      snapshot = await fetchGcpSnapshot();
    } else {
      const result = await sql`
        SELECT snapshot FROM user_snapshots WHERE user_email = ${session.user.email}
      `;
      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: "No snapshot yet. Please wait for the initial scan." },
          { status: 404 }
        );
      }
      snapshot = result.rows[0].snapshot;
    }

    const intent = await extractIntent(query, provider, apiKey);
    const [answer, resources] = await Promise.all([
      generateAnswer(query, intent, snapshot, provider, apiKey),
      Promise.resolve(extractResources(intent, snapshot)),
    ]);

    const response = NextResponse.json({ query, intent, answer, resources, fetchedAt: snapshot.fetchedAt });

    // Increment demo cap cookie after a successful call
    if (DEMO_MODE) {
      response.cookies.set("demo-ai-count", String(demoCookieCount + 1), {
        httpOnly: true,
        maxAge: 60 * 60 * 24,
        sameSite: "lax",
        path: "/",
      });
    }

    return response;
  } catch (err) {
    console.error("[api/query] error:", err);
    return NextResponse.json({ error: "Failed to process query. Check server logs." }, { status: 500 });
  }
}
