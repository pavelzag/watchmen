variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
  default     = "watchmen-test-488807"
}

variable "region" {
  description = "Google Cloud region. us-central1 is one of the common low-cost/free-tier eligible US regions."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Google Cloud zone for the test VM."
  type        = string
  default     = "us-central1-a"
}

variable "instance_name" {
  description = "Compute Engine instance name."
  type        = string
  default     = "ebpf-agent-test"
}

variable "machine_type" {
  description = "VM machine type. e2-micro keeps spend low but is slow for compiling."
  type        = string
  default     = "e2-micro"
}

variable "boot_disk_gb" {
  description = "Boot disk size in GB. Keep at or below 30 GB if you are trying to fit Compute Engine free-tier storage limits."
  type        = number
  default     = 20
}

variable "install_go_toolchain" {
  description = "Install Ubuntu's Go package on the VM. Disable if you cross-compile locally and only copy binaries."
  type        = bool
  default     = true
}

