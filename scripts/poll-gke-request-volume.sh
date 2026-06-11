#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/poll-gke-request-volume.sh --trace-url URL --email EMAIL [options]

Send repeated request bursts against the public GKE trace endpoint so the
trace UI can be exercised with different request volumes.

Options:
  --trace-url URL         Public GKE trace-test LoadBalancer URL. Optional; falls back to Terraform if stale or omitted.
  --email EMAIL           Email label included in each request query string.
  --method VERB           HTTP method to send. Default: POST.
  --path PATH             Trace path to hit. Default: /work
  --bursts N              Number of request bursts to send. Default: 6.
  --requests N            Requests per burst. Default: 20.
  --concurrency N         Max in-flight requests per burst. Default: 10.
  --pause SECONDS         Pause between bursts. Default: 1.5.
  --timeout SECONDS       Per-request curl timeout. Default: 10.
  -h, --help              Show this help.

Example:
  scripts/poll-gke-request-volume.sh --trace-url http://34.57.5.191/ --email zagalsky@gmail.com --bursts 8 --requests 25 --pause 1 --method POST
EOF
}

trace_url="${TRACE_TEST_URL:-}"
email=""
method="POST"
path="/work"
bursts="6"
requests="20"
concurrency="10"
pause="1.5"
timeout="10"
tf_dir="${GKE_TF_DIR:-/Users/pavel/Projects/watchmen-infra/stacks/gcp-gke-cluster}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --trace-url)
      trace_url="${2:-}"
      shift 2
      ;;
    --email)
      email="${2:-}"
      shift 2
      ;;
    --method)
      method="${2:-}"
      shift 2
      ;;
    --path)
      path="${2:-}"
      shift 2
      ;;
    --bursts)
      bursts="${2:-}"
      shift 2
      ;;
    --requests)
      requests="${2:-}"
      shift 2
      ;;
    --concurrency)
      concurrency="${2:-}"
      shift 2
      ;;
    --pause)
      pause="${2:-}"
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

if [[ -z "$email" ]]; then
  usage >&2
  exit 2
fi

if ! [[ "$concurrency" =~ ^[0-9]+$ ]] || [[ "$concurrency" -lt 1 ]]; then
  echo "Invalid concurrency: $concurrency" >&2
  exit 2
fi

method="$(printf '%s' "$method" | tr '[:lower:]' '[:upper:]')"
case "$method" in
  GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE) ;;
  *)
    echo "Invalid method: $method" >&2
    exit 2
    ;;
esac

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

resolve_live_trace_url() {
  local candidate="${1:-}"
  local resolved=""

  local live_trace_ip=""
  live_trace_ip="$(kubectl -n "${NAMESPACE:-watchmen}" get svc watchmen-trace-main -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [[ -n "$live_trace_ip" ]]; then
    printf 'http://%s/' "$live_trace_ip"
    return 0
  fi

  if [[ -d "$tf_dir" ]]; then
    resolved="$(terraform -chdir="$tf_dir" output -raw trace_test_url 2>/dev/null || true)"
    if [[ -n "$resolved" ]]; then
      printf '%s' "$resolved"
      return 0
    fi
  fi

  if [[ -n "$candidate" ]]; then
    if curl -sS --max-time 3 --connect-timeout 2 -o /dev/null "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  fi

  printf '%s' "${candidate:-}"
}

format_curl_command() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local content_type="${4:-}"
  local trace_id="$5"
  local rendered_payload="${payload//__TRACE_ID__/$trace_id}"
  rendered_payload="${rendered_payload//__EMAIL__/$email}"
  rendered_payload="${rendered_payload//__BURST__/$6}"
  rendered_payload="${rendered_payload//__REQUEST__/$7}"

  local -a cmd=(
    curl
    -sS
    --location
    --max-time "$timeout"
    --user-agent "watchmen-trace-poller/1.0"
    --header "X-Watchmen-Trace-Source: poll-gke-request-volume"
    --header "X-Watchmen-Trace-Id: $trace_id"
    --header "X-Watchmen-Trace-Method: $method"
  )

  if [[ "$method" == "HEAD" ]]; then
    cmd+=(--head)
  else
    cmd+=(-X "$method")
  fi

  if [[ -n "$rendered_payload" && "$method" != "GET" && "$method" != "HEAD" ]]; then
    cmd+=(--header "Content-Type: ${content_type:-application/json}")
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

