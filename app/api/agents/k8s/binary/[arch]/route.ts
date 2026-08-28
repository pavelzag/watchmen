import { createReadStream, existsSync, statSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";

function binaryPath(arch: string): string | null {
  if (arch !== "amd64" && arch !== "arm64") return null;
  const dir = process.env.WATCHMEN_AGENT_BINARY_DIR || join(process.cwd(), "dist");
  return join(dir, `watchmen-ebpf-agent-linux-${arch}`);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ arch: string }> }) {
  const { arch } = await params;
  const path = binaryPath(arch);
  if (!path || !existsSync(path)) {
    return NextResponse.json({
      error: `Local Watchmen eBPF agent binary for ${arch} was not found.`,
      expected: path,
      hint: `Build it with: docker run --rm -v "$PWD:/src" -v /private/tmp:/out -w /src/services/ebpf-agent golang:1.22-bookworm bash -lc 'CGO_ENABLED=0 GOOS=linux GOARCH=${arch} /usr/local/go/bin/go build -buildvcs=false -trimpath -ldflags "-s -w -X main.version=dev-local" -o /out/watchmen-ebpf-agent-linux-${arch} .'`,
    }, { status: 404 });
  }

  const size = statSync(path).size;
  const stream = createReadStream(path);
  return new NextResponse(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="watchmen-ebpf-agent-linux-${arch}"`,
    },
  });
}
