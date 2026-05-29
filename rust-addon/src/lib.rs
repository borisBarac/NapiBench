use std::collections::HashMap;

use napi_derive::napi;
use serde::Serialize;

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn timestamp_to_date(ts: f64) -> String {
    let secs = ts as i64 / 1000;
    let days_since_epoch = secs / 86400;
    let mut year = 1970;
    let mut remaining = days_since_epoch;
    loop {
        let year_days = if is_leap(year) { 366 } else { 365 };
        if remaining < year_days {
            break;
        }
        remaining -= year_days;
        year += 1;
    }
    let month_days = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 0;
    for (i, &days) in month_days.iter().enumerate() {
        if remaining < days {
            month = i;
            break;
        }
        remaining -= days;
    }
    let day = remaining + 1;
    format!("{:04}-{:02}-{:02}", year, month + 1, day)
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

#[derive(Serialize)]
struct MaEntry {
    date: String,
    price: f64,
    #[serde(flatten)]
    smas: HashMap<String, Option<f64>>,
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

#[napi]
pub fn calculate_moving_averages(
    prices: Vec<Vec<f64>>,
    sma_windows: Vec<u32>,
    cutoff_years: Option<u32>,
) -> serde_json::Value {
    let cutoff_years = cutoff_years.unwrap_or(9);
    let cutoff_index = 0usize.max(prices.len().saturating_sub((cutoff_years as usize) * 365));
    let mut results = Vec::with_capacity(prices.len() - cutoff_index);

    for i in cutoff_index..prices.len() {
        let date = timestamp_to_date(prices[i][0]);
        let price = round2(prices[i][1]);
        let mut smas = HashMap::new();
        for &w in &sma_windows {
            let w_usize = w as usize;
            let start = i as isize - w_usize as isize + 1;
            if start >= 0 {
                let start = start as usize;
                let sum: f64 = (start..=i).map(|j| prices[j][1]).sum();
                smas.insert(format!("sma_{}", w), Some(round2(sum / w_usize as f64)));
            } else {
                smas.insert(format!("sma_{}", w), None);
            }
        }
        results.push(MaEntry {
            date,
            price,
            smas,
        });
    }

    serde_json::to_value(&results).unwrap()
}

#[napi]
pub fn calculate_rsi(
    prices: Vec<Vec<f64>>,
    period: Option<u32>,
    cutoff_years: Option<u32>,
) -> Vec<RsiEntry> {
    let period = period.unwrap_or(14) as usize;
    let cutoff_years = cutoff_years.unwrap_or(9);
    let cutoff_index = 0usize.max(prices.len().saturating_sub((cutoff_years as usize) * 365));
    let start_index = 1usize.max(cutoff_index);

    let changes: Vec<f64> = (1..prices.len())
        .map(|i| prices[i][1] - prices[i - 1][1])
        .collect();

    let mut avg_gain = 0.0_f64;
    let mut avg_loss = 0.0_f64;

    let first_change_idx = 0usize.max(start_index.saturating_sub(1));

    if first_change_idx + period <= changes.len() {
        let gain_sum: f64 = changes[first_change_idx..first_change_idx + period]
            .iter()
            .filter(|&&c| c > 0.0)
            .sum();
        let loss_sum: f64 = changes[first_change_idx..first_change_idx + period]
            .iter()
            .filter(|&&c| c < 0.0)
            .map(|c| c.abs())
            .sum();
        avg_gain = gain_sum / period as f64;
        avg_loss = loss_sum / period as f64;
    }

    let mut results = Vec::new();

    for i in start_index..prices.len() {
        let change_idx = i - 1;
        if change_idx >= first_change_idx + period && change_idx < changes.len() {
            let change = changes[change_idx];
            let gain = change.max(0.0);
            let loss = if change < 0.0 { change.abs() } else { 0.0 };
            avg_gain = (avg_gain * (period as f64 - 1.0) + gain) / period as f64;
            avg_loss = (avg_loss * (period as f64 - 1.0) + loss) / period as f64;
        }

        if change_idx >= first_change_idx + period - 1 {
            let rs = if avg_loss == 0.0 {
                100.0
            } else {
                avg_gain / avg_loss
            };
            let rsi = round2(100.0 - 100.0 / (1.0 + rs));
            results.push(RsiEntry {
                date: timestamp_to_date(prices[i][0]),
                rsi,
            });
        }
    }

    results
}

fn ema(values: &[f64], period: usize) -> Vec<f64> {
    let k = 2.0 / (period as f64 + 1.0);
    let mut result = Vec::new();

    let init_len = period.min(values.len());
    let sum: f64 = values[..init_len].iter().sum();

    if values.len() < period {
        return result;
    }

    result.push(sum / period as f64);

    for i in period..values.len() {
        let prev = result[result.len() - 1];
        result.push(values[i] * k + prev * (1.0 - k));
    }

    result
}

#[napi]
pub fn calculate_macd(
    prices: Vec<Vec<f64>>,
    fast: Option<u32>,
    slow: Option<u32>,
    signal: Option<u32>,
    cutoff_years: Option<u32>,
) -> Vec<MacdEntry> {
    let fast = fast.unwrap_or(12) as usize;
    let slow = slow.unwrap_or(26) as usize;
    let signal = signal.unwrap_or(9) as usize;
    let cutoff_years = cutoff_years.unwrap_or(9);

    let close_prices: Vec<f64> = prices.iter().map(|p| p[1]).collect();

    let fast_ema = ema(&close_prices, fast);
    let slow_ema = ema(&close_prices, slow);

    let mut macd_line = Vec::new();
    for i in 0..fast_ema.len() {
        let slow_idx = i as isize - (fast as isize - slow as isize);
        if slow_idx >= 0 && (slow_idx as usize) < slow_ema.len() {
            macd_line.push(fast_ema[i] - slow_ema[slow_idx as usize]);
        }
    }

    let signal_line = ema(&macd_line, signal);

    let cutoff_index = 0usize.max(prices.len().saturating_sub((cutoff_years as usize) * 365));
    let mut results = Vec::new();

    let macd_start_in_prices = (fast as isize - 1) as usize;

    for i in 0..signal_line.len() {
        let price_idx = macd_start_in_prices + signal - 1 + i;
        if price_idx >= cutoff_index && price_idx < prices.len() {
            let macd_val = macd_line[macd_line.len() - signal_line.len() + i];
            results.push(MacdEntry {
                date: timestamp_to_date(prices[price_idx][0]),
                macd: round2(macd_val),
                signal: round2(signal_line[i]),
                histogram: round2(macd_val - signal_line[i]),
            });
        }
    }

    results
}
