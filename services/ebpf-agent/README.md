# Watchmen eBPF Agent

Minimal Go/eBPF agent for VM smoke testing.

The agent attaches a `raw_tracepoint/sys_enter` sniffer for HTTP bytes plus
`kprobe/tcp_sendmsg` and `kprobe/tcp_recvmsg` for the L4 tuple, and emits
enriched events:

```json
{"type":"http_request","timestamp":"2026-06-07T12:00:00Z","hostname":"node-1","pid":1234,"uid":0,"comm":"curl","method":"GET","path":"/api/products","data":"GET /api/products HTTP/1.1","sourceIp":"10.0.0.7","sourcePort":45678,"destIp":"10.0.1.20","destPort":8080,"family":"ipv4","cgroupId":12345,"sockCookie":6789,"containerId":"ad8b5c..."}
{"type":"tcp_flow","timestamp":"2026-06-07T12:00:00Z","hostname":"node-1","pid":1234,"uid":0,"comm":"curl","data":"","sourceIp":"10.0.0.7","sourcePort":45678,"destIp":"10.0.1.20","destPort":8080,"family":"ipv4","cgroupId":12345,"sockCookie":6789}
```

Flow events are throttled to one per socket per second (`last_flow` LRU map).
When the checked-in bindings predate the tuple probes, the agent logs a
warning and runs HTTP-only; regenerate to enable them (see below).

## Build on the GCP VM

SSH to the VM created by `../watchmen-infra/stacks/gcp-ebpf-vm`, then copy this directory or clone the repo.

```sh
cd services/ebpf-agent
./scripts/build-on-vm.sh
sudo ./watchmen-ebpf-agent
```

In another shell, run commands like:

```sh
ls
curl https://example.com
```

The agent should print one JSON event per executed process.

## Forward to Watchmen

Run with an endpoint:

```sh
sudo ./watchmen-ebpf-agent \
  -endpoint https://your-watchmen-host.example/api/agent/events \
  -verbose
```

The endpoint receives one JSON object per POST. Keep it simple for the first collector; batching can be added once the backend shape is stable.

## GitHub Release Binaries

The release workflow builds these Linux binaries and attaches them to a GitHub Release:

- `watchmen-ebpf-agent-linux-amd64`
- `watchmen-ebpf-agent-linux-arm64`

Create a release from a tag:

```sh
git tag agent-v0.1.0
git push origin agent-v0.1.0
```

Or run the `Release Watchmen Agent` workflow manually with version `0.1.0`.

For a public repository, configure Watchmen with:

```sh
WATCHMEN_AGENT_BINARY_URL=https://github.com/OWNER/REPO/releases/download/agent-v0.1.0/watchmen-ebpf-agent-linux-amd64
WATCHMEN_AGENT_VERSION=0.1.0
```

For Kubernetes DaemonSet installs, prefer setting a base release URL and let the init container select the binary by node architecture:

```sh
WATCHMEN_AGENT_BINARY_BASE_URL=https://github.com/OWNER/REPO/releases/download/agent-v0.1.0
WATCHMEN_AGENT_VERSION=0.1.0
```

The generated manifest maps `x86_64`/`amd64` nodes to `watchmen-ebpf-agent-linux-amd64` and `aarch64`/`arm64` nodes to `watchmen-ebpf-agent-linux-arm64`.

For a private repository, use a release host that the VM installer can access without interactive auth, or extend the installer to request a short-lived signed download URL.

## Install as systemd

```sh
sudo install -m 0755 watchmen-ebpf-agent /usr/local/bin/watchmen-ebpf-agent
sudo install -m 0644 ../../../watchmen-infra/deploy/systemd/watchmen-ebpf-agent.service /etc/systemd/system/watchmen-ebpf-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now watchmen-ebpf-agent
sudo journalctl -u watchmen-ebpf-agent -f
```

## Notes

- Build on the target VM first. The script generates `bpf/vmlinux.h` from that VM's kernel BTF.
- To force an architecture during local/release builds, set `WATCHMEN_AGENT_ARCH=amd64` or `WATCHMEN_AGENT_ARCH=arm64`.
- The agent currently runs as root. For production, reduce privileges after the probe set is finalized.
- If `bpftool feature probe kernel` reports missing ring buffer, BTF, or tracepoint support, use a newer Ubuntu/GCP image or change the probe strategy.
