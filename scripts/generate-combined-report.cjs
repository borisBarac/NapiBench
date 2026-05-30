const fs = require('fs');
const path = require('path');

const reportsDir = process.argv[2];
const slugs = process.argv.slice(3);

if (!reportsDir || slugs.length === 0) {
  console.error('Usage: node generate-combined-report.cjs <reportsDir> <slug1> [slug2] ...');
  process.exit(1);
}

function tryReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

const slugLabel = (slug) => {
  const name = slug.replace(/^_/, '');
  if (name === 'price') return 'JS';
  if (name === 'price-rust') return 'Rust';
  return name;
};

const slugPath = (slug) => slug.replace(/^_/, '');

const series = [
  { runtime: 'node', slug: null, color: '#68a063', label: 'Node.js (JS)' },
  { runtime: 'node', slug: null, color: '#3d8c37', label: 'Node.js (Rust)' },
  { runtime: 'bun',  slug: null, color: '#c17a2f', label: 'Bun (JS)' },
  { runtime: 'bun',  slug: null, color: '#d99a4f', label: 'Bun (Rust)' },
];

const slugTypeMap = { 'price': 0, 'price-rust': 1 };

const dataPoints = [];
for (const slug of slugs) {
  const slugName = slug.replace(/^_/, '');
  const nodeIdx = slugName === 'price-rust' ? 1 : 0;
  const bunIdx = slugName === 'price-rust' ? 3 : 2;

  const nodeSummary = tryReadJson(path.join(reportsDir, 'node' + slug + '_summary.json'));
  const bunSummary = tryReadJson(path.join(reportsDir, 'bun' + slug + '_summary.json'));
  const nodeMetrics = tryReadJson(path.join(reportsDir, 'node' + slug + '_metrics.json'));
  const bunMetrics = tryReadJson(path.join(reportsDir, 'bun' + slug + '_metrics.json'));

  if (nodeSummary) dataPoints.push({ seriesIdx: nodeIdx, summary: nodeSummary, metrics: nodeMetrics, slug });
  if (bunSummary)  dataPoints.push({ seriesIdx: bunIdx,  summary: bunSummary,  metrics: bunMetrics,  slug });
}

if (dataPoints.length < 2) {
  console.error('Need at least 2 data points to generate a comparison report. Found: ' + dataPoints.length);
  process.exit(1);
}

function getMetricValues(dataPoints, accessor) {
  return dataPoints
    .map((dp, i) => {
      const val = accessor(dp);
      return val != null ? { idx: i, val } : null;
    })
    .filter(Boolean);
}

function renderMetricSection(title, accessor, unit, lowerIsBetter) {
  const vals = getMetricValues(dataPoints, accessor);
  if (vals.length === 0) return '';

  const maxVal = Math.max(...vals.map(v => v.val));
  const minVal = Math.min(...vals.map(v => v.val));
  const range = maxVal - minVal || maxVal || 1;

  const bars = vals.map(v => {
    const dp = dataPoints[v.idx];
    const s = series[dp.seriesIdx];
    const pct = lowerIsBetter
      ? ((1 - (v.val - minVal) / range) * 100).toFixed(1)
      : ((v.val / maxVal) * 100).toFixed(1);
    const isWinner = lowerIsBetter
      ? v.val <= Math.min(...vals.map(x => x.val))
      : v.val >= Math.max(...vals.map(x => x.val));
    return `
          <div class="bar-row">
            <div class="bar-label">
              <span class="badge" style="background:${s.color}">${s.label}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill${isWinner ? ' winner-bar' : ''}" style="width:${pct}%;background:${s.color}">
                <span class="bar-value">${v.val.toFixed(2)} ${unit}</span>
              </div>
            </div>
          </div>`;
  }).join('\n');

  const best = lowerIsBetter
    ? vals.reduce((a, b) => a.val <= b.val ? a : b)
    : vals.reduce((a, b) => a.val >= b.val ? a : b);
  const worst = lowerIsBetter
    ? vals.reduce((a, b) => a.val >= b.val ? a : b)
    : vals.reduce((a, b) => a.val <= b.val ? a : b);
  const bestSeries = series[dataPoints[best.idx].seriesIdx];
  const worstSeries = series[dataPoints[worst.idx].seriesIdx];
  const ratio = worst.val > 0 ? (worst.val / best.val).toFixed(2) : 'N/A';
  const comparison = lowerIsBetter
    ? `${bestSeries.label} is <strong>${ratio}x</strong> faster`
    : `${bestSeries.label} handles <strong>${ratio}x</strong> more requests`;

  return `
        <div class="suite">
          <h2>${title}</h2>
${bars}
          <p class="winner">${comparison}</p>
        </div>`;
}

const hasP99 = dataPoints.every(dp => dp.summary.latency_ms.p99 != null);

const activeSeries = [...new Set(dataPoints.map(dp => dp.seriesIdx))].sort().map(i => series[i]);

const legendItems = activeSeries.map(s =>
  `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span> ${s.label}</div>`
).join('\n    ');

const endpointInfo = [...new Set(dataPoints.map(dp => slugPath(dp.slug)))].join(', ');

const latencySection = renderMetricSection('Average Latency', dp => dp.summary.latency_ms.avg, 'ms', true);
const p95Section = renderMetricSection('P95 Latency', dp => dp.summary.latency_ms.p95, 'ms', true);
const p99Section = hasP99 ? renderMetricSection('P99 Latency', dp => dp.summary.latency_ms.p99, 'ms', true) : '';
const rpsSection = renderMetricSection('Requests/sec', dp => dp.summary.throughput.rps, 'req/s', false);
const errorSection = renderMetricSection('Error Rate', dp => dp.summary.errors.fail_rate * 100, '%', true);
const rssSection = renderMetricSection('Peak RSS', dp => dp.metrics?.peak_rss_mb, 'MB', true);
const cpuSection = renderMetricSection('Avg CPU', dp => dp.metrics?.avg_cpu_pct, '%', true);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NapiBench — K6 HTTP Benchmark</title>
<style>
  :root { --bg: #f8fafc; --card: #fff; --text: #1e293b; --muted: #64748b; --border: #e2e8f0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --muted: #94a3b8; --border: #334155; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; padding: 2rem; }
  h1 { text-align: center; margin-bottom: 0.5rem; }
  .subtitle { text-align: center; color: var(--muted); margin-bottom: 0.5rem; }
  .config { text-align: center; color: var(--muted); margin-bottom: 2rem; font-size: 0.85rem; }
  .legend { display: flex; gap: 1.5rem; justify-content: center; margin-bottom: 2rem; flex-wrap: wrap; }
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
  <p class="subtitle">API Performance Comparison</p>
  <p class="config">Endpoints: ${endpointInfo}</p>
  <div class="legend">
    ${legendItems}
  </div>
  <div class="section-title">Latency</div>
  <div class="metrics-grid">
    ${latencySection}
    ${p95Section}
    ${p99Section}
  </div>
  <div class="section-title">Throughput &amp; Errors</div>
  <div class="metrics-grid">
    ${rpsSection}
    ${errorSection}
  </div>
  <div class="section-title">Server Resources</div>
  <div class="metrics-grid">
    ${rssSection}
    ${cpuSection}
  </div>
  <p class="footer">Generated with <a href="https://k6.io">k6</a></p>
</body>
</html>`;

const outPath = path.join(reportsDir, 'combined_benchmark-k6.html');
fs.writeFileSync(outPath, html);
console.log('Combined report: ' + outPath);
