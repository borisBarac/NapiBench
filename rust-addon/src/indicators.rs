use serde::Serialize;

use crate::utils::{format_date, round2};

pub struct MaEntry {
    pub date_ts: i64,
    pub price: f64,
    pub sma_values: Vec<Option<f64>>,
}

pub struct MaResult {
    pub sma_keys: Vec<String>,
    pub entries: Vec<MaEntry>,
}

struct MaEntrySerializer<'a> {
    entry: &'a MaEntry,
    keys: &'a [String],
}

impl Serialize for MaEntrySerializer<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(Some(2 + self.keys.len()))?;
        map.serialize_entry("date", &format_date(self.entry.date_ts))?;
        map.serialize_entry("price", &self.entry.price)?;
        for (k, v) in self.keys.iter().zip(self.entry.sma_values.iter()) {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}

impl Serialize for MaResult {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeSeq;
        let mut seq = serializer.serialize_seq(Some(self.entries.len()))?;
        for entry in &self.entries {
            seq.serialize_element(&MaEntrySerializer {
                entry,
                keys: &self.sma_keys,
            })?;
        }
        seq.end()
    }
}

pub fn calculate_moving_averages(
    prices: &[f64],
    sma_windows: &[u32],
    cutoff_years: u32,
    dates: &[i64],
) -> MaResult {
    let num_points = prices.len() / 2;
    let cutoff_index = 0usize.max(num_points.saturating_sub((cutoff_years as usize) * 365));
    let mut entries = Vec::with_capacity(num_points - cutoff_index);

    let mut running_sums: Vec<f64> = vec![0.0; sma_windows.len()];

    for i in 0..num_points {
        let price = prices[i * 2 + 1];

        for (wi, &w) in sma_windows.iter().enumerate() {
            let w_usize = w as usize;
            running_sums[wi] += price;
            if i >= w_usize {
                running_sums[wi] -= prices[(i - w_usize) * 2 + 1];
            }
        }

        if i >= cutoff_index {
            let sma_values: Vec<Option<f64>> = sma_windows
                .iter()
                .enumerate()
                .map(|(wi, &w)| {
                    let w_usize = w as usize;
                    if i >= w_usize - 1 {
                        Some(round2(running_sums[wi] / w_usize as f64))
                    } else {
                        None
                    }
                })
                .collect();
            entries.push(MaEntry {
                date_ts: dates[i],
                price: round2(price),
                sma_values,
            });
        }
    }

    let sma_keys: Vec<String> = sma_windows.iter().map(|w| format!("sma_{}", w)).collect();
    MaResult { sma_keys, entries }
}

pub struct RsiEntry {
    pub date_ts: i64,
    pub rsi: f64,
}

impl Serialize for RsiEntry {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("RsiEntry", 2)?;
        s.serialize_field("date", &format_date(self.date_ts))?;
        s.serialize_field("rsi", &self.rsi)?;
        s.end()
    }
}

pub fn calculate_rsi(prices: &[f64], period: u32, cutoff_years: u32, dates: &[i64]) -> Vec<RsiEntry> {
    let period = period as usize;
    let num_points = prices.len() / 2;
    let cutoff_index = 0usize.max(num_points.saturating_sub((cutoff_years as usize) * 365));
    let start_index = 1usize.max(cutoff_index);

    let changes: Vec<f64> = (1..num_points)
        .map(|i| prices[i * 2 + 1] - prices[(i - 1) * 2 + 1])
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

    for i in start_index..num_points {
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
                date_ts: dates[i],
                rsi,
            });
        }
    }

    results
}

pub fn ema(values: &[f64], period: usize) -> Vec<f64> {
    let k = 2.0 / (period as f64 + 1.0);

    if values.len() < period {
        return Vec::new();
    }

    let sum: f64 = values[..period].iter().sum();
    let mut prev = sum / period as f64;
    let mut result = Vec::with_capacity(values.len() - period + 1);
    result.push(prev);

    for i in period..values.len() {
        prev = values[i] * k + prev * (1.0 - k);
        result.push(prev);
    }

    result
}

pub struct MacdEntry {
    pub date_ts: i64,
    pub macd: f64,
    pub signal: f64,
    pub histogram: f64,
}

