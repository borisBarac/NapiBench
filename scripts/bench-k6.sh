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

BENCH_SIZE="${SIZE:-s}"
BENCH_ENDPOINT="${ENDPOINT:-/price}"

endpoint_suffix=""
if [[ "$BENCH_ENDPOINT" != "/price" ]]; then
  endpoint_suffix="_${BENCH_ENDPOINT#/price-}"
fi
BENCH_SLUG="_${BENCH_SIZE}${endpoint_suffix}"

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

  if [[ ! -f "$htmlfile" || ! -f "$jsonfile" ]]; then
    return
  fi

  local peak_rss avg_cpu max_cpu
  peak_rss=$(awk -F'"peak_rss_mb":' '{split($2,a,","); print a[1]}' "$jsonfile")
  avg_cpu=$(awk -F'"avg_cpu_pct":' '{split($2,a,","); print a[1]}' "$jsonfile")
  max_cpu=$(awk -F'"max_cpu_pct":' '{split($2,a,"}"); print a[1]}' "$jsonfile")

  local metrics_block
  metrics_block=$(cat <<METRICS_HEREDOC
<div style="position:fixed;bottom:0;left:0;right:0;background:#1a1a2e;color:#e0e0e0;padding:16px 24px;font-family:system-ui,-apple-system,sans-serif;border-top:2px solid #6c63ff;display:flex;gap:32px;align-items:center;z-index:9999">
  <span style="font-size:14px;font-weight:700;color:#6c63ff;text-transform:uppercase;letter-spacing:1px">Server Resources</span>
  <span style="font-size:14px">Peak RSS: <strong>${peak_rss} MB</strong></span>
  <span style="font-size:14px">Avg CPU: <strong>${avg_cpu}%</strong></span>
  <span style="font-size:14px">Max CPU: <strong>${max_cpu}%</strong></span>
</div>
<div style="height:60px"></div>
METRICS_HEREDOC
)

  local tmp
  tmp=$(mktemp)
  awk -v block="$metrics_block" '
    /<\/body>/ { print block; print; next }
    { print }
  ' "$htmlfile" > "$tmp" && mv "$tmp" "$htmlfile"
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
  local report="$REPORTS_DIR/${name}${BENCH_SLUG}_report.html"
  local summary_json="$REPORTS_DIR/${name}${BENCH_SLUG}_summary.json"
  local metrics_log="$REPORTS_DIR/${name}${BENCH_SLUG}_metrics.log"
  local metrics_json="$REPORTS_DIR/${name}${BENCH_SLUG}_metrics.json"
  local monitor_pid=""

  echo ""
  echo "========================================="
  echo "  Benchmarking: $label"
  echo "  Size: $BENCH_SIZE | Endpoint: $BENCH_ENDPOINT"
  echo "  Target: http://localhost:$port${BENCH_ENDPOINT}"
  echo "========================================="
  echo ""

  monitor_process "$SERVER_PID" "$metrics_log" &
  monitor_pid=$!

  K6_WEB_DASHBOARD=true \
  K6_WEB_DASHBOARD_EXPORT="$report" \
    k6 run "$ROOT_DIR/bench/bench-k6.js" \
      --env BASE_URL="http://localhost:$port" \
      --env SIZE="$BENCH_SIZE" \
      --env ENDPOINT="$BENCH_ENDPOINT" \
      --env SUMMARY_EXPORT="$summary_json" \
      --tag "runtime=$name"

  kill "$monitor_pid" 2>/dev/null || true
  wait "$monitor_pid" 2>/dev/null || true
  compute_stats "$metrics_log" "$label" "$metrics_json"
  inject_metrics_to_html "$report" "$metrics_json"

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
  echo "  Node: $REPORTS_DIR/node${BENCH_SLUG}_report.html"
fi
if [[ "$RUNTIME" == "bun" || "$RUNTIME" == "all" ]]; then
  echo "  Bun:  $REPORTS_DIR/bun${BENCH_SLUG}_report.html"
fi
echo ""
echo "Resource usage:"
for result in "${RESULTS[@]}"; do
  echo "  $result"
done

