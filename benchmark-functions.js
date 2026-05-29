import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  calculateMovingAverages,
  calculateRSI,
  calculateMACD,
} from "./indicators.js";

const require = createRequire(import.meta.url);
const { Suite, jsonReport } = require("bench-node");
const native = require("./napibench-native.node");

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

function generateHtmlReport(allResults) {
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
          <div class="bar-details">min: ${r.min}, max: ${r.max}</div>
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
<title>NapiBench - JS vs Native</title>
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
  <h1>NapiBench</h1>
  <p class="subtitle">JavaScript vs Native (Rust/N-API) Performance Comparison</p>
  <div class="legend">
    <div class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span> JavaScript</div>
    <div class="legend-item"><span class="legend-dot" style="background:#f97316"></span> Native (Rust/N-API)</div>
  </div>
  ${suites}
  <p class="footer">Generated with <a href="https://github.com/RafaelGSS/bench-node">bench-node</a></p>
</body>
</html>`;

  writeFileSync("reports/benchmark-functions.html", html);
  console.log("\nHTML report generated: reports/benchmark-functions.html");
}

function collectResults(suiteName) {
  let collected = [];
  const reporter = (results) => {
    collected = results;
    jsonReport(results);
  };
  return { reporter, getResults: () => ({ name: suiteName, results: collected }) };
}

const { prices: oneYearPrices } = JSON.parse(
  readFileSync(new URL("./prices.json", import.meta.url), "utf-8")
);

const prices = expandPrices(oneYearPrices, 10);
const smaWindows = [25, 50, 100, 200];

const flatPrices = new Float64Array(prices.length * 2);
for (let i = 0; i < prices.length; i++) {
  flatPrices[i * 2] = prices[i][0];
  flatPrices[i * 2 + 1] = prices[i][1];
}

console.log(`Benchmarking with ${prices.length} price points (10 years)\n`);

const collectors = [];

const c1 = collectResults("Moving Averages");
collectors.push(c1);
await new Suite({ reporter: c1.reporter })
  .add("JS - calculateMovingAverages", () => {
    calculateMovingAverages(prices, smaWindows);
  })
  .add("Native - calculateMovingAveragesJson", () => {
    native.calculateMovingAveragesJson(flatPrices, smaWindows);
  })
  .run();

const c2 = collectResults("RSI");
collectors.push(c2);
await new Suite({ reporter: c2.reporter })
  .add("JS - calculateRSI", () => {
    calculateRSI(prices, 14);
  })
  .add("Native - calculateRsiJson", () => {
    native.calculateRsiJson(flatPrices, 14);
  })
  .run();

const c3 = collectResults("MACD");
collectors.push(c3);
await new Suite({ reporter: c3.reporter })
  .add("JS - calculateMACD", () => {
    calculateMACD(prices, 12, 26, 9);
  })
  .add("Native - calculateMacdJson", () => {
    native.calculateMacdJson(flatPrices, 12, 26, 9);
  })
  .run();

generateHtmlReport(collectors.map((c) => c.getResults()));
