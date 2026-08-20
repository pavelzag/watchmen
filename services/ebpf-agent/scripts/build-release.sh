#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

arch="${1:-${GOARCH:-$(go env GOARCH)}}"
version="${WATCHMEN_AGENT_VERSION:-dev}"
output_dir="${WATCHMEN_AGENT_OUTPUT_DIR:-../../dist}"

case "$arch" in
  amd64 | x86_64)
    goarch="amd64"
    ;;
  arm64 | aarch64)
    goarch="arm64"
    ;;
  *)
    echo "unsupported release architecture: $arch" >&2
    exit 1
    ;;
esac

if [ ! -r /sys/kernel/btf/vmlinux ]; then
  echo "missing /sys/kernel/btf/vmlinux; this kernel does not expose BTF" >&2
  exit 1
fi

mkdir -p "$output_dir"
bpftool btf dump file /sys/kernel/btf/vmlinux format c > bpf/vmlinux.h

WATCHMEN_AGENT_ARCH="$goarch" GOARCH="$goarch" go generate ./...

CGO_ENABLED=0 GOOS=linux GOARCH="$goarch" go build \
  -buildvcs=false \
  -trimpath \
  -ldflags "-s -w -X main.version=${version}" \
  -o "$output_dir/watchmen-ebpf-agent-linux-$goarch" .

echo "built $output_dir/watchmen-ebpf-agent-linux-$goarch"
