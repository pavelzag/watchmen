import { NextRequest, NextResponse } from "next/server";

function shellEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:/@-]/g, "");
}

export async function GET(req: NextRequest) {
  const projectId = shellEscape(req.nextUrl.searchParams.get("project") ?? "your-gcp-project");
  const zone = shellEscape(req.nextUrl.searchParams.get("zone") ?? "europe-west3-b");
  const instance = shellEscape(req.nextUrl.searchParams.get("instance") ?? "$(hostname)");
  const origin = (process.env.WATCHMEN_BASE_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const binaryBaseUrl = (
    process.env.WATCHMEN_AGENT_BINARY_BASE_URL ??
    "https://github.com/pavelzag/watchmen/releases/download/agent-v0.3.19"
  ).replace(/\/$/, "");
  const agentVersion = process.env.WATCHMEN_AGENT_VERSION ?? "0.3.19";

  const script = `#!/usr/bin/env bash
set -euo pipefail

# Watchmen eBPF Agent VM Installer (GCE / Linux systemd)
# Usage:
#   WATCHMEN_AGENT_SECRET="<secret>" sudo -E bash install-watchmen-vm-agent.sh

PROJECT_ID="${projectId}"
ZONE="${zone}"
INSTANCE_NAME="${instance}"
AGENT_ID="vm:\${PROJECT_ID}:\${INSTANCE_NAME}"
WATCHMEN_ORIGIN="${origin}"
BINARY_BASE_URL="${binaryBaseUrl}"
AGENT_VERSION="${agentVersion}"

if [ -z "\${WATCHMEN_AGENT_SECRET:-}" ]; then
  echo "WATCHMEN_AGENT_SECRET is required" >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64 | amd64) AGENT_ARCH="amd64" ;;
  aarch64 | arm64) AGENT_ARCH="arm64" ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

curl -fsSL "\${BINARY_BASE_URL}/watchmen-ebpf-agent-linux-\${AGENT_ARCH}" -o /usr/local/bin/watchmen-ebpf-agent
chmod 0755 /usr/local/bin/watchmen-ebpf-agent

KERNEL="$(uname -r 2>/dev/null || echo '')"
REGISTER_PAYLOAD="$(printf '{"agentId":"%s","projectId":"%s","zone":"%s","instanceName":"%s","hostname":"%s","agentSecret":"%s","agentVersion":"%s","kernelVersion":"%s"}' \\
  "$AGENT_ID" "$PROJECT_ID" "$ZONE" "$INSTANCE_NAME" "$(hostname)" "$WATCHMEN_AGENT_SECRET" "$AGENT_VERSION" "$KERNEL")"

curl -fsS -X POST "\${WATCHMEN_ORIGIN}/api/agents/vm/register" \\
  -H "Content-Type: application/json" \\
  -d "$REGISTER_PAYLOAD" >/dev/null

umask 077
cat > /opt/watchmen-agent.env <<EOF
WATCHMEN_ENDPOINT=\${WATCHMEN_ORIGIN}/api/agents/events
WATCHMEN_AGENT_ID=\${AGENT_ID}
WATCHMEN_AGENT_SECRET=\${WATCHMEN_AGENT_SECRET}
WATCHMEN_REDACT_SECRETS=1
WATCHMEN_TRUNCATE_IPS=0
WATCHMEN_OMIT_RAW_DATA=0
WATCHMEN_SEND_RESPONSES=0
WATCHMEN_DROP_COMM_PREFIXES=watchmen-ebpf,alloy,google_osconfig
WATCHMEN_DROP_PATH_PREFIXES=/api/agents/events,/api/agents/vm/register,/_health,/healthz
EOF
chmod 0600 /opt/watchmen-agent.env
umask 022

cat > /etc/systemd/system/watchmen-ebpf-agent.service <<'UNIT'
[Unit]
Description=Watchmen eBPF Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/opt/watchmen-agent.env
ExecStart=/usr/local/bin/watchmen-ebpf-agent
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now watchmen-ebpf-agent.service
systemctl status watchmen-ebpf-agent.service --no-pager
`;

  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Content-Disposition": `attachment; filename="install-watchmen-vm-agent.sh"`,
    },
  });
}
