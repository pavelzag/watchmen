#!/usr/bin/env bash
# Destroys all Watchmen AWS test assets created by apply.sh.
# Usage: bash scripts/terraform/aws/destroy.sh [--region=us-east-1]
set -euo pipefail

cd "$(dirname "$0")"

REGION_VAR=""

for arg in "$@"; do
  case $arg in
    --region=*) REGION_VAR="-var=aws_region=${arg#*=}" ;;
  esac
done

echo "→ Destroying all AWS test assets (this is irreversible)..."
# shellcheck disable=SC2086
terraform destroy -auto-approve $REGION_VAR

echo "✓ All AWS test assets removed."
