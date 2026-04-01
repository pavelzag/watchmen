#!/usr/bin/env bash
# Import existing GCP resources into this Terraform state.
# Run once from the faulty/ directory after `terraform init`.
set -e

PROJECT="watchmen-test-488807"
REGION="us-central1"
ZONE="us-central1-a"

echo "==> Importing storage buckets..."
terraform import google_storage_bucket.attack_public_data  "${PROJECT}-wm-attack-public-data"
terraform import google_storage_bucket.attack_public_uploads "${PROJECT}-wm-attack-public-uploads"

echo "==> Importing firewall rules..."
terraform import google_compute_firewall.attack_open_ssh      "projects/${PROJECT}/global/firewalls/wm-attack-open-ssh"
terraform import google_compute_firewall.attack_open_rdp      "projects/${PROJECT}/global/firewalls/wm-attack-open-rdp"
terraform import google_compute_firewall.attack_open_db_ports "projects/${PROJECT}/global/firewalls/wm-attack-open-db-ports"
terraform import google_compute_firewall.attack_allow_all     "projects/${PROJECT}/global/firewalls/wm-attack-allow-all-ingress"

echo "==> Importing Cloud Run services..."
terraform import google_cloud_run_v2_service.attack_leaked_aws_creds "projects/${PROJECT}/locations/${REGION}/services/wm-attack-leaked-aws-creds"
terraform import google_cloud_run_v2_service.attack_stripe_key       "projects/${PROJECT}/locations/${REGION}/services/wm-attack-stripe-key"
terraform import google_cloud_run_v2_service.attack_github_token     "projects/${PROJECT}/locations/${REGION}/services/wm-attack-github-runner"
terraform import google_cloud_run_v2_service.attack_db_password_env  "projects/${PROJECT}/locations/${REGION}/services/wm-attack-db-password-env"

echo "==> Importing service accounts..."
terraform import google_service_account.attack_escalation_sa "projects/${PROJECT}/serviceAccounts/wm-attack-escalation-sa@${PROJECT}.iam.gserviceaccount.com"
terraform import google_service_account.attack_owner_sa      "projects/${PROJECT}/serviceAccounts/wm-attack-owner-sa@${PROJECT}.iam.gserviceaccount.com"
terraform import google_service_account.attack_multikey_sa   "projects/${PROJECT}/serviceAccounts/wm-attack-multikey-sa@${PROJECT}.iam.gserviceaccount.com"
terraform import google_service_account.attack_exposed_cicd  "projects/${PROJECT}/serviceAccounts/wm-attack-exposed-cicd@${PROJECT}.iam.gserviceaccount.com"

echo "==> Importing Cloud Run services (batch 2)..."
terraform import google_cloud_run_v2_service.attack_public_internal_api "projects/${PROJECT}/locations/${REGION}/services/wm-attack-public-internal-api"
terraform import google_cloud_run_v2_service.attack_public_api          "projects/${PROJECT}/locations/${REGION}/services/wm-attack-public-api"

echo "==> Importing compute instances..."
terraform import google_compute_instance.attack_privileged_vm "${PROJECT}/${ZONE}/wm-attack-privileged-vm"
terraform import google_compute_instance.attack_exposed_vm    "${PROJECT}/${ZONE}/wm-attack-exposed-vm"
terraform import google_compute_instance.attack_dev_instance  "${PROJECT}/${ZONE}/wm-attack-dev-instance"

echo "==> Done. Run 'terraform plan' to verify."
