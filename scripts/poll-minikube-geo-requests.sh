#!/usr/bin/env bash
set -euo pipefail

# Generate request traffic with rotating public source IP headers. Watchmen
# resolves these IPs to geographical locations when WATCHMEN_IP_GEO_ENABLED=1.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Generate geo-tagged request traffic for the local minikube demo.

Usage:
  scripts/poll-minikube-geo-requests.sh [options]

Options are passed to poll-minikube-watchmen-demo.sh. The script always enables
rotating public source IP headers, so --external is not required.

Examples:
  scripts/poll-minikube-geo-requests.sh --profile=watchmen-minikube --requests=200 --pause=0.05
  scripts/poll-minikube-geo-requests.sh --profile=watchmen-minikube --requests=40 --path=/api/products
  scripts/poll-minikube-geo-requests.sh --profile=watchmen-minikube --source-ip=8.8.8.8
USAGE
  exit 0
fi

exec "${SCRIPT_DIR}/poll-minikube-watchmen-demo.sh" --external "$@"
