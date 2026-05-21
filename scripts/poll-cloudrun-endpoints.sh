#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Poll all Cloud Run URLs from a user's latest GCP snapshot using widening intervals.

Usage:
  scripts/poll-cloudrun-endpoints.sh --email you@example.com [options]

Options:
  --email EMAIL           Snapshot owner email to read from user_snapshots
  --db-url URL            Override POSTGRES_URL instead of reading .env.local
  --intervals CSV         Round delays in seconds, default: 1,2,5,10,15,20
  --fixed-interval SEC    Use the same sleep after every round
  --duration SEC          Keep polling for roughly this many seconds
  --timeout SECONDS       Per-request curl timeout, default: 10
  --method METHOD         HTTP method, default: GET
  --repeat N              Requests per endpoint in each round, default: 1
  --parallel N            Max concurrent requests across all endpoints, default: 1
  --header 'K: V'         Extra header, repeatable
  --json-body JSON        Send this JSON body with each request
  --no-trace-headers      Disable built-in Watchmen trace headers
  --path PATH             Append path to each Cloud Run base URL
  --rounds N              Override round count; uses first N intervals

Examples:
  scripts/poll-cloudrun-endpoints.sh --email you@example.com
  scripts/poll-cloudrun-endpoints.sh --email you@example.com --path /healthz
  scripts/poll-cloudrun-endpoints.sh --email you@example.com --intervals 1,3,7,15
  scripts/poll-cloudrun-endpoints.sh --email you@example.com --fixed-interval 2 --duration 300 --repeat 3 --parallel 8
  scripts/poll-cloudrun-endpoints.sh --email you@example.com --method POST --path /items --json-body '{"name":"watchmen","value":"trace probe"}'
EOF
}

EMAIL=""
DB_URL=""
INTERVALS_CSV="1,2,5,10,15,20"
FIXED_INTERVAL=""
DURATION=""
TIMEOUT="10"
METHOD="GET"
REPEAT="1"
PARALLEL="1"
PATH_SUFFIX=""
ROUNDS=""
JSON_BODY=""
INCLUDE_TRACE_HEADERS="true"
HEADERS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --db-url)
      DB_URL="${2:-}"
      shift 2
      ;;
    --intervals)
      INTERVALS_CSV="${2:-}"
      shift 2
      ;;
    --fixed-interval)
      FIXED_INTERVAL="${2:-}"
      shift 2
      ;;
    --duration)
      DURATION="${2:-}"
      shift 2
      ;;
    --timeout)
      TIMEOUT="${2:-}"
      shift 2
      ;;
    --method)
      METHOD="${2:-}"
      shift 2
      ;;
    --repeat)
      REPEAT="${2:-}"
      shift 2
      ;;
    --parallel)
      PARALLEL="${2:-}"
      shift 2
      ;;
    --header)
      HEADERS+=("${2:-}")
      shift 2
      ;;
    --json-body)
      JSON_BODY="${2:-}"
      shift 2
      ;;
    --no-trace-headers)
      INCLUDE_TRACE_HEADERS="false"
      shift
      ;;
    --path)
      PATH_SUFFIX="${2:-}"
      shift 2
      ;;
    --rounds)
      ROUNDS="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$EMAIL" ]]; then
  echo "--email is required" >&2
  usage >&2
  exit 1
fi

if [[ -z "$DB_URL" ]]; then
  if [[ ! -f ".env.local" ]]; then
    echo "POSTGRES_URL not provided and .env.local not found" >&2
    exit 1
  fi
  DB_URL="$(grep '^POSTGRES_URL=' .env.local | sed 's/^POSTGRES_URL=//')"
fi

# Accept quoted .env values like POSTGRES_URL="postgres://..."
if [[ "${DB_URL:0:1}" == '"' && "${DB_URL: -1}" == '"' ]]; then
  DB_URL="${DB_URL:1:${#DB_URL}-2}"
