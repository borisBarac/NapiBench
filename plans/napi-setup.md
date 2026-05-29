# NapiBench + napi-rs Setup Plan

## Design decisions

- Rust functions match JS signatures from `indicators.js` exactly (dynamic `smaWindows`, `cutoffYears` with default `9`, etc.)
- `MaEntry` uses `serde-json` feature + `HashMap<String, Option<f64>>` for dynamic SMA keys (`sma_25`, `sma_50`, etc.)
- `RsiEntry` and `MacdEntry` use fixed `#[napi(object)]` structs (their fields are static)
- Separate `k6/bench-rust.js` for Rust benchmarking

---

## Phase 1: Set up napi-rs infrastructure

### 1a. Install @napi-rs CLI

```bash
bun add -D @napi-rs/cli
```

### 1b. Create `rust-addon/Cargo.toml`

```toml
[package]
name = "napibench-native"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "3", features = ["napi4", "serde-json"] }
napi-derive = "3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
napi-build = "3"
```

### 1c. Create `rust-addon/build.rs`

```rust
extern crate napi_build;

fn main() {
  napi_build::setup();
}
```

### 1d. Create `rust-addon/src/lib.rs` with a minimal hello function

```rust
#[napi]
pub fn hello() -> String {
  "Hello from Rust!".to_string()
}
```

### 1e. Add build scripts to `package.json`

```json
"build:native": "napi build --release --cargo-cwd rust-addon",
"build:native:debug": "napi build --cargo-cwd rust-addon"
```

### 1f. Add `*.node` to `.gitignore`

### 1g. Verify Phase 1

```bash
npm run build:native:debug
node -e "const {createRequire}=require('module');const r=createRequire('.');console.log(r('./napibench-native.node').hello())"
```

---

## Phase 2: Port indicator functions to Rust

### 2a. Define structs in `rust-addon/src/lib.rs`

```rust
use std::collections::HashMap;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MaEntry {
    pub date: String,
    pub price: f64,
    #[serde(flatten)]
    pub smas: HashMap<String, Option<f64>>,
}

#[napi(object)]
pub struct RsiEntry {
    pub date: String,
    pub rsi: f64,
}

#[napi(object)]
pub struct MacdEntry {
    pub date: String,
    pub macd: f64,
    pub signal: f64,
    pub histogram: f64,
}
```

### 2b. Implement `calculate_moving_averages`

Signature: `#[napi] fn calculate_moving_averages(prices: Vec<Vec<f64>>, sma_windows: Vec<u32>, cutoff_years: Option<u32>) -> Vec<MaEntry>`

Logic from `indicators.js:1-26`:
- `cutoffIndex = max(0, prices.len() - cutoffYears * 365)`
- For each price from cutoffIndex onward: compute date, price (rounded to 2dp)
- For each window `w`: compute SMA if enough data, else `null`
- Dynamic keys: `sma_{w}` → use `HashMap<String, Option<f64>>` + serde-json serialization
- Since `MaEntry` uses serde, return via `napi::Env` to serialize as JS objects

### 2c. Implement `calculate_rsi`

Signature: `#[napi] fn calculate_rsi(prices: Vec<Vec<f64>>, period: Option<u32>, cutoff_years: Option<u32>) -> Vec<RsiEntry>`

Logic from `indicators.js:28-76`:
- Compute price changes array
- Initialize avgGain/avgLoss from first `period` changes at `firstChangeIdx`
- Wilder smoothing: `avgGain = (avgGain * (period-1) + gain) / period`
- RSI = `round((100 - 100/(1+rs)) * 100) / 100`
- Special case: `avgLoss === 0` → rs = 100

### 2d. Implement `calculate_macd`

Signature: `#[napi] fn calculate_macd(prices: Vec<Vec<f64>>, fast: Option<u32>, slow: Option<u32>, signal: Option<u32>, cutoff_years: Option<u32>) -> Vec<MacdEntry>`

Logic from `indicators.js:78-134`:
- Helper `ema(values, period)`: SMA seed, then EMA with `k = 2/(period+1)`
- Compute fast EMA, slow EMA → MACD line
- Compute signal line from MACD line
- Filter by cutoffIndex, round all values to 2dp
- `histogram = macd - signal`

### 2e. Verify Phase 2

```bash
npm run build:native:debug
# Spot-check: compare Rust output vs JS output with test data
```

---

## Phase 3: Integration & benchmarking

### 3a. Add `/price-rust` route to `index.js`

```js
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const native = require("./napibench-native.node");
```

New Express route `/price-rust` mirrors `/price` but calls:
- `native.calculateMovingAverages(prices, [25, 50, 100, 200])`
- `native.calculateRsi(prices)`
- `native.calculateMacd(prices)`

Keep `/price` unchanged.

### 3b. Create `k6/bench-rust.js`

Same structure as `k6/bench.js` but hitting `/price-rust`.

### 3c. Verify Phase 3

```bash
npm run build:native:debug   # compiles the Rust addon
npm test                      # existing JS tests still pass
node index.js                 # both /price and /price-rust respond
```
