import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { extractIntent, generateAnswer } from "@/lib/claude/query-processor";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const query: string = body?.query?.trim();

  if (!query || query.length < 3) {
    return NextResponse.json(
      { error: "Query must be at least 3 characters." },
      { status: 400 }
    );
  }

  if (query.length > 500) {
    return NextResponse.json(
      { error: "Query must be under 500 characters." },
      { status: 400 }
    );
  }

  try {
    const [snapshot, intent] = await Promise.all([
      fetchGcpSnapshot(),
      extractIntent(query),
    ]);

    const answer = await generateAnswer(query, intent, snapshot);

    return NextResponse.json({
      query,
      intent,
      answer,
      fetchedAt: snapshot.fetchedAt,
    });
  } catch (err) {
    console.error("[api/query] error:", err);
    return NextResponse.json(
      { error: "Failed to process query. Check server logs." },
      { status: 500 }
    );
  }
}
