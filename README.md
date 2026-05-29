# NapiBench — Node vs Bun API Benchmark

A performance benchmark comparing the same Express API running under **Node.js** and **Bun**, load-tested with [k6](https://k6.io).

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
# Benchmark both runtimes
./scripts/run-bench.sh all

# Benchmark Node.js only
./scripts/run-bench.sh node

# Benchmark Bun only
./scripts/run-bench.sh bun
```

## Reports

HTML reports are saved to the `reports/` directory:

- `reports/node_report.html` — Node.js results
- `reports/bun_report.html` — Bun results

Open them in a browser to view interactive charts for latency, throughput, and error rates.

## Project Structure

```
├── fake_price.js        # Fake BTC price data server (Bun, port 3022)
├── index.js             # Express API server (runs under Node or Bun)
├── k6/bench.js          # k6 load test script
├── scripts/
│   ├── setup.sh         # Installs k6 if missing
│   └── run-bench.sh     # Orchestrates and runs benchmarks
├── reports/             # Generated HTML reports
├── prices.json          # Sample BTC price data
└── plans/               # Planning docs
```

## Running Tests

```bash
bun test
```
