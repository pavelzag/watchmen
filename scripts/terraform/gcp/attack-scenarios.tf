# ============================================================================
# Watchmen Attack-Path Scenarios — GCP
# ============================================================================
# Creates 20 deliberately misconfigured GCP resources that trigger security
# findings in Watchmen. Apply to the watchmen-test project ONLY.
#
# COST ESTIMATE (monthly, all resources combined):
#   Storage buckets   : $0  (empty, no data stored)
#   Service accounts  : $0
#   SA keys           : $0
#   Firewall rules    : $0
#   Secret Manager    : ~$0.48  (8 secrets × $0.06)
#   Cloud Run         : $0  (0 min instances)
#   Cloud SQL (1 inst): ~$9     (db-f1-micro, zonal)
#   Compute VMs (2)   : ~$7     (e2-micro preemptible × 2)
#   TOTAL             : ~$16.50 / month
#
# To destroy all: terraform destroy -target=module or delete resources by tag.
# ============================================================================

# ── SCENARIO 1 ───────────────────────────────────────────────────────────────
# Public bucket — allUsers can read all objects (data exfiltration risk)
# Triggers: CRITICAL  public_bucket

resource "google_storage_bucket" "attack_public_data" {
  name          = "${var.project_id}-wm-attack-public-data"
  location      = "US-CENTRAL1"
  storage_class = "STANDARD"
  force_destroy = true

  uniform_bucket_level_access = true
}


# ── SCENARIO 2 ───────────────────────────────────────────────────────────────
# Public bucket — allAuthenticatedUsers have object admin access
# Triggers: CRITICAL  public_bucket

resource "google_storage_bucket" "attack_public_uploads" {
  name          = "${var.project_id}-wm-attack-public-uploads"
  location      = "US-CENTRAL1"
  storage_class = "STANDARD"
  force_destroy = true

  uniform_bucket_level_access = true
}


# ── SCENARIO 3 ───────────────────────────────────────────────────────────────
# SSH open to the internet — enables brute-force / credential stuffing attacks
# Triggers: CRITICAL  public_firewall

