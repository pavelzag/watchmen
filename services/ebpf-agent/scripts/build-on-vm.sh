#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -r /sys/kernel/btf/vmlinux ]; then
  echo "missing /sys/kernel/btf/vmlinux; this kernel does not expose BTF" >&2
  exit 1
fi

bpftool btf dump file /sys/kernel/btf/vmlinux format c > bpf/vmlinux.h
go generate ./...
go build -trimpath -o watchmen-ebpf-agent .

echo "built $(pwd)/watchmen-ebpf-agent"

