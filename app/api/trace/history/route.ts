import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    try {
        const processorUrl = process.env.PROCESSOR_URL || "http://localhost:8080";
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

        if (resp.ok) {
            const data = await resp.json();
            return NextResponse.json(data);
        }

        const errorText = await resp.text().catch(() => "Unknown error");
        console.error(`[History API] Backend returned ${resp.status}: ${errorText}`);
        return NextResponse.json({
            error: "Failed to fetch history from processor",
            status: resp.status,
            details: errorText
        }, { status: resp.status });
    } catch (error: any) {
        console.error("[History API] Critical failure:", error.message || error);
        return NextResponse.json({
            error: "Processor unreachable",
            message: error.message,
            target: process.env.PROCESSOR_URL
        }, { status: 503 });
    }
}
