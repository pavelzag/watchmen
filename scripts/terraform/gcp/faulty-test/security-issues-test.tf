terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

# ============================================================================
# Watchmen Security Test Scenarios — 20 Deliberately Misconfigured Resources
#
# Severity distribution:
#   CRITICAL : 6  (scenarios 01–06)
#   HIGH     : 6  (scenarios 07–12)
#   MEDIUM   : 5  (scenarios 13–17)
#   LOW      : 4  (scenarios 18–21) [no-cost config flags only]
#
# COST ESTIMATE (monthly):
#   Storage buckets (5)  : $0   (empty)
#   Service accounts (4) : $0
#   SA keys (5)          : $0
#   Firewall rules (4)   : $0
#   Cloud Run (3)        : $0   (0 min instances)
#   Cloud SQL (1)        : ~$9  (db-f1-micro, zonal)
#   Compute VMs (2)      : ~$7  (e2-micro preemptible × 2)
#   TOTAL                : ~$16 / month
#
# Apply in the watchmen-test project ONLY. Destroy when not in use.
# ============================================================================

variable "project_id" {
  type    = string
  default = "watchmen-test-488807"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "zone" {
  type    = string
  default = "us-central1-a"
}

# ── SCENARIO 01 ──────────────────────────────────────────────────────────────
# CRITICAL — Public bucket: allUsers objectAdmin (full read/write/delete)
# Chain: Public Writable Bucket → SA Privilege Escalation

resource "google_storage_bucket" "ft_public_rw_bucket" {
  name          = "${var.project_id}-ft-public-rw"
  location      = "US-CENTRAL1"
  storage_class = "STANDARD"
  force_destroy = true
  uniform_bucket_level_access = true
}

resource "google_storage_bucket_iam_member" "ft_public_rw_allUsers_admin" {
  bucket = google_storage_bucket.ft_public_rw_bucket.name
  role   = "roles/storage.objectAdmin"
  member = "allUsers"
}

# ── SCENARIO 02 ──────────────────────────────────────────────────────────────
# CRITICAL — Public bucket: allAuthenticatedUsers objectViewer (data exfiltration)
# Triggers: public_bucket finding

resource "google_storage_bucket" "ft_public_ro_bucket" {
  name          = "${var.project_id}-ft-public-ro"
  location      = "US-CENTRAL1"
  storage_class = "STANDARD"
  force_destroy = true
  uniform_bucket_level_access = true
}

resource "google_storage_bucket_iam_member" "ft_public_ro_allAuth_viewer" {
  bucket = google_storage_bucket.ft_public_ro_bucket.name
  role   = "roles/storage.objectViewer"
  member = "allAuthenticatedUsers"
}

# ── SCENARIO 03 ──────────────────────────────────────────────────────────────
# CRITICAL — Firewall: SSH (port 22) open to 0.0.0.0/0
# Chain: Internet → Open Firewall → VM → Privileged SA

resource "google_compute_firewall" "ft_open_ssh" {
  name    = "ft-open-ssh"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# ── SCENARIO 04 ──────────────────────────────────────────────────────────────
# CRITICAL — Firewall: RDP (port 3389) open to 0.0.0.0/0
# Ransomware / lateral movement entry point

resource "google_compute_firewall" "ft_open_rdp" {
  name    = "ft-open-rdp"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "tcp"
    ports    = ["3389"]
  }
}

# ── SCENARIO 05 ──────────────────────────────────────────────────────────────
# CRITICAL — Firewall: all protocols open to 0.0.0.0/0
# Completely open network perimeter

resource "google_compute_firewall" "ft_allow_all_ingress" {
  name    = "ft-allow-all-ingress"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]

  allow { protocol = "all" }
}

# ── SCENARIO 06 ──────────────────────────────────────────────────────────────
# CRITICAL — Unauthenticated Cloud Run service running a privileged service account
# Chain: Unauthenticated Cloud Run → Privileged SA

resource "google_service_account" "ft_privileged_sa" {
  account_id   = "ft-privileged-sa"
  display_name = "FT: Privileged SA (owner)"
}

resource "google_project_iam_member" "ft_privileged_sa_owner" {
  project = var.project_id
  role    = "roles/owner"
  member  = "serviceAccount:${google_service_account.ft_privileged_sa.email}"
}

resource "google_cloud_run_v2_service" "ft_unauth_privileged_run" {
  name     = "ft-unauth-privileged-run"
  location = var.region

  template {
    service_account = google_service_account.ft_privileged_sa.email
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
    }
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
  }

  depends_on = [google_project_iam_member.ft_privileged_sa_owner]
}

