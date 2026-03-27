terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── Human users (IAM bindings) ────────────────────────────────────────────────
# GCP validates that each email is a real Google account.
# Add real emails to test_user_emails in terraform.tfvars.
resource "google_project_iam_member" "test_users" {
  for_each = toset(var.test_user_emails)
  project  = var.project_id
  role     = "roles/viewer"
  member   = "user:${each.value}"
}

# ── Service Accounts ──────────────────────────────────────────────────────────
resource "google_service_account" "etl" {
  account_id   = "wm-test-etl"
  display_name = "WM Test ETL Pipeline"
}

resource "google_service_account" "reporting" {
  account_id   = "wm-test-reporting"
  display_name = "WM Test Reporting"
}

resource "google_service_account" "cicd" {
  account_id   = "wm-test-cicd"
  display_name = "WM Test CI/CD Runner"
}

resource "google_project_iam_member" "etl_storage_admin" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.etl.email}"
}

resource "google_project_iam_member" "reporting_bq_viewer" {
  project = var.project_id
  role    = "roles/bigquery.dataViewer"
  member  = "serviceAccount:${google_service_account.reporting.email}"
}

resource "google_project_iam_member" "cicd_editor" {
  project = var.project_id
  role    = "roles/editor"
  member  = "serviceAccount:${google_service_account.cicd.email}"
}

# ── Storage Buckets ───────────────────────────────────────────────────────────
# Empty buckets cost nothing; NEARLINE/ARCHIVE are cheapest storage classes.
resource "google_storage_bucket" "logs" {
  name          = "${var.project_id}-wm-logs"
  location      = "US-CENTRAL1"
  storage_class = "NEARLINE"
  force_destroy = true

  uniform_bucket_level_access = true

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 30 }
  }
}

resource "google_storage_bucket" "data" {
  name          = "${var.project_id}-wm-data"
  location      = "US-CENTRAL1"
  storage_class = "NEARLINE"
  force_destroy = true

  uniform_bucket_level_access = true
}

resource "google_storage_bucket" "backups" {
  name          = "${var.project_id}-wm-backups"
  location      = "US-CENTRAL1"
  storage_class = "ARCHIVE"
  force_destroy = true

  uniform_bucket_level_access = true
}

# ── GKE Cluster ───────────────────────────────────────────────────────────────
# Cost: ~$3–5/month (1x spot e2-small node).
# GKE Standard management fee is waived for the first cluster per billing account.
resource "google_container_cluster" "test" {
  name     = "wm-test-cluster"
  location = var.zone # zonal avoids 3× node replication cost

  remove_default_node_pool = true
  initial_node_count       = 1

  deletion_protection = false
}

resource "google_container_node_pool" "primary_nodes" {
  name       = "wm-test-node-pool"
  location   = var.zone
  cluster    = google_container_cluster.test.name
  node_count = 1

  node_config {
    preemptible  = true
    machine_type = "e2-small"

    # Google recommends custom service accounts that have cloud-platform scope and permissions granted via IAM Roles.
    service_account = google_service_account.cicd.email
    oauth_scopes    = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]
  }
}


# ── VM ────────────────────────────────────────────────────────────────────────
# Cost: ~$0.005/hr spot e2-micro (~$3.5/month worst case; free-tier eligible in us-central1)
resource "google_compute_instance" "test" {
  name         = "wm-test-vm"
  machine_type = "e2-micro"
  zone         = var.zone

  scheduling {
    preemptible        = true # use preemptible flag; provisioning_model=SPOT conflicts with preemptible=false default
    automatic_restart  = false
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
  }
}

# ── Cloud Run ─────────────────────────────────────────────────────────────────
# Cost: $0 — pay per request only; 0 min instances means no idle charges.
resource "google_cloud_run_v2_service" "hello" {
  name     = "wm-test-hello"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      resources {
        limits    = { cpu = "1", memory = "512Mi" }
        cpu_idle  = true # throttle CPU when not handling requests; required for memory < 512Mi
      }
    }
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
  }
}

resource "google_cloud_run_v2_service" "api" {
  name     = "wm-test-api"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      resources {
        limits    = { cpu = "1", memory = "512Mi" }
        cpu_idle  = true # throttle CPU when not handling requests; required for memory < 512Mi
      }
    }
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
  }
}

# ── Cloud SQL ─────────────────────────────────────────────────────────────────
# Cost: ~$9/month (db-f1-micro, zonal, no HA, no backups, 10 GB SSD).
# Public IP with no authorized networks = reachable in theory but no access granted.
# This will trigger a Watchmen security finding — intentional for demo purposes.
resource "google_sql_database_instance" "test" {
  name             = "wm-test-sql"
  database_version = "MYSQL_8_0"
  region           = var.region

  deletion_protection = false

  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    disk_autoresize   = false
    disk_size         = 10
    disk_type         = "PD_SSD"

    backup_configuration {
      enabled = false
    }

    ip_configuration {
      ipv4_enabled = true
    }
  }
}

# ── BigQuery ──────────────────────────────────────────────────────────────────
# Cost: $0 — datasets cost nothing; charges only apply to stored data / queries.
resource "google_bigquery_dataset" "analytics" {
  dataset_id = "wm_test_analytics"
  location   = "US"
}

resource "google_bigquery_dataset" "logs" {
  dataset_id = "wm_test_logs"
  location   = "US"
}

resource "google_bigquery_dataset" "ml_features" {
  dataset_id = "wm_test_ml_features"
  location   = "US"
}

# ── Pub/Sub ───────────────────────────────────────────────────────────────────
# Cost: $0 — topics are free; charges only apply to published messages.
resource "google_pubsub_topic" "events" {
  name = "wm-test-events"
}

resource "google_pubsub_topic" "alerts" {
  name = "wm-test-alerts"
}

resource "google_pubsub_topic" "metrics" {
  name = "wm-test-metrics"
}

# ── Secret Manager ────────────────────────────────────────────────────────────
# Cost: ~$0.18/month (3 secrets × $0.06/secret/month)
resource "google_secret_manager_secret" "api_key" {
  secret_id = "wm-test-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "api_key" {
  secret      = google_secret_manager_secret.api_key.id
  secret_data = "test-api-key-not-real"
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "wm-test-db-password"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = "test-db-password-not-real"
}

resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "wm-test-jwt-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = "test-jwt-secret-not-real"
}

# ── Firewall Rules ────────────────────────────────────────────────────────────
# Cost: $0
resource "google_compute_firewall" "allow_internal" {
  name    = "wm-test-allow-internal"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["10.128.0.0/9"] # GCP internal range

  allow { protocol = "tcp" }
  allow { protocol = "udp" }
  allow { protocol = "icmp" }
}

resource "google_compute_firewall" "allow_iap_ssh" {
  name    = "wm-test-allow-iap-ssh"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"] # IAP tunnel range only — not open to internet

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_firewall" "allow_http_open" {
  name    = "wm-test-allow-http-open"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"] # intentionally open — triggers Watchmen firewall finding

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  target_tags = ["web"]
}
