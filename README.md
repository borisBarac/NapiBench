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
# Benchmark both runtimes (defaults: size=s, endpoint=/price)
./scripts/run-bench.sh all

# Benchmark Node.js only
./scripts/run-bench.sh node

# Benchmark Bun only
./scripts/run-bench.sh bun
```

### Benchmark Sizes

| Size | VUs | Ramp-up | Hold | Ramp-down |
|------|-----|---------|------|-----------|
| `s`  | 50  | 30s     | 1m   | 10s       |
| `m`  | 200 | 1m      | 3m   | 30s       |
| `l`  | 500 | 2m      | 5m   | 1m        |

```bash
SIZE=m ./scripts/run-bench.sh bun
SIZE=l ./scripts/run-bench.sh all
```

### Endpoint Selection

```bash
# Default JS endpoint (/price)
./scripts/run-bench.sh bun

# Rust native endpoint (/price-rust)
ENDPOINT=/price-rust ./scripts/run-bench.sh bun

# Combined
SIZE=m ENDPOINT=/price-rust ./scripts/run-bench.sh node
```

## Reports

HTML reports and JSON metrics are saved to the `reports/` directory.

### Filename Pattern

```
reports/{runtime}_{size}[_{endpoint}]_report.html
reports/{runtime}_{size}[_{endpoint}]_metrics.json
reports/{runtime}_{size}[_{endpoint}]_metrics.log
```

### Examples

| Flags | Report |
|-------|--------|
| *(defaults)* | `reports/node_s_report.html` |
| `SIZE=m` | `reports/bun_m_report.html` |
| `ENDPOINT=/price-rust` | `reports/bun_s_rust_report.html` |
| `SIZE=l ENDPOINT=/price-rust` | `reports/node_l_rust_report.html` |

### What's Included

- **HTML report** — Interactive k6 dashboard with latency, throughput, and error rate charts. A fixed resource usage bar at the bottom shows Peak RSS, Avg CPU, and Max CPU.
- **JSON metrics** — Machine-readable `peak_rss_mb`, `avg_cpu_pct`, and `max_cpu_pct` for easy comparison.

## Project Structure

```
├── fake_price.js        # Fake BTC price data server (Bun, port 3022)
├── index.js             # Express API server (runs under Node or Bun)
├── k6/
│   └── bench.js         # Unified k6 load test (SIZE + ENDPOINT env vars)
├── rust-addon/          # Rust N-API native addon source
├── scripts/
│   ├── setup.sh         # Installs k6 if missing
│   └── run-bench.sh     # Orchestrates and runs benchmarks
├── reports/             # Generated HTML reports + JSON metrics
├── prices.json          # Sample BTC price data
└── plans/               # Planning docs
```

## Running Tests

```bash
bun test
```
