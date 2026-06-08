output "cluster_name" {
  description = "GKE cluster name"
  value       = google_container_cluster.primary.name
}

output "region" {
  description = "GCP region"
  value       = var.region
}

output "endpoint" {
  description = "Cluster master API endpoint"
  value       = google_container_cluster.primary.endpoint
  sensitive   = true
}

output "k8s_version" {
  description = "Kubernetes version"
  value       = google_container_cluster.primary.master_version
}

output "node_count" {
  description = "Total node count across all zones"
  value       = google_container_node_pool.primary_nodes.node_count
}

output "get_credentials" {
  description = "Command to configure kubectl"
  value       = "gcloud container clusters get-credentials ${var.cluster_name} --region ${var.region} --project ${var.project_id}"
}

output "deploy_agent" {
  description = "Command to deploy the Watchmen eBPF agent"
  value       = "kubectl apply -f ${var.watchmen_url}/api/agents/k8s/manifest?cluster=${var.cluster_name}&project=${var.project_id}"
}
