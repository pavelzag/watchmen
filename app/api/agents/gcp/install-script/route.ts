import { NextRequest, NextResponse } from "next/server";
import { ensureAgentInstallTables } from "@/lib/db";
import { getInstallJob } from "@/lib/agents/gcp-osconfig";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job") ?? "";
  if (!jobId) {
    return new NextResponse("missing job", { status: 400 });
  }

  await ensureAgentInstallTables();
  const job = await getInstallJob(jobId);
  if (!job) {
    return new NextResponse("unknown job", { status: 404 });
  }
  if (new Date(job.expiresAt).getTime() < Date.now()) {
    return new NextResponse("expired job", { status: 410 });
  }

  const origin = req.nextUrl.origin;
  const registerUrl = `${origin}/api/agents/gcp/register`;
  const binaryUrl = process.env.WATCHMEN_AGENT_BINARY_URL ?? "";
  const version = process.env.WATCHMEN_AGENT_VERSION ?? "dev";

  const script = `#!/bin/sh
set -eu

LOG=/var/log/watchmen-agent-install.log
mkdir -p /etc/watchmen
touch "$LOG"
exec >>"$LOG" 2>&1

echo "[watchmen] install started $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if ! command -v curl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y curl ca-certificates
  elif command -v yum >/dev/null 2>&1; then yum install -y curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then dnf install -y curl ca-certificates
  else echo "[watchmen] curl is required"; exit 1
  fi
fi

if [ -z "${binaryUrl}" ]; then
  echo "[watchmen] WATCHMEN_AGENT_BINARY_URL is not configured on the Watchmen server"
  exit 1
fi

AUD="${registerUrl}"
TOKEN="$(curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=$AUD&format=full")"
HOSTNAME_VALUE="$(hostname 2>/dev/null || true)"
KERNEL_VALUE="$(uname -r 2>/dev/null || true)"

REGISTER_RESPONSE="$(curl -fsS -X POST "${registerUrl}" \\
  -H 'Content-Type: application/json' \\
  -d "{\\"jobId\\":\\"${jobId}\\",\\"identityToken\\":\\"$TOKEN\\",\\"hostname\\":\\"$HOSTNAME_VALUE\\",\\"kernelVersion\\":\\"$KERNEL_VALUE\\",\\"agentVersion\\":\\"${version}\\"}")"

AGENT_ID="$(printf '%s' "$REGISTER_RESPONSE" | sed -n 's/.*"agentId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')"
AGENT_SECRET="$(printf '%s' "$REGISTER_RESPONSE" | sed -n 's/.*"agentSecret"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')"

if [ -z "$AGENT_ID" ] || [ -z "$AGENT_SECRET" ]; then
  echo "[watchmen] registration response did not include credentials"
  echo "$REGISTER_RESPONSE"
  exit 1
fi

curl -fsSL "${binaryUrl}" -o /usr/local/bin/watchmen-ebpf-agent
chmod 0755 /usr/local/bin/watchmen-ebpf-agent

cat >/etc/watchmen/agent.env <<EOF
WATCHMEN_ENDPOINT=${origin}/api/agents/events
WATCHMEN_AGENT_ID=$AGENT_ID
WATCHMEN_AGENT_SECRET=$AGENT_SECRET
WATCHMEN_VERBOSE=1
EOF
chmod 0600 /etc/watchmen/agent.env

cat >/etc/systemd/system/watchmen-ebpf-agent.service <<'EOF'
[Unit]
Description=Watchmen eBPF Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/watchmen/agent.env
ExecStart=/usr/local/bin/watchmen-ebpf-agent
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now watchmen-ebpf-agent
echo "[watchmen] install completed"
`;

  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
