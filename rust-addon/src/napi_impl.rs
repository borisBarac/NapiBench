use napi::bindgen_prelude::{Buffer, Float64Array};
use napi_derive::napi;
use serde::Serialize;

use crate::indicators::{
    calculate_macd as calc_macd, calculate_moving_averages as calc_ma, calculate_rsi as calc_rsi,
    BollingerEntry, MacdEntry, MaResult, RsiEntry,
};
use crate::signals::{calculate_signals, SignalEntry};
use crate::summary::Summary;

#[derive(Serialize)]
struct AllResult {
    moving_averages: MaResult,
    rsi: Vec<RsiEntry>,
    macd: Vec<MacdEntry>,
    bollinger_bands: Vec<BollingerEntry>,
    summary: Summary,
    signals: Vec<SignalEntry>,
}

#[derive(Serialize)]
struct AllResultHttp {
    data_points: u32,
    #[serde(flatten)]
    inner: AllResult,
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

    let (((moving_averages, rsi), (macd, bollinger_bands)), summary) = rayon::join(
        || {
            rayon::join(
                || {
                    rayon::join(
                        || crate::indicators::calculate_moving_averages(prices, sma_windows, cutoff_years, &dates),
                        || crate::indicators::calculate_rsi(prices, 14, cutoff_years, &dates),
                    )
                },
                || {
                    rayon::join(
                        || crate::indicators::calculate_macd(prices, 12, 26, 9, cutoff_years, &dates),
                        || crate::indicators::calculate_bollinger_bands(prices, 20, cutoff_years, &dates),
                    )
                },
            )
        },
        || crate::summary::calculate_summary(prices, &dates),
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
pub fn calculate_moving_averages(
    prices: Float64Array,
    sma_windows: Vec<u32>,
    cutoff_years: Option<u32>,
) -> Buffer {
    let cutoff_years = cutoff_years.unwrap_or(9);
    let dates = crate::utils::precompute_dates(&prices);
    let result = calc_ma(&prices, &sma_windows, cutoff_years, &dates);
    Buffer::from(serde_json::to_vec(&result).unwrap())
}

#[napi]
pub fn calculate_rsi(
    prices: Float64Array,
    period: Option<u32>,
    cutoff_years: Option<u32>,
) -> Buffer {
    let period = period.unwrap_or(14);
    let cutoff_years = cutoff_years.unwrap_or(9);
    let dates = crate::utils::precompute_dates(&prices);
    let result = calc_rsi(&prices, period, cutoff_years, &dates);
    Buffer::from(serde_json::to_vec(&result).unwrap())
}

#[napi]
pub fn calculate_macd(
    prices: Float64Array,
    fast: Option<u32>,
    slow: Option<u32>,
    signal: Option<u32>,
    cutoff_years: Option<u32>,
) -> Buffer {
    let fast = fast.unwrap_or(12);
    let slow = slow.unwrap_or(26);
    let signal = signal.unwrap_or(9);
    let cutoff_years = cutoff_years.unwrap_or(9);
    let dates = crate::utils::precompute_dates(&prices);
    let result = calc_macd(&prices, fast, slow, signal, cutoff_years, &dates);
    Buffer::from(serde_json::to_vec(&result).unwrap())
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
) -> Buffer {
    let result = do_calculate_all(&prices, &sma_windows);
    Buffer::from(serde_json::to_vec(&result).unwrap())
}

#[napi]
pub fn calculate_all_from_raw(
    one_year_prices: Float64Array,
    years: Option<u32>,
    sma_windows: Vec<u32>,
) -> Buffer {
    let years = years.unwrap_or(10) as usize;
    let prices = expand_prices(&one_year_prices, years);
    let result = do_calculate_all(&prices, &sma_windows);
    Buffer::from(serde_json::to_vec(&result).unwrap())
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
    let http_result = AllResultHttp { data_points, inner: result };
    Buffer::from(serde_json::to_vec(&http_result).unwrap())
}

#[napi]
pub async fn calculate_all_async(prices: Float64Array, sma_windows: Vec<u32>) -> Buffer {
    let prices_vec = prices.to_vec();
    let sma_windows_clone = sma_windows.clone();
    let result = napi::tokio::task::spawn_blocking(move || {
        do_calculate_all(&prices_vec, &sma_windows_clone)
    })
    .await
    .unwrap();
    Buffer::from(serde_json::to_vec(&result).unwrap())
}

#[napi]
pub async fn calculate_all_from_raw_async(
    one_year_prices: Float64Array,
    years: Option<u32>,
    sma_windows: Vec<u32>,
) -> Buffer {
    let years = years.unwrap_or(10) as usize;
    let prices_vec = one_year_prices.to_vec();
    let sma_windows_clone = sma_windows.clone();
    let result = napi::tokio::task::spawn_blocking(move || {
        let prices = expand_prices(&prices_vec, years);
        do_calculate_all(&prices, &sma_windows_clone)
    })
    .await
    .unwrap();
    Buffer::from(serde_json::to_vec(&result).unwrap())
}
