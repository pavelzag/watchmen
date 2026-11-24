# Watchmen × Shirudo — Enterprise Hardened VM & OTel Blueprints

This directory provides production-oriented blueprints for deploying **Shirudo-protected Linux targets** (requiring a Shirudo-compatible `bpf-next` kernel image, `systemd` 256+ UKI boot, and TPM 2.0 / vTPM) and streaming their telemetry to Watchmen (`v0.10.0`).

## Contents

- `otel-collector-shirudo.yaml`: OpenTelemetry Collector (Go 1.24+) config that terminates TLS 1.3 with hybrid PQC (`X25519MLKEM768`) from Shirudo nodes and forwards OTLP/HTTP JSON logs and metrics directly to Watchmen (`/api/ingest/shirudo/v1/logs` and `/v1/metrics`) without altering `body.stringValue` (so `shirudo.quote` cryptographic signatures stay intact).
- `terraform/gcp-shirudo-vm/`: Terraform blueprint provisioning a Shielded GCE VM (`enable_vtpm = true`, `enable_secure_boot = true`, `enable_integrity_monitoring = true`) configured for Shirudo OTLP keepalives and map exports.

## Quick Setup (OTel Collector -> Watchmen)

1. Generate a Watchmen Personal API Token (`wm_...`) in **Settings → Integrations**.
2. Export environment variables for the OpenTelemetry Collector:
   ```bash
   export WATCHMEN_BASE_URL="https://your-watchmen-host.example"
   export WATCHMEN_API_TOKEN="wm_..."
   ```
3. Run an OpenTelemetry Collector built with Go 1.24+ (for `X25519MLKEM768` TLS 1.3 hybrid key exchange):
   ```bash
   otelcol-contrib --config=scripts/shirudo/otel-collector-shirudo.yaml
   ```
4. Point your Shirudo target's `etc/shirudo/shirudo.conf` (`map_export.otel_endpoint`) at the collector, or directly at `${WATCHMEN_BASE_URL}/api/ingest/shirudo` if TLS is terminated by a PQC-capable proxy.
