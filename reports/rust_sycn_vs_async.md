# SYNC — Benchmark Results

**Benchmark:** Full Pipeline (366,000 price points, 1,000 years)
**Date:** 2026-05-30

| Variant | Runtime | ops/sec | Avg (ms) | Min (ms) | Max (ms) | Speedup vs JS |
|---------|---------|--------:|---------:|---------:|---------:|:-------------:|
| JS - expand + all indicators | Node.js | 23 | 43.50 | 37.91 | 49.34 | 1x |
| Native - calculateAllFromRaw | Node.js | 62 | 16.15 | 15.39 | 16.81 | **2.70x** |
| Native - calculateAllFromRawAsync | Node.js | 63 | 15.79 | 15.08 | 16.75 | **2.74x** |
| JS - expand + all indicators | Bun | 25 | 39.55 | 32.81 | 49.98 | 1x |
| Native - calculateAllFromRaw | Bun | 68 | 14.64 | 13.85 | 15.49 | **2.72x** |
| Native - calculateAllFromRawAsync | Bun | 68 | 14.62 | 14.04 | 15.22 | **2.72x** |
| JS - expand + all indicators | Browser (Chromium) | 26 | 38.31 | 33.10 | 64.30 | 1x |
| Native (WASM) - calculateAllFromRaw | Browser (Chromium) | 56 | 17.78 | 16.90 | 35.60 | **2.15x** |

## Key Takeaways

- **Native (Rust via N-API) is ~2.7x faster** than JS on both Node.js and Bun
- **Bun is slightly faster** than Node.js across the board (~9% for JS, ~10% for native)
- **WASM in the browser** is ~2.2x faster than browser JS
- **Async vs sync N-API** performance is nearly identical
- JS performance is consistent across all three runtimes (~23–26 ops/sec)


# Async — Function Benchmark Results

**Benchmark:** Full Pipeline (366,000 price points, 1000 years)
**Date:** 2026-05-30

## Results

| Implementation | Runtime | ops/sec | Avg (ms) | Min (ms) | Max (ms) |
|---|---|---|---|---|---|
| JS | Node.js | 20 | 49.11 | 38.47 | 60.91 |
| Native (N-API) | Node.js | 63 | 15.95 | 15.23 | 16.81 |
| Native Async (N-API) | Node.js | 63 | 15.83 | 15.11 | 16.35 |
| JS | Bun | 28 | 36.10 | 32.91 | 39.94 |
| Native (N-API) | Bun | 69 | 14.51 | 13.81 | 15.40 |
| Native Async (N-API) | Bun | 68 | 14.69 | 13.90 | 15.42 |
| JS | Browser (Chromium) | 26 | 38.04 | 32.90 | 91.30 |
| Native (WASM) | Browser (Chromium) | 56 | 17.71 | 16.80 | 38.80 |

## Key Takeaways

- **Native is ~3x faster** than JS across all runtimes (~3.1x Node, ~2.5x Bun, ~2.2x Browser/WASM)
- **Bun is fastest** for both JS (28 vs 20 ops/sec) and Native (69 vs 63 ops/sec) compared to Node.js
- Sync vs Async N-API calls are virtually identical in performance
- WASM in the browser is surprisingly competitive — 56 ops/sec vs 63–69 for native N-API
