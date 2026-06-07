# GCP eBPF Agent Test VM

This stack creates a minimal Compute Engine VM for testing a Go/eBPF agent in project `watchmen-test-488807`.

## Shape

- Machine type: `e2-micro`
- OS: Ubuntu 24.04 LTS
- Disk: 20 GB `pd-standard`
- Network: dedicated VPC/subnet
- SSH: OS Login through IAP only
- VM service account: dedicated account with only the `logging.write` OAuth scope and no project IAM roles
- Secure Boot: disabled to avoid Linux lockdown restrictions while testing tracing/eBPF programs

`e2-micro` is intentionally small. It is fine for loading and smoke-testing a prebuilt agent, but compiling Go plus BPF objects on the VM will be slow. Use `-var machine_type=e2-small` temporarily if you need interactive builds, then switch back or destroy the VM.

## Deploy

```sh
cd stacks/gcp-ebpf-vm
terraform init
terraform plan
terraform apply
```

SSH:

```sh
gcloud compute ssh ebpf-agent-test \
  --project watchmen-test-488807 \
  --zone us-central1-a \
  --tunnel-through-iap
```

Verify eBPF support:

```sh
uname -a
sudo bpftool feature probe kernel
```

## Agent Implementation Outline

Use a tiny privileged agent process on the VM:

1. Build the eBPF program with `clang` or `bpf2go`.
2. Load it from Go with `github.com/cilium/ebpf`.
3. Attach to stable hooks first:
   - tracepoint `syscalls/sys_enter_execve` for process execution telemetry
   - tracepoint `syscalls/sys_enter_connect` or `tcp/tcp_connect` for outbound connection telemetry
   - kprobe/tcp tracepoints only after validating kernel compatibility
4. Send events from kernel to user space with a ring buffer.
5. Batch and forward events to the Watchmen backend over HTTPS or OpenTelemetry.
6. Run as root or grant the binary the required capabilities. During early testing, root is simpler.

For production, prefer CO-RE builds with BTF, pin map schemas, cap event size, and add backpressure handling so the agent fails closed by dropping telemetry rather than blocking workloads.

## Destroy

```sh
terraform destroy
```
