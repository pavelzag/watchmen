import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    try {
        const processorUrl = process.env.PROCESSOR_URL || "http://localhost:8080";
        const historyUrl = `${processorUrl.replace(/\/$/, '')}/api/history`;

        const resp = await fetch(historyUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
        });

        if (resp.ok) {
            const data = await resp.json();
            return NextResponse.json(data);
        }

        return NextResponse.json({ error: "Failed to fetch history from processor" }, { status: resp.status });
    } catch (error) {
        console.error("History fetch error:", error);
        return NextResponse.json({ error: "Processor unreachable" }, { status: 503 });
    }
}
