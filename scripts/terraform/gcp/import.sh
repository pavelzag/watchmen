#!/usr/bin/env bash
# Imports existing GCP resources into Terraform state.
# Run this once if resources already exist but state is missing.
# Usage: bash scripts/terraform/gcp/import.sh [--project=<id>]
set -uo pipefail  # no -e so individual import failures don't abort the run

cd "$(dirname "$0")"

# Import only if not already tracked in state
try_import() {
  local addr="$1" id="$2"
  if terraform state show "$addr" > /dev/null 2>&1; then
    echo "  skip (already managed): $addr"
  else
    terraform import "$addr" "$id"
  fi
}

PROJECT="watchmen-test-488807"

for arg in "$@"; do
  case $arg in
    --project=*) PROJECT="${arg#*=}" ;;
  esac
done

echo "→ Importing existing GCP resources into state (project: $PROJECT)..."

# ── Base infrastructure (main.tf) ─────────────────────────────────────────────

# Service Accounts
try_import google_service_account.etl       "projects/$PROJECT/serviceAccounts/wm-test-etl@$PROJECT.iam.gserviceaccount.com"
try_import google_service_account.reporting "projects/$PROJECT/serviceAccounts/wm-test-reporting@$PROJECT.iam.gserviceaccount.com"
try_import google_service_account.cicd      "projects/$PROJECT/serviceAccounts/wm-test-cicd@$PROJECT.iam.gserviceaccount.com"

# IAM bindings
try_import "google_project_iam_member.etl_storage_admin"    "$PROJECT roles/storage.admin serviceAccount:wm-test-etl@$PROJECT.iam.gserviceaccount.com"
try_import "google_project_iam_member.reporting_bq_viewer"  "$PROJECT roles/bigquery.dataViewer serviceAccount:wm-test-reporting@$PROJECT.iam.gserviceaccount.com"
try_import "google_project_iam_member.cicd_editor"          "$PROJECT roles/editor serviceAccount:wm-test-cicd@$PROJECT.iam.gserviceaccount.com"

# Storage Buckets
try_import google_storage_bucket.logs    "$PROJECT-wm-logs"
try_import google_storage_bucket.data    "$PROJECT-wm-data"
try_import google_storage_bucket.backups "$PROJECT-wm-backups"

# GKE
try_import google_container_cluster.test           "$PROJECT/us-central1-a/wm-test-cluster"
try_import google_container_node_pool.primary_nodes "$PROJECT/us-central1-a/wm-test-cluster/wm-test-node-pool"

# Compute VM
try_import google_compute_instance.test "projects/$PROJECT/zones/us-central1-a/instances/wm-test-vm"

# Cloud Run
try_import google_cloud_run_v2_service.hello "projects/$PROJECT/locations/us-central1/services/wm-test-hello"
try_import google_cloud_run_v2_service.api   "projects/$PROJECT/locations/us-central1/services/wm-test-api"

# Cloud SQL
try_import google_sql_database_instance.test "$PROJECT/wm-test-sql"

# BigQuery
try_import google_bigquery_dataset.analytics  "projects/$PROJECT/datasets/wm_test_analytics"
try_import google_bigquery_dataset.logs        "projects/$PROJECT/datasets/wm_test_logs"
try_import google_bigquery_dataset.ml_features "projects/$PROJECT/datasets/wm_test_ml_features"

# Pub/Sub
try_import google_pubsub_topic.events  "projects/$PROJECT/topics/wm-test-events"
try_import google_pubsub_topic.alerts  "projects/$PROJECT/topics/wm-test-alerts"
try_import google_pubsub_topic.metrics "projects/$PROJECT/topics/wm-test-metrics"

# Secret Manager
try_import google_secret_manager_secret.api_key     "projects/$PROJECT/secrets/wm-test-api-key"
try_import google_secret_manager_secret.db_password "projects/$PROJECT/secrets/wm-test-db-password"
try_import google_secret_manager_secret.jwt_secret  "projects/$PROJECT/secrets/wm-test-jwt-secret"

try_import google_secret_manager_secret_version.api_key     "projects/$PROJECT/secrets/wm-test-api-key/versions/1"
try_import google_secret_manager_secret_version.db_password "projects/$PROJECT/secrets/wm-test-db-password/versions/1"
try_import google_secret_manager_secret_version.jwt_secret  "projects/$PROJECT/secrets/wm-test-jwt-secret/versions/1"

# Firewall Rules
try_import google_compute_firewall.allow_internal  "projects/$PROJECT/global/firewalls/wm-test-allow-internal"
try_import google_compute_firewall.allow_iap_ssh   "projects/$PROJECT/global/firewalls/wm-test-allow-iap-ssh"
try_import google_compute_firewall.allow_http_open "projects/$PROJECT/global/firewalls/wm-test-allow-http-open"

