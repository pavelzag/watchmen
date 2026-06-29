# Watchmen eBPF Agent

Minimal Go/eBPF agent for VM smoke testing.

The first collector attaches to `syscalls:sys_enter_execve` and emits process execution events:

```json
{"type":"process_exec","timestamp":"2026-06-07T12:00:00Z","hostname":"ebpf-agent-test","pid":1234,"ppid":1,"uid":0,"comm":"curl","filename":"/usr/bin/curl"}
```

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

## GitHub Release Binary

The release workflow builds `watchmen-ebpf-agent-linux-amd64` and attaches it to a GitHub Release.

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
- The agent currently runs as root. For production, reduce privileges after the probe set is finalized.
- If `bpftool feature probe kernel` reports missing ring buffer, BTF, or tracepoint support, use a newer Ubuntu/GCP image or change the probe strategy.
