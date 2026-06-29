import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveAI } from "@/lib/ai/client";
import { rejectDemoAi } from "@/lib/ai/demo";
import { generateRemediation } from "@/lib/claude/remediation-processor";

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const demoBlocked = rejectDemoAi(session);
    if (demoBlocked) return demoBlocked;

    const { vulnerability, demoCredentials } = await req.json();

    if (!vulnerability) {
        return NextResponse.json({ error: "No vulnerability provided" }, { status: 400 });
    }

    try {
        let provider, apiKey;
        if (demoCredentials?.aiKey && demoCredentials?.aiProvider) {
            provider = demoCredentials.aiProvider;
            apiKey = demoCredentials.aiKey;
        } else {
            const resolved = await resolveAI(session.user.email, session.isDemoUser);
            provider = resolved.provider;
            apiKey = resolved.key;
        }

        const remediation = await generateRemediation(vulnerability, provider, apiKey);

        return NextResponse.json(remediation);
    } catch (err: any) {
        console.error("[api/remediate] error:", err);
        return NextResponse.json({ error: "Failed to generate remediation. Check server logs." }, { status: 500 });
    }
}