resource "google_cloud_run_v2_service_iam_member" "ft_unauth_privileged_run_allUsers" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.ft_unauth_privileged_run.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── SCENARIO 07 ──────────────────────────────────────────────────────────────
# HIGH — Service account with project-level editor role
# Triggers: sa_owner_editor finding

resource "google_service_account" "ft_editor_sa" {
  account_id   = "ft-editor-sa"
  display_name = "FT: SA with Editor Role"
}

resource "google_project_iam_member" "ft_editor_sa_binding" {
  project = var.project_id
  role    = "roles/editor"
  member  = "serviceAccount:${google_service_account.ft_editor_sa.email}"
}

# ── SCENARIO 08 ──────────────────────────────────────────────────────────────
# HIGH — CI/CD service account with editor role and two user-managed keys
# Triggers: sa_owner_editor + multiple_sa_keys

resource "google_service_account" "ft_cicd_sa" {
  account_id   = "ft-cicd-sa"
  display_name = "FT: CI/CD SA (editor + 2 keys)"
}

resource "google_project_iam_member" "ft_cicd_sa_editor" {
  project = var.project_id
  role    = "roles/editor"
  member  = "serviceAccount:${google_service_account.ft_cicd_sa.email}"
}

resource "google_service_account_key" "ft_cicd_key_1" {
  service_account_id = google_service_account.ft_cicd_sa.name
}

resource "google_service_account_key" "ft_cicd_key_2" {
  service_account_id = google_service_account.ft_cicd_sa.name
}

# ── SCENARIO 09 ──────────────────────────────────────────────────────────────
# HIGH — Cloud Run service with AWS credentials hardcoded in environment variables
# Triggers: secret_in_env (AWS Access Key ID pattern)

resource "google_cloud_run_v2_service" "ft_leaked_aws_creds" {
  name     = "ft-leaked-aws-creds"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      env {
        name  = "AWS_ACCESS_KEY_ID"
        value = "AKIAIOSFODNN7EXAMPLE"
      }
      env {
        name  = "AWS_SECRET_ACCESS_KEY"
        value = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      }

      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
    }
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
  }
}

# ── SCENARIO 10 ──────────────────────────────────────────────────────────────
# HIGH — Cloud Run service with database password in plaintext environment variable
# Triggers: secret_in_env (high-entropy secret-named value)

resource "google_cloud_run_v2_service" "ft_db_password_env" {
  name     = "ft-db-password-env"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      env {
        name  = "DATABASE_PASSWORD"
        value = "Sup3rS3cr3tProdDbP@ssw0rd2024!"
      }
      env {
        name  = "DATABASE_URL"
        value = "postgresql://admin:Sup3rS3cr3tProdDbP@ssw0rd2024!@10.1.0.10:5432/prod"
      }

      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
    }
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
  }
}

# ── SCENARIO 11 ──────────────────────────────────────────────────────────────
# HIGH — VM with external IP running a privileged service account
# Combined with open firewall rules (scenarios 03–05) completes the
# Internet → Open Firewall → VM → Privileged SA attack chain

resource "google_compute_instance" "ft_privileged_vm" {
  name         = "ft-privileged-vm"
  machine_type = "e2-micro"
  zone         = var.zone

  scheduling {
    preemptible         = false
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
  }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10
      type  = "pd-standard"
    }
  }

  network_interface {
    network = "default"
    access_config {} # ephemeral public IP
  }

  service_account {
    email  = google_service_account.ft_privileged_sa.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  depends_on = [google_project_iam_member.ft_privileged_sa_owner]
}

# ── SCENARIO 12 ──────────────────────────────────────────────────────────────
# HIGH — Service account with 3 user-managed keys (excessive key exposure surface)
# Triggers: multiple_sa_keys finding

resource "google_service_account" "ft_multikey_sa" {
  account_id   = "ft-multikey-sa"
  display_name = "FT: SA with Three Keys"
}

resource "google_service_account_key" "ft_multikey_1" {
  service_account_id = google_service_account.ft_multikey_sa.name
}

resource "google_service_account_key" "ft_multikey_2" {
  service_account_id = google_service_account.ft_multikey_sa.name
}

resource "google_service_account_key" "ft_multikey_3" {
  service_account_id = google_service_account.ft_multikey_sa.name
}

