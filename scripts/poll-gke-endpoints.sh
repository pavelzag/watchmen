#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/poll-gke-endpoints.sh --email EMAIL --intervals 1,2,5,10,15,20 [options]

Polls Watchmen trace endpoints for GCP, AWS, or both. GCP defaults are read
from stacks/gcp-gke-cluster Terraform outputs when available.

Options:
  --email EMAIL              Email label included in each request query string.
  --intervals CSV            Seconds to sleep between polling rounds.
  --cloud CLOUD              Cloud to poll: gcp or aws. Default: gcp
  --clouds CSV               Clouds to poll: gcp,aws.
  --method VERB              Restrict polling to a single HTTP method.
  --watchmen-url URL         Watchmen base URL. Default: https://watchmen-kappa.vercel.app
  --trace-url URL            Public GKE trace-test LoadBalancer URL.
  --cluster NAME             GKE cluster name. Default: Terraform output cluster_name.
  --project ID               GCP project ID. Default: parsed from deploy_agent output.
  --agent-binary-url URL     Agent binary URL to check.
  --aws-lambda-url URL       AWS Lambda Function URL to poll.
  --aws-ec2-url URL          AWS EC2 public HTTP endpoint to poll.
  --aws-elb-url URL          AWS ELB/ALB public HTTP endpoint to poll.
  --aws-eks-url URL          Public EKS API endpoint to poll.
  --aws-account ID           AWS account label included in payloads.
  --aws-region REGION        AWS region label. Default: us-east-1
  --aws-cluster NAME         EKS cluster label. Default: watchmen-test
  --timeout SECONDS          Per-request curl timeout. Default: 10
  -h, --help                 Show this help.

Example:
  scripts/poll-gke-endpoints.sh --email zagalsky@gmail.com --intervals 1,2,5,10,15,20
  scripts/poll-gke-endpoints.sh --email zagalsky@gmail.com --intervals 1,5 --clouds gcp,aws --aws-lambda-url https://abc.lambda-url.us-east-1.on.aws/
EOF
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tf_dir="$repo_root/stacks/gcp-gke-cluster"

email=""
intervals=""
clouds="${TRACE_CLOUDS:-gcp}"
method_filter=""
watchmen_url="${WATCHMEN_URL:-https://watchmen-kappa.vercel.app}"
trace_url="${TRACE_TEST_URL:-}"
cluster="${GKE_CLUSTER_NAME:-}"
project="${GCP_PROJECT_ID:-}"
agent_binary_url="${WATCHMEN_AGENT_BINARY_URL:-https://github.com/pavelzag/watchmen/releases/download/agent-v0.3.19/watchmen-ebpf-agent-linux-amd64}"
aws_lambda_url="${AWS_LAMBDA_URL:-}"
aws_ec2_url="${AWS_EC2_URL:-}"
aws_elb_url="${AWS_ELB_URL:-}"
aws_eks_url="${AWS_EKS_URL:-}"
aws_account="${AWS_ACCOUNT_ID:-}"
aws_region="${AWS_REGION:-us-east-1}"
aws_cluster="${AWS_EKS_CLUSTER_NAME:-watchmen-test}"
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
    --cloud)
      clouds="${2:-}"
      shift 2
      ;;
    --clouds)
      clouds="${2:-}"
      shift 2
      ;;
    --method)
      method_filter="${2:-}"
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
    --aws-lambda-url)
      aws_lambda_url="${2:-}"
      shift 2
      ;;
    --aws-ec2-url)
      aws_ec2_url="${2:-}"
      shift 2
      ;;
    --aws-elb-url)
      aws_elb_url="${2:-}"
      shift 2
      ;;
    --aws-eks-url)
      aws_eks_url="${2:-}"
      shift 2
      ;;
    --aws-account)
      aws_account="${2:-}"
      shift 2
      ;;
    --aws-region)
      aws_region="${2:-}"
      shift 2
      ;;
    --aws-cluster)
      aws_cluster="${2:-}"
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