# ── Attack scenario resources (attack-scenarios.tf) ───────────────────────────

# Public buckets
try_import google_storage_bucket.attack_public_data    "$PROJECT-wm-attack-public-data"
try_import google_storage_bucket.attack_public_uploads "$PROJECT-wm-attack-public-uploads"

try_import "google_storage_bucket_iam_member.attack_public_data_allUsers"   "$PROJECT-wm-attack-public-data roles/storage.objectViewer allUsers"
try_import "google_storage_bucket_iam_member.attack_public_uploads_allAuth" "$PROJECT-wm-attack-public-uploads roles/storage.objectAdmin allAuthenticatedUsers"

# Firewall rules
try_import google_compute_firewall.attack_open_ssh      "projects/$PROJECT/global/firewalls/wm-attack-open-ssh"
try_import google_compute_firewall.attack_open_rdp      "projects/$PROJECT/global/firewalls/wm-attack-open-rdp"
try_import google_compute_firewall.attack_open_db_ports "projects/$PROJECT/global/firewalls/wm-attack-open-db-ports"
try_import google_compute_firewall.attack_allow_all     "projects/$PROJECT/global/firewalls/wm-attack-allow-all-ingress"

# Cloud Run services
try_import google_cloud_run_v2_service.attack_leaked_aws_creds   "projects/$PROJECT/locations/us-central1/services/wm-attack-leaked-aws-creds"
try_import google_cloud_run_v2_service.attack_stripe_key          "projects/$PROJECT/locations/us-central1/services/wm-attack-stripe-key"
try_import google_cloud_run_v2_service.attack_github_token        "projects/$PROJECT/locations/us-central1/services/wm-attack-github-runner"
try_import google_cloud_run_v2_service.attack_db_password_env     "projects/$PROJECT/locations/us-central1/services/wm-attack-db-password-env"
try_import google_cloud_run_v2_service.attack_public_internal_api "projects/$PROJECT/locations/us-central1/services/wm-attack-public-internal-api"
try_import google_cloud_run_v2_service.attack_public_api          "projects/$PROJECT/locations/us-central1/services/wm-attack-public-api"

try_import "google_cloud_run_v2_service_iam_member.attack_public_internal_api_allUsers" "projects/$PROJECT/locations/us-central1/services/wm-attack-public-internal-api roles/run.invoker allUsers"
try_import "google_cloud_run_v2_service_iam_member.attack_public_api_allUsers"          "projects/$PROJECT/locations/us-central1/services/wm-attack-public-api roles/run.invoker allUsers"

# Service accounts
try_import google_service_account.attack_escalation_sa "projects/$PROJECT/serviceAccounts/wm-attack-escalation-sa@$PROJECT.iam.gserviceaccount.com"
try_import google_service_account.attack_owner_sa      "projects/$PROJECT/serviceAccounts/wm-attack-owner-sa@$PROJECT.iam.gserviceaccount.com"
try_import google_service_account.attack_multikey_sa   "projects/$PROJECT/serviceAccounts/wm-attack-multikey-sa@$PROJECT.iam.gserviceaccount.com"
try_import google_service_account.attack_exposed_cicd  "projects/$PROJECT/serviceAccounts/wm-attack-exposed-cicd@$PROJECT.iam.gserviceaccount.com"

try_import "google_project_iam_member.attack_escalation_editor"    "$PROJECT roles/editor serviceAccount:wm-attack-escalation-sa@$PROJECT.iam.gserviceaccount.com"
try_import "google_project_iam_member.attack_owner_iam"            "$PROJECT roles/owner serviceAccount:wm-attack-owner-sa@$PROJECT.iam.gserviceaccount.com"
try_import "google_project_iam_member.attack_exposed_cicd_editor"  "$PROJECT roles/editor serviceAccount:wm-attack-exposed-cicd@$PROJECT.iam.gserviceaccount.com"

# Compute VMs
try_import google_compute_instance.attack_privileged_vm "projects/$PROJECT/zones/us-central1-a/instances/wm-attack-privileged-vm"
try_import google_compute_instance.attack_exposed_vm    "projects/$PROJECT/zones/us-central1-a/instances/wm-attack-exposed-vm"
try_import google_compute_instance.attack_dev_instance  "projects/$PROJECT/zones/us-central1-a/instances/wm-attack-dev-instance"

echo ""
echo "✓ Import complete. Run 'terraform plan' to check for any remaining drift."
