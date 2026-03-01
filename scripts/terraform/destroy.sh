#!/usr/bin/env bash
# Destroys all Watchmen test assets created by apply.sh.
# Usage: bash scripts/terraform/destroy.sh [--project=<id>]
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_VAR=""

for arg in "$@"; do
  case $arg in
    --project=*) PROJECT_VAR="-var=project_id=${arg#*=}" ;;
  esac
done

echo "→ Destroying all test assets (this is irreversible)..."
# shellcheck disable=SC2086
terraform destroy -auto-approve $PROJECT_VAR

echo "✓ All test assets removed."
