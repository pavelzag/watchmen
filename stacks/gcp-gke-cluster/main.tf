# Minimal GKE cluster for testing the Watchmen eBPF agent DaemonSet.
#
# Deploy:
#   terraform init
#   terraform plan
#   terraform apply
#
# Get credentials after creation:
#   gcloud container clusters get-credentials watchmen-test --region us-central1
#
# Destroy:
#   terraform destroy

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "current" {}

resource "google_project_service" "container" {
  project            = var.project_id
  service            = "container.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "compute" {
  project            = var.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_network" "gke_test" {
  name                    = "gke-test-net"
  auto_create_subnetworks = false

  depends_on = [google_project_service.compute]
}

resource "google_compute_subnetwork" "gke_test" {
  name          = "gke-test-subnet"
  ip_cidr_range = "10.80.0.0/16"
  network       = google_compute_network.gke_test.id
  region        = var.region

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.81.0.0/16"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.82.0.0/20"
  }
}

resource "google_container_cluster" "primary" {
  name     = var.cluster_name
  location = var.region

  network    = google_compute_network.gke_test.id
  subnetwork = google_compute_subnetwork.gke_test.id

  # Regional cluster with one node per zone (3 nodes total).
  initial_node_count = 1

  # Remove the default node pool and use a separate node pool resource
  # for more control over sizing and autoscaling.
  remove_default_node_pool = true

  # Enable minimal addons.
  min_master_version = var.k8s_version
  monitoring_service = "monitoring.googleapis.com/kubernetes"
  logging_service    = "logging.googleapis.com/kubernetes"

  # Workload Identity for GCP service account integration.
  workload_identity_config {
    workload_pool = "${data.google_project.current.project_id}.svc.id.goog"
  }

  # Public endpoint for test convenience.
  private_cluster_config {
    enable_private_endpoint = false
    enable_private_nodes    = false
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # Release channel for managed upgrades.
  release_channel {
    channel = var.release_channel
  }

  # Shielded nodes.
  enable_shielded_nodes = true

  depends_on = [google_project_service.container]
}

resource "google_container_node_pool" "primary_nodes" {
  name     = "primary"
  location = var.region
  cluster  = google_container_cluster.primary.name

  # Start with 1 node per zone (3 nodes in a regional cluster).
  initial_node_count = var.nodes_per_zone

  autoscaling {
    min_node_count = 0
    max_node_count = var.nodes_per_zone * 2
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type = var.machine_type
    disk_size_gb = var.boot_disk_gb
    disk_type    = "pd-standard"

    # Preemptible for cost savings (nodes may be reclaimed, ok for testing).
    preemptible = var.preemptible

    labels = {
      "goog-terraform-provisioned" = "true"
    }

    # OAuth scopes — minimal for testing.
    oauth_scopes = [
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring.write",
      "https://www.googleapis.com/auth/devstorage.read_only",
    ]

    confidential_nodes {
      enabled = false
    }
  }
}
