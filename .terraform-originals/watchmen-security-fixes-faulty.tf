terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# ---------------------------------------------------------------------------
# Fix 1 & 2: Remove public write access from the publicly-writable bucket
# "watchmen-test-488807-wm-attack-public-uploads"
# ---------------------------------------------------------------------------

# Remove allUsers objectAdmin binding from the writable bucket
resource "google_storage_bucket_iam_binding" "watchmen-remove-public-write-uploads" {
  bucket  = "watchmen-test-488807-wm-attack-public-uploads"
  role    = "roles/storage.objectAdmin"
  members = []
}

# Remove allUsers objectViewer binding from the writable bucket (defense in depth)
resource "google_storage_bucket_iam_binding" "watchmen-remove-public-read-uploads" {
  bucket  = "watchmen-test-488807-wm-attack-public-uploads"
  role    = "roles/storage.objectViewer"
  members = []
}

# Remove allUsers objectCreator binding from the writable bucket (defense in depth)
resource "google_storage_bucket_iam_binding" "watchmen-remove-public-create-uploads" {
  bucket  = "watchmen-test-488807-wm-attack-public-uploads"
  role    = "roles/storage.objectCreator"
  members = []
}

# Apply uniform bucket-level access to the writable bucket to prevent ACL bypasses
resource "google_storage_bucket" "watchmen-harden-public-uploads-bucket" {
  name                        = "watchmen-test-488807-wm-attack-public-uploads"
  location                    = "US"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}

# ---------------------------------------------------------------------------
# Fix 3: Restrict SA wm-test-cicd from accessing the now-public-writable bucket
# Enforce least privilege – remove any broad storage roles, grant only what is needed
# ---------------------------------------------------------------------------

# Ensure the CI/CD service account does NOT have objectAdmin on the writable bucket
resource "google_storage_bucket_iam_binding" "watchmen-cicd-sa-no-admin-uploads" {
  bucket  = "watchmen-test-488807-wm-attack-public-uploads"
  role    = "roles/storage.objectAdmin"
  members = []

  depends_on = [
    google_storage_bucket_iam_binding.watchmen-remove-public-write-uploads
  ]
}

# ---------------------------------------------------------------------------
# Fix 4: Restrict SA wm-attack-escalation-sa from accessing the writable bucket
# ---------------------------------------------------------------------------

resource "google_storage_bucket_iam_binding" "watchmen-escalation-sa-no-admin-uploads" {
  bucket  = "watchmen-test-488807-wm-attack-public-uploads"
  role    = "roles/storage.objectAdmin"
  members = []

  depends_on = [
    google_storage_bucket_iam_binding.watchmen-remove-public-write-uploads
  ]
}

# Deny escalation SA project-level storage admin to prevent bucket-level privilege escalation
resource "google_project_iam_binding" "watchmen-escalation-sa-no-project-storage-admin" {
  project = "watchmen-test-488807"
  role    = "roles/storage.admin"
  members = []
}

# Deny escalation SA project-level editor to enforce least privilege
resource "google_project_iam_binding" "watchmen-escalation-sa-no-project-editor" {
  project = "watchmen-test-488807"
  role    = "roles/editor"
  members = []
}

# ---------------------------------------------------------------------------
# Fix 5: Remove public read access from "theinsite-scraped-images"
# ---------------------------------------------------------------------------

resource "google_storage_bucket_iam_binding" "watchmen-remove-public-read-theinsite-images" {
  bucket  = "theinsite-scraped-images"
  role    = "roles/storage.objectViewer"
  members = []
}

# Apply uniform bucket-level access to the theinsite bucket
resource "google_storage_bucket" "watchmen-harden-theinsite-images-bucket" {
  name                        = "theinsite-scraped-images"
  location                    = "US"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}

# ---------------------------------------------------------------------------
# Fix 6: Remove public read access from "watchmen-test-488807-wm-attack-public-data"
# ---------------------------------------------------------------------------

resource "google_storage_bucket_iam_binding" "watchmen-remove-public-read-attack-data" {
  bucket  = "watchmen-test-488807-wm-attack-public-data"
  role    = "roles/storage.objectViewer"
  members = []
}

