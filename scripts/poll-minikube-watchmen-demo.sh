#!/usr/bin/env bash
set -euo pipefail

PROFILE="watchmen-minikube"
CONTEXT=""
NAMESPACE="watchmen"
SERVICE="watchmen-shop-frontend"
LOCAL_PORT="18080"
REQUESTS="40"
PAUSE="0.2"
METHOD="GET"
PATHS=("/" "/healthz" "/api/products" "/api/cart" "/api/checkout")

usage() {
  cat <<'USAGE'
Send trace-tagged HTTP requests to the local Watchmen demo service.

Usage:
  scripts/poll-minikube-watchmen-demo.sh [options]

Options:
  --context=NAME       Kubernetes context to use. Defaults to auto-detect.
  --profile=NAME       Preferred minikube profile/context. Default: watchmen-minikube.
  --namespace=NAME     Kubernetes namespace. Default: watchmen.
  --service=NAME       Service to port-forward. Default: watchmen-shop-frontend.
  --local-port=PORT    Local port for port-forward. Default: 18080.
  --requests=N         Number of requests to send. Default: 40.
  --pause=SECONDS      Delay between requests. Default: 0.2.
  --method=METHOD      HTTP method. Default: GET.
  --path=PATH          Path to request. Can be repeated. Overrides defaults.
  -h, --help           Show this help.

Examples:
  scripts/poll-minikube-watchmen-demo.sh
  scripts/poll-minikube-watchmen-demo.sh --requests=100 --pause=0.1
  scripts/poll-minikube-watchmen-demo.sh --context=watchmen-minikube --path=/ --path=/api/products
USAGE
}

die() {
  echo "error: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

while [[ "$#" -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    --context=*) CONTEXT="${arg#*=}" ;;
    --context) shift; [[ "$#" -gt 0 ]] || die "--context requires a value"; CONTEXT="$1" ;;
    --profile=*) PROFILE="${arg#*=}" ;;
    --profile) shift; [[ "$#" -gt 0 ]] || die "--profile requires a value"; PROFILE="$1" ;;
    --namespace=*) NAMESPACE="${arg#*=}" ;;
    --namespace) shift; [[ "$#" -gt 0 ]] || die "--namespace requires a value"; NAMESPACE="$1" ;;
    --service=*) SERVICE="${arg#*=}" ;;
    --service) shift; [[ "$#" -gt 0 ]] || die "--service requires a value"; SERVICE="$1" ;;
    --local-port=*) LOCAL_PORT="${arg#*=}" ;;
    --local-port) shift; [[ "$#" -gt 0 ]] || die "--local-port requires a value"; LOCAL_PORT="$1" ;;
    --requests=*) REQUESTS="${arg#*=}" ;;
    --requests) shift; [[ "$#" -gt 0 ]] || die "--requests requires a value"; REQUESTS="$1" ;;
    --pause=*) PAUSE="${arg#*=}" ;;
    --pause) shift; [[ "$#" -gt 0 ]] || die "--pause requires a value"; PAUSE="$1" ;;
    --method=*) METHOD="${arg#*=}" ;;
    --method) shift; [[ "$#" -gt 0 ]] || die "--method requires a value"; METHOD="$1" ;;
    --path=*)
      if [[ "${PATHS_OVERRIDDEN:-}" != "1" ]]; then
        PATHS=()
        PATHS_OVERRIDDEN=1
      fi
      PATHS+=("${arg#*=}")
      ;;
    --path)
      shift
      [[ "$#" -gt 0 ]] || die "--path requires a value"
      if [[ "${PATHS_OVERRIDDEN:-}" != "1" ]]; then
        PATHS=()
        PATHS_OVERRIDDEN=1
      fi
      PATHS+=("$1")
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $arg"
      ;;
  esac
  shift
done

need kubectl
need curl

[[ "$REQUESTS" =~ ^[0-9]+$ ]] || die "--requests must be an integer"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ ]] || die "--local-port must be an integer"
[[ "${#PATHS[@]}" -gt 0 ]] || die "at least one --path is required"

