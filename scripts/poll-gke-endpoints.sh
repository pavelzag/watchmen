#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/poll-gke-endpoints.sh --email EMAIL --intervals 1,2,5,10,15,20 [options]

Polls the Watchmen GKE-related endpoints and the public trace-test
LoadBalancer. Defaults are read from stacks/gcp-gke-cluster Terraform outputs
when available.

Options:
  --email EMAIL              Email label included in each request query string.
  --intervals CSV            Seconds to sleep between polling rounds.
  --watchmen-url URL         Watchmen base URL. Default: https://watchmen-kappa.vercel.app
  --trace-url URL            Public GKE trace-test LoadBalancer URL.
  --cluster NAME             GKE cluster name. Default: Terraform output cluster_name.
  --project ID               GCP project ID. Default: parsed from deploy_agent output.
  --agent-binary-url URL     Agent binary URL to check.
  --timeout SECONDS          Per-request curl timeout. Default: 10
  -h, --help                 Show this help.

Example:
  scripts/poll-gke-endpoints.sh --email zagalsky@gmail.com --intervals 1,2,5,10,15,20
EOF
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tf_dir="$repo_root/stacks/gcp-gke-cluster"

email=""
intervals=""
watchmen_url="${WATCHMEN_URL:-https://watchmen-kappa.vercel.app}"
trace_url="${TRACE_TEST_URL:-}"
cluster="${GKE_CLUSTER_NAME:-}"
project="${GCP_PROJECT_ID:-}"
agent_binary_url="${WATCHMEN_AGENT_BINARY_URL:-https://github.com/pavelzag/watchmen/releases/download/agent-v0.3.19/watchmen-ebpf-agent-linux-amd64}"
timeout="${CURL_TIMEOUT:-10}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      email="${2:-}"
      shift 2
      ;;
    --intervals)
      intervals="${2:-}"
      shift 2
      ;;
    --watchmen-url)
      watchmen_url="${2:-}"
      shift 2
      ;;
    --trace-url)
      trace_url="${2:-}"
      shift 2
      ;;
    --cluster)
      cluster="${2:-}"
      shift 2
      ;;
    --project)
      project="${2:-}"
      shift 2
      ;;
    --agent-binary-url)
      agent_binary_url="${2:-}"
      shift 2
      ;;
    --timeout)
      timeout="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$email" || -z "$intervals" ]]; then
  usage >&2
  exit 2
fi

if [[ -z "$cluster" && -d "$tf_dir" ]]; then
  cluster="$(terraform -chdir="$tf_dir" output -raw cluster_name 2>/dev/null || true)"
fi

if [[ -z "$trace_url" && -d "$tf_dir" ]]; then
  trace_url="$(terraform -chdir="$tf_dir" output -raw trace_test_url 2>/dev/null || true)"
fi

if [[ -z "$project" && -d "$tf_dir" ]]; then
  deploy_agent="$(terraform -chdir="$tf_dir" output -raw deploy_agent 2>/dev/null || true)"
  project="$(printf '%s' "$deploy_agent" | sed -n 's/.*[?&]project=\([^&"'"'"'[:space:]]*\).*/\1/p')"
fi

watchmen_url="${watchmen_url%/}"
api_url="$watchmen_url/api"
cluster="${cluster:-watchmen-test}"
project="${project:-watchmen-test-488807}"

urlencode() {
  local value="$1"
  local length="${#value}"
  local i char
  for ((i = 0; i < length; i++)); do
    char="${value:i:1}"
    case "$char" in
      [a-zA-Z0-9.~_-]) printf '%s' "$char" ;;
      *) printf '%%%02X' "'$char" ;;
    esac
  done
}

append_query() {
  local url="$1"
  local query="$2"
  if [[ "$url" == *\?* ]]; then
    printf '%s&%s' "$url" "$query"
  else
    printf '%s?%s' "$url" "$query"
  fi
}

format_curl_command() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local content_type="${4:-}"
  local trace_id="$5"
  local rendered_payload="${payload//__TRACE_ID__/$trace_id}"
  rendered_payload="${rendered_payload//__EMAIL__/$email}"
  rendered_payload="${rendered_payload//__CLUSTER__/$cluster}"
  rendered_payload="${rendered_payload//__PROJECT__/$project}"

  local -a cmd=(
    curl
    -sS
    --location
    --max-time "$timeout"
    --user-agent "watchmen-trace-poller/1.0"
    --header "X-Watchmen-Trace-Source: poll-gke-endpoints"
    --header "X-Watchmen-Trace-Id: $trace_id"
    --header "X-Watchmen-Trace-Method: $method"
  )

  if [[ "$method" == "HEAD" ]]; then
    cmd+=(--head)
  else
    cmd+=(-X "$method")
  fi

  if [[ -n "$rendered_payload" && "$method" != "GET" && "$method" != "HEAD" ]]; then
    cmd+=(--header "Content-Type: ${content_type:-application/octet-stream}")
    cmd+=(--header "X-Watchmen-Payload-Bytes: ${#rendered_payload}")
    cmd+=(--data-binary "$rendered_payload")
  fi

  cmd+=("$url")

  local quoted=""
  local arg
  for arg in "${cmd[@]}"; do
    printf -v quoted '%s %q' "$quoted" "$arg"
  done
  printf '%s' "${quoted# }"
}

