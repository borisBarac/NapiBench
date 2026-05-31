# NapiBench — Node vs Bun vs Rust API Benchmark

A performance benchmark comparing a BTC price analysis API running under **Node.js** and **Bun**, with both JS and Rust (N-API native / WASM) computation paths. The API computes technical indicators (SMA, RSI, MACD, Bollinger Bands), price summaries, and trading signals. HTTP endpoints are load-tested with [k6](https://k6.io); raw computation is benchmarked with [mitata](https://github.com/evanwashere/mitata) across Node.js, Bun, and headless Chromium (Playwright).

## Results

Full reports are available in the `reports/` directory, including interactive HTML dashboards and JSON metrics.

### HTTP Benchmarks (k6) — 500 req/s, 1 min

| Runtime | Endpoint | Avg Latency | p95 Latency | Throughput | Error Rate | Peak RSS |
|---------|----------|------------|------------|------------|------------|----------|
| Node.js | `/price` (JS) | 3,318 ms | 8,437 ms | 62.4 rps | 15.5% | 292 MB |
| Node.js | `/price-rust` (N-API) | 660 ms | 2,061 ms | 35.6 rps | 0% | 283 MB |
| Bun | `/price` (JS) | 1,845 ms | 5,146 ms | 33.4 rps | 0% | 470 MB |
| Bun | `/price-rust` (N-API) | 642 ms | 2,412 ms | 32.1 rps | 0% | 259 MB |

### Function Benchmarks (mitata) — 366K data points (1,000 years)

| Variant | Runtime | ops/sec | Avg (ms) | Speedup vs JS |
|---------|---------|--------:|---------:|:---:|
| JS | Node.js | 20 | 49.11 | 1x |
| Native (N-API) | Node.js | 63 | 15.95 | **3.1x** |
| JS | Bun | 28 | 36.10 | 1x |
| Native (N-API) | Bun | 69 | 14.51 | **2.5x** |
| JS | Browser (Chromium) | 26 | 38.04 | 1x |
| Native (WASM) | Browser (Chromium) | 56 | 17.71 | **2.2x** |

### Key Takeaways

- **Rust (N-API) is ~2.5–3x faster** than JS for raw computation across all runtimes
- **Bun is fastest** for both JS (28 vs 20 ops/sec) and Native (69 vs 63 ops/sec) vs Node.js
- **WASM in the browser** achieves ~2.2x speedup and is competitive with native N-API
- **Sync vs Async N-API** performance is virtually identical
- Under HTTP load, Rust endpoints have **~5x lower avg latency** and **zero errors** vs the JS endpoint on Node.js

## Prerequisites

- **macOS** (setup script uses Homebrew)
- [Bun](https://bun.com) runtime
- [Node.js](https://nodejs.org)
- [Rust](https://rustup.rs) toolchain (for building the native addon)
- [k6](https://k6.io) (install via `./scripts/setup.sh`)
- [wasm-pack](https://github.com/nicknisi/wasm-pack) (optional, for browser benchmarks)

## Setup

```bash
bun install
npm run build:native
./scripts/setup.sh   # installs k6 + Playwright Chromium
```

For browser benchmarks, also build the WASM package:

```bash
npm run build:wasm
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run tests with vitest |
| `npm run build:native` | Build Rust N-API native addon (`napibench-native.node`) |
| `npm run build:wasm` | Build WASM package to `pkg/` (requires wasm-pack) |

## Running the Benchmark

### HTTP Benchmarks (k6)

```bash
# Benchmark both runtimes, both endpoints (default)
./scripts/bench-k6.sh all

# Benchmark Node.js only
./scripts/bench-k6.sh node

# Benchmark Bun only
./scripts/bench-k6.sh bun
```

The k6 load test uses a constant-arrival-rate of 500 req/s for 1 minute (50 pre-allocated VUs, max 300 VUs), with thresholds of <1% error rate and p95 latency < 500ms.

### Endpoint Selection

By default, both endpoints are benchmarked:

| Endpoint | Description |
|----------|-------------|
| `/price` | JS computation: expands 1 year of BTC prices to 10 years, then calculates moving averages (SMA 25/50/100/200), RSI (14), MACD (12/26/9), Bollinger Bands (20), price summary (24h/7d/30d change, ATH/ATL, volatility), and trading signals (composite score, buy/sell/hold) |
| `/price-rust` | Rust native computation via `calculateAllFromRawAsync` — same indicators, summary, and signals computed in Rust via N-API |

Override with the `ENDPOINTS` env var:

```bash
# Only JS endpoint
ENDPOINTS="/price" ./scripts/bench-k6.sh all

# Only Rust endpoint
ENDPOINTS="/price-rust" ./scripts/bench-k6.sh all

# Both (default)
ENDPOINTS="/price /price-rust" ./scripts/bench-k6.sh all
```

### Function Benchmarks (mitata)

Benchmark raw computation performance (JS vs Rust native vs WASM) across Node.js, Bun, and browser:

```bash
./scripts/bench-functions.sh
```

This script runs three stages:

1. **Node.js** — JS pipeline (expand + all indicators) vs `calculateAllFromRaw` (sync) vs `calculateAllFromRawAsync`
2. **Bun** — Same three benchmarks
3. **Browser (Chromium)** — JS pipeline vs WASM (`wasm_calculate_all_from_raw`), via Playwright

All benchmarks expand 1 year of price data to **1000 years** (~3.65M data points).

## Reports

HTML reports and JSON metrics are saved to the `reports/` directory.

### k6 HTTP Reports

Each runtime/endpoint combination generates:

```
reports/{runtime}_{endpoint}_report.html      # Interactive k6 dashboard
reports/{runtime}_{endpoint}_summary.json      # Latency, throughput, errors
reports/{runtime}_{endpoint}_metrics.json      # Peak RSS, CPU usage
reports/{runtime}_{endpoint}_metrics.log       # Raw sampling data
```

When running with `all` (both runtimes), a combined comparison report is generated:

```
reports/combined_benchmark-k6.html
```

This shows side-by-side bar charts for all combinations (e.g. Node.js/JS, Node.js/Rust, Bun/JS, Bun/Rust) across latency, throughput, error rate, and resource usage metrics.

### Function Benchmark Reports

Each runtime generates a JSON results file:

```
reports/node-bench-results.json
reports/bun-bench-results.json
reports/browser-bench-results.json
```

A combined HTML report is also generated:

```
reports/combined_benchmark-functions.html
```

### What's Included

- **k6 HTML report** — Interactive dashboard with latency, throughput, and error rate charts. A fixed resource usage bar at the bottom shows Peak RSS, Avg CPU, and Max CPU.
- **k6 JSON summary** — Machine-readable latency (avg, p95, p99, min, max, med), throughput (rps, total requests), and error rate.
- **k6 JSON metrics** — `peak_rss_mb`, `avg_cpu_pct`, and `max_cpu_pct` for easy comparison.
- **Function HTML report** — Bar charts comparing JS vs Native ops/sec per runtime, with speedup ratios.

## Architecture

```
prices.json ──► fake-price.js (Bun.serve, port 3022) ──► /prices
                                                          │
                     server.js (Express 5, port 3033) ◄───┘
                       │              │
                  /price (JS)    /price-rust (N-API)
                       │              │
              indicators.js    napibench-native.node
                                        │
                                  rust-addon/ (Rust)
                                   ├── N-API (napi_impl.rs)
                                   └── WASM  (wasm.rs)
```

The fake price server serves BTC price data (1 year, ~365 data points) from `prices.json`. The app server expands this to 10 years and computes all indicators. Function benchmarks expand to 1000 years for heavier workloads.

## Project Structure

```
├── bench/
│   ├── bench-k6.js              # k6 load test script
│   ├── benchmark-functions.js   # mitata function benchmarks (Node.js, Bun)
│   └── benchmark-browser.js     # Playwright browser benchmarks (WASM vs JS)
├── rust-addon/                  # Rust native addon source
│   ├── Cargo.toml               # N-API + WASM feature flags
│   └── src/
│       ├── lib.rs               # Module root (napi or wasm feature gate)
│       ├── napi_impl.rs         # N-API bindings (sync + async, rayon parallel)
│       ├── wasm.rs              # WASM bindings (wasm-bindgen)
│       ├── indicators.rs        # SMA, RSI, MACD, Bollinger Bands
│       ├── signals.rs           # Trading signals (MA cross, RSI divergence, etc.)
│       ├── summary.rs           # Price summary (ATH/ATL, volatility)
│       └── utils.rs             # Date formatting, rounding
├── scripts/
│   ├── setup.sh                 # Installs k6 + Playwright Chromium (macOS only)
│   ├── bench-k6.sh              # k6 HTTP benchmark runner
│   ├── bench-functions.sh       # Function benchmark runner (Node + Bun + Browser)
│   ├── generate-combined-report.cjs  # Combined k6 report generator
│   └── kill_servers.sh          # Kill leftover server processes
├── src/
│   ├── server.js                # Express 5 API server
│   ├── fake-price.js            # Fake BTC price data server (Bun.serve)
│   ├── indicators.js            # JS technical indicator calculations
│   └── ports.config.js          # Port configuration (3022, 3033)
├── tests/
│   ├── indicators.test.js       # JS indicator unit tests
│   ├── native.test.js           # Native addon parity tests (vs JS output)
│   └── server.test.js           # Server integration tests
├── pkg/                         # WASM build output (generated by build:wasm)
├── reports/                     # Generated HTML reports + JSON metrics
├── prices.json                  # Fake BTC price data (~365 data points)
├── index.d.ts                   # TypeScript definitions for native addon
└── napibench-native.node        # Compiled native addon (generated by build:native)
```

## Running Tests

```bash
npm test
```

Tests use [vitest](https://vitest.dev) and cover:

- **`indicators.test.js`** — Unit tests for all JS indicator functions (moving averages, RSI, MACD, Bollinger Bands, summary, signals)
- **`native.test.js`** — Parity tests verifying Rust native output matches JS output
- **`server.test.js`** — Integration tests for the `/price` endpoint against a fake price server
