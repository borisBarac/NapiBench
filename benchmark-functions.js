import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { run, bench, group } from "mitata";

const require = createRequire(import.meta.url);
const native = require("./napibench-native.node");

function detectRuntime() {
  if (typeof Bun !== "undefined") return "Bun";
  if (typeof process !== "undefined" && process.versions?.node) return "Node.js";
  if (typeof window !== "undefined") return "Browser";
  return "Unknown";
}

const runtime = detectRuntime();

function expandPrices(oneYearPrices, years = 10) {
  const yearMs = 365 * 24 * 3600 * 1000;
  const prices = [];
  for (let y = years - 1; y >= 0; y--) {
    for (const [ts, p] of oneYearPrices) {
      prices.push([ts - y * yearMs, p]);
    }
  }
  return prices;
}

function flattenOneYear(oneYearPrices) {
  const n = oneYearPrices.length;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = oneYearPrices[i][0];
    out[i * 2 + 1] = oneYearPrices[i][1];
  }
  return out;
}

function formatNs(ns) {
  if (ns < 1_000) return `${ns.toFixed(2)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

function generateHtmlReport(allResults, runtime) {
  const suites = allResults.map(({ name, results }) => {
    const maxOps = Math.max(...results.map((r) => r.opsSec));
    const bars = results
      .map((r) => {
        const pct = ((r.opsSec / maxOps) * 100).toFixed(1);
        const isNative = r.name.startsWith("Native");
        const color = isNative ? "#f97316" : "#3b82f6";
        const label = isNative ? "Native (Rust/N-API)" : "JavaScript";
        return `
        <div class="bar-row">
          <div class="bar-label">
            <span class="badge" style="background:${color}">${label}</span>
            <span class="bar-name">${r.name}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${pct}%;background:${color}">
              <span class="bar-value">${r.opsSec.toLocaleString()} ops/sec</span>
            </div>
          </div>
          <div class="bar-details">avg: ${formatNs(r.avg)}, min: ${formatNs(r.min)}, max: ${formatNs(r.max)}</div>
        </div>`;
      })
      .join("");

    const winner = results.reduce((a, b) => (a.opsSec > b.opsSec ? a : b));
    const loser = results.find((r) => r !== winner);
    const speedup = (winner.opsSec / loser.opsSec).toFixed(2);
    const winnerLabel = winner.name.startsWith("Native") ? "Native" : "JS";

    return `
    <div class="suite">
      <h2>${name}</h2>
      ${bars}
      <p class="winner">${winnerLabel} is <strong>${speedup}x</strong> faster</p>
    </div>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NapiBench - ${runtime} - JS vs Native</title>
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
  <h1>NapiBench - ${runtime}</h1>
  <p class="subtitle">JavaScript vs Native (Rust/N-API) Performance Comparison</p>
  <div class="legend">
    <div class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span> JavaScript</div>
    <div class="legend-item"><span class="legend-dot" style="background:#f97316"></span> Native (Rust/N-API)</div>
  </div>
  ${suites}
  <p class="footer">Generated with <a href="https://github.com/evanwashere/mitata">mitata</a></p>
</body>
</html>`;

  mkdirSync("reports", { recursive: true });
  writeFileSync(`reports/${runtime.toLowerCase().replace(/ /g, "-")}_benchmark-functions.html`, html);
  console.log(`\nHTML report generated: reports/${runtime.toLowerCase().replace(/ /g, "-")}_benchmark-functions.html`);
}

const { prices: oneYearPrices } = JSON.parse(
  readFileSync(new URL("./prices.json", import.meta.url), "utf-8")
);

const smaWindows = [25, 50, 100, 200];
const oneYearFlat = flattenOneYear(oneYearPrices);

console.log(`Benchmarking Full Pipeline with ${oneYearPrices.length * 10} price points (10 years)\n`);

group("Full Pipeline", () => {
  bench("JS - expand + flatten + calculateAll", () => {
    const p = expandPrices(oneYearPrices, 10);
    const f = new Float64Array(p.length * 2);
    for (let i = 0; i < p.length; i++) {
      f[i * 2] = p[i][0];
      f[i * 2 + 1] = p[i][1];
    }
    native.calculateAll(f, smaWindows);
  });
  bench("Native - calculateAllFromRaw", () => {
    native.calculateAllFromRaw(oneYearFlat, 10, smaWindows);
  });
});

const results = await run({ format: "json" });

const groupsByName = {};
for (const b of results.benchmarks) {
  const groupName = results.layout[b.group]?.name || "Other";
  if (!groupsByName[groupName]) groupsByName[groupName] = [];
  const stats = b.runs[0].stats;
  groupsByName[groupName].push({
    name: b.alias,
    opsSec: Math.round(1e9 / stats.avg),
    avg: stats.avg,
    min: stats.min,
    max: stats.max,
  });
}

const allResults = Object.entries(groupsByName).map(([name, results]) => ({
  name,
  results,
}));

generateHtmlReport(allResults, runtime);
