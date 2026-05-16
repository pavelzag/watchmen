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
  --timeout SECONDS       Per-request curl timeout, default: 10
  --method METHOD         HTTP method, default: GET
  --header 'K: V'         Extra header, repeatable
  --path PATH             Append path to each Cloud Run base URL
  --rounds N              Override round count; uses first N intervals

Examples:
  scripts/poll-cloudrun-endpoints.sh --email you@example.com
  scripts/poll-cloudrun-endpoints.sh --email you@example.com --path /healthz
  scripts/poll-cloudrun-endpoints.sh --email you@example.com --intervals 1,3,7,15
EOF
}

EMAIL=""
DB_URL=""
INTERVALS_CSV="1,2,5,10,15,20"
TIMEOUT="10"
METHOD="GET"
PATH_SUFFIX=""
ROUNDS=""
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
    --timeout)
      TIMEOUT="${2:-}"
      shift 2
      ;;
    --method)
      METHOD="${2:-}"
      shift 2
      ;;
    --header)
      HEADERS+=("${2:-}")
      shift 2
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

if [[ -z "$DB_URL" ]]; then
  echo "POSTGRES_URL is empty" >&2
  exit 1
fi

if [[ -n "$PATH_SUFFIX" && "${PATH_SUFFIX:0:1}" != "/" ]]; then
  PATH_SUFFIX="/$PATH_SUFFIX"
fi

IFS=',' read -r -a INTERVALS <<< "$INTERVALS_CSV"
if [[ ${#INTERVALS[@]} -eq 0 ]]; then
  echo "No intervals provided" >&2
  exit 1
fi

if [[ -n "$ROUNDS" ]]; then
  if ! [[ "$ROUNDS" =~ ^[0-9]+$ ]] || [[ "$ROUNDS" -lt 1 ]]; then
    echo "--rounds must be a positive integer" >&2
    exit 1
  fi
  INTERVALS=("${INTERVALS[@]:0:$ROUNDS}")
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

if [[ ${#HEADERS[@]} -gt 0 ]]; then
  for header in "${HEADERS[@]}"; do
    CURL_ARGS+=(--header "$header")
  done
fi

echo "Found ${#ENDPOINT_ROWS[@]} Cloud Run endpoint(s) for $EMAIL"
echo "Intervals: ${INTERVALS[*]} seconds"
echo

round=1
for interval in "${INTERVALS[@]}"; do
  round_started="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "=== Round $round/${#INTERVALS[@]} at $round_started (sleep after round: ${interval}s) ==="

  for row in "${ENDPOINT_ROWS[@]}"; do
    IFS=$'\t' read -r name project_id region url <<< "$row"
    target="${url%/}${PATH_SUFFIX}"
    sep='?'
    if [[ "$target" == *\?* ]]; then
      sep='&'
    fi
    request_url="${target}${sep}watchmen_trace_probe=$(date +%s)-${RANDOM}"

    printf '%s [%s/%s] %s -> ' "$name" "$project_id" "$region" "$request_url"
    if ! curl "${CURL_ARGS[@]}" "$request_url"; then
      echo "status=ERR"
    fi
  done

  if [[ "$round" -lt "${#INTERVALS[@]}" ]]; then
    echo "Sleeping ${interval}s"
    echo
    sleep "$interval"
  fi
  round=$((round + 1))
done