if [[ -n "$method_filter" ]]; then
  method_filter="$(printf '%s' "$method_filter" | tr '[:lower:]' '[:upper:]')"
  case "$method_filter" in
    GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE) ;;
    *)
      echo "Invalid method: $method_filter" >&2
      usage >&2
      exit 2
      ;;
  esac
fi

if [[ -z "$email" || -z "$intervals" ]]; then
  usage >&2
  exit 2
fi

clouds="$(printf '%s' "$clouds" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if [[ -z "$clouds" ]]; then
  echo "At least one cloud must be selected." >&2
  usage >&2
  exit 2
fi

IFS=',' read -r -a selected_clouds <<< "$clouds"
for selected_cloud in "${selected_clouds[@]}"; do
  case "$selected_cloud" in
    gcp|aws) ;;
    *)
      echo "Invalid cloud: $selected_cloud" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cloud_enabled() {
  local cloud="$1"
  [[ ",$clouds," == *",$cloud,"* ]]
}

if cloud_enabled "gcp" && [[ -z "$cluster" && -d "$tf_dir" ]]; then
  cluster="$(terraform -chdir="$tf_dir" output -raw cluster_name 2>/dev/null || true)"
fi

if cloud_enabled "gcp" && [[ -z "$trace_url" && -d "$tf_dir" ]]; then
  trace_url="$(terraform -chdir="$tf_dir" output -raw trace_test_url 2>/dev/null || true)"
fi

if cloud_enabled "gcp" && [[ -z "$project" && -d "$tf_dir" ]]; then
  deploy_agent="$(terraform -chdir="$tf_dir" output -raw deploy_agent 2>/dev/null || true)"
  project="$(printf '%s' "$deploy_agent" | sed -n 's/.*[?&]project=\([^&"'"'"'[:space:]]*\).*/\1/p')"
fi

watchmen_url="${watchmen_url%/}"
api_url="$watchmen_url/api"
cluster="${cluster:-watchmen-test}"
project="${project:-watchmen-test-488807}"
aws_account="${aws_account:-<unknown>}"

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

should_poll_method() {
  local method="$1"
  if [[ -z "$method_filter" ]]; then
    return 0
  fi
  [[ "$method" == "$method_filter" ]]
}

format_curl_command() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local content_type="${4:-}"
  local trace_id="$5"
  local cloud="${6:-gcp}"
  local rendered_payload="${payload//__TRACE_ID__/$trace_id}"
  rendered_payload="${rendered_payload//__EMAIL__/$email}"
  rendered_payload="${rendered_payload//__CLUSTER__/$cluster}"
  rendered_payload="${rendered_payload//__PROJECT__/$project}"
  rendered_payload="${rendered_payload//__CLOUD__/$cloud}"
  rendered_payload="${rendered_payload//__AWS_ACCOUNT__/$aws_account}"
  rendered_payload="${rendered_payload//__AWS_REGION__/$aws_region}"
  rendered_payload="${rendered_payload//__AWS_CLUSTER__/$aws_cluster}"

  local -a cmd=(
    curl
    -sS
    --location
    --max-time "$timeout"
    --user-agent "watchmen-trace-poller/1.0"
    --header "X-Watchmen-Trace-Source: poll-${cloud}-endpoints"
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
  local cloud="${6:-gcp}"
  local started code timing label trace_id request_url rendered_payload
  local -a curl_args

  started="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  trace_id="watchmen-${cloud}-${name}-$(date +%s)-${RANDOM}"
  request_url="$(append_query "$url" "watchmen_trace_probe=$trace_id")"
  rendered_payload="${payload//__TRACE_ID__/$trace_id}"
  rendered_payload="${rendered_payload//__EMAIL__/$email}"
  rendered_payload="${rendered_payload//__CLUSTER__/$cluster}"
  rendered_payload="${rendered_payload//__PROJECT__/$project}"
  rendered_payload="${rendered_payload//__CLOUD__/$cloud}"
  rendered_payload="${rendered_payload//__AWS_ACCOUNT__/$aws_account}"
  rendered_payload="${rendered_payload//__AWS_REGION__/$aws_region}"
  rendered_payload="${rendered_payload//__AWS_CLUSTER__/$aws_cluster}"

  curl_args=(
    -sS
    -o "/tmp/watchmen-poll-body.$$"
    --location
    -w '%{http_code} %{time_total}'
    --max-time "$timeout"
    --user-agent "watchmen-trace-poller/1.0"
    --header "X-Watchmen-Trace-Source: poll-${cloud}-endpoints"
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

  printf '  curl: %s\n' "$(format_curl_command "$method" "$request_url" "$payload" "$content_type" "$trace_id" "$cloud")"

  code="$(
    curl "${curl_args[@]}" "$request_url" 2>/tmp/watchmen-poll-error.$$ || printf '000 0'
  )"

  timing="${code##* }"
  code="${code%% *}"
  label="$(status_label "$code")"

  printf '%s %-10s %-28s %-7s http=%s time=%ss %s\n' "$started" "$label" "$name" "$method" "$code" "$timing" "$request_url"

  if [[ "$label" != "ok" ]]; then
    printf '  repro: %s\n' "$(format_curl_command "$method" "$request_url" "$payload" "$content_type" "$trace_id" "$cloud")"
  fi

  if [[ "$label" == "failed" && -s /tmp/watchmen-poll-error.$$ ]]; then
    sed 's/^/  curl: /' /tmp/watchmen-poll-error.$$
  fi

  rm -f /tmp/watchmen-poll-body.$$ /tmp/watchmen-poll-error.$$
}

