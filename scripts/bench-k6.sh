#!/usr/bin/env bash
set -euo pipefail

RUNTIME="${1:-all}"
if [[ "$RUNTIME" != "node" && "$RUNTIME" != "bun" && "$RUNTIME" != "all" ]]; then
  echo "Usage: $0 [node|bun|all]"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPORTS_DIR="$ROOT_DIR/reports"
FAKE_PORT=3022
NODE_PORT=3000
BUN_PORT=3033

PIDS=()
SERVER_PID=""
RESULTS=()
SLUGS=()

read -ra ENDPOINTS <<< "${ENDPOINTS:-/price /price-rust}"

cleanup() {
  echo ""
  echo "Stopping background processes..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  echo "Done."
}
trap cleanup EXIT

mkdir -p "$REPORTS_DIR"

monitor_process() {
  local pid=$1
  local logfile=$2
  > "$logfile"
  while ps -p "$pid" > /dev/null 2>&1; do
    ps -p "$pid" -o rss=,%cpu= >> "$logfile"
    sleep 0.1
  done
}

compute_stats() {
  local logfile=$1
  local label=$2
  local jsonfile=$3

  if [[ ! -s "$logfile" ]]; then
    RESULTS+=("$label  — no data")
    echo '{"peak_rss_mb":0,"avg_cpu_pct":0,"max_cpu_pct":0}' > "$jsonfile"
    return
  fi

  local peak_rss avg_cpu max_cpu
  peak_rss=$(awk '{print $1}' "$logfile" | sort -n | tail -1)
  peak_rss=$((peak_rss / 1024))
  avg_cpu=$(awk '{sum+=$2; count++} END {if(count>0) printf "%.1f", sum/count; else print "0"}' "$logfile")
  max_cpu=$(awk '{print $2}' "$logfile" | sort -n | tail -1)
  max_cpu=$(printf "%.1f" "$max_cpu")

  echo "{\"peak_rss_mb\":$peak_rss,\"avg_cpu_pct\":$avg_cpu,\"max_cpu_pct\":$max_cpu}" > "$jsonfile"
  RESULTS+=("$label  — Peak RSS: ${peak_rss} MB | Avg CPU: ${avg_cpu}% | Max CPU: ${max_cpu}%")
}

inject_metrics_to_html() {
  local htmlfile=$1
  local jsonfile=$2
  local runtime_label="$3"
  local endpoint_path="$4"

  if [[ ! -f "$htmlfile" || ! -f "$jsonfile" ]]; then
    return
  fi

  local peak_rss avg_cpu max_cpu
  peak_rss=$(awk -F'"peak_rss_mb":' '{split($2,a,","); print a[1]}' "$jsonfile")
  avg_cpu=$(awk -F'"avg_cpu_pct":' '{split($2,a,","); print a[1]}' "$jsonfile")
  max_cpu=$(awk -F'"max_cpu_pct":' '{split($2,a,"}"); print a[1]}' "$jsonfile")

  local tmp snippet
  tmp=$(mktemp)
  snippet=$(mktemp)
  cat > "$snippet" <<SNIPPET
<div style="position:fixed;bottom:0;left:0;right:0;background:#1a1a2e;color:#e0e0e0;padding:16px 24px;font-family:system-ui,-apple-system,sans-serif;border-top:2px solid #6c63ff;display:flex;gap:32px;align-items:center;z-index:9999">
  <span style="font-size:14px;font-weight:700;color:#6c63ff;text-transform:uppercase;letter-spacing:1px">${runtime_label}</span>
  <span style="font-size:14px">Endpoint: <strong>${endpoint_path}</strong></span>
  <span style="font-size:14px">Peak RSS: <strong>${peak_rss} MB</strong></span>
  <span style="font-size:14px">Avg CPU: <strong>${avg_cpu}%</strong></span>
  <span style="font-size:14px">Max CPU: <strong>${max_cpu}%</strong></span>
</div>
<div style="height:60px"></div>
SNIPPET

  awk -v snippet="$snippet" '
    BEGIN { while((getline line < snippet) > 0) block = block "\n" line; close(snippet) }
    /<\/body>/ { print block; print; next }
    { print }
  ' "$htmlfile" > "$tmp" && mv "$tmp" "$htmlfile"
  rm -f "$snippet"
}

wait_for_server() {
  local url="$1"
  local name="$2"
  local max_attempts=30
  local attempt=0

  echo "Waiting for $name to be ready..."
  while (( attempt < max_attempts )); do
    if curl -sf "$url" -o /dev/null 2>/dev/null; then
      echo "$name is ready."
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 0.5
  done

  echo "Error: $name did not start in time."
  exit 1
}

