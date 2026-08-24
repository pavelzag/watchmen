import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { applyRuntimeDecision } from "@/lib/runtime-security";
import { getRuntimeSecurityRules, saveRuntimeRequestEvent } from "@/lib/runtime-security-store";

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { data: payloadData, id: requestId } = body;
        const sourceIp = getSourceIp(req);
        const bodySample = shouldStoreBodySample()
            ? JSON.stringify(body).slice(0, 512)
            : undefined;

        // Only use the server-configured PROCESSOR_URL — never a client-supplied URL.
        const finalTargetUrl = process.env['PROCESSOR_URL'];

        if (finalTargetUrl) {
            try {
                const endpoint = finalTargetUrl.endsWith('/process')
                    ? finalTargetUrl
                    : `${finalTargetUrl.replace(/\/$/, '')}/process`;

                const resp = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                if (resp.ok) {
                    const result = await resp.json();
                    await saveTraceRuntimeEvent({
                        userEmail: session.user.email,
                        requestId,
                        sourceIp,
                        statusCode: resp.status,
                        targetUrl: endpoint,
                        contentType: req.headers.get("content-type") ?? undefined,
                        bodySize: Number(req.headers.get("content-length")) || JSON.stringify(body).length,
                        bodySample,
                    });
                    return NextResponse.json({
                        ...result,
                        source: finalTargetUrl,
                        proxied: true
                    });
                } else {
                    return NextResponse.json({
                        error: `Target returned ${resp.status}`,
                        status: resp.status,
                        source: finalTargetUrl
                    }, { status: resp.status });
                }
            } catch (err) {
                console.error("Failed to contact target service:", err);
            }
        }

        // For the demo/mock environment (default fallback):
        const data = payloadData || {};
        const processed = {
            ...data,
            _watchmen_processed: true,
            server_id: "watchmen-processor-7f4b",
            timestamp: new Date().toISOString(),
            location: "Local Mock Service",
            db_status: "committed"
        };

        const trace = [
            { component: "API Gateway", action: "Checking Ingress Rules", status: "Success" },
            { component: "Local Proxy", action: "Routing to Mock", status: "Success" },
            { component: "Mock Service", action: "Processing Transformation", status: "Success" },
            { component: "Mock DB", action: "Simulated Write", status: "Success" }
        ];

        await new Promise(r => setTimeout(r, 800));

        await saveTraceRuntimeEvent({
            userEmail: session.user.email,
            requestId,
            sourceIp,
            statusCode: 200,
            targetUrl: "Mock",
            contentType: req.headers.get("content-type") ?? undefined,
            bodySize: Number(req.headers.get("content-length")) || JSON.stringify(body).length,
            bodySample,
        });

        return NextResponse.json({
            request_id: requestId,
            original_data: data,
            processed_data: processed,
            trace: trace,
            message: `Request successfully processed by Watchmen Mock logic`,
            source: "Mock"
        });
    } catch (error) {
        return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }
}

async function saveTraceRuntimeEvent(input: {
    userEmail?: string | null;
    requestId?: string;
    sourceIp?: string;
    statusCode: number;
    targetUrl: string;
    contentType?: string;
    bodySize?: number;
    bodySample?: string;
}) {
    if (!input.userEmail) return;

    try {
        const rules = await getRuntimeSecurityRules(input.userEmail);
        const event = applyRuntimeDecision({
            id: input.requestId || `trace-${crypto.randomUUID()}`,
            ts: new Date().toISOString(),
            sourceIp: input.sourceIp,
            method: "POST",
            path: "/process",
            contentType: input.contentType,
            bodySize: input.bodySize,
            bodySample: input.bodySample,
            statusCode: input.statusCode,
            destinationService: input.targetUrl,
        }, rules);
        await saveRuntimeRequestEvent(input.userEmail, event);
    } catch (error) {
        console.warn("[api/trace] runtime security event write failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function getSourceIp(req: NextRequest): string | undefined {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || req.headers.get("x-real-ip") || undefined;
}

function shouldStoreBodySample(): boolean {
    return process.env.DEMO_MODE === "true" || process.env.NODE_ENV === "development";
}