impl Serialize for MacdEntry {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("MacdEntry", 4)?;
        s.serialize_field("date", &format_date(self.date_ts))?;
        s.serialize_field("macd", &self.macd)?;
        s.serialize_field("signal", &self.signal)?;
        s.serialize_field("histogram", &self.histogram)?;
        s.end()
    }
}

pub fn calculate_macd(
    prices: &[f64],
    fast: u32,
    slow: u32,
    signal: u32,
    cutoff_years: u32,
    dates: &[i64],
) -> Vec<MacdEntry> {
    let fast = fast as usize;
    let slow = slow as usize;
    let signal = signal as usize;
    let num_points = prices.len() / 2;

    let close_prices: Vec<f64> = (0..num_points).map(|i| prices[i * 2 + 1]).collect();

    let (fast_ema, slow_ema) = (ema(&close_prices, fast), ema(&close_prices, slow));

    let mut macd_line = Vec::new();
    for i in 0..fast_ema.len() {
        let slow_idx = i as isize - (fast as isize - slow as isize);
        if slow_idx >= 0 && (slow_idx as usize) < slow_ema.len() {
            macd_line.push(fast_ema[i] - slow_ema[slow_idx as usize]);
        }
    }

    let signal_line = ema(&macd_line, signal);

    let cutoff_index = 0usize.max(num_points.saturating_sub((cutoff_years as usize) * 365));
    let mut results = Vec::new();

    let macd_start_in_prices = (fast as isize - 1) as usize;

    for i in 0..signal_line.len() {
        let price_idx = macd_start_in_prices + signal - 1 + i;
        if price_idx >= cutoff_index && price_idx < num_points {
            let macd_val = macd_line[macd_line.len() - signal_line.len() + i];
            results.push(MacdEntry {
                date_ts: dates[price_idx],
                macd: round2(macd_val),
                signal: round2(signal_line[i]),
                histogram: round2(macd_val - signal_line[i]),
            });
        }
    }

    results
}

pub struct BollingerEntry {
    pub date_ts: i64,
    pub upper: f64,
    pub middle: f64,
    pub lower: f64,
    pub bandwidth: f64,
    pub percent_b: f64,
}

impl Serialize for BollingerEntry {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("BollingerEntry", 6)?;
        s.serialize_field("date", &format_date(self.date_ts))?;
        s.serialize_field("upper", &self.upper)?;
        s.serialize_field("middle", &self.middle)?;
        s.serialize_field("lower", &self.lower)?;
        s.serialize_field("bandwidth", &self.bandwidth)?;
        s.serialize_field("percent_b", &self.percent_b)?;
        s.end()
    }
}

pub fn calculate_bollinger_bands(
    prices: &[f64],
    period: u32,
    cutoff_years: u32,
    dates: &[i64],
) -> Vec<BollingerEntry> {
    let period = period as usize;
    let num_points = prices.len() / 2;
    let cutoff_index = 0usize.max(num_points.saturating_sub((cutoff_years as usize) * 365));
    let mut results = Vec::new();

    let mut sum = 0.0_f64;
    let mut sum_sq = 0.0_f64;

    for i in 0..num_points {
        let price = prices[i * 2 + 1];
        sum += price;
        sum_sq += price * price;

        if i >= period {
            let old_price = prices[(i - period) * 2 + 1];
            sum -= old_price;
            sum_sq -= old_price * old_price;
        }

        if i >= period - 1 && i >= cutoff_index {
            let n = period as f64;
            let mean = sum / n;
            let variance = (sum_sq / n - mean * mean).max(0.0);
            let stddev = variance.sqrt();

            let upper = mean + 2.0 * stddev;
            let lower = mean - 2.0 * stddev;
            let bandwidth = if mean != 0.0 {
                round2((upper - lower) / mean * 100.0)
            } else {
                0.0
            };
            let percent_b = if upper != lower {
                round2((price - lower) / (upper - lower))
            } else {
                0.5
            };

            results.push(BollingerEntry {
                date_ts: dates[i],
                upper: round2(upper),
                middle: round2(mean),
                lower: round2(lower),
                bandwidth,
                percent_b,
            });
        }
    }

    results
}