service_is_ready() {
  local ctx="$1"
  kubectl --context "$ctx" -n "$NAMESPACE" get service "$SERVICE" --request-timeout=5s >/dev/null 2>&1 || return 1
  kubectl --context "$ctx" -n "$NAMESPACE" get endpoints "$SERVICE" --request-timeout=5s \
    -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null | grep -Eq '.'
}

pick_context() {
  if [[ -n "$CONTEXT" ]]; then
    service_is_ready "$CONTEXT" || die "context '$CONTEXT' is not reachable or has no ready endpoints for service/$SERVICE in namespace '$NAMESPACE'"
    echo "$CONTEXT"
    return
  fi

  local current
  current="$(kubectl config current-context 2>/dev/null || true)"

  local candidates=()
  [[ -n "$current" ]] && candidates+=("$current")
  candidates+=("$PROFILE")

  while IFS= read -r ctx; do
    [[ -n "$ctx" ]] && candidates+=("$ctx")
  done < <(kubectl config get-contexts -o name 2>/dev/null || true)

  local seen=" "
  local ctx
  for ctx in "${candidates[@]}"; do
    [[ "$seen" == *" $ctx "* ]] && continue
    seen+="$ctx "
    if service_is_ready "$ctx"; then
      echo "$ctx"
      return
    fi
  done

  die "no reachable context has ready endpoints for service/$SERVICE in namespace '$NAMESPACE'"
}

CONTEXT="$(pick_context)"
BASE_URL="http://127.0.0.1:${LOCAL_PORT}"
PF_LOG="$(mktemp -t watchmen-port-forward.XXXXXX.log)"

cleanup() {
  if [[ -n "${PF_PID:-}" ]] && kill -0 "$PF_PID" >/dev/null 2>&1; then
    kill "$PF_PID" >/dev/null 2>&1 || true
    wait "$PF_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$PF_LOG"
}
trap cleanup EXIT INT TERM

echo "context:   $CONTEXT"
echo "namespace: $NAMESPACE"
echo "service:   $SERVICE"
echo "local url: $BASE_URL"

kubectl --context "$CONTEXT" -n "$NAMESPACE" port-forward "service/${SERVICE}" "${LOCAL_PORT}:80" >"$PF_LOG" 2>&1 &
PF_PID="$!"

for _ in {1..50}; do
  if curl -fsS --max-time 1 "$BASE_URL/" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$PF_PID" >/dev/null 2>&1; then
    echo "port-forward log:" >&2
    cat "$PF_LOG" >&2
    die "port-forward exited before becoming ready"
  fi
  sleep 0.2
done

if ! curl -fsS --max-time 2 "$BASE_URL/" >/dev/null 2>&1; then
  echo "port-forward log:" >&2
  cat "$PF_LOG" >&2
  die "service did not respond on $BASE_URL"
fi

echo "sending $REQUESTS request(s)..."

for i in $(seq 1 "$REQUESTS"); do
  path="${PATHS[$(((i - 1) % ${#PATHS[@]}))]}"
  trace_id="wm-${CONTEXT//[^a-zA-Z0-9]/-}-test-$(date +%s)-${i}"
  separator="?"
  [[ "$path" == *"?"* ]] && separator="&"
  url="${BASE_URL}${path}${separator}demo_trace_id=${trace_id}&watchmen_trace_probe=${trace_id}"

  status="$(
    curl -sS -o /dev/null -w "%{http_code}" --max-time 5 \
      -X "$METHOD" \
      -H "User-Agent: watchmen-trace-poller/1.0" \
      -H "X-Watchmen-Trace-Id: ${trace_id}" \
      -H "X-Demo-Trace-Id: ${trace_id}" \
      -H "X-Watchmen-Trace-Source: local-kubernetes" \
      "$url" || true
  )"

  printf "%03d %s %s -> %s trace=%s\n" "$i" "$METHOD" "$path" "$status" "$trace_id"
  sleep "$PAUSE"
done

echo
echo "done. In Watchmen UI, open Dashboard -> Trace, select K8S, enable LIVE, then look for trace ids starting with:"
echo "wm-${CONTEXT//[^a-zA-Z0-9]/-}-test-"
