import { NextResponse } from "next/server";

export const DEMO_AI_DISABLED_MESSAGE =
  "AI is disabled in demo mode. For a preview with AI functionality or real, non-fake data, email zagalsky@gmail.com.";

export function rejectDemoAi(session: { isDemoUser?: boolean } | null | undefined): NextResponse | null {
  if (!session?.isDemoUser) return null;
  return NextResponse.json({ error: DEMO_AI_DISABLED_MESSAGE }, { status: 403 });
}