if [[ "$RUNTIME" == "all" ]]; then
  echo ""
  echo "Combined report:"
  echo "  $REPORTS_DIR/combined_benchmark-k6${BENCH_SLUG}.html"
  echo ""
  echo ""
  echo ">>> Generating combined report..."
  node -e "
    const fs = require('fs');
    const path = require('path');

    const reportsDir = '$REPORTS_DIR';
    const benchSlug = '$BENCH_SLUG';

    const nodeSummary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'node' + benchSlug + '_summary.json'), 'utf-8'));
    const bunSummary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'bun' + benchSlug + '_summary.json'), 'utf-8'));
    const nodeMetrics = JSON.parse(fs.readFileSync(path.join(reportsDir, 'node' + benchSlug + '_metrics.json'), 'utf-8'));
    const bunMetrics = JSON.parse(fs.readFileSync(path.join(reportsDir, 'bun' + benchSlug + '_metrics.json'), 'utf-8'));

    const nodeColor = '#68a063';
    const bunColor = '#c17a2f';
    const nodeLabel = 'Node.js';
    const bunLabel = 'Bun';

    const endpoint = nodeSummary.test_config.endpoint;
    const size = nodeSummary.test_config.size;
    const targetRate = nodeSummary.test_config.target_rate;
    const duration = nodeSummary.test_config.duration;

    function formatMs(ms) {
      if (ms < 1) return ms.toFixed(3) + ' ms';
      if (ms < 1000) return ms.toFixed(2) + ' ms';
      return (ms / 1000).toFixed(2) + ' s';
    }

    function renderMetricSection(title, nodeVal, bunVal, unit, lowerIsBetter) {
      const maxVal = Math.max(nodeVal, bunVal);
      const minVal = Math.min(Math.min(nodeVal, bunVal), maxVal * 0.01);
      const range = maxVal - minVal || maxVal || 1;
      const nodePct = lowerIsBetter
        ? ((1 - (nodeVal - minVal) / range) * 100).toFixed(1)
        : ((nodeVal / maxVal) * 100).toFixed(1);
      const bunPct = lowerIsBetter
        ? ((1 - (bunVal - minVal) / range) * 100).toFixed(1)
        : ((bunVal / maxVal) * 100).toFixed(1);

      const nodeWins = lowerIsBetter ? nodeVal <= bunVal : nodeVal >= bunVal;
      const bunWins = lowerIsBetter ? bunVal <= nodeVal : bunVal >= nodeVal;
      const winner = nodeWins ? nodeLabel : bunLabel;
      const winnerVal = nodeWins ? nodeVal : bunVal;
      const loserVal = nodeWins ? bunVal : nodeVal;
      const ratio = loserVal > 0 ? (loserVal / winnerVal).toFixed(2) : 'N/A';
      const comparison = lowerIsBetter
        ? winner + ' is <strong>' + ratio + 'x</strong> faster'
        : winner + ' handles <strong>' + ratio + 'x</strong> more requests';

      return \`
        <div class=\"suite\">
          <h2>\${title}</h2>
          <div class=\"bar-row\">
            <div class=\"bar-label\">
              <span class=\"badge\" style=\"background:\${nodeColor}\">\${nodeLabel}</span>
            </div>
            <div class=\"bar-track\">
              <div class=\"bar-fill\${nodeWins ? ' winner-bar' : ''}\" style=\"width:\${nodePct}%;background:\${nodeColor}\">
                <span class=\"bar-value\">\${nodeVal.toFixed(2)} \${unit}</span>
              </div>
            </div>
          </div>
          <div class=\"bar-row\">
            <div class=\"bar-label\">
              <span class=\"badge\" style=\"background:\${bunColor}\">\${bunLabel}</span>
            </div>
            <div class=\"bar-track\">
              <div class=\"bar-fill\${bunWins ? ' winner-bar' : ''}\" style=\"width:\${bunPct}%;background:\${bunColor}\">
                <span class=\"bar-value\">\${bunVal.toFixed(2)} \${unit}</span>
              </div>
            </div>
          </div>
          <p class=\"winner\">\${comparison}</p>
        </div>\`;
    }

    function renderResourceSection(title, nodeVal, bunVal, unit) {
      return renderMetricSection(title, nodeVal, bunVal, unit, true);
    }

    const latencySection = renderMetricSection('Average Latency', nodeSummary.latency_ms.avg, bunSummary.latency_ms.avg, 'ms', true);
    const p95Section = renderMetricSection('P95 Latency', nodeSummary.latency_ms.p95, bunSummary.latency_ms.p95, 'ms', true);
    const p99Section = renderMetricSection('P99 Latency', nodeSummary.latency_ms.p99, bunSummary.latency_ms.p99, 'ms', true);
    const rpsSection = renderMetricSection('Requests/sec', nodeSummary.throughput.rps, bunSummary.throughput.rps, 'req/s', false);
    const errorSection = renderMetricSection('Error Rate', nodeSummary.errors.fail_rate * 100, bunSummary.errors.fail_rate * 100, '%', true);
    const rssSection = renderResourceSection('Peak RSS', nodeMetrics.peak_rss_mb, bunMetrics.peak_rss_mb, 'MB');
    const cpuSection = renderResourceSection('Avg CPU', nodeMetrics.avg_cpu_pct, bunMetrics.avg_cpu_pct, '%');

    const html = \`<!DOCTYPE html>
<html lang=\"en\">
<head>
<meta charset=\"UTF-8\">
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
<title>NapiBench — K6 HTTP Benchmark</title>
<style>
  :root { --bg: #f8fafc; --card: #fff; --text: #1e293b; --muted: #64748b; --border: #e2e8f0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --muted: #94a3b8; --border: #334155; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; padding: 2rem; }
  h1 { text-align: center; margin-bottom: 0.5rem; }
  .subtitle { text-align: center; color: var(--muted); margin-bottom: 0.5rem; }
  .config { text-align: center; color: var(--muted); margin-bottom: 2rem; font-size: 0.85rem; }
  .legend { display: flex; gap: 1.5rem; justify-content: center; margin-bottom: 2rem; }
  .legend-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; }
  .legend-dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
  .section-title { text-align: center; font-size: 1.2rem; margin: 2rem 0 1rem; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; font-size: 0.85rem; }
  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.5rem; max-width: 1200px; margin: 0 auto 1.5rem; }
  .suite { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; }
  .suite h2 { margin-bottom: 1rem; font-size: 1.1rem; }
  .bar-row { margin-bottom: 0.75rem; }
  .bar-label { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
  .badge { color: #fff; font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
  .bar-track { background: var(--border); border-radius: 6px; height: 32px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 6px; display: flex; align-items: center; padding-left: 10px; min-width: 0; transition: width 0.6s ease; }
  .bar-fill.winner-bar { box-shadow: 0 0 0 2px rgba(255,255,255,0.3); }
  .bar-value { color: #fff; font-size: 0.85rem; font-weight: 600; white-space: nowrap; }
  .winner { margin-top: 0.75rem; font-size: 0.9rem; color: var(--muted); }
  .winner strong { color: var(--text); }
  .footer { text-align: center; margin-top: 2rem; font-size: 0.8rem; color: var(--muted); }
  .footer a { color: var(--muted); }
</style>
</head>
<body>
  <h1>NapiBench — K6 HTTP Benchmark</h1>
  <p class=\"subtitle\">\${nodeLabel} vs \${bunLabel} — API Performance Comparison</p>
  <p class=\"config\">Endpoint: \${endpoint} | Size: \${size} | Target: \${targetRate} req/s | Duration: \${duration}</p>
  <div class=\"legend\">
    <div class=\"legend-item\"><span class=\"legend-dot\" style=\"background:\${nodeColor}\"></span> \${nodeLabel}</div>
    <div class=\"legend-item\"><span class=\"legend-dot\" style=\"background:\${bunColor}\"></span> \${bunLabel}</div>
  </div>
  <div class=\"section-title\">Latency</div>
  <div class=\"metrics-grid\">
    \${latencySection}
    \${p95Section}
    \${p99Section}
  </div>
  <div class=\"section-title\">Throughput &amp; Errors</div>
  <div class=\"metrics-grid\">
    \${rpsSection}
    \${errorSection}
  </div>
  <div class=\"section-title\">Server Resources</div>
  <div class=\"metrics-grid\">
    \${rssSection}
    \${cpuSection}
  </div>
  <p class=\"footer\">Generated with <a href=\"https://k6.io\">k6</a></p>
</body>
</html>\`;

    const outPath = path.join(reportsDir, 'combined_benchmark-k6' + benchSlug + '.html');
    fs.writeFileSync(outPath, html);
    console.log('Combined report: ' + outPath);
  "
fi
