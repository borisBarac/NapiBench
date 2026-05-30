# NapiBench — Node vs Bun vs Rust API Benchmark

A performance benchmark comparing the same Express API running under **Node.js** and **Bun**, with both JS and Rust (N-API native) computation paths, load-tested with [k6](https://k6.io).

## Prerequisites

- [Bun](https://bun.com) runtime
- [Node.js](https://nodejs.org)
- [k6](https://k6.io) (install via `./scripts/setup.sh`)

## Setup

```bash
bun install
./scripts/setup.sh
```

## Running the Benchmark

```bash
# Benchmark both runtimes, both endpoints (default)
./scripts/bench-k6.sh all

# Benchmark Node.js only
./scripts/bench-k6.sh node

# Benchmark Bun only
./scripts/bench-k6.sh bun
```

### Endpoint Selection

By default, both endpoints are benchmarked:

| Endpoint | Description |
|----------|-------------|
| `/price` | JS computation (moving averages, RSI, MACD, Bollinger Bands) |
| `/price-rust` | Rust native computation via N-API (`calculateAllFromRawAsync`) |

Override with the `ENDPOINTS` env var:

```bash
# Only JS endpoint
ENDPOINTS="/price" ./scripts/bench-k6.sh all

# Only Rust endpoint
ENDPOINTS="/price-rust" ./scripts/bench-k6.sh all

# Both (default)
ENDPOINTS="/price /price-rust" ./scripts/bench-k6.sh all
```

## Reports

HTML reports and JSON metrics are saved to the `reports/` directory.

### Individual Reports

Each runtime/endpoint combination generates:

```
reports/{runtime}_{endpoint}_report.html      # Interactive k6 dashboard
reports/{runtime}_{endpoint}_summary.json      # Latency, throughput, errors
reports/{runtime}_{endpoint}_metrics.json      # Peak RSS, CPU usage
reports/{runtime}_{endpoint}_metrics.log       # Raw sampling data
```

### Combined Report

When running with `all` (both runtimes), a combined comparison report is generated:

```
reports/combined_benchmark-k6.html
```

This shows side-by-side bar charts for all combinations (e.g. Node.js/JS, Node.js/Rust, Bun/JS, Bun/Rust) across latency, throughput, error rate, and resource usage metrics.

### What's Included

- **HTML report** — Interactive k6 dashboard with latency, throughput, and error rate charts. A fixed resource usage bar at the bottom shows Peak RSS, Avg CPU, and Max CPU.
- **JSON summary** — Machine-readable latency (avg, p95, p99, min, max, med), throughput (rps, total requests), and error rate.
- **JSON metrics** — `peak_rss_mb`, `avg_cpu_pct`, and `max_cpu_pct` for easy comparison.

## Function Benchmarks

Benchmark raw computation performance (JS vs Rust native vs WASM) across Node.js, Bun, and browser:

```bash
./scripts/bench-functions.sh
```

## Project Structure

```
├── bench/
│   ├── bench-k6.js              # k6 load test script
│   ├── benchmark-functions.js   # mitata function benchmarks
│   └── benchmark-browser.js     # Playwright browser benchmarks
├── rust-addon/                  # Rust N-API native addon source
├── scripts/
│   ├── setup.sh                 # Installs k6 if missing
│   ├── bench-k6.sh              # K6 HTTP benchmark runner
│   ├── bench-functions.sh       # Function benchmark runner
│   ├── generate-combined-report.cjs  # Combined report generator
│   └── kill_servers.sh          # Kill leftover server processes
├── src/
│   ├── server.js                # Express API server
│   ├── fake-price.js            # Fake BTC price data server
│   ├── indicators.js            # JS technical indicator calculations
│   └── ports.config.js          # Port configuration
├── reports/                     # Generated HTML reports + JSON metrics
├── tests/                       # Test files
└── plans/                       # Planning docs
```

## Running Tests

```bash
bun test
```
