output "instance_name" {
  value = google_compute_instance.shirudo_target.name
}

output "self_link" {
  value = google_compute_instance.shirudo_target.self_link
}

output "internal_ip" {
  value = google_compute_instance.shirudo_target.network_interface[0].network_ip
}