elif [[ "${DB_URL:0:1}" == "'" && "${DB_URL: -1}" == "'" ]]; then
  DB_URL="${DB_URL:1:${#DB_URL}-2}"
fi

if [[ -z "$DB_URL" ]]; then
  echo "POSTGRES_URL is empty" >&2
  exit 1
fi

if [[ -n "$PATH_SUFFIX" && "${PATH_SUFFIX:0:1}" != "/" ]]; then
  PATH_SUFFIX="/$PATH_SUFFIX"
fi

if ! [[ "$REPEAT" =~ ^[0-9]+$ ]] || [[ "$REPEAT" -lt 1 ]]; then
  echo "--repeat must be a positive integer" >&2
  exit 1
fi

if ! [[ "$PARALLEL" =~ ^[0-9]+$ ]] || [[ "$PARALLEL" -lt 1 ]]; then
  echo "--parallel must be a positive integer" >&2
  exit 1
fi

if [[ -n "$ROUNDS" ]]; then
  if ! [[ "$ROUNDS" =~ ^[0-9]+$ ]] || [[ "$ROUNDS" -lt 1 ]]; then
    echo "--rounds must be a positive integer" >&2
    exit 1
  fi
fi

if [[ -n "$FIXED_INTERVAL" ]]; then
  if ! [[ "$FIXED_INTERVAL" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "--fixed-interval must be a positive number" >&2
    exit 1
  fi
fi

if [[ -n "$DURATION" ]]; then
  if ! [[ "$DURATION" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "--duration must be a positive number" >&2
    exit 1
  fi
fi

INTERVALS=()
if [[ -n "$FIXED_INTERVAL" ]]; then
  rounds_to_run="${ROUNDS:-}"
  if [[ -z "$rounds_to_run" ]]; then
    if [[ -n "$DURATION" ]]; then
      rounds_to_run="$(awk -v d="$DURATION" -v i="$FIXED_INTERVAL" 'BEGIN { r = int((d / i) + 0.999999); if (r < 1) r = 1; print r }')"
    else
      rounds_to_run="30"
    fi
  fi
  i=0
  while [[ "$i" -lt "$rounds_to_run" ]]; do
    INTERVALS+=("$FIXED_INTERVAL")
    i=$((i + 1))
  done
else
  IFS=',' read -r -a INTERVALS <<< "$INTERVALS_CSV"
  if [[ ${#INTERVALS[@]} -eq 0 ]]; then
    echo "No intervals provided" >&2
    exit 1
  fi
  if [[ -n "$ROUNDS" ]]; then
    INTERVALS=("${INTERVALS[@]:0:$ROUNDS}")
  fi
fi

ENDPOINT_ROWS=()
while IFS= read -r row; do
  ENDPOINT_ROWS+=("$row")
done < <(
  psql "$DB_URL" -X -A -F $'\t' -v ON_ERROR_STOP=1 --set=email="$EMAIL" <<'EOF'
\pset tuples_only on
SELECT
  elem->>'name' AS name,
  elem->>'projectId' AS project_id,
  elem->>'region' AS region,
  elem->>'url' AS url
FROM user_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(s.snapshot->'cloudRunServices') elem
WHERE s.user_email = :'email'
  AND COALESCE(elem->>'url', '') <> ''
ORDER BY 1, 2, 3;
EOF
)

if [[ ${#ENDPOINT_ROWS[@]} -eq 0 ]]; then
  echo "No Cloud Run URLs found for $EMAIL" >&2
  exit 1
fi

CURL_ARGS=(
  --silent
  --show-error
  --output /dev/null
  --location
  --max-time "$TIMEOUT"
  --request "$METHOD"
  --write-out 'status=%{http_code} total=%{time_total}s ip=%{remote_ip}\n'
  --user-agent "watchmen-trace-poller/1.0"
)

echo "Found ${#ENDPOINT_ROWS[@]} Cloud Run endpoint(s) for $EMAIL"
echo "Intervals: ${INTERVALS[*]} seconds"
echo "Requests per endpoint per round: $REPEAT"
echo "Max concurrent requests: $PARALLEL"
if [[ -n "$JSON_BODY" ]]; then
  echo "JSON body: enabled"
fi
echo

run_request() {
  local name="$1"
  local project_id="$2"
  local region="$3"
  local req="$4"
  local request_url="$5"
  local request_body="$6"
  local trace_id="$7"
  local round="$8"

  if [[ "$REPEAT" -gt 1 ]]; then
    printf '%s [%s/%s] #%s %s -> ' "$name" "$project_id" "$region" "$req" "$request_url"
  else
    printf '%s [%s/%s] %s -> ' "$name" "$project_id" "$region" "$request_url"
  fi

  REQUEST_CURL_ARGS=("${CURL_ARGS[@]}")
  if [[ "$INCLUDE_TRACE_HEADERS" == "true" ]]; then
    REQUEST_CURL_ARGS+=(--header "X-Watchmen-Trace-Source: poll-cloudrun-endpoints")
    REQUEST_CURL_ARGS+=(--header "X-Watchmen-Trace-Id: ${trace_id}")
    REQUEST_CURL_ARGS+=(--header "X-Watchmen-Trace-Round: ${round}")
  fi
  if [[ ${#HEADERS[@]} -gt 0 ]]; then
    for header in "${HEADERS[@]}"; do
      REQUEST_CURL_ARGS+=(--header "$header")
    done
  fi
  if [[ -n "$request_body" ]]; then
    REQUEST_CURL_ARGS+=(--header "Content-Type: application/json")
    REQUEST_CURL_ARGS+=(--data-raw "$request_body")
  fi

  if ! curl "${REQUEST_CURL_ARGS[@]}" "$request_url"; then
    echo "status=ERR"
  fi
}

throttle_parallel() {
  if [[ "$PARALLEL" -le 1 ]]; then
    return
  fi

  local running_jobs
  while :; do
    running_jobs="$(jobs -pr | wc -l | tr -d '[:space:]')"
    if [[ "$running_jobs" -lt "$PARALLEL" ]]; then
      break
    fi
    sleep 0.05
  done
}

round=1
for interval in "${INTERVALS[@]}"; do
  round_started="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "=== Round $round/${#INTERVALS[@]} at $round_started (sleep after round: ${interval}s) ==="

  for row in "${ENDPOINT_ROWS[@]}"; do
    IFS=$'\t' read -r name project_id region url <<< "$row"
    target="${url%/}${PATH_SUFFIX}"
    req=1
    while [[ "$req" -le "$REPEAT" ]]; do
      trace_id="watchmen-${round}-${req}-$(date +%s)-${RANDOM}"
      sep='?'
      if [[ "$target" == *\?* ]]; then
        sep='&'
      fi
      request_url="${target}${sep}watchmen_trace_probe=${trace_id}"
      request_body="$JSON_BODY"

      if [[ -z "$request_body" && ( "$METHOD" == "POST" || "$METHOD" == "PUT" || "$METHOD" == "PATCH" ) ]]; then
        request_body="{\"name\":\"watchmen-trace-${round}-${req}\",\"value\":\"${trace_id}\",\"source\":\"watchmen-trace-poller\"}"
      fi

      if [[ "$PARALLEL" -gt 1 ]]; then
        throttle_parallel
        run_request "$name" "$project_id" "$region" "$req" "$request_url" "$request_body" "$trace_id" "$round" &
      else
        run_request "$name" "$project_id" "$region" "$req" "$request_url" "$request_body" "$trace_id" "$round"
      fi
      req=$((req + 1))
    done
  done

  if [[ "$PARALLEL" -gt 1 ]]; then
    wait
  fi

  if [[ "$round" -lt "${#INTERVALS[@]}" ]]; then
    echo "Sleeping ${interval}s"
    echo
    sleep "$interval"
  fi
  round=$((round + 1))
done
