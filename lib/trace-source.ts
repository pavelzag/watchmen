import { sql, ensureTraceSourceConfigsTable } from "@/lib/db";

export type TraceSourceMode = "polling" | "streaming";
export type TraceSetupState =
  | "not_configured"
  | "terraform_generated"
  | "resources_applied"
  | "receiving_events";

export interface GcpTraceSourceConfig {
  cloud: "gcp";
  mode: TraceSourceMode;
  projectId: string;
  region: string;
  namePrefix: string;
  pushEndpoint: string;
  pushAudience: string;
  setupState: TraceSetupState;
  lastCheckedAt: string | null;
  lastCheckMessage: string;
}

export interface GeneratedFile {
  name: string;
  content: string;
  language: string;
}

export interface GcpTraceSourceBundle {
  files: GeneratedFile[];
  steps: string[];
  notes: string[];
}

export const DEFAULT_GCP_TRACE_SOURCE_CONFIG: GcpTraceSourceConfig = {
  cloud: "gcp",
  mode: "polling",
  projectId: "",
  region: "us-central1",
  namePrefix: "watchmen-live-trace",
  pushEndpoint: "",
  pushAudience: "",
  setupState: "not_configured",
  lastCheckedAt: null,
  lastCheckMessage: "Using Cloud Logging polling. Switch to streaming to generate Terraform.",
};

export function getPublicHttpsPushEndpoint(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return "";
    if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) return "";
    return `${url.origin}/api/ingest/gcp/pubsub`;
  } catch {
    return "";
  }
}

export function validateGcpStreamingPushEndpoint(pushEndpoint: string): string | null {
  const value = pushEndpoint.trim();
  if (!value) {
    return "Set a public HTTPS push endpoint for Pub/Sub delivery. Watchmen does not consume pull subscriptions yet.";
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a valid absolute push endpoint URL.";
  }

  if (url.protocol !== "https:") {
    return "Pub/Sub push delivery requires a public HTTPS endpoint.";
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return "Pub/Sub cannot push to localhost. Use a public Watchmen URL.";
  }
  if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) {
    return "Pub/Sub cannot push to a private-network endpoint. Use a public Watchmen URL.";
  }

  return null;
}

export async function getUserGcpTraceSourceConfig(email: string): Promise<GcpTraceSourceConfig> {
  await ensureTraceSourceConfigsTable();
  const result = await sql`
    SELECT config
    FROM user_trace_source_configs
    WHERE user_email = ${email} AND cloud = 'gcp'
  `;
  if (result.rows.length === 0) return DEFAULT_GCP_TRACE_SOURCE_CONFIG;

  const raw = result.rows[0].config as Partial<GcpTraceSourceConfig>;
  return {
    ...DEFAULT_GCP_TRACE_SOURCE_CONFIG,
    ...raw,
    cloud: "gcp",
  };
}

export async function saveUserGcpTraceSourceConfig(email: string, config: GcpTraceSourceConfig): Promise<void> {
  await ensureTraceSourceConfigsTable();
  await sql`
    INSERT INTO user_trace_source_configs (user_email, cloud, config, updated_at)
    VALUES (${email}, 'gcp', ${JSON.stringify(config)}::jsonb, NOW())
    ON CONFLICT (user_email, cloud) DO UPDATE
      SET config = EXCLUDED.config,
          updated_at = NOW()
  `;
}

export async function listUsersForGcpStreamingProject(projectId: string): Promise<Array<{ userEmail: string; config: GcpTraceSourceConfig }>> {
  await ensureTraceSourceConfigsTable();
  const result = await sql`
    SELECT user_email, config
    FROM user_trace_source_configs
    WHERE cloud = 'gcp'
      AND config->>'mode' = 'streaming'
      AND config->>'projectId' = ${projectId}
  `;

  return result.rows.map((row) => ({
    userEmail: row.user_email as string,
    config: {
      ...DEFAULT_GCP_TRACE_SOURCE_CONFIG,
      ...(row.config as Partial<GcpTraceSourceConfig>),
      cloud: "gcp",
    },
  }));
}

export function getDerivedGcpSetupState(config: GcpTraceSourceConfig): TraceSetupState {
  if (config.mode === "polling") return "receiving_events";
  if (!config.projectId.trim()) return "not_configured";
  if (validateGcpStreamingPushEndpoint(config.pushEndpoint)) return "not_configured";
  return config.setupState === "resources_applied" || config.setupState === "receiving_events"
    ? config.setupState
    : "terraform_generated";
}

