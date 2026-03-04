import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchGcpSnapshot } from "@/lib/gcp";
import { useMockData } from "@/lib/gcp/client";
import { extractIntent, generateAnswer, extractResources } from "@/lib/claude/query-processor";
import { callAI, resolveAI, type AIProvider } from "@/lib/ai/client"; // Updated import
import { sql, ensureGcpSnapshotTable } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  // Resolve the user's AI key: check body first (browser-only), then fallback to DB
  let provider: AIProvider;
  let apiKey: string;
  const browserKey = (body as any)?.demoCredentials?.aiKey;
  const browserProvider = (body as any)?.demoCredentials?.aiProvider;

  if (browserKey && browserProvider) {
    provider = browserProvider;
    apiKey = browserKey;
  } else if (session.isDemoUser) {
    return NextResponse.json(
      { error: "Demo users must provide their own API key in Settings (stored in this browser only)." },
      { status: 422 }
    );
  } else {
    try {
      const resolved = await resolveAI(session.user.email);
      provider = resolved.provider;
      apiKey = resolved.key;
    } catch {
      return NextResponse.json(
        { error: "No AI key configured. Add one in Settings." },
        { status: 422 }
      );
    }
  }

  const query: string = body?.query?.trim();

  try {
    let snapshot;

    if (useMockData() || session.isDemoUser) {
      snapshot = await fetchGcpSnapshot({ forceMock: true });
    } else {
      await ensureGcpSnapshotTable();
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

    return NextResponse.json({ query, intent, answer, resources, fetchedAt: snapshot.fetchedAt });
  } catch (err) {
    console.error("[api/query] error:", err);
    return NextResponse.json({ error: "Failed to process query. Check server logs." }, { status: 500 });
  }
}
