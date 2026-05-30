import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");

const { prices: oneYearPrices } = JSON.parse(
  readFileSync(resolve(ROOT_DIR, "prices.json"), "utf-8")
);

const smaWindows = [25, 50, 100, 200];

const indicatorsCode = readFileSync(
  resolve(ROOT_DIR, "src/indicators.js"),
  "utf-8"
).replace(/export /g, "");

const REPORTS_DIR = resolve(ROOT_DIR, "reports");
mkdirSync(REPORTS_DIR, { recursive: true });

const oneYearFlat = new Float64Array(oneYearPrices.length * 2);
for (let i = 0; i < oneYearPrices.length; i++) {
  oneYearFlat[i * 2] = oneYearPrices[i][0];
  oneYearFlat[i * 2 + 1] = oneYearPrices[i][1];
}

const WASM_DIR = resolve(ROOT_DIR, "pkg");
if (!existsSync(resolve(WASM_DIR, "napibench_native.js"))) {
  console.error("WASM package not found. Run: npm run build:wasm");
  process.exit(1);
}

async function runBrowserBenchmark() {
  console.log(
    `Benchmarking Full Pipeline with ${
      oneYearPrices.length * 1000
    } price points (1000 years)\n`
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.route("**/bench.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
  ${indicatorsCode}

  window.oneYearPrices = ${JSON.stringify(oneYearPrices)};
  window.smaWindows = ${JSON.stringify(smaWindows)};
  window.oneYearFlat = new Float64Array(${JSON.stringify(Array.from(oneYearFlat))});

  const wasmModule = await import('/pkg/napibench_native.js');
  await wasmModule.default();
  window.wasmCalculateAllFromRaw = (flat, years, windows) => {
    return wasmModule.wasm_calculate_all_from_raw(flat, years, windows);
  };

  window.jsPipeline = () => {
    const p = expandPrices(window.oneYearPrices, 1000);
    const ma = calculateMovingAverages(p, window.smaWindows);
    const rsi = calculateRSI(p);
    const macd = calculateMACD(p);
    const bb = calculateBollingerBands(p);
    const summary = calculateSummary(p);
    const signals = calculateSignals(p, ma, rsi, macd, bb);
  };

  window.wasmPipeline = () => {
    window.wasmCalculateAllFromRaw(window.oneYearFlat, 1000, window.smaWindows);
  };

  window.__ready = true;
</script>
</body></html>`,
  }));

  await page.route("**/pkg/**", (route) => {
    const url = new URL(route.request().url());
    const filePath = resolve(ROOT_DIR, url.pathname.slice(1));
    try {
      const body = readFileSync(filePath);
      const ext = filePath.endsWith(".wasm") ? "application/wasm" : "text/javascript";
      route.fulfill({ status: 200, contentType: ext, body });
    } catch {
      route.fulfill({ status: 404, body: "Not found" });
    }
  });

  await page.goto("http://localhost/bench.html");
  await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

  console.log(">>> Running JS benchmark (5s)...");
  const jsResults = await page.evaluate(async () => {
    const start = performance.now();
    let iterations = 0;
    const times = [];
    const deadline = start + 5000;

    while (performance.now() < deadline) {
      const t0 = performance.now();
      window.jsPipeline();
      const t1 = performance.now();
      times.push((t1 - t0) * 1e6);
      iterations++;
    }

    const totalMs = performance.now() - start;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const opsSec = Math.round((iterations / totalMs) * 1000);

    return { opsSec, avg, min, max, iterations, totalMs };
  });
  console.log(`    JS: ${jsResults.opsSec.toLocaleString()} ops/sec (${jsResults.iterations} iterations in ${jsResults.totalMs.toFixed(0)}ms)`);

  console.log(">>> Running WASM benchmark (5s)...");
  const wasmResults = await page.evaluate(async () => {
    const start = performance.now();
    let iterations = 0;
    const times = [];
    const deadline = start + 5000;

    while (performance.now() < deadline) {
      const t0 = performance.now();
      window.wasmPipeline();
      const t1 = performance.now();
      times.push((t1 - t0) * 1e6);
      iterations++;
    }

    const totalMs = performance.now() - start;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const opsSec = Math.round((iterations / totalMs) * 1000);

    return { opsSec, avg, min, max, iterations, totalMs };
  });
  console.log(`    WASM: ${wasmResults.opsSec.toLocaleString()} ops/sec (${wasmResults.iterations} iterations in ${wasmResults.totalMs.toFixed(0)}ms)`);

  await browser.close();

  const allResults = [
    {
      name: "Full Pipeline",
      results: [
        {
          name: "JS - expand + all indicators (JS)",
          opsSec: jsResults.opsSec,
          avg: jsResults.avg,
          min: jsResults.min,
          max: jsResults.max,
        },
        {
          name: "Native (WASM) - calculateAllFromRaw",
          opsSec: wasmResults.opsSec,
          avg: wasmResults.avg,
          min: wasmResults.min,
          max: wasmResults.max,
        },
      ],
    },
  ];

  const jsonResultsPath = resolve(REPORTS_DIR, "browser-bench-results.json");
  writeFileSync(jsonResultsPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults JSON saved: ${jsonResultsPath}`);
}

runBrowserBenchmark().catch((err) => {
  console.error("Browser benchmark failed:", err);
  process.exit(1);
});