export function generateGcpTraceSourceBundle(config: GcpTraceSourceConfig): GcpTraceSourceBundle {
  const projectId = config.projectId.trim() || "your-gcp-project";
  const region = config.region.trim() || "us-central1";
  const namePrefix = config.namePrefix.trim() || "watchmen-live-trace";
  const pushEndpoint = config.pushEndpoint.trim();
  const pushAudience = config.pushAudience.trim();

  const variablesTf = `variable "name_prefix" {
  description = "Prefix used for created resources."
  type        = string
  default     = "${namePrefix}"
}

variable "gcp_project_id" {
  description = "GCP project id that owns the logging sink and Pub/Sub resources."
  type        = string
}

variable "gcp_region" {
  description = "GCP region for regional resources when needed."
  type        = string
  default     = "${region}"
}

variable "gcp_log_filter" {
  description = "Cloud Logging filter for request-oriented live trace events."
  type        = string
  default     = <<-EOT
    resource.type="cloud_run_revision"
    OR resource.type="gce_instance"
    OR resource.type="k8s_container"
    OR resource.type="http_load_balancer"
  EOT
}

variable "gcp_subscription_ack_deadline_seconds" {
  description = "Ack deadline for the Watchmen Pub/Sub subscription."
  type        = number
  default     = 20
}

variable "gcp_message_retention_duration" {
  description = "How long Pub/Sub retains unacked messages."
  type        = string
  default     = "1200s"
}

variable "gcp_push_endpoint" {
  description = "HTTPS endpoint for Pub/Sub push delivery into Watchmen."
  type        = string
  default     = "${pushEndpoint}"
}

variable "gcp_push_audience" {
  description = "Optional OIDC audience for Pub/Sub push. Defaults to the push endpoint when empty."
  type        = string
  default     = "${pushAudience}"
}
`;

  const mainTf = `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

locals {
  gcp_push_enabled = trimspace(var.gcp_push_endpoint) != ""
}

resource "google_project_service" "gcp_pubsub_api" {
  project = var.gcp_project_id
  service = "pubsub.googleapis.com"
}

resource "google_project_service" "gcp_logging_api" {
  project = var.gcp_project_id
  service = "logging.googleapis.com"
}

resource "google_project_service" "gcp_iam_api" {
  project = var.gcp_project_id
  service = "iam.googleapis.com"
}

data "google_project" "gcp_project" {
  project_id = var.gcp_project_id
}

resource "google_pubsub_topic" "watchmen_live_trace" {
  project = var.gcp_project_id
  name    = "\${var.name_prefix}-topic"

  depends_on = [
    google_project_service.gcp_pubsub_api,
  ]
}

resource "google_logging_project_sink" "watchmen_live_trace" {
  project                = var.gcp_project_id
  name                   = "\${var.name_prefix}-sink"
  destination            = "pubsub.googleapis.com/projects/\${var.gcp_project_id}/topics/\${google_pubsub_topic.watchmen_live_trace.name}"
  filter                 = trimspace(var.gcp_log_filter)
  unique_writer_identity = true

  depends_on = [
    google_project_service.gcp_logging_api,
    google_pubsub_topic.watchmen_live_trace,
  ]
}

resource "google_pubsub_topic_iam_member" "watchmen_sink_publisher" {
  project = var.gcp_project_id
  topic   = google_pubsub_topic.watchmen_live_trace.name
  role    = "roles/pubsub.publisher"
  member  = google_logging_project_sink.watchmen_live_trace.writer_identity
}

resource "google_service_account" "watchmen_pubsub_push" {
  count        = local.gcp_push_enabled ? 1 : 0
  project      = var.gcp_project_id
  account_id   = substr(replace("\${var.name_prefix}-push", "_", "-"), 0, 30)
  display_name = "Watchmen Pub/Sub push identity"

  depends_on = [
    google_project_service.gcp_iam_api,
  ]
}

resource "google_service_account_iam_member" "watchmen_pubsub_push_token_creator" {
  count              = local.gcp_push_enabled ? 1 : 0
  service_account_id = google_service_account.watchmen_pubsub_push[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-\${data.google_project.gcp_project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription" "watchmen_live_trace" {
  project = var.gcp_project_id
  name    = "\${var.name_prefix}-subscription"
  topic   = google_pubsub_topic.watchmen_live_trace.name

  ack_deadline_seconds       = var.gcp_subscription_ack_deadline_seconds
  message_retention_duration = var.gcp_message_retention_duration

  dynamic "push_config" {
    for_each = local.gcp_push_enabled ? [1] : []
    content {
      push_endpoint = var.gcp_push_endpoint
      attributes = {
        x-goog-version = "v1"
      }
      oidc_token {
        service_account_email = google_service_account.watchmen_pubsub_push[0].email
        audience              = trimspace(var.gcp_push_audience) != "" ? var.gcp_push_audience : var.gcp_push_endpoint
      }
    }
  }

  depends_on = [
    google_pubsub_topic_iam_member.watchmen_sink_publisher,
    google_service_account_iam_member.watchmen_pubsub_push_token_creator,
  ]
}

output "gcp_pubsub_topic_name" {
  value       = google_pubsub_topic.watchmen_live_trace.name
  description = "Pub/Sub topic receiving live GCP request logs."
}

output "gcp_pubsub_subscription_name" {
  value       = google_pubsub_subscription.watchmen_live_trace.name
  description = "Pub/Sub subscription Watchmen should consume from."
}

output "gcp_logging_sink_writer_identity" {
  value       = google_logging_project_sink.watchmen_live_trace.writer_identity
  description = "Writer identity used by the GCP logging sink."
}
`;

  const tfvars = `gcp_project_id = "${projectId}"
gcp_region     = "${region}"
name_prefix    = "${namePrefix}"

# Recommended for Watchmen streaming. Leave blank only if you plan to build your own pull consumer.
gcp_push_endpoint = "${pushEndpoint}"
gcp_push_audience = "${pushAudience}"
`;

  const readme = `# Watchmen GCP Trace Streaming

This Terraform config provisions the resources needed to move Watchmen GCP trace ingestion from Cloud Logging polling to Pub/Sub streaming.

## What gets created

- Cloud Logging sink: \`${namePrefix}-sink\`
- Pub/Sub topic: \`${namePrefix}-topic\`
- Pub/Sub subscription: \`${namePrefix}-subscription\`
${pushEndpoint ? "- Pub/Sub push identity service account for OIDC-authenticated push delivery" : ""}

## Before you apply

1. Install Terraform 1.5+.
2. Authenticate to Google Cloud:
   - \`gcloud auth application-default login\`
   - or set \`GOOGLE_APPLICATION_CREDENTIALS\`
3. Confirm the target project id is correct:
   - \`${projectId}\`

## Files in this bundle

- \`main.tf\`
- \`variables.tf\`
- \`terraform.tfvars.example\`

## Apply steps

1. Copy these files into an empty Terraform working directory.
2. Rename \`terraform.tfvars.example\` to \`terraform.tfvars\` if desired.
3. Confirm the Watchmen ingestion endpoint is reachable at:
   - \`${pushEndpoint || "https://your-watchmen-host/api/ingest/gcp/pubsub"}\`
4. Run:

\`\`\`bash
terraform init
terraform plan
terraform apply
\`\`\`

## After apply

1. Return to Watchmen Settings.
2. Click \`Check setup\`.
3. Generate live traffic in the target project.
4. Once push events arrive, Watchmen will mark the integration as \`Receiving events\` and the Trace view will switch live mode to streaming automatically.

## Important note

The current Watchmen streaming bus is in-memory. It works for local development and single-instance deployments. Multi-instance production deployments should back the live fan-out with shared infrastructure such as Redis, NATS, or another durable pub/sub layer.

Watchmen currently consumes GCP Pub/Sub through push delivery to its ingestion endpoint. Pull subscriptions are not consumed by this app unless you add a separate worker.
`;

  return {
    files: [
      { name: "main.tf", content: mainTf, language: "hcl" },
      { name: "variables.tf", content: variablesTf, language: "hcl" },
      { name: "terraform.tfvars.example", content: tfvars, language: "hcl" },
      { name: "README.md", content: readme, language: "markdown" },
    ],
    steps: [
      "Choose streaming mode and save your GCP trace source settings.",
      "Download the generated Terraform bundle.",
      "Run terraform init, terraform plan, and terraform apply in a separate Terraform working directory.",
      "Return to Watchmen, click Check setup, then generate live traffic so Watchmen can confirm event delivery.",
    ],
    notes: [
      "Polling remains the fallback mode only until the first streaming events are received or whenever streaming is disabled.",
      "Pub/Sub push requires the Watchmen ingestion endpoint to be reachable from Google Cloud over HTTPS.",
      "The current app path consumes Pub/Sub push. Pull subscriptions need a separate worker and are not wired into the tracer.",
      "AWS and agent-based sources can be added later without changing the GCP settings model.",
    ],
  };
}
