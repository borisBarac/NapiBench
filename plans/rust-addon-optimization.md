# Plan: Optimize `rust-addon/` Performance

Decisions:
- **Buffer returns** (not `#[napi(object)]`) — simpler, still much faster than `String`
- **No backward compat** — replace existing functions directly
- **WASM untouched** — `wasm.rs` is separate, only internal shared types change

---

## Phase 1: Fix immediate waste ✅

- [x] **1.1** Fix wasteful `serde_json::Value` round-trip in `calculate_all_from_raw_http`
  - File: `napi_impl.rs:141-155`
  - Added `AllResultHttp` wrapper struct with `#[serde(flatten)]` to include `data_points`
  - Removed `to_value()` → mutate → `to_vec()` pattern
  - Serialize directly: `serde_json::to_vec(&http_result).unwrap()`

## Phase 2: Replace all `String` returns with `Buffer`

Every napi function that currently returns `String` via `serde_json::to_string()` should instead return `Buffer` via `serde_json::to_vec()`. This skips V8's UTF-16 string conversion. JS side uses `JSON.parse(new TextDecoder().decode(buf))` or passes the buffer directly to `res.send()`.

- [ ] **2.1** `calculate_moving_averages_json` → rename to `calculate_moving_averages`, return `Buffer`
- [ ] **2.2** `calculate_rsi_json` → rename to `calculate_rsi`, return `Buffer`
- [ ] **2.3** `calculate_macd_json` → rename to `calculate_macd`, return `Buffer`
- [ ] **2.4** `calculate_all` → return `Buffer`
- [ ] **2.5** `calculate_all_from_raw` → return `Buffer`
- [ ] **2.6** `calculate_all_from_raw_http` → already returns `Buffer`, just fix per 1.1
- [ ] **2.7** Update `server.js` `/price-rust` route to work with Buffer return
- [ ] **2.8** Update `bench/benchmark-functions.js` — native benchmark should decode Buffer
- [ ] **2.9** Update `tests/native.test.js` — decode Buffer before asserting

## Phase 3: Eliminate internal String date allocations

Change the internal data flow from `Vec<String>` dates to `Vec<i64>` timestamps. Date formatting happens only at serialization time.

- [ ] **3.1** `utils.rs` — change `precompute_dates` to return `Vec<i64>` (raw ms timestamps)
  - Add `format_date(ts: i64) -> String` helper used only at output boundary
- [ ] **3.2** `indicators.rs` — change all entry structs to store `date_ts: i64` instead of `date: String`
  - `MaEntry.date` → `date_ts: i64`
  - `RsiEntry.date` → `date_ts: i64`
  - `MacdEntry.date` → `date_ts: i64`
  - `BollingerEntry.date` → `date_ts: i64`
- [ ] **3.3** `indicators.rs` — update `Serialize` impls to format `date_ts` → `"date"` string field in JSON output
- [ ] **3.4** `signals.rs` — change `SignalEntry.date` to `date_ts: i64`, update `Serialize` impl
- [ ] **3.5** `signals.rs` — update `calculate_signals` merge loop to compare `i64` instead of `String`
  - `dates` parameter becomes `&[i64]`
  - `signals.rs:76-88` string comparison → integer comparison
- [ ] **3.6** `summary.rs` — update `calculate_summary` to accept `&[i64]` dates, format only in `Serialize`
  - `AllTimeExtreme.date` → `date_ts: i64` + custom serialize
  - `DateRange.from/to` → `from_ts: i64`, `to_ts: i64` + custom serialize
- [ ] **3.7** `napi_impl.rs` — adapt `do_calculate_all` to pass `&[i64]` instead of `&[String]`
- [ ] **3.8** `wasm.rs` — adapt `do_calculate_all` to pass `&[i64]` instead of `&[String]`

## Phase 4: Make CPU-heavy functions async ✅

- [x] **4.1** Add async variant `calculate_all_from_raw_async`
  - Added `tokio_rt` feature to `napi` in `Cargo.toml`
  - Uses `napi::tokio::task::spawn_blocking` to offload computation off JS thread
  - Returns `Buffer` (JSON bytes) via Promise
- [x] **4.2** Add async variant `calculate_all_async`
  - Same pattern, for the non-expand path
- [x] **4.3** Update `server.js` `/price-rust` to call async variant with `await`
  - Switched from `calculateAllFromRawHttp` to `calculateAllFromRawAsync`
- [x] **4.4** Add benchmark entries for async variants in `bench/benchmark-functions.js`

## Phase 5: Minor optimizations

- [ ] **5.1** Verify zero-copy input — confirm `Float64Array` param gives `&[f64]` without copy in napi-rs 3.x (check docs, it likely already does for read-only access)
- [ ] **5.2** Consider `sma_windows` — low priority, `Vec<u32>` allocation is trivial compared to data

## Phase 6: Verify

- [ ] **6.1** `npm run build:native` — compiles without errors
- [ ] **6.2** `npm test` — all existing tests pass with new Buffer returns
- [ ] **6.3** `node bench/benchmark-functions.js` — compare before/after numbers
- [ ] **6.4** Manual smoke test: `node src/server.js`, hit `/price-rust`, verify JSON response is correct
