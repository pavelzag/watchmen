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

# struct pt_regs (and friends) are arch-specific: a vmlinux.h vendored from
# an ARM64 machine breaks x86_64 compilation and vice versa. Refresh from the
# local kernel's BTF whenever possible so the header always matches the
# machine doing the build.
if [ -r /sys/kernel/btf/vmlinux ] && command -v bpftool >/dev/null 2>&1; then
  echo "refreshing bpf/vmlinux.h from local kernel BTF"
  bpftool btf dump file /sys/kernel/btf/vmlinux format c > bpf/vmlinux.h
else
  echo "warning: no local kernel BTF/bpftool; using vendored bpf/vmlinux.h (must match target arch)" >&2
fi

exec go run github.com/cilium/ebpf/cmd/bpf2go \
  -cc clang \
  -cflags "-O2 -g -Wall -Werror -Wno-missing-declarations -D__TARGET_ARCH_${target_arch}" \
  http_trace bpf/http_trace.bpf.c -- -I./bpf
