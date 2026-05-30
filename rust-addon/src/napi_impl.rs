use napi::bindgen_prelude::{Buffer, Float64Array};
use napi_derive::napi;
use serde::Serialize;

use crate::indicators::{
    calculate_bollinger_bands, calculate_macd, calculate_moving_averages, calculate_rsi,
    BollingerEntry, MacdEntry, MaResult, RsiEntry,
};
use crate::signals::{calculate_signals, SignalEntry};
use crate::summary::{calculate_summary, Summary};

#[derive(Serialize)]
struct AllResult {
    moving_averages: MaResult,
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
    let dates = crate::utils::precompute_dates(prices);

    let ((moving_averages, rsi), (macd, bollinger_bands, summary)) = rayon::join(
        || {
            let ma = calculate_moving_averages(prices, sma_windows, cutoff_years, &dates);
            let rsi = calculate_rsi(prices, 14, cutoff_years, &dates);
            (ma, rsi)
        },
        || {
            let macd = calculate_macd(prices, 12, 26, 9, cutoff_years, &dates);
            let bb = calculate_bollinger_bands(prices, 20, cutoff_years, &dates);
            let summary = calculate_summary(prices, &dates);
            (macd, bb, summary)
        },
    );

    let signals = calculate_signals(
        &moving_averages.sma_keys,
        &moving_averages.entries,
        &rsi,
        &macd,
        &bollinger_bands,
    );
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
pub fn calculate_moving_averages_json(
    prices: Float64Array,
    sma_windows: Vec<u32>,
    cutoff_years: Option<u32>,
) -> String {
    let cutoff_years = cutoff_years.unwrap_or(9);
    let dates = crate::utils::precompute_dates(&prices);
    let result = calculate_moving_averages(&prices, &sma_windows, cutoff_years, &dates);
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
    let dates = crate::utils::precompute_dates(&prices);
    let result = calculate_rsi(&prices, period, cutoff_years, &dates);
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
    let dates = crate::utils::precompute_dates(&prices);
    let result = calculate_macd(&prices, fast, slow, signal, cutoff_years, &dates);
    serde_json::to_string(&result).unwrap()
}

#[napi]
pub fn expand_prices_flat(one_year_prices: Float64Array, years: Option<u32>) -> Float64Array {
    let years = years.unwrap_or(10) as usize;
    let expanded = expand_prices(&one_year_prices, years);
    Float64Array::from(expanded)
}

#[napi]
pub fn calculate_all(
    prices: Float64Array,
    sma_windows: Vec<u32>,
) -> String {
    let result = do_calculate_all(&prices, &sma_windows);
    serde_json::to_string(&result).unwrap()
}

#[napi]
pub fn calculate_all_from_raw(
    one_year_prices: Float64Array,
    years: Option<u32>,
    sma_windows: Vec<u32>,
) -> String {
    let years = years.unwrap_or(10) as usize;
    let prices = expand_prices(&one_year_prices, years);
    let result = do_calculate_all(&prices, &sma_windows);
    serde_json::to_string(&result).unwrap()
}

#[napi]
pub fn calculate_all_from_raw_http(
    one_year_prices: Float64Array,
    data_points: u32,
    years: Option<u32>,
    sma_windows: Vec<u32>,
) -> Buffer {
    let years = years.unwrap_or(10) as usize;
    let prices = expand_prices(&one_year_prices, years);
    let result = do_calculate_all(&prices, &sma_windows);
    let mut val = serde_json::to_value(&result).unwrap();
    val.as_object_mut().unwrap()
        .insert("data_points".into(), serde_json::Value::Number(data_points.into()));
    let bytes = serde_json::to_vec(&val).unwrap();
    Buffer::from(bytes)
}
