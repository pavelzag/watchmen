#!/usr/bin/env bash
# Creates all Watchmen AWS test assets via Terraform.
# Usage: bash scripts/terraform/aws/apply.sh [--region=us-east-1]
set -euo pipefail

cd "$(dirname "$0")"

REGION_VAR=""

for arg in "$@"; do
  case $arg in
    --region=*) REGION_VAR="-var=aws_region=${arg#*=}" ;;
  esac
done

echo "→ Initialising Terraform..."
terraform init -upgrade

echo "→ Applying (RDS may take 5–10 min)..."
# shellcheck disable=SC2086
terraform apply -auto-approve $REGION_VAR

echo ""
echo "✓ Done. Trigger a Watchmen scan to see the new assets."
terraform output
