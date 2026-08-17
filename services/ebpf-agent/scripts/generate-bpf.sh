#!/usr/bin/env bash
set -euo pipefail

arch="${WATCHMEN_AGENT_ARCH:-${GOARCH:-$(go env GOARCH)}}"

case "$arch" in
  amd64 | x86_64)
    target_arch="x86"
    ;;
  arm64 | aarch64)
    target_arch="arm64"
    ;;
  *)
    echo "unsupported eBPF target architecture: $arch" >&2
    exit 1
    ;;
esac

exec go run github.com/cilium/ebpf/cmd/bpf2go \
  -cc clang \
  -cflags "-O2 -g -Wall -Werror -D__TARGET_ARCH_${target_arch}" \
  http_trace bpf/http_trace.bpf.c -- -I./bpf
