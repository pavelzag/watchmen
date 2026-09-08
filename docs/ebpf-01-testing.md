# Testing #1 — socket tuple + container enrichment

> Copy of the test guide for `~/Projects/ebpf-learn/watchmen-ebpf/`.
> Copy it over with:
> `cp docs/ebpf-01-socket-tuple-enrichment.md docs/ebpf-01-testing.md ~/Projects/ebpf-learn/watchmen-ebpf/`

## Layer 1 — macOS, no kernel needed (done, all green)

Portable logic lives in `services/ebpf-agent/enrich/` precisely so it runs here:

```sh
cd services/ebpf-agent && go test ./enrich/ -v
# ok  watchmen/ebpf-agent/enrich  (FormatIPv4, ParseContainerID,
# ReadContainerID, Cache TTL/Prune)
```

Backend normalization:

```sh
npx jest lib/runtime-security.test.ts
# 10 passed — incl. "prefers the kernel tuple over spoofable L7 headers"
# and "maps dest tuple and container identity onto destinations"
```

Compile check for the Linux-only agent (it imports `ringbuf`, which is
`//go:build linux`, so native macOS `go build` fails — pre-existing):

```sh
cd services/ebpf-agent
GOMODCACHE=/tmp/gomodcache GOCACHE=/tmp/gocache GOFLAGS=-mod=mod \
  GOOS=linux GOARCH=arm64 go build ./...   # must exit 0
GOMODCACHE=/tmp/gomodcache GOCACHE=/tmp/gocache GOFLAGS=-mod=mod \
  GOOS=linux GOARCH=amd64 go vet ./...     # must exit 0
```

(`GOMODCACHE/GOCACHE` point at `/tmp` because the sandbox blocks writes to
`~/go` and `~/Library/Caches`.)

`npm run type-check` shows errors only for the missing
`@kubernetes/client-node` module in `lib/kubernetes/` — verified identical on
the clean tree (`git stash`), i.e. pre-existing broken `node_modules`, not
from this change. None of the touched files report errors.

## Layer 2 — Linux VM: regenerate bindings (required once)

macOS Apple clang has no BPF target, so the checked-in generated bindings
(`http_trace_bpf*.go`) cannot be regenerated here. On the VM from
`docs/ebpf-agent-vm-debugging.md`:

```sh
cd services/ebpf-agent
./scripts/build-on-vm.sh        # or ./scripts/generate-bpf.sh directly
git diff --stat                 # expect http_trace_bpfel.go/.o + http_trace_bpfeb.go/.o changed
GOOS=linux go build ./...       # uses the new programs
```

Until you do this, the new Go code runs in **degraded HTTP-only mode** — you
will see `tuple probe trace_tcp_sendmsg absent ... continuing HTTP-only` in
the log. That is intentional and safe to ship.

## Layer 3 — Linux VM: live traffic

```sh
sudo ./watchmen-ebpf-agent -verbose
# other shell:
curl http://example.com:80/ ; curl https://example.com/
```

Expect per request:

```json
{"type":"http_request","comm":"curl","method":"GET","path":"/","sourceIp":"10.0.x.x","destIp":"93.184.216.34","destPort":80,"family":"ipv4","cgroupId":1234,...}
{"type":"tcp_flow","comm":"curl","sourceIp":"10.0.x.x","destIp":"93.184.216.34","destPort":80,...}
```

Ground truth checks:

- `ss -tnp | grep <destPort>` — tuple must match; if the IP looks plausible
  but wrong, suspect a byte-order bug (see learning doc §3).
- `cat /proc/<pid>/cgroup` — container id must match `containerId`.
- `sudo cat /sys/kernel/debug/tracing/trace_pipe` (optional) — confirm
  `tcp_sendmsg` fires; one flow line per socket per second proves the
  `last_flow` throttle.

## Layer 4 — end to end into Watchmen

```sh
sudo ./watchmen-ebpf-agent -endpoint http://<mac-lan-ip>:3000/api/agents/events
```

Then: **Trace** page shows `remoteIp` = kernel IP (not `-`), **Runtime
Security → Events** rows carry `destinationService = destIp:destPort`, and the
`default-public-source` rule now fires on real public destinations. Flow-only
events (`tcp_flow`, no method/path) are stored but skipped by the live-trace
view — query them via `/api/agents/events/query`.

## Layer 5 — DaemonSet (K8s)

Redeploy the manifest after rebuilding the release binary (`agent-v*` tag per
`services/ebpf-agent/README.md`). The new `host-proc` volume + 
`WATCHMEN_HOST_PROC=/host/proc` take effect on pod restart — verify with
`kubectl describe ds watchmen-ebpf-agent` and check events carry
`containerId` for pod traffic.
