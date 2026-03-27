#!/usr/bin/env bash
# Imports existing GCP resources into Terraform state.
# Run this once after moving to the gcp/ folder if resources already exist.
# Usage: bash scripts/terraform/gcp/import.sh [--project=<id>]
set -euo pipefail

cd "$(dirname "$0")"

PROJECT="watchmen-test-488807"

for arg in "$@"; do
  case $arg in
    --project=*) PROJECT="${arg#*=}" ;;
  esac
done

echo "→ Importing existing GCP resources into state (project: $PROJECT)..."

# Service Accounts
terraform import google_service_account.etl      "projects/$PROJECT/serviceAccounts/wm-test-etl@$PROJECT.iam.gserviceaccount.com"
terraform import google_service_account.reporting "projects/$PROJECT/serviceAccounts/wm-test-reporting@$PROJECT.iam.gserviceaccount.com"
terraform import google_service_account.cicd      "projects/$PROJECT/serviceAccounts/wm-test-cicd@$PROJECT.iam.gserviceaccount.com"

# IAM bindings
terraform import "google_project_iam_member.etl_storage_admin"   "$PROJECT roles/storage.admin serviceAccount:wm-test-etl@$PROJECT.iam.gserviceaccount.com"
terraform import "google_project_iam_member.reporting_bq_viewer"  "$PROJECT roles/bigquery.dataViewer serviceAccount:wm-test-reporting@$PROJECT.iam.gserviceaccount.com"
terraform import "google_project_iam_member.cicd_editor"          "$PROJECT roles/editor serviceAccount:wm-test-cicd@$PROJECT.iam.gserviceaccount.com"

# Storage Buckets
terraform import google_storage_bucket.logs    "$PROJECT-wm-logs"
terraform import google_storage_bucket.data    "$PROJECT-wm-data"
terraform import google_storage_bucket.backups "$PROJECT-wm-backups"

# Compute VM
terraform import google_compute_instance.test "projects/$PROJECT/zones/us-central1-a/instances/wm-test-vm"

# Cloud Run
terraform import google_cloud_run_v2_service.hello "projects/$PROJECT/locations/us-central1/services/wm-test-hello"
terraform import google_cloud_run_v2_service.api   "projects/$PROJECT/locations/us-central1/services/wm-test-api"

# Cloud SQL
terraform import google_sql_database_instance.test "$PROJECT/wm-test-sql"

# BigQuery
terraform import google_bigquery_dataset.analytics  "projects/$PROJECT/datasets/wm_test_analytics"
terraform import google_bigquery_dataset.logs        "projects/$PROJECT/datasets/wm_test_logs"
terraform import google_bigquery_dataset.ml_features "projects/$PROJECT/datasets/wm_test_ml_features"

# Pub/Sub
terraform import google_pubsub_topic.events  "projects/$PROJECT/topics/wm-test-events"
terraform import google_pubsub_topic.alerts  "projects/$PROJECT/topics/wm-test-alerts"
terraform import google_pubsub_topic.metrics "projects/$PROJECT/topics/wm-test-metrics"

# Secret Manager
terraform import google_secret_manager_secret.api_key     "projects/$PROJECT/secrets/wm-test-api-key"
terraform import google_secret_manager_secret.db_password "projects/$PROJECT/secrets/wm-test-db-password"
terraform import google_secret_manager_secret.jwt_secret  "projects/$PROJECT/secrets/wm-test-jwt-secret"

terraform import google_secret_manager_secret_version.api_key     "projects/$PROJECT/secrets/wm-test-api-key/versions/1"
terraform import google_secret_manager_secret_version.db_password "projects/$PROJECT/secrets/wm-test-db-password/versions/1"
terraform import google_secret_manager_secret_version.jwt_secret  "projects/$PROJECT/secrets/wm-test-jwt-secret/versions/1"

# Firewall Rules
terraform import google_compute_firewall.allow_internal  "projects/$PROJECT/global/firewalls/wm-test-allow-internal"
terraform import google_compute_firewall.allow_iap_ssh   "projects/$PROJECT/global/firewalls/wm-test-allow-iap-ssh"
terraform import google_compute_firewall.allow_http_open "projects/$PROJECT/global/firewalls/wm-test-allow-http-open"

echo ""
echo "✓ Import complete. Run 'terraform apply' to sync any config drift."