status_label() {
  local code="$1"
  if [[ "$code" =~ ^2|^3 ]]; then
    printf 'ok'
  elif [[ "$code" == "401" || "$code" == "403" || "$code" == "404" || "$code" == "405" ]]; then
    printf 'reachable'
  elif [[ "$code" == "000" ]]; then
    printf 'failed'
  else
    printf 'bad'
  fi
}

poll_url() {
  local name="$1"
  local method="$2"
  local url="$3"
  local payload="${4:-}"
  local content_type="${5:-}"
  local started code timing label trace_id request_url rendered_payload
  local -a curl_args

  started="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  trace_id="watchmen-gke-${name}-$(date +%s)-${RANDOM}"
  request_url="$(append_query "$url" "watchmen_trace_probe=$trace_id")"
  rendered_payload="${payload//__TRACE_ID__/$trace_id}"
  rendered_payload="${rendered_payload//__EMAIL__/$email}"
  rendered_payload="${rendered_payload//__CLUSTER__/$cluster}"
  rendered_payload="${rendered_payload//__PROJECT__/$project}"

  curl_args=(
    -sS
    -o "/tmp/watchmen-poll-body.$$"
    --location
    -w '%{http_code} %{time_total}'
    --max-time "$timeout"
    --user-agent "watchmen-trace-poller/1.0"
    --header "X-Watchmen-Trace-Source: poll-gke-endpoints"
    --header "X-Watchmen-Trace-Id: $trace_id"
    --header "X-Watchmen-Trace-Method: $method"
  )

  if [[ "$method" == "HEAD" ]]; then
    curl_args+=(--head)
  else
    curl_args+=(-X "$method")
  fi

  if [[ -n "$rendered_payload" && "$method" != "GET" && "$method" != "HEAD" ]]; then
    curl_args+=(--header "Content-Type: ${content_type:-application/octet-stream}")
    curl_args+=(--header "X-Watchmen-Payload-Bytes: ${#rendered_payload}")
    curl_args+=(--data-binary "$rendered_payload")
  fi

  printf '  curl: %s\n' "$(format_curl_command "$method" "$request_url" "$payload" "$content_type" "$trace_id")"

  code="$(
    curl "${curl_args[@]}" "$request_url" 2>/tmp/watchmen-poll-error.$$ || printf '000 0'
  )"

  timing="${code##* }"
  code="${code%% *}"
  label="$(status_label "$code")"

  printf '%s %-10s %-28s %-7s http=%s time=%ss %s\n' "$started" "$label" "$name" "$method" "$code" "$timing" "$request_url"

  if [[ "$label" != "ok" ]]; then
    printf '  repro: %s\n' "$(format_curl_command "$method" "$request_url" "$payload" "$content_type" "$trace_id")"
  fi

  if [[ "$label" == "failed" && -s /tmp/watchmen-poll-error.$$ ]]; then
    sed 's/^/  curl: /' /tmp/watchmen-poll-error.$$
  fi

  rm -f /tmp/watchmen-poll-body.$$ /tmp/watchmen-poll-error.$$
}

encoded_email="$(urlencode "$email")"
encoded_cluster="$(urlencode "$cluster")"
encoded_project="$(urlencode "$project")"

declare -a endpoint_names=(
  "watchmen-health"
  "agent-manifest"
  "agent-register"
  "agent-events"
  "agent-binary"
)
declare -a endpoint_payloads=(
  ""
  ""
  ""
  ""
  ""
)
declare -a endpoint_content_types=(
  ""
  ""
  ""
  ""
  ""
)
declare -a endpoint_methods=(
  "GET"
  "GET"
  "GET"
  "GET"
  "GET"
)
declare -a endpoint_urls=(
  "$(append_query "$api_url/health" "poll_email=$encoded_email&source=gke")"
  "$api_url/agents/k8s/manifest?cluster=$encoded_cluster&project=$encoded_project&poll_email=$encoded_email"
  "$(append_query "$api_url/agents/k8s/register" "poll_email=$encoded_email&source=gke")"
  "$(append_query "$api_url/agents/events" "poll_email=$encoded_email&source=gke")"
  "$agent_binary_url"
)