# Apply uniform bucket-level access to the attack-public-data bucket
resource "google_storage_bucket" "watchmen-harden-public-data-bucket" {
  name                        = "watchmen-test-488807-wm-attack-public-data"
  location                    = "US"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}

# ---------------------------------------------------------------------------
# Fix 7: Restrict zagalsky@gmail.com owner/editor across all affected projects
# Replace broad owner/editor with no binding (access should be granted per role as needed)
# ---------------------------------------------------------------------------

resource "google_project_iam_binding" "watchmen-remove-owner-theinsite" {
  project = "theinsite"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-theinsite" {
  project = "theinsite"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-bonvoyage" {
  project = "bonvoyage-489606"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-bonvoyage" {
  project = "bonvoyage-489606"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-gen-lang-0760991201" {
  project = "gen-lang-client-0760991201"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-gen-lang-0760991201" {
  project = "gen-lang-client-0760991201"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-watchmen-test" {
  project = "watchmen-test-488807"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-watchmen-test" {
  project = "watchmen-test-488807"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-gen-lang-0605201272" {
  project = "gen-lang-client-0605201272"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-gen-lang-0605201272" {
  project = "gen-lang-client-0605201272"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-bookondemand" {
  project = "bookondemand-711e9"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-bookondemand" {
  project = "bookondemand-711e9"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-api-8868282396434458803" {
  project = "api-8868282396434458803-112515"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-api-8868282396434458803" {
  project = "api-8868282396434458803-112515"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-shiftmanagerapi" {
  project = "shiftmanagerapi"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-shiftmanagerapi" {
  project = "shiftmanagerapi"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-quickstart-1549282262743" {
  project = "quickstart-1549282262743"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-quickstart-1549282262743" {
  project = "quickstart-1549282262743"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-quickstart-1549282013765" {
  project = "quickstart-1549282013765"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-quickstart-1549282013765" {
  project = "quickstart-1549282013765"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-viatest1-33897" {
  project = "viatest1-33897"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-viatest1-33897" {
  project = "viatest1-33897"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-raspgen-spreadsheet" {
  project = "raspgen-spreadsheet"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-raspgen-spreadsheet" {
  project = "raspgen-spreadsheet"
  role    = "roles/editor"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-owner-camvision-188315" {
  project = "camvision-188315"
  role    = "roles/owner"
  members = []
}

resource "google_project_iam_binding" "watchmen-remove-editor-camvision-188315" {
  project = "camvision-188315"
  role    = "roles/editor"
  members = []
}

# ---------------------------------------------------------------------------
# Fix 8: Restrict the CI/CD service account to least privilege on watchmen project
# Grant only the minimal roles needed for CI/CD operations instead of broad access
# ---------------------------------------------------------------------------

resource "google_project_iam_member" "watchmen-cicd-sa-minimal-role" {
  project = "watchmen-test-488807"
  role    = "roles/cloudbuild.builds.builder"
  member  = "serviceAccount:wm-test-cicd@watchmen-test-488807.iam.gserviceaccount.com"
}

# Revoke any project-level editor or owner from CI/CD SA
resource "google_project_iam_binding" "watchmen-cicd-sa-no-project-editor" {
  project = "watchmen-test-488807"
  role    = "roles/editor"
  members = []
}

# Revoke any project-level owner from CI/CD SA
resource "google_project_iam_binding" "watchmen-cicd-sa-no-project-owner" {
  project = "watchmen-test-488807"
  role    = "roles/owner"
  members = []
}

# ---------------------------------------------------------------------------
# Fix 9: Restrict firewall rule "default-allow-rdp" - change source range from
# 0.0.0.0/0 to internal only (10.0.0.0/8) to block internet RDP access on port 3389
# ---------------------------------------------------------------------------

resource "google_compute_firewall" "default-allow-rdp" {
  name    = "default-allow-rdp"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["3389"]
  }

  source_ranges = ["10.0.0.0/8"]
}

# ---------------------------------------------------------------------------
# Fix 10: Restrict firewall rule "default-allow-ssh" - change source range from
# 0.0.0.0/0 to internal only (10.0.0.0/8) to block internet SSH access on port 22
# ---------------------------------------------------------------------------

resource "google_compute_firewall" "default-allow-ssh" {
  name    = "default-allow-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["10.0.0.0/8"]
}