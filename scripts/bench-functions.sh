#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPORTS_DIR="$ROOT_DIR/reports"

mkdir -p "$REPORTS_DIR"

echo "========================================="
echo "  NapiBench — Function Benchmark Runner"
echo "========================================="
echo ""

echo ">>> Running with Node.js..."
echo ""
node --expose-gc --allow-natives-syntax "$ROOT_DIR/bench/benchmark-functions.js"
echo ""

echo ">>> Running with Bun..."
echo ""
bun run "$ROOT_DIR/bench/benchmark-functions.js"
echo ""

echo ">>> Generating combined report..."
node -e "
const fs = require('fs');
const path = require('path');

const reportsDir = '$REPORTS_DIR';

function findJson(name) {
  const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('-bench-results.json'));
  return files.find(f => f.startsWith(name));
}

const nodeFile = findJson('node');
const bunFile = findJson('bun');

if (!nodeFile || !bunFile) {
  console.error('Missing results files');
  process.exit(1);
}

const nodeResults = JSON.parse(fs.readFileSync(path.join(reportsDir, nodeFile), 'utf-8'));
const bunResults = JSON.parse(fs.readFileSync(path.join(reportsDir, bunFile), 'utf-8'));

function formatNs(ns) {
  if (ns < 1_000) return ns.toFixed(2) + ' ns';
  if (ns < 1_000_000) return (ns / 1_000).toFixed(2) + ' µs';
  if (ns < 1_000_000_000) return (ns / 1_000_000).toFixed(2) + ' ms';
  return (ns / 1_000_000_000).toFixed(2) + ' s';
}

function renderRuntimeSection(title, runtimeResults, accentColor) {
  const suites = runtimeResults.map(({ name, results }) => {
    const maxOps = Math.max(...results.map(r => r.opsSec));
    const bars = results.map(r => {
      const pct = ((r.opsSec / maxOps) * 100).toFixed(1);
      const isNative = r.name.startsWith('Native');
      const color = isNative ? '#f97316' : '#3b82f6';
      const label = isNative ? 'Native (Rust/N-API)' : 'JavaScript';
      return \`
        <div class=\"bar-row\">
          <div class=\"bar-label\">
            <span class=\"badge\" style=\"background:\${color}\">\${label}</span>
            <span class=\"bar-name\">\${r.name}</span>
          </div>
          <div class=\"bar-track\">
            <div class=\"bar-fill\" style=\"width:\${pct}%;background:\${color}\">
              <span class=\"bar-value\">\${r.opsSec.toLocaleString()} ops/sec</span>
            </div>
          </div>
          <div class=\"bar-details\">avg: \${formatNs(r.avg)}, min: \${formatNs(r.min)}, max: \${formatNs(r.max)}</div>
        </div>\`;
    }).join('');

    const winner = results.reduce((a, b) => a.opsSec > b.opsSec ? a : b);
    const loser = results.find(r => r !== winner);
    const speedup = (winner.opsSec / loser.opsSec).toFixed(2);
    const winnerLabel = winner.name.startsWith('Native') ? 'Native' : 'JS';

    return \`
      <div class=\"suite\">
        <h2>\${name}</h2>
        \${bars}
        <p class=\"winner\">\${winnerLabel} is <strong>\${speedup}x</strong> faster</p>
      </div>\`;
  }).join('');

  return \`
    <div class=\"runtime-section\">
      <div class=\"runtime-header\">
        <span class=\"runtime-dot\" style=\"background:\${accentColor}\"></span>
        <h2>\${title}</h2>
      </div>
      \${suites}
    </div>\`;
}

const nodeSection = renderRuntimeSection('Node.js', nodeResults, '#68a063');
const bunSection = renderRuntimeSection('Bun', bunResults, '#fbf0df');

const html = \`<!DOCTYPE html>
<html lang=\"en\">
<head>
<meta charset=\"UTF-8\">
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
<title>NapiBench — Combined Report</title>
<style>
  :root { --bg: #f8fafc; --card: #fff; --text: #1e293b; --muted: #64748b; --border: #e2e8f0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --muted: #94a3b8; --border: #334155; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; padding: 2rem; }
  h1 { text-align: center; margin-bottom: 0.5rem; }
  .subtitle { text-align: center; color: var(--muted); margin-bottom: 2rem; }
  .legend { display: flex; gap: 1.5rem; justify-content: center; margin-bottom: 2rem; }
  .legend-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; }
  .legend-dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
  .runtime-section { margin-bottom: 3rem; }
  .runtime-header { display: flex; align-items: center; gap: 0.75rem; justify-content: center; margin-bottom: 1rem; }
  .runtime-header h2 { font-size: 1.3rem; margin: 0; }
  .runtime-header .runtime-dot { width: 16px; height: 16px; border-radius: 50%; }
  .suite { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; max-width: 800px; margin-left: auto; margin-right: auto; }
  .suite h2 { margin-bottom: 1rem; font-size: 1.1rem; }
  .bar-row { margin-bottom: 0.75rem; }
  .bar-label { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
  .badge { color: #fff; font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
  .bar-name { font-size: 0.85rem; color: var(--muted); }
  .bar-track { background: var(--border); border-radius: 6px; height: 32px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 6px; display: flex; align-items: center; padding-left: 10px; min-width: 0; transition: width 0.6s ease; }
  .bar-value { color: #fff; font-size: 0.85rem; font-weight: 600; white-space: nowrap; }
  .bar-details { font-size: 0.75rem; color: var(--muted); margin-top: 2px; }
  .winner { margin-top: 0.75rem; font-size: 0.9rem; color: var(--muted); }
  .winner strong { color: var(--text); }
  .footer { text-align: center; margin-top: 2rem; font-size: 0.8rem; color: var(--muted); }
  .footer a { color: var(--muted); }
</style>
</head>
<body>
  <h1>NapiBench — Combined Report</h1>
  <p class=\"subtitle\">Node.js vs Bun — JavaScript vs Native (Rust/N-API) Performance Comparison</p>
  <div class=\"legend\">
    <div class=\"legend-item\"><span class=\"legend-dot\" style=\"background:#3b82f6\"></span> JavaScript</div>
    <div class=\"legend-item\"><span class=\"legend-dot\" style=\"background:#f97316\"></span> Native (Rust/N-API)</div>
  </div>
  \${nodeSection}
  \${bunSection}
  <p class=\"footer\">Generated with <a href=\"https://github.com/evanwashere/mitata\">mitata</a></p>
</body>
</html>\`;

fs.writeFileSync(path.join(reportsDir, 'combined_benchmark-functions.html'), html);
console.log('Combined report: ' + path.join(reportsDir, 'combined_benchmark-functions.html'));
"

echo ""
echo "========================================="
echo "  All benchmarks complete!"
echo "========================================="
echo ""
echo "Report:"
echo "  $REPORTS_DIR/combined_benchmark-functions.html"