if [[ -n "$trace_url" ]]; then
  json_payload='{"traceId":"__TRACE_ID__","email":"__EMAIL__","cluster":"__CLUSTER__","project":"__PROJECT__","kind":"json","nested":{"flag":true,"count":3},"items":["alpha","beta","gamma"]}'
  form_payload='trace_id=__TRACE_ID__&email=__EMAIL__&kind=form&feature=ebpf-agent&encoded=a%2Bb%3Dc'
  text_payload=$'trace=__TRACE_ID__\nemail=__EMAIL__\nkind=text\nmessage=hello from poll-gke-endpoints'
  patch_payload='{"traceId":"__TRACE_ID__","op":"replace","path":"/feature/ebpf","value":"payload-capture"}'
  binary_payload=$'watchmen-binary-probe __TRACE_ID__\n\x01\x02\x03\x7f payload-end'

  endpoint_names+=(
    "gke-trace-main"
    "gke-trace-health"
    "gke-trace-head"
    "gke-trace-options"
    "gke-trace-json-post"
    "gke-trace-form-post"
    "gke-trace-text-put"
    "gke-trace-json-patch"
    "gke-trace-delete"
    "gke-trace-octets"
    "gke-trace-trace"
  )
  endpoint_methods+=(
    "GET"
    "GET"
    "HEAD"
    "OPTIONS"
    "POST"
    "POST"
    "PUT"
    "PATCH"
    "DELETE"
    "POST"
    "TRACE"
  )
  endpoint_urls+=(
    "$(append_query "${trace_url%/}/" "poll_email=$encoded_email&source=gke")"
    "${trace_url%/}/health"
    "$(append_query "${trace_url%/}/" "poll_email=$encoded_email&source=gke&probe=head")"
    "$(append_query "${trace_url%/}/" "poll_email=$encoded_email&source=gke&probe=options")"
    "$(append_query "${trace_url%/}/work" "poll_email=$encoded_email&source=gke&payload=json")"
    "$(append_query "${trace_url%/}/work" "poll_email=$encoded_email&source=gke&payload=form")"
    "$(append_query "${trace_url%/}/work" "poll_email=$encoded_email&source=gke&payload=text")"
    "$(append_query "${trace_url%/}/work" "poll_email=$encoded_email&source=gke&payload=patch")"
    "$(append_query "${trace_url%/}/work" "poll_email=$encoded_email&source=gke&payload=delete")"
    "$(append_query "${trace_url%/}/work" "poll_email=$encoded_email&source=gke&payload=octets")"
    "$(append_query "${trace_url%/}/" "poll_email=$encoded_email&source=gke&probe=trace")"
  )
  endpoint_payloads+=(
    ""
    ""
    ""
    ""
    "$json_payload"
    "$form_payload"
    "$text_payload"
    "$patch_payload"
    ""
    "$binary_payload"
    ""
  )
  endpoint_content_types+=(
    ""
    ""
    ""
    ""
    "application/json"
    "application/x-www-form-urlencoded"
    "text/plain; charset=utf-8"
    "application/json-patch+json"
    ""
    "application/octet-stream"
    ""
  )
fi

IFS=',' read -r -a sleeps <<< "$intervals"

echo "Polling Watchmen/GKE endpoints"
echo "  email:        $email"
echo "  watchmen_url: $watchmen_url"
echo "  cluster:      $cluster"
echo "  project:      $project"
echo "  trace_url:    ${trace_url:-<not found>}"
echo "  intervals:    $intervals"
echo

for round in "${!sleeps[@]}"; do
  round_no=$((round + 1))
  echo "Round $round_no/$(( ${#sleeps[@]} + 1 ))"
  for i in "${!endpoint_names[@]}"; do
    poll_url "${endpoint_names[$i]}" "${endpoint_methods[$i]}" "${endpoint_urls[$i]}" "${endpoint_payloads[$i]:-}" "${endpoint_content_types[$i]:-}"
  done
  echo

  sleep_for="${sleeps[$round]}"
  if [[ ! "$sleep_for" =~ ^[0-9]+$ ]]; then
    echo "Invalid interval: $sleep_for" >&2
    exit 2
  fi
  sleep "$sleep_for"
done

echo "Round $(( ${#sleeps[@]} + 1 ))/$(( ${#sleeps[@]} + 1 ))"
for i in "${!endpoint_names[@]}"; do
  poll_url "${endpoint_names[$i]}" "${endpoint_methods[$i]}" "${endpoint_urls[$i]}" "${endpoint_payloads[$i]:-}" "${endpoint_content_types[$i]:-}"
done