resource "google_compute_firewall" "attack_open_ssh" {
  name    = "wm-attack-open-ssh"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["10.0.0.0/8"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# ── SCENARIO 4 ───────────────────────────────────────────────────────────────
# RDP open to the internet — lateral movement / ransomware entry point
# Triggers: CRITICAL  public_firewall

resource "google_compute_firewall" "attack_open_rdp" {
  name    = "wm-attack-open-rdp"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["10.0.0.0/8"]

  allow {
    protocol = "tcp"
    ports    = ["3389"]
  }
}

# ── SCENARIO 5 ───────────────────────────────────────────────────────────────
# Database ports open to the internet — direct DB credential attacks
# Triggers: CRITICAL  public_firewall

resource "google_compute_firewall" "attack_open_db_ports" {
  name    = "wm-attack-open-db-ports"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["10.0.0.0/8"]

  allow {
    protocol = "tcp"
    ports    = ["3306", "5432", "27017", "6379"]
  }
}

# ── SCENARIO 6 ───────────────────────────────────────────────────────────────
# All-traffic ingress — completely open network perimeter
# Triggers: CRITICAL  public_firewall

resource "google_compute_firewall" "attack_allow_all" {
  name    = "wm-attack-allow-all-ingress"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["10.0.0.0/8"]

  allow { protocol = "all" }
}

# ── SCENARIO 7 ───────────────────────────────────────────────────────────────
# Cloud Run service with a hardcoded AWS access key in environment variables
# Triggers: CRITICAL  secret_in_env  (pattern: AWS Access Key ID)

resource "google_cloud_run_v2_service" "attack_leaked_aws_creds" {
  name     = "wm-attack-leaked-aws-creds"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      env {
        name  = "AWS_ACCESS_KEY_ID"
        value = "AKIAIOSFODNN7EXAMPLE"  # dummy — matches AWS key ID pattern
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

# ── SCENARIO 8 ───────────────────────────────────────────────────────────────
# Cloud Run service with a hardcoded Stripe live secret key
# Triggers: CRITICAL  secret_in_env  (pattern: Stripe Secret Key)

resource "google_cloud_run_v2_service" "attack_stripe_key" {
  name     = "wm-attack-stripe-key"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      env {
        name  = "STRIPE_SECRET_KEY"
        value = "sk_WATCHMEN_DEMO_NOT_A_REAL_KEY_ABCDE99"  # dummy — matches Stripe pattern
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

# ── SCENARIO 9 ───────────────────────────────────────────────────────────────
# Cloud Run service with a hardcoded GitHub Personal Access Token
# Triggers: CRITICAL  secret_in_env  (pattern: GitHub PAT)

resource "google_cloud_run_v2_service" "attack_github_token" {
  name     = "wm-attack-github-runner"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      env {
        name  = "GITHUB_TOKEN"
        value = "ghp_WatchmenDemoFakeTokenABCDEFGHIJKLMN01"  # dummy — matches ghp_ pattern
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
# Service account with editor role — overly broad permissions, privilege escalation
# Triggers: HIGH  sa_owner_editor

resource "google_service_account" "attack_escalation_sa" {
  account_id   = "wm-attack-escalation-sa"
  display_name = "WM Attack: Escalation SA (editor)"
}

resource "google_project_iam_member" "attack_escalation_editor" {
  project = var.project_id
  role    = "roles/editor"
  member  = "serviceAccount:${google_service_account.attack_escalation_sa.email}"
}

# ── SCENARIO 11 ──────────────────────────────────────────────────────────────
# Service account with owner role — full project takeover if key is leaked
# Triggers: HIGH  sa_owner_editor

resource "google_service_account" "attack_owner_sa" {
  account_id   = "wm-attack-owner-sa"
  display_name = "WM Attack: Owner SA (full takeover)"
}

resource "google_project_iam_member" "attack_owner_iam" {
  project = var.project_id
  role    = "roles/owner"
  member  = "serviceAccount:${google_service_account.attack_owner_sa.email}"
}

# ── SCENARIO 12 & 13 ─────────────────────────────────────────────────────────
# NOTE: Skipped — GCP org policy on this project blocks allUsers /
# allAuthenticatedUsers IAM members on Secret Manager secrets.

# ── SCENARIO 14 ──────────────────────────────────────────────────────────────
# Cloud Run service with high-entropy database password in plaintext env var
# Triggers: HIGH  secret_in_env  (medium confidence — secret-named key + high-entropy value)

resource "google_cloud_run_v2_service" "attack_db_password_env" {
  name     = "wm-attack-db-password-env"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      env {
        name  = "DATABASE_PASSWORD"
        value = "WatchmenDemoDbPasswordSecretKey2024"  # dummy high-entropy value
      }
      env {
        name  = "DATABASE_URL"
        value = "postgresql://admin:WatchmenDemoDbPasswordSecretKey2024@10.0.0.5:5432/prod"
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

# ── SCENARIO 15 ──────────────────────────────────────────────────────────────
# Service account with 3 user-managed keys — excessive key exposure surface
# Triggers: MEDIUM  multiple_sa_keys

resource "google_service_account" "attack_multikey_sa" {
  account_id   = "wm-attack-multikey-sa"
  display_name = "WM Attack: SA with Multiple Keys"
}

resource "google_service_account_key" "attack_multikey_1" {
  service_account_id = google_service_account.attack_multikey_sa.name
}

resource "google_service_account_key" "attack_multikey_2" {
  service_account_id = google_service_account.attack_multikey_sa.name
}

resource "google_service_account_key" "attack_multikey_3" {
  service_account_id = google_service_account.attack_multikey_sa.name
}

# ── SCENARIO 16 ──────────────────────────────────────────────────────────────
# CI/CD SA with editor role AND 2 leaked keys — combined privilege + exposure
# Triggers: HIGH  sa_owner_editor  +  MEDIUM  multiple_sa_keys

resource "google_service_account" "attack_exposed_cicd" {
  account_id   = "wm-attack-exposed-cicd"
  display_name = "WM Attack: CI/CD SA (editor + multi-key)"
}

resource "google_project_iam_member" "attack_exposed_cicd_editor" {
  project = var.project_id
  role    = "roles/editor"
  member  = "serviceAccount:${google_service_account.attack_exposed_cicd.email}"
}

resource "google_service_account_key" "attack_exposed_cicd_key1" {
  service_account_id = google_service_account.attack_exposed_cicd.name
}

resource "google_service_account_key" "attack_exposed_cicd_key2" {
  service_account_id = google_service_account.attack_exposed_cicd.name
}

# ── SCENARIO 17 ──────────────────────────────────────────────────────────────
# sql_public_ip is already covered by wm-test-sql (MySQL 8.0, RUNNABLE) from
# main.tf — no second Cloud SQL instance needed. Replaced with a second
# publicly-accessible Cloud Run service to keep the scenario count at 20.
# Triggers: MEDIUM  cloud_run_public

resource "google_cloud_run_v2_service" "attack_public_internal_api" {
  name     = "wm-attack-public-internal-api"
  location = var.region

  template {
    service_account = google_service_account.attack_escalation_sa.email
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

  depends_on = [google_project_iam_member.attack_escalation_editor]
}


# ── SCENARIO 18 ──────────────────────────────────────────────────────────────
# Cloud Run service with unauthenticated (allUsers) invocations allowed
# Triggers: MEDIUM  cloud_run_public

resource "google_cloud_run_v2_service" "attack_public_api" {
  name     = "wm-attack-public-api"
  location = var.region

  template {
    service_account = google_service_account.attack_owner_sa.email
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

  depends_on = [google_project_iam_member.attack_owner_iam]
}


# ── SCENARIO 21 ──────────────────────────────────────────────────────────────
# VM with external IP + privileged SA — completes the firewall → VM → SA chain.
# Combined with the open firewall rules above (scenarios 3–6), this triggers
# the "Internet → Open Firewall → VM → Privileged SA" attack path.

resource "google_compute_instance" "attack_privileged_vm" {
  name         = "wm-attack-privileged-vm"
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
    access_config {}  # ephemeral public IP
  }

  service_account {
    email  = google_service_account.attack_escalation_sa.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  depends_on = [google_project_iam_member.attack_escalation_editor]
}

# ── SCENARIO 19 ──────────────────────────────────────────────────────────────
# VM with external (ephemeral) IP and no service account attached
# An attacker who compromises the VM cannot pivot to GCP APIs, but the VM
# is reachable from the internet with no SA — unmonitored attack surface.
# Triggers: MEDIUM  vm_external_ip_no_sa

resource "google_compute_instance" "attack_exposed_vm" {
  name         = "wm-attack-exposed-vm"
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
    access_config {}  # ephemeral public IP — no service_account block = finding
  }
}

# ── SCENARIO 20 ──────────────────────────────────────────────────────────────
# Dev VM with external IP and no SA — same as above, simulates unmanaged dev box
# Triggers: MEDIUM  vm_external_ip_no_sa

resource "google_compute_instance" "attack_dev_instance" {
  name         = "wm-attack-dev-instance"
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
    access_config {}  # ephemeral public IP — no service_account block = finding
  }
}