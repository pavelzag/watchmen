import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDemoUsage } from "@/lib/ai/client";

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !session.isDemoUser) {
        return NextResponse.json({ count: 0, limit: 0 });
    }

    try {
        const usage = await getDemoUsage(session.user.email);
        return NextResponse.json(usage);
    } catch (err) {
        console.error("[api/demo/usage] error:", err);
        return NextResponse.json({ error: "Failed to fetch usage" }, { status: 500 });
    }
}
