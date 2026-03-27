output "service_accounts" {
  value = {
    etl       = google_service_account.etl.email
    reporting = google_service_account.reporting.email
    cicd      = google_service_account.cicd.email
  }
}

output "buckets" {
  value = [
    google_storage_bucket.logs.name,
    google_storage_bucket.data.name,
    google_storage_bucket.backups.name,
  ]
}

output "gke_cluster" {
  value = google_container_cluster.test.name
  # cluster exists (control plane only, no nodes — sufficient for Watchmen to list it)
}

output "vm" {
  value = google_compute_instance.test.name
}

output "cloud_run_urls" {
  value = {
    hello = google_cloud_run_v2_service.hello.uri
    api   = google_cloud_run_v2_service.api.uri
  }
}

output "sql_instance" {
  value = google_sql_database_instance.test.name
}

output "bigquery_datasets" {
  value = [
    google_bigquery_dataset.analytics.dataset_id,
    google_bigquery_dataset.logs.dataset_id,
    google_bigquery_dataset.ml_features.dataset_id,
  ]
}

output "pubsub_topics" {
  value = [
    google_pubsub_topic.events.name,
    google_pubsub_topic.alerts.name,
    google_pubsub_topic.metrics.name,
  ]
}

output "secrets" {
  value = [
    google_secret_manager_secret.api_key.secret_id,
    google_secret_manager_secret.db_password.secret_id,
    google_secret_manager_secret.jwt_secret.secret_id,
  ]
}
