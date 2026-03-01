#!/usr/bin/env bash
# Creates all Watchmen test assets via Terraform.
# Usage: bash scripts/terraform/apply.sh [--project=<id>] [--users=a@b.com,c@d.com]
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_VAR=""
USERS_VAR=""

for arg in "$@"; do
  case $arg in
    --project=*) PROJECT_VAR="-var=project_id=${arg#*=}" ;;
    --users=*)   USERS_VAR="-var=test_user_emails=[$(echo "${arg#*=}" | sed 's/,/\",\"/g; s/^/\"/; s/$/\"/')]" ;;
  esac
done

echo "→ Initialising Terraform..."
terraform init -upgrade

echo "→ Applying (GKE + Cloud SQL may take 5–10 min)..."
# shellcheck disable=SC2086
terraform apply -auto-approve $PROJECT_VAR $USERS_VAR

echo ""
echo "✓ Done. Trigger a Watchmen scan to see the new assets."
terraform output
