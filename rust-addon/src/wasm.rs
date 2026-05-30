use wasm_bindgen::prelude::*;
use js_sys::Float64Array;
use serde::Serialize;

use crate::indicators::{
    calculate_bollinger_bands, calculate_macd, calculate_moving_averages, calculate_rsi,
    BollingerEntry, MacdEntry, MaEntry, RsiEntry,
};
use crate::signals::{calculate_signals, SignalEntry};
use crate::summary::Summary;

#[derive(Serialize)]
struct AllResult {
    moving_averages: Vec<MaEntry>,
    rsi: Vec<RsiEntry>,
    macd: Vec<MacdEntry>,
    bollinger_bands: Vec<BollingerEntry>,
    summary: Summary,
    signals: Vec<SignalEntry>,
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
    let moving_averages = calculate_moving_averages(prices, sma_windows, cutoff_years);
    let rsi = calculate_rsi(prices, 14, cutoff_years);
    let macd = calculate_macd(prices, 12, 26, 9, cutoff_years);
    let bollinger_bands = calculate_bollinger_bands(prices, 20, cutoff_years);
    let summary = crate::summary::calculate_summary(prices);
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

#[wasm_bindgen]
pub fn wasm_calculate_all_from_raw(
    one_year_prices: Float64Array,
    years: u32,
    sma_windows: Vec<u32>,
) -> String {
    let years = years as usize;
    let prices_vec = one_year_prices.to_vec();
    let prices = expand_prices(&prices_vec, years);
    let result = do_calculate_all(&prices, &sma_windows);
    serde_json::to_string(&result).unwrap()
}
