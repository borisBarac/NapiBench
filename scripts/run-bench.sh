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

  if [[ ! -s "$logfile" ]]; then
    RESULTS+=("$label  — no data")
    return
  fi

  local peak_rss avg_cpu max_cpu
  peak_rss=$(awk '{print $1}' "$logfile" | sort -n | tail -1)
  peak_rss=$((peak_rss / 1024))
  avg_cpu=$(awk '{sum+=$2; count++} END {if(count>0) printf "%.1f", sum/count; else print "0"}' "$logfile")
  max_cpu=$(awk '{print $2}' "$logfile" | sort -n | tail -1)
  max_cpu=$(printf "%.1f" "$max_cpu")

  RESULTS+=("$label  — Peak RSS: ${peak_rss} MB | Avg CPU: ${avg_cpu}% | Max CPU: ${max_cpu}%")
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
  bun run "$ROOT_DIR/fake_price.js" &
  PIDS+=($!)
  wait_for_server "http://localhost:$FAKE_PORT/prices" "Fake price server"
}

run_k6() {
  local name="$1"
  local port="$2"
  local label="$3"
  local report="$REPORTS_DIR/${name}_report.html"
  local metrics_log="$REPORTS_DIR/${name}_metrics.log"
  local monitor_pid=""

  echo ""
  echo "========================================="
  echo "  Benchmarking: $label"
  echo "  Target: http://localhost:$port/price"
  echo "========================================="
  echo ""

  monitor_process "$SERVER_PID" "$metrics_log" &
  monitor_pid=$!

  K6_WEB_DASHBOARD=true \
  K6_WEB_DASHBOARD_EXPORT="$report" \
    k6 run "$ROOT_DIR/k6/bench.js" \
      --env BASE_URL="http://localhost:$port" \
      --tag "runtime=$name"

  kill "$monitor_pid" 2>/dev/null || true
  wait "$monitor_pid" 2>/dev/null || true
  compute_stats "$metrics_log" "$label"

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
    PORT="$port" node "$ROOT_DIR/index.js" &
  else
    PORT="$port" bun run "$ROOT_DIR/index.js" &
  fi
  SERVER_PID=$!
  PIDS+=($SERVER_PID)
  wait_for_server "http://localhost:$port/price" "$name"
}

stop_latest() {
  local pid="${PIDS[-1]}"
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  PIDS=("${PIDS[@]:0:${#PIDS[@]}-1}")
}

echo "NapiBench — Node vs Bun API Benchmark"
echo "======================================="
echo "Runtime: $RUNTIME"
echo ""

start_fake_price

if [[ "$RUNTIME" == "node" || "$RUNTIME" == "all" ]]; then
  start_server "node" "$NODE_PORT" "Node.js server"
  run_k6 "node" "$NODE_PORT" "Node.js"
  stop_latest
fi

if [[ "$RUNTIME" == "bun" || "$RUNTIME" == "all" ]]; then
  start_server "bun" "$BUN_PORT" "Bun server"
  run_k6 "bun" "$BUN_PORT" "Bun"
  stop_latest
fi

echo "========================================="
echo "  All benchmarks complete!"
echo "========================================="
echo ""
echo "Reports:"
if [[ "$RUNTIME" == "node" || "$RUNTIME" == "all" ]]; then
  echo "  Node: $REPORTS_DIR/node_report.html"
fi
if [[ "$RUNTIME" == "bun" || "$RUNTIME" == "all" ]]; then
  echo "  Bun:  $REPORTS_DIR/bun_report.html"
fi
echo ""
echo "Resource usage:"
for result in "${RESULTS[@]}"; do
  echo "  $result"
done
