variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "watchmen-test-488807"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "cluster_name" {
  description = "GKE cluster name"
  type        = string
  default     = "watchmen-test"
}

variable "k8s_version" {
  description = "Kubernetes version (prefix, e.g. 1.34)"
  type        = string
  default     = "1.34"
}

variable "release_channel" {
  description = "GKE release channel (UNSPECIFIED, RAPID, REGULAR, STABLE)"
  type        = string
  default     = "REGULAR"
}

variable "machine_type" {
  description = "Node machine type"
  type        = string
  default     = "e2-medium"
}

variable "nodes_per_zone" {
  description = "Number of nodes per zone"
  type        = number
  default     = 1
}

variable "boot_disk_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 20
}

variable "watchmen_url" {
  description = "Watchmen server base URL (e.g. https://watchmen.example.com)"
  type        = string
}

variable "preemptible" {
  description = "Use preemptible nodes (cheaper, may be reclaimed)"
  type        = bool
  default     = true
}
