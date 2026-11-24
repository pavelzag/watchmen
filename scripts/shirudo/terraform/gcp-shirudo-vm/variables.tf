variable "project_id" {
  type        = string
  description = "GCP project ID for the Shielded VM."
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "zone" {
  type    = string
  default = "us-central1-a"
}

variable "instance_name" {
  type    = string
  default = "watchmen-shirudo-node-01"
}

variable "machine_type" {
  type    = string
  default = "e2-standard-2"
}

variable "shirudo_image" {
  type        = string
  description = "Custom GCE image built with Shirudo's patched bpf-next kernel, systemd 256+ UKI, and initrd hooks."
}

variable "disk_size_gb" {
  type    = number
  default = 30
}

variable "network" {
  type    = string
  default = "default"
}

variable "assign_public_ip" {
  type    = bool
  default = false
}

variable "watchmen_otlp_endpoint" {
  type        = string
  description = "Base OTLP collector URL (e.g. https://otel-proxy.internal:4318 or https://watchmen.example.com/api/ingest/shirudo)."
}

variable "watchmen_api_token" {
  type        = string
  sensitive   = true
  description = "Watchmen Personal API Token (wm_...) for OTLP ingest authentication."
}

variable "shirudo_oci_tree" {
  type        = string
  default     = ""
  description = "Optional OCI upatch tree reference for shirudo-bpm-tree-sync."
}
