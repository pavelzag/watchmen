#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Watchmen — GCP test environment setup
# Creates a test project with fake users and resources for development.
# Run once: bash scripts/setup-gcp-test.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

PROJECT_ID="watchmen-test-001"
BILLING_ACCOUNT=""   # Set your billing account ID if needed (e.g. 01ABCD-EF1234-567890)
                     # GCS buckets need billing. Leave empty to skip bucket creation.

# Test user emails (use real Gmail accounts you control)
TEST_VIEWER="testviewer@gmail.com"
TEST_EDITOR="testeditor@gmail.com"
TEST_ADMIN="testadmin@gmail.com"

echo "→ Creating project $PROJECT_ID ..."
gcloud projects create "$PROJECT_ID" --name="Watchmen Test" 2>/dev/null || echo "  (project already exists)"

echo "→ Setting active project ..."
gcloud config set project "$PROJECT_ID"

if [ -n "$BILLING_ACCOUNT" ]; then
  echo "→ Linking billing account ..."
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
fi

echo "→ Enabling required APIs ..."
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  storage.googleapis.com \
  container.googleapis.com

echo "→ Creating IAM bindings for test users ..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="user:$TEST_VIEWER" --role="roles/viewer" --quiet

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="user:$TEST_EDITOR" --role="roles/editor" --quiet

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="user:$TEST_ADMIN" --role="roles/owner" --quiet

echo "→ Creating service accounts ..."
gcloud iam service-accounts create data-pipeline-sa \
  --display-name="Data Pipeline SA" \
  --description="Test SA for ETL pipeline" 2>/dev/null || true

gcloud iam service-accounts create reporting-sa \
  --display-name="Reporting SA" \
  --description="Read-only reporting SA" 2>/dev/null || true

echo "→ Granting service account roles ..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:data-pipeline-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.admin" --quiet

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:reporting-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/viewer" --quiet

if [ -n "$BILLING_ACCOUNT" ]; then
  echo "→ Creating test storage buckets ..."
  gsutil mb -p "$PROJECT_ID" -l US-CENTRAL1 "gs://accounting_bucket_${PROJECT_ID}" 2>/dev/null || true
  gsutil mb -p "$PROJECT_ID" -l US "gs://logs_archive_${PROJECT_ID}" 2>/dev/null || true

  echo "→ Setting bucket IAM ..."
  gsutil iam ch \
    "user:${TEST_VIEWER}:objectViewer" \
    "user:${TEST_EDITOR}:objectAdmin" \
    "gs://accounting_bucket_${PROJECT_ID}"
fi

echo "→ Creating Watchmen reader service account ..."
gcloud iam service-accounts create watchmen-reader \
  --display-name="Watchmen IAM Reader" \
  --description="Used by the Watchmen app to read IAM policies" 2>/dev/null || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.securityReviewer" --quiet

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer" --quiet

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/container.viewer" --quiet

echo ""
echo "✓ Done! To generate the service account key:"
echo ""
echo "  gcloud iam service-accounts keys create key.json \\"
echo "    --iam-account=watchmen-reader@${PROJECT_ID}.iam.gserviceaccount.com"
echo ""
echo "  Then base64-encode it for .env.local:"
echo "  base64 -i key.json | tr -d '\\n'"
echo ""
echo "  Set GCP_PROJECTS=${PROJECT_ID} in .env.local and USE_MOCK_DATA=false"
