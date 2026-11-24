terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

resource "google_compute_instance" "shirudo_target" {
  name         = var.instance_name
  machine_type = var.machine_type
  zone         = var.zone

  tags = ["watchmen-shirudo-target"]

  boot_disk {
    initialize_params {
      image = var.shirudo_image
      size  = var.disk_size_gb
      type  = "pd-ssd"
    }
  }

  # Required by Shirudo for TPM 2.0 measurement register (/dev/tpmrm0) and attestation keys.
  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  network_interface {
    network = var.network
    dynamic "access_config" {
      for_each = var.assign_public_ip ? [1] : []
      content {}
    }
  }

  metadata = {
    enable-oslogin = "TRUE"
    user-data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
      watchmen_otlp_endpoint = var.watchmen_otlp_endpoint
      watchmen_api_token     = var.watchmen_api_token
      shirudo_oci_tree       = var.shirudo_oci_tree
    })
  }

  service_account {
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }
}