send_request() {
  local burst="$1"
  local request="$2"
  local method="$3"
  local url="$4"
  local payload="${5:-}"
  local content_type="${6:-}"
  local trace_id="$7"
  local started code timing label
  local tmp_body tmp_error
  local -a curl_args

  tmp_body="$(mktemp /tmp/watchmen-gke-volume-body.XXXXXX)"
  tmp_error="$(mktemp /tmp/watchmen-gke-volume-error.XXXXXX)"

  curl_args=(
    -sS
    -o "$tmp_body"
    --location
    -w '%{http_code} %{time_total}'
    --max-time "$timeout"
    --user-agent "watchmen-trace-poller/1.0"
    --header "X-Watchmen-Trace-Source: poll-gke-request-volume"
    --header "X-Watchmen-Trace-Id: $trace_id"
    --header "X-Watchmen-Trace-Method: $method"
  )

  if [[ "$method" == "HEAD" ]]; then
    curl_args+=(--head)
  else
    curl_args+=(-X "$method")
  fi

  if [[ -n "$payload" && "$method" != "GET" && "$method" != "HEAD" ]]; then
    curl_args+=(--header "Content-Type: ${content_type:-application/json}")
    curl_args+=(--header "X-Watchmen-Payload-Bytes: ${#payload}")
    curl_args+=(--data-binary "$payload")
  fi

  started="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '  curl: %s\n' "$(format_curl_command "$method" "$url" "$payload" "$content_type" "$trace_id" "$burst" "$request")"

  code="$(
    curl "${curl_args[@]}" "$url" 2>"$tmp_error" || printf '000 0'
  )"
  timing="${code##* }"
  code="${code%% *}"

  if [[ "$code" =~ ^[23] ]]; then
    label="ok"
  elif [[ "$code" == "000" ]]; then
    label="failed"
  else
    label="reachable"
  fi

  printf '%s %-8s burst=%s req=%s %-7s http=%s time=%ss %s\n' \
    "$started" "$label" "$burst" "$request" "$method" "$code" "$timing" "$url"

  if [[ "$label" != "ok" ]]; then
    printf '  repro: %s\n' "$(format_curl_command "$method" "$url" "$payload" "$content_type" "$trace_id" "$burst" "$request")"
  fi

  if [[ "$label" == "failed" && -s "$tmp_error" ]]; then
    sed 's/^/  curl: /' "$tmp_error"
  fi

  rm -f "$tmp_body" "$tmp_error"
}

trace_url="${trace_url%/}"
trace_url="$(resolve_live_trace_url "$trace_url")"
trace_url="${trace_url%/}"
if [[ -z "$trace_url" ]]; then
  echo "Unable to resolve a live GKE trace URL." >&2
  exit 2
fi
encoded_email="$(urlencode "$email")"

echo "Polling GKE trace request volume"
echo "  email:      $email"
echo "  trace_url:  $trace_url"
echo "  path:       $path"
echo "  method:     $method"
echo "  bursts:     $bursts"
echo "  requests:   $requests"
echo "  concurrency:$concurrency"
echo "  pause:      $pause"
echo

body_template='{"traceId":"__TRACE_ID__","email":"__EMAIL__","burst":"__BURST__","request":"__REQUEST__","kind":"volume","path":"__PATH__"}'

for burst in $(seq 1 "$bursts"); do
  echo "Burst $burst/$bursts"
  request_pids=()
  for request in $(seq 1 "$requests"); do
    trace_id="watchmen-gke-volume-${burst}-${request}-$(date +%s)-${RANDOM}"
    request_url="$(append_query "${trace_url}${path}" "poll_email=$encoded_email&source=gke-volume&burst=$burst&request=$request&watchmen_trace_probe=$trace_id")"
    payload="${body_template//__TRACE_ID__/$trace_id}"
    payload="${payload//__EMAIL__/$email}"
    payload="${payload//__BURST__/$burst}"
    payload="${payload//__REQUEST__/$request}"
    payload="${payload//__PATH__/$path}"
    send_request "$burst" "$request" "$method" "$request_url" "$payload" "application/json" "$trace_id" &
    request_pids+=("$!")

    if [[ "${#request_pids[@]}" -ge "$concurrency" ]]; then
      wait "${request_pids[0]}"
      request_pids=("${request_pids[@]:1}")
    fi
  done

  for pid in "${request_pids[@]}"; do
    wait "$pid"
  done
  echo
  if [[ "$burst" -lt "$bursts" ]]; then
    sleep "$pause"
  fi
done
