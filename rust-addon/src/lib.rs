mod indicators;
mod signals;
mod summary;
mod utils;

use napi::bindgen_prelude::Float64Array;
use napi::bindgen_prelude::Unknown;
use napi::Env;
use napi_derive::napi;
use serde::Serialize;

use indicators::{
    calculate_bollinger_bands, calculate_macd, calculate_moving_averages, calculate_rsi,
    BollingerEntry, MacdEntry, MaEntry, RsiEntry,
};
use signals::{calculate_signals, SignalEntry};
use summary::{calculate_summary, Summary};

#[derive(Serialize)]
struct AllResult {
    moving_averages: Vec<MaEntry>,
    rsi: Vec<RsiEntry>,
    macd: Vec<MacdEntry>,
    bollinger_bands: Vec<BollingerEntry>,
    summary: Summary,
    signals: Vec<SignalEntry>,
}

#[napi]
pub fn calculate_moving_averages_json(
    prices: Float64Array,
    sma_windows: Vec<u32>,
    cutoff_years: Option<u32>,
) -> String {
    let cutoff_years = cutoff_years.unwrap_or(9);
    let result = calculate_moving_averages(&prices, &sma_windows, cutoff_years);
    serde_json::to_string(&result).unwrap()
}

#[napi]
pub fn calculate_rsi_json(
    prices: Float64Array,
    period: Option<u32>,
    cutoff_years: Option<u32>,
) -> String {
    let period = period.unwrap_or(14);
    let cutoff_years = cutoff_years.unwrap_or(9);
    let result = calculate_rsi(&prices, period, cutoff_years);
    serde_json::to_string(&result).unwrap()
}

#[napi]
pub fn calculate_macd_json(
    prices: Float64Array,
    fast: Option<u32>,
    slow: Option<u32>,
    signal: Option<u32>,
    cutoff_years: Option<u32>,
) -> String {
    let fast = fast.unwrap_or(12);
    let slow = slow.unwrap_or(26);
    let signal = signal.unwrap_or(9);
    let cutoff_years = cutoff_years.unwrap_or(9);
    let result = calculate_macd(&prices, fast, slow, signal, cutoff_years);
    serde_json::to_string(&result).unwrap()
}

fn expand_prices(one_year_prices: &[f64], years: usize) -> Vec<f64> {
    let year_ms = 365.0 * 24.0 * 3600.0 * 1000.0;
    let n = one_year_prices.len() / 2;
    let mut out = Vec::with_capacity(n * years * 2);
    for y in 0..years {
        let offset = (years - 1 - y) as f64 * year_ms;
        for i in 0..n {
            out.push(one_year_prices[i * 2] - offset);
            out.push(one_year_prices[i * 2 + 1]);
        }
    }
    out
}

fn do_calculate_all(prices: &[f64], sma_windows: &[u32]) -> AllResult {
    let cutoff_years: u32 = 9;

    let ((moving_averages, rsi), (macd, bollinger_bands, summary)) = rayon::join(
        || {
            let ma = calculate_moving_averages(prices, sma_windows, cutoff_years);
            let rsi = calculate_rsi(prices, 14, cutoff_years);
            (ma, rsi)
        },
        || {
            let macd = calculate_macd(prices, 12, 26, 9, cutoff_years);
            let bb = calculate_bollinger_bands(prices, 20, cutoff_years);
            let summary = calculate_summary(prices);
            (macd, bb, summary)
        },
    );

    let signals = calculate_signals(&moving_averages, &rsi, &macd, &bollinger_bands);
    AllResult {
        moving_averages,
        rsi,
        macd,
        bollinger_bands,
        summary,
        signals,
    }
}

fn do_calculate_all_sync(prices: &[f64], sma_windows: &[u32]) -> AllResult {
    let cutoff_years: u32 = 9;
    let moving_averages = calculate_moving_averages(prices, sma_windows, cutoff_years);
    let rsi = calculate_rsi(prices, 14, cutoff_years);
    let macd = calculate_macd(prices, 12, 26, 9, cutoff_years);
    let bollinger_bands = calculate_bollinger_bands(prices, 20, cutoff_years);
    let summary = calculate_summary(prices);
    let signals = calculate_signals(&moving_averages, &rsi, &macd, &bollinger_bands);
    AllResult {
        moving_averages,
        rsi,
        macd,
        bollinger_bands,
        summary,
        signals,
    }
}

#[napi]
pub fn expand_prices_flat(one_year_prices: Float64Array, years: Option<u32>) -> Float64Array {
    let years = years.unwrap_or(10) as usize;
    let expanded = expand_prices(&one_year_prices, years);
    Float64Array::from(expanded)
}

#[napi]
pub fn calculate_all(
    env: Env,
    prices: Float64Array,
    sma_windows: Vec<u32>,
) -> napi::Result<Unknown<'static>> {
    let result = do_calculate_all(&prices, &sma_windows);
    env.to_js_value(&result)
}

#[napi]
pub fn calculate_all_from_raw(
    env: Env,
    one_year_prices: Float64Array,
    years: Option<u32>,
    sma_windows: Vec<u32>,
) -> napi::Result<Unknown<'static>> {
    let years = years.unwrap_or(10) as usize;
    let prices = expand_prices(&one_year_prices, years);
    let result = do_calculate_all(&prices, &sma_windows);
    env.to_js_value(&result)
}