start_fake_price() {
  echo "Starting fake price server on port $FAKE_PORT..."
  bun run "$ROOT_DIR/src/fake-price.js" &
  PIDS+=($!)
  wait_for_server "http://localhost:$FAKE_PORT/prices" "Fake price server"
}

run_k6() {
  local name="$1"
  local port="$2"
  local label="$3"
  local endpoint="$4"
  local slug="_${endpoint#/}"

  local report="$REPORTS_DIR/${name}${slug}_report.html"
  local summary_json="$REPORTS_DIR/${name}${slug}_summary.json"
  local metrics_log="$REPORTS_DIR/${name}${slug}_metrics.log"
  local metrics_json="$REPORTS_DIR/${name}${slug}_metrics.json"
  local monitor_pid=""

  echo ""
  echo "========================================="
  echo "  Benchmarking: $label — $endpoint"
  echo "  Target: http://localhost:$port${endpoint}"
  echo "========================================="
  echo ""

  monitor_process "$SERVER_PID" "$metrics_log" &
  monitor_pid=$!

  K6_WEB_DASHBOARD=true \
  K6_WEB_DASHBOARD_EXPORT="$report" \
    k6 run "$ROOT_DIR/bench/bench-k6.js" \
      --env BASE_URL="http://localhost:$port" \
      --env ENDPOINT="$endpoint" \
      --env SUMMARY_EXPORT="$summary_json" \
      --tag "runtime=$name" || true

  kill "$monitor_pid" 2>/dev/null || true
  wait "$monitor_pid" 2>/dev/null || true
  compute_stats "$metrics_log" "$label ($endpoint)" "$metrics_json"
  inject_metrics_to_html "$report" "$metrics_json" "$label" "$endpoint"

  echo ""
  echo "$label report saved to: $report"
  echo ""
}

start_server() {
  local runtime="$1"
  local port="$2"
  local name="$3"

  echo "Starting $name on port $port..."
  if [[ "$runtime" == "node" ]]; then
    PORT="$port" node "$ROOT_DIR/src/server.js" &
  else
    PORT="$port" bun run "$ROOT_DIR/src/server.js" &
  fi
  SERVER_PID=$!
  PIDS+=($SERVER_PID)
  wait_for_server "http://localhost:$port/price" "$name"
}

stop_latest() {
  local pid="${PIDS[${#PIDS[@]}-1]}"
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  PIDS=("${PIDS[@]:0:${#PIDS[@]}-1}")
}

echo "NapiBench — Node vs Bun API Benchmark"
echo "======================================="
echo "Runtime: $RUNTIME"
echo "Endpoints: ${ENDPOINTS[*]}"
echo ""

start_fake_price

for endpoint in "${ENDPOINTS[@]}"; do
  SLUGS+=("_${endpoint#/}")
done

if [[ "$RUNTIME" == "node" || "$RUNTIME" == "all" ]]; then
  start_server "node" "$NODE_PORT" "Node.js server"
  for endpoint in "${ENDPOINTS[@]}"; do
    run_k6 "node" "$NODE_PORT" "Node.js" "$endpoint"
  done
  stop_latest
fi

if [[ "$RUNTIME" == "bun" || "$RUNTIME" == "all" ]]; then
  start_server "bun" "$BUN_PORT" "Bun server"
  for endpoint in "${ENDPOINTS[@]}"; do
    run_k6 "bun" "$BUN_PORT" "Bun" "$endpoint"
  done
  stop_latest
fi

echo "========================================="
echo "  All benchmarks complete!"
echo "========================================="
echo ""
echo "Reports:"
for slug in "${SLUGS[@]}"; do
  if [[ "$RUNTIME" == "node" || "$RUNTIME" == "all" ]]; then
    echo "  Node: $REPORTS_DIR/node${slug}_report.html"
  fi
  if [[ "$RUNTIME" == "bun" || "$RUNTIME" == "all" ]]; then
    echo "  Bun:  $REPORTS_DIR/bun${slug}_report.html"
  fi
done
echo ""
echo "Resource usage:"
for result in "${RESULTS[@]}"; do
  echo "  $result"
done

if [[ "$RUNTIME" == "all" ]]; then
  echo ""
  echo ">>> Generating combined report..."
  node "$ROOT_DIR/scripts/generate-combined-report.cjs" "$REPORTS_DIR" "${SLUGS[@]}"
fi
