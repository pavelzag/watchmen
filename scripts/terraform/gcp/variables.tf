variable "project_id" {
  description = "GCP project to create test assets in"
  type        = string
  default     = "watchmen-test-488807"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "zone" {
  description = "Zonal resources (GKE, VM) go here — zonal is cheaper than regional"
  type        = string
  default     = "us-central1-a"
}

variable "test_user_emails" {
  description = "Real Google account emails to add as IAM viewers (must exist in Google's directory)"
  type        = list(string)
  default     = []
}
