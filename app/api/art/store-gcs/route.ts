import { NextRequest, NextResponse } from "next/server";

function summarizeHeaders(req: NextRequest) {
  return {
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    userAgent: req.headers.get("user-agent"),
    contentType: req.headers.get("content-type"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    secFetchMode: req.headers.get("sec-fetch-mode"),
  };
}

async function readBodyPreview(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const data = await req.json().catch(() => null);
      return data;
    }
    const text = await req.text().catch(() => "");
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const headers = summarizeHeaders(req);
  const bodyPreview = await readBodyPreview(req);
  console.warn("[api/art/store-gcs] unexpected caller", {
    method: "POST",
    headers,
    bodyPreview,
  });

  return NextResponse.json(
    {
      ok: false,
      error: "Unexpected caller logged. Check server output for origin/referer/user-agent.",
    },
    { status: 501 }
  );
}
