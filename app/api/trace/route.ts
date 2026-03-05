import { NextRequest, NextResponse } from "next/server";

// This is a proxy/simulated endpoint for the Go service
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // In a real scenario, we would:
        // const resp = await fetch('http://localhost:8080/process', { method: 'POST', body: JSON.stringify(body) });
        // return NextResponse.json(await resp.json());

        // For the demo/mock environment:
        const data = body.data || {};
        const processed = {
            ...data,
            _watchmen_processed: true,
            server_id: "watchmen-processor-7f4b",
            timestamp: new Date().toISOString(),
            location: "us-central1 (Cloud Run)",
            db_status: "committed"
        };

        const trace = [
            { component: "API Gateway", action: "Request Received", status: "Success" },
            { component: "Load Balancer", action: "Forwarding to CloudRun", status: "Success" },
            { component: "CloudRun Service (Go)", action: "Applying Business Logic", status: "Success" },
            { component: "Cloud SQL", action: "Persisting Record", status: "Success" },
            { component: "Egress", action: "Dispatching Response", status: "Success" }
        ];

        // Artificial delay to simulate network/processing
        await new Promise(r => setTimeout(r, 800));

        return NextResponse.json({
            request_id: body.id,
            original_data: data,
            processed_data: processed,
            trace: trace,
            message: `Request from ${body.source} successfully processed by Watchmen Go Service`
        });
    } catch (error) {
        return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }
}