encoded_email="$(urlencode "$email")"
encoded_cluster="$(urlencode "$cluster")"
encoded_project="$(urlencode "$project")"
encoded_aws_region="$(urlencode "$aws_region")"
encoded_aws_account="$(urlencode "$aws_account")"

declare -a endpoint_names=()
declare -a endpoint_payloads=()
declare -a endpoint_content_types=()
declare -a endpoint_methods=()
declare -a endpoint_urls=()
declare -a endpoint_clouds=()

add_endpoint() {
  endpoint_names+=("$1")
  endpoint_methods+=("$2")
  endpoint_urls+=("$3")
  endpoint_payloads+=("${4:-}")
  endpoint_content_types+=("${5:-}")
  endpoint_clouds+=("$6")
}

add_http_matrix() {
  local cloud="$1"
  local label="$2"
  local base_url="$3"
  local source="$4"
  local json_payload="$5"
  local form_payload="$6"
  local text_payload="$7"
  local patch_payload="$8"
  local binary_payload="$9"
  local root_url="${base_url%/}/"
  local work_url="${base_url%/}/work"

  add_endpoint "$label-main" "GET" "$(append_query "$root_url" "poll_email=$encoded_email&source=$source")" "" "" "$cloud"
  add_endpoint "$label-health" "GET" "${base_url%/}/health" "" "" "$cloud"
  add_endpoint "$label-head" "HEAD" "$(append_query "$root_url" "poll_email=$encoded_email&source=$source&probe=head")" "" "" "$cloud"
  add_endpoint "$label-options" "OPTIONS" "$(append_query "$root_url" "poll_email=$encoded_email&source=$source&probe=options")" "" "" "$cloud"
  add_endpoint "$label-json-post" "POST" "$(append_query "$work_url" "poll_email=$encoded_email&source=$source&payload=json")" "$json_payload" "application/json" "$cloud"
  add_endpoint "$label-form-post" "POST" "$(append_query "$work_url" "poll_email=$encoded_email&source=$source&payload=form")" "$form_payload" "application/x-www-form-urlencoded" "$cloud"
  add_endpoint "$label-text-put" "PUT" "$(append_query "$work_url" "poll_email=$encoded_email&source=$source&payload=text")" "$text_payload" "text/plain; charset=utf-8" "$cloud"
  add_endpoint "$label-json-patch" "PATCH" "$(append_query "$work_url" "poll_email=$encoded_email&source=$source&payload=patch")" "$patch_payload" "application/json-patch+json" "$cloud"
  add_endpoint "$label-delete" "DELETE" "$(append_query "$work_url" "poll_email=$encoded_email&source=$source&payload=delete")" "" "" "$cloud"
  add_endpoint "$label-octets" "POST" "$(append_query "$work_url" "poll_email=$encoded_email&source=$source&payload=octets")" "$binary_payload" "application/octet-stream" "$cloud"
  add_endpoint "$label-trace" "TRACE" "$(append_query "$root_url" "poll_email=$encoded_email&source=$source&probe=trace")" "" "" "$cloud"
}

