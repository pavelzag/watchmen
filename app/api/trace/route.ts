import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { data: payloadData, id: requestId } = body;

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
