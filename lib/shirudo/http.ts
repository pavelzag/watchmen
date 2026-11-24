import { gunzipSync } from "zlib";
import type { NextRequest } from "next/server";

const MAX_OTLP_BODY_BYTES = 8 * 1024 * 1024;

export async function parseOtlpHttpJsonBody(req: NextRequest): Promise<unknown> {
  const rawBuf = Buffer.from(await req.arrayBuffer());
  if (rawBuf.length === 0) return {};
  if (rawBuf.length > MAX_OTLP_BODY_BYTES) {
    throw new Error("OTLP payload exceeds maximum size (8 MiB).");
  }

  const encoding = (req.headers.get("content-encoding") ?? "").toLowerCase().trim();
  const decodedBuf = encoding === "gzip" ? gunzipSync(rawBuf, { maxOutputLength: MAX_OTLP_BODY_BYTES }) : rawBuf;
  const text = decodedBuf.toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}