if cloud_enabled "gcp"; then
  add_endpoint "watchmen-health-gcp" "GET" "$(append_query "$api_url/health" "poll_email=$encoded_email&source=gke")" "" "" "gcp"
  add_endpoint "agent-manifest" "GET" "$api_url/agents/k8s/manifest?cluster=$encoded_cluster&project=$encoded_project&poll_email=$encoded_email" "" "" "gcp"
  add_endpoint "agent-register" "GET" "$(append_query "$api_url/agents/k8s/register" "poll_email=$encoded_email&source=gke")" "" "" "gcp"
  add_endpoint "agent-events" "GET" "$(append_query "$api_url/agents/events" "poll_email=$encoded_email&source=gke")" "" "" "gcp"
  add_endpoint "agent-binary" "GET" "$agent_binary_url" "" "" "gcp"
fi

if cloud_enabled "gcp" && [[ -n "$trace_url" ]]; then
  json_payload='{"traceId":"__TRACE_ID__","email":"__EMAIL__","cluster":"__CLUSTER__","project":"__PROJECT__","kind":"json","nested":{"flag":true,"count":3},"items":["alpha","beta","gamma"]}'
  form_payload='trace_id=__TRACE_ID__&email=__EMAIL__&kind=form&feature=ebpf-agent&encoded=a%2Bb%3Dc'
  text_payload=$'trace=__TRACE_ID__\nemail=__EMAIL__\nkind=text\nmessage=hello from poll-gke-endpoints'
  patch_payload='{"traceId":"__TRACE_ID__","op":"replace","path":"/feature/ebpf","value":"payload-capture"}'
  binary_payload=$'watchmen-binary-probe __TRACE_ID__\n\x01\x02\x03\x7f payload-end'

  add_http_matrix "gcp" "gke-trace" "$trace_url" "gke" "$json_payload" "$form_payload" "$text_payload" "$patch_payload" "$binary_payload"
fi

