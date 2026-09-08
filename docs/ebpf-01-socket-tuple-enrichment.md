# #1 — Socket tuple + container enrichment: what was done and why

> Copy of the learning doc for `~/Projects/ebpf-learn/watchmen-ebpf/`.
> Copy it over with:
> `cp docs/ebpf-01-socket-tuple-enrichment.md docs/ebpf-01-testing.md ~/Projects/ebpf-learn/watchmen-ebpf/`

## The problem (30 seconds)

The old agent sniffed HTTP bytes at `raw_tracepoint/sys_enter`. That hook sees
a **user-space buffer + length** — never the socket. So every event had
`method/path/data` but no idea *who talked to whom*: the backend guessed the
source IP from `X-Forwarded-For`-style headers (spoofable, often absent) and
had no container attribution at all.

A syscall only knows the **fd number**. The fd → socket → 5-tuple mapping
lives in kernel TCP state (`struct sock`). To observe it you must hook the
layer that has the `struct sock *`: `tcp_sendmsg` / `tcp_recvmsg`.

## What changed, file by file

| File | Change |
|---|---|
| `services/ebpf-agent/bpf/http_trace.bpf.c` | `struct event` gains `saddr/daddr/sport/dport/family/cgroup_id/sock_cookie`; new `kprobe/tcp_sendmsg` + `kprobe/tcp_recvmsg` + `kprobe/tcp_connect` emit `EVENT_FLOW`; `last_flow` LRU (keyed by tuple) throttles to 1 event/socket/sec; flow id is FNV-1a of the tuple |
| `services/ebpf-agent/main.go` | Loads the collection by program **name** so tuple probes are optional (old bindings → HTTP-only degraded mode); joins flows to HTTP events by pid (5s TTL); resolves container id from `/proc` |
| `services/ebpf-agent/enrich/` (new) | Portable helpers: IPv4 formatting, family labels, cgroup → container-id parsing, TTL flow cache. No kernel imports → unit-testable on macOS |
| `lib/runtime-security.ts` | `normalizeAgentEventRow` prefers kernel `sourceIp`, falls back to headers; `destIp:destPort` → `destinationService`; `containerId` → `destinationWorkload` |
| `app/api/agents/events/route.ts` | `remoteIp` prefers kernel `sourceIp`; live-trace `container` from `pod`/`containerId` |
| `lib/agents/k8s-manifest.ts` | DaemonSet mounts host `/proc` at `/host/proc` (read-only) + `WATCHMEN_HOST_PROC` env, so the containerized agent can resolve **host** PIDs |

## eBPF concepts this exercises

1. **kprobe vs tracepoint.** `sys_enter` is a stable tracepoint (fixed args);
   `tcp_sendmsg` is a kprobe on a kernel function (first arg = `struct sock *`
   via `PT_REGS_PARM1`). Kprobes are powerful but less stable — hence CO-RE.
2. **CO-RE (`bpf_core_read`).** Field offsets in `struct sock` differ per
   kernel. `BPF_CORE_READ(sk->__sk_common.skc_daddr)` relocates at load time
   using BTF, so one binary runs on many kernels. Raw offset math would break.
3. **Byte order.** `skc_rcv_saddr/skc_daddr` are network order (format bytes
   as-is); `skc_num` is host order; `skc_dport` is network order (we
   `bswap16` in-kernel). Getting one of these wrong prints a plausible but
   wrong IP — always verify against `ss -tnp`.
4. **BPF maps as more than storage.** `last_flow` (LRU_HASH) is *rate
   limiting in kernel*: dropping noise before the ring buffer keeps the
   verifier, CPU, and Go reader happy.
5. **Helper availability is per program type.** `bpf_get_socket_cookie`
   sounds ideal but the verifier rejects it in kprobes — our first version
   compiled and died at load with `program of this type cannot use helper`.
   Replacement: key the throttle map by the tuple itself, hash it (FNV-1a)
   for the userspace join id. Always check a helper against your program
   type; compile success says nothing about load success.
6. **The fresh-connection race.** `sys_enter` fires at syscall *entry*,
   `tcp_sendmsg` runs later — so a new connection's flow was always cached
   ~300µs *after* its first request (observed live: curl's request had no
   tuple). Fix: `kprobe/tcp_connect` runs during setup, before any request
   bytes, so the tuple is cached ahead of time. After the fix, request and
   flow shared `sockCookie 2651819463027931022`.
7. **`vmlinux.h` is arch-specific.** The vendored header was ARM64
   (`regs[31]`); the GCP VM is x86_64 (`di/si/dx`) — libbpf defers to
   `vmlinux.h`, so *nothing* compiled until the header was regenerated from
   the machine's own BTF (`bpftool btf dump ...`). `generate-bpf.sh` now
   does this automatically when BTF+bpftool exist.
8. **`bpf_get_current_cgroup_id`.** Free container grouping: all processes in
   one container share a cgroup id, no `/proc` parsing needed in kernel.
9. **Graceful degradation.** New probes are looked up by name at load;
   missing programs (stale bindings) log and continue. eBPF agents must never
   take down the observability they add.

## Why userspace does the join (not the kernel)

Joining HTTP bytes to tuples in-kernel would need an LRU keyed by pid with
payload reassembly — verifier-hostile and hard to debug. Kernel emits two
simple streams; Go joins on `(pid, 5s window)`. Rule of thumb: **kernel
filters and annotates, userspace correlates.**

## Suggested exercises

1. `ss -tnp` vs agent output: confirm tuple, then note what `ss` can't show
   (the HTTP path) — that's the value of the join.
2. Throttle math: remove `last_flow`, `curl` a 100MB file, watch ringbuf
   pressure (`verbose` drops). Re-add it.
3. IPv6: extend `submit_flow_event` for `AF_INET6` (`skc_v6_rcv_saddr` is
   `struct in6_addr`, 16 bytes) and add handling in `enrich`.
4. Break CO-RE on purpose: replace one `bpf_core_read` with a hardcoded
   offset, load on a different kernel, observe garbage — then revert.
