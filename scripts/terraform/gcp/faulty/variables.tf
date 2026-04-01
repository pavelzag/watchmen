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
  type    = string
  default = "us-central1-a"
}