if cloud_enabled "aws"; then
  add_endpoint "watchmen-health-aws" "GET" "$(append_query "$api_url/health" "poll_email=$encoded_email&source=aws&aws_region=$encoded_aws_region&aws_account=$encoded_aws_account")" "" "" "aws"

  aws_json_payload='{"traceId":"__TRACE_ID__","email":"__EMAIL__","cloud":"__CLOUD__","account":"__AWS_ACCOUNT__","region":"__AWS_REGION__","cluster":"__AWS_CLUSTER__","kind":"json","nested":{"flag":true,"count":3},"items":["lambda","ec2","eks"]}'
  aws_form_payload='trace_id=__TRACE_ID__&email=__EMAIL__&cloud=__CLOUD__&account=__AWS_ACCOUNT__&region=__AWS_REGION__&kind=form'
  aws_text_payload=$'trace=__TRACE_ID__\nemail=__EMAIL__\ncloud=__CLOUD__\naccount=__AWS_ACCOUNT__\nregion=__AWS_REGION__\nmessage=hello from poll-aws-endpoints'
  aws_patch_payload='{"traceId":"__TRACE_ID__","op":"replace","path":"/feature/aws","value":"payload-capture"}'
  aws_binary_payload=$'watchmen-aws-binary-probe __TRACE_ID__\n\x01\x02\x03\x7f payload-end'

  if [[ -n "$aws_lambda_url" ]]; then
    add_http_matrix "aws" "aws-lambda" "$aws_lambda_url" "aws-lambda" "$aws_json_payload" "$aws_form_payload" "$aws_text_payload" "$aws_patch_payload" "$aws_binary_payload"
  fi
  if [[ -n "$aws_ec2_url" ]]; then
    add_http_matrix "aws" "aws-ec2" "$aws_ec2_url" "aws-ec2" "$aws_json_payload" "$aws_form_payload" "$aws_text_payload" "$aws_patch_payload" "$aws_binary_payload"
  fi
  if [[ -n "$aws_elb_url" ]]; then
    add_http_matrix "aws" "aws-elb" "$aws_elb_url" "aws-elb" "$aws_json_payload" "$aws_form_payload" "$aws_text_payload" "$aws_patch_payload" "$aws_binary_payload"
  fi
  if [[ -n "$aws_eks_url" ]]; then
    add_endpoint "aws-eks-api" "GET" "$(append_query "${aws_eks_url%/}/" "poll_email=$encoded_email&source=aws-eks&aws_region=$encoded_aws_region&aws_account=$encoded_aws_account")" "" "" "aws"
    add_endpoint "aws-eks-api-head" "HEAD" "$(append_query "${aws_eks_url%/}/" "poll_email=$encoded_email&source=aws-eks&probe=head&aws_region=$encoded_aws_region&aws_account=$encoded_aws_account")" "" "" "aws"
    add_endpoint "aws-eks-api-options" "OPTIONS" "$(append_query "${aws_eks_url%/}/" "poll_email=$encoded_email&source=aws-eks&probe=options&aws_region=$encoded_aws_region&aws_account=$encoded_aws_account")" "" "" "aws"
  fi
fi

IFS=',' read -r -a sleeps <<< "$intervals"

echo "Polling Watchmen trace endpoints"
echo "  email:        $email"
echo "  clouds:       $clouds"
echo "  watchmen_url: $watchmen_url"
echo "  cluster:      $cluster"
echo "  project:      $project"
echo "  trace_url:    ${trace_url:-<not found>}"
echo "  aws_region:   $aws_region"
echo "  aws_account:  $aws_account"
echo "  aws_cluster:  $aws_cluster"
echo "  aws_lambda:   ${aws_lambda_url:-<not set>}"
echo "  aws_ec2:      ${aws_ec2_url:-<not set>}"
echo "  aws_elb:      ${aws_elb_url:-<not set>}"
echo "  aws_eks:      ${aws_eks_url:-<not set>}"
echo "  intervals:    $intervals"
echo "  method:       ${method_filter:-<all>}"
echo

if [[ "${#endpoint_names[@]}" -eq 0 ]]; then
  echo "No endpoints selected. Provide a GCP trace URL, AWS endpoint URL, or include Watchmen health checks." >&2
  exit 2
fi

if [[ -n "$method_filter" ]]; then
  matches=0
  for method in "${endpoint_methods[@]}"; do
    if [[ "$method" == "$method_filter" ]]; then
      matches=1
      break
    fi
  done
  if [[ "$matches" -ne 1 ]]; then
    echo "No endpoints match method filter: $method_filter" >&2
    exit 2
  fi
fi

for round in "${!sleeps[@]}"; do
  round_no=$((round + 1))
  echo "Round $round_no/$(( ${#sleeps[@]} + 1 ))"
  for i in "${!endpoint_names[@]}"; do
    if should_poll_method "${endpoint_methods[$i]}"; then
      poll_url "${endpoint_names[$i]}" "${endpoint_methods[$i]}" "${endpoint_urls[$i]}" "${endpoint_payloads[$i]:-}" "${endpoint_content_types[$i]:-}" "${endpoint_clouds[$i]:-gcp}"
    fi
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
  if should_poll_method "${endpoint_methods[$i]}"; then
    poll_url "${endpoint_names[$i]}" "${endpoint_methods[$i]}" "${endpoint_urls[$i]}" "${endpoint_payloads[$i]:-}" "${endpoint_content_types[$i]:-}" "${endpoint_clouds[$i]:-gcp}"
  fi
done