# ── SCENARIO 13 ──────────────────────────────────────────────────────────────
# MEDIUM — Cloud SQL instance with a public IP address
# Triggers: sql_public_ip finding

resource "google_sql_database_instance" "ft_public_sql" {
  name             = "ft-public-sql"
  database_version = "POSTGRES_15"
  region           = var.region

  deletion_protection = false

  settings {
    tier = "db-f1-micro"

    ip_configuration {
      ipv4_enabled = true # public IP — should be false with private IP only
    }

    backup_configuration {
      enabled = false # no backups — scenario 14
    }
  }
}

# ── SCENARIO 14 ──────────────────────────────────────────────────────────────
# MEDIUM — Cloud SQL instance with automated backups disabled
# Triggers: sql_no_backup finding (same instance as scenario 13 — two findings)

# (Backups disabled via backup_configuration.enabled = false above)

# ── SCENARIO 15 ──────────────────────────────────────────────────────────────
# MEDIUM — VM with external IP and no service account (unmonitored attack surface)
# Triggers: vm_external_ip finding

resource "google_compute_instance" "ft_exposed_vm_no_sa" {
  name         = "ft-exposed-vm-no-sa"
  machine_type = "e2-micro"
  zone         = var.zone

  scheduling {
    preemptible         = true
    automatic_restart   = false
    on_host_maintenance = "TERMINATE"
  }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10
      type  = "pd-standard"
    }
  }

  network_interface {
    network = "default"
    access_config {} # ephemeral public IP, no service_account block
  }
}

# ── SCENARIO 16 ──────────────────────────────────────────────────────────────
# MEDIUM — Unauthenticated Cloud Run service (low-privilege SA — less critical than 06)
# Triggers: cloud_run_public finding

resource "google_cloud_run_v2_service" "ft_unauth_run" {
  name     = "ft-unauth-run"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
    }
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "ft_unauth_run_allUsers" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.ft_unauth_run.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── SCENARIO 17 ──────────────────────────────────────────────────────────────
# MEDIUM — Storage bucket without uniform bucket-level access
# Allows legacy per-object ACLs, creating inconsistent access control
# Triggers: bucket_no_uniform_access finding

resource "google_storage_bucket" "ft_no_uniform_access_bucket" {
  name          = "${var.project_id}-ft-no-uniform-access"
  location      = "US-CENTRAL1"
  storage_class = "STANDARD"
  force_destroy = true

  uniform_bucket_level_access = false # should be true
}

# ── SCENARIO 18 ──────────────────────────────────────────────────────────────
# LOW — Storage bucket with versioning disabled
# Data loss risk: overwrites and deletions are not recoverable
# Triggers: bucket_no_versioning finding

resource "google_storage_bucket" "ft_no_versioning_bucket" {
  name          = "${var.project_id}-ft-no-versioning"
  location      = "US-CENTRAL1"
  storage_class = "STANDARD"
  force_destroy = true
  uniform_bucket_level_access = true

  # versioning block intentionally omitted — defaults to disabled
}

# ── SCENARIO 19 ──────────────────────────────────────────────────────────────
# LOW — Firewall rule allowing ICMP from the internet
# Enables network reconnaissance (ping sweeps, path tracing)
# Triggers: public_firewall (low severity — ICMP only)

resource "google_compute_firewall" "ft_allow_icmp" {
  name    = "ft-allow-icmp-internet"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "icmp"
  }
}

# ── SCENARIO 20 ──────────────────────────────────────────────────────────────
# LOW — Storage bucket with no retention or lifecycle policy
# Indefinite data accumulation; no data minimisation compliance
# Triggers: bucket_no_retention_policy finding

resource "google_storage_bucket" "ft_no_retention_bucket" {
  name          = "${var.project_id}-ft-no-retention"
  location      = "US-CENTRAL1"
  storage_class = "STANDARD"
  force_destroy = true
  uniform_bucket_level_access = true

  # No lifecycle_rule or retention_policy block — findings expected
}

# ── SCENARIO 21 ──────────────────────────────────────────────────────────────
# LOW — Service account key with no rotation constraint
# Long-lived key with no expiry increases credential exposure window
# Triggers: sa_key_no_rotation finding

resource "google_service_account" "ft_stale_key_sa" {
  account_id   = "ft-stale-key-sa"
  display_name = "FT: SA with Unrotated Key"
}

resource "google_service_account_key" "ft_stale_key" {
  service_account_id = google_service_account.ft_stale_key_sa.name
  # No key_algorithm or valid_after constraints — key never expires
}
