output "instance_name" {
  value = google_compute_instance.agent.name
}

output "zone" {
  value = google_compute_instance.agent.zone
}

output "external_ip" {
  value = google_compute_instance.agent.network_interface[0].access_config[0].nat_ip
}

output "ssh_command" {
  value = "gcloud compute ssh ${google_compute_instance.agent.name} --project ${var.project_id} --zone ${var.zone} --tunnel-through-iap"
}

