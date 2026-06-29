import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureAgentInstallTables, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await ensureAgentInstallTables();

        const agentEvents = await sql`
            SELECT e.id, e.agent_id, e.event, e.received_at, h.metadata->>'clusterName' AS cluster_name
            FROM agent_events e
            JOIN agent_hosts h ON h.id = e.agent_id
            WHERE h.user_email = ${session.user.email}
               OR h.user_email = 'system'
            ORDER BY e.received_at DESC
            LIMIT 100
        `;

        const processorUrl = process.env['PROCESSOR_URL'] || "http://localhost:8080";
        // Ensure we don't have double slashes and handle internal k8s DNS correctly
        const baseUrl = processorUrl.replace(/\/$/, '');
        const historyUrl = `${baseUrl}/api/history`;

        console.log(`[History API] Fetching from: ${historyUrl}`);

        const resp = await fetch(historyUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            },
            next: { revalidate: 0 }
        });

        const normalizedAgentHistory = agentEvents.rows.map((row: any) => {
            const ev = row.event || {};
            const action = ev.type === "http_response"
                ? `HTTP ${ev.status || "response"}`
                : `${ev.method || "HTTP"} ${ev.path || "request"}`;

            return {
                request_id: `agent-${row.id}`,
                source: ev.hostname || row.agent_id,
                original_data: ev,
                processed_data: ev,
                trace: [
                    {
                        component: "GKE Pod",
                        action,
                        status: "Observed",
                        time: row.received_at,
                    },
                ],
                received_at: row.received_at,
                agent_id: row.agent_id,
                cluster_name: row.cluster_name,
            };
        });

        if (resp.ok) {
            const data = await resp.json();
            const processorHistory = Array.isArray(data) ? data : (data?.history || []);
            const merged = [...normalizedAgentHistory, ...processorHistory]
                .sort((a: any, b: any) => {
                    const at = new Date(a.received_at || a.timestamp || a.trace?.[0]?.time || 0).getTime();
                    const bt = new Date(b.received_at || b.timestamp || b.trace?.[0]?.time || 0).getTime();
                    return bt - at;
                });
            return NextResponse.json(merged);
        }

        const errorText = await resp.text().catch(() => "Unknown error");
        console.error(`[History API] Backend returned ${resp.status}: ${errorText}`);
        return NextResponse.json(normalizedAgentHistory);
    } catch (error: any) {
        console.error("[History API] Critical failure:", error.message || error);
        try {
            await ensureAgentInstallTables();
            const agentEvents = await sql`
                SELECT e.id, e.agent_id, e.event, e.received_at, h.metadata->>'clusterName' AS cluster_name
                FROM agent_events e
                JOIN agent_hosts h ON h.id = e.agent_id
                WHERE h.user_email = ${session.user.email}
                   OR h.user_email = 'system'
                ORDER BY e.received_at DESC
                LIMIT 100
            `;

            return NextResponse.json(agentEvents.rows.map((row: any) => {
                const ev = row.event || {};
                return {
                    request_id: `agent-${row.id}`,
                    source: ev.hostname || row.agent_id,
                    original_data: ev,
                    processed_data: ev,
                    trace: [{
                        component: "GKE Pod",
                        action: ev.type === "http_response" ? `HTTP ${ev.status || "response"}` : `${ev.method || "HTTP"} ${ev.path || "request"}`,
                        status: "Observed",
                        time: row.received_at,
                    }],
                    received_at: row.received_at,
                    agent_id: row.agent_id,
                    cluster_name: row.cluster_name,
                };
            }));
        } catch (dbError: any) {
            return NextResponse.json({
                error: "Processor unreachable",
                message: error.message,
                dbError: dbError?.message,
            }, { status: 503 });
        }
    }
}
