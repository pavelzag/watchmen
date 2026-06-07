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
  zone    = var.zone
}

resource "google_project_service" "compute" {
  project            = var.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "agent_vm" {
  account_id   = "ebpf-agent-vm"
  display_name = "eBPF agent test VM"
}

resource "google_compute_network" "ebpf_test" {
  name                    = "ebpf-test-net"
  auto_create_subnetworks = false

  depends_on = [google_project_service.compute]
}

resource "google_compute_subnetwork" "ebpf_test" {
  name          = "ebpf-test-subnet"
  ip_cidr_range = "10.80.0.0/24"
  network       = google_compute_network.ebpf_test.id
  region        = var.region
}

resource "google_compute_firewall" "allow_iap_ssh" {
  name    = "ebpf-test-allow-iap-ssh"
  network = google_compute_network.ebpf_test.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  # Google Cloud IAP TCP forwarding range.
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["ebpf-test"]
}

resource "google_compute_instance" "agent" {
  name         = var.instance_name
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["ebpf-test"]

  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
      size  = var.boot_disk_gb
      type  = "pd-standard"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.ebpf_test.id

    access_config {
      network_tier = "STANDARD"
    }
  }

  metadata = {
    enable-oslogin = "TRUE"
    startup-script = templatefile("${path.module}/startup.sh.tftpl", {
      install_go_toolchain = var.install_go_toolchain
    })
  }

  service_account {
    email  = google_service_account.agent_vm.email
    scopes = ["https://www.googleapis.com/auth/logging.write"]
  }

  shielded_instance_config {
    enable_secure_boot          = false
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  depends_on = [google_project_service.compute]
}

