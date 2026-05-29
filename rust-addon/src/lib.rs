use std::collections::HashMap;

use napi::bindgen_prelude::Float64Array;
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

fn calculate_moving_averages(
    prices: &[f64],
    sma_windows: &[u32],
    cutoff_years: u32,
) -> Vec<MaEntry> {
    let num_points = prices.len() / 2;
    let cutoff_index = 0usize.max(num_points.saturating_sub((cutoff_years as usize) * 365));
    let mut results = Vec::with_capacity(num_points - cutoff_index);

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
            let date = timestamp_to_date(prices[i * 2]);
            let mut smas = HashMap::new();
            for (wi, &w) in sma_windows.iter().enumerate() {
                let w_usize = w as usize;
                if i >= w_usize - 1 {
                    smas.insert(
                        format!("sma_{}", w),
                        Some(round2(running_sums[wi] / w_usize as f64)),
                    );
                } else {
                    smas.insert(format!("sma_{}", w), None);
                }
            }
            results.push(MaEntry {
                date,
                price: round2(price),
                smas,
            });
        }
    }

    results
}

#[derive(Serialize)]
struct RsiEntry {
    date: String,
    rsi: f64,
}

fn calculate_rsi(prices: &[f64], period: u32, cutoff_years: u32) -> Vec<RsiEntry> {
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
                date: timestamp_to_date(prices[i * 2]),
                rsi,
            });
        }
    }

    results
}

fn ema(values: &[f64], period: usize) -> Vec<f64> {
    let k = 2.0 / (period as f64 + 1.0);
    let mut result = Vec::new();

    if values.len() < period {
        return result;
    }

    let sum: f64 = values[..period].iter().sum();
    result.push(sum / period as f64);

    for i in period..values.len() {
        let prev = result[result.len() - 1];
        result.push(values[i] * k + prev * (1.0 - k));
    }

    result
}

#[derive(Serialize)]
struct MacdEntry {
    date: String,
    macd: f64,
    signal: f64,
    histogram: f64,
}

fn calculate_macd(
    prices: &[f64],
    fast: u32,
    slow: u32,
    signal: u32,
    cutoff_years: u32,
) -> Vec<MacdEntry> {
    let fast = fast as usize;
    let slow = slow as usize;
    let signal = signal as usize;
    let num_points = prices.len() / 2;

    let close_prices: Vec<f64> = (0..num_points).map(|i| prices[i * 2 + 1]).collect();

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

    let cutoff_index = 0usize.max(num_points.saturating_sub((cutoff_years as usize) * 365));
    let mut results = Vec::new();

    let macd_start_in_prices = (fast as isize - 1) as usize;

    for i in 0..signal_line.len() {
        let price_idx = macd_start_in_prices + signal - 1 + i;
        if price_idx >= cutoff_index && price_idx < num_points {
            let macd_val = macd_line[macd_line.len() - signal_line.len() + i];
            results.push(MacdEntry {
                date: timestamp_to_date(prices[price_idx * 2]),
                macd: round2(macd_val),
                signal: round2(signal_line[i]),
                histogram: round2(macd_val - signal_line[i]),
            });
        }
    }

    results
}

#[derive(Serialize)]
struct BollingerEntry {
    date: String,
    upper: f64,
    middle: f64,
    lower: f64,
    bandwidth: f64,
    percent_b: f64,
}

fn calculate_bollinger_bands(
    prices: &[f64],
    period: u32,
    cutoff_years: u32,
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
                date: timestamp_to_date(prices[i * 2]),
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

#[derive(Serialize)]
struct PriceChange {
    absolute: f64,
    percent: f64,
}

#[derive(Serialize)]
struct AllTimeExtreme {
    price: f64,
    date: String,
    days_since: i64,
}

#[derive(Serialize)]
struct Volatility {
    daily_avg: f64,
    weekly_avg: f64,
    monthly_avg: f64,
    yearly_avg: f64,
}

#[derive(Serialize)]
struct DateRange {
    from: String,
    to: String,
}

#[derive(Serialize)]
struct Summary {
    symbol: String,
    currency: String,
    date_range: DateRange,
    latest_price: f64,
    price_change_24h: PriceChange,
    price_change_7d: PriceChange,
    price_change_30d: PriceChange,
    all_time_high: AllTimeExtreme,
    all_time_low: AllTimeExtreme,
    volatility: Volatility,
}

fn calculate_summary(prices: &[f64]) -> Summary {
    let num_points = prices.len() / 2;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let latest_price = round2(prices[(num_points - 1) * 2 + 1]);

    let price_change = |days: usize| -> PriceChange {
        if num_points <= days {
            return PriceChange {
                absolute: 0.0,
                percent: 0.0,
            };
        }
        let idx = num_points - 1 - days;
        let old_price = prices[idx * 2 + 1];
        let abs = round2(latest_price - old_price);
        let pct = round2(((latest_price - old_price) / old_price) * 100.0);
        PriceChange {
            absolute: abs,
            percent: pct,
        }
    };

    let mut ath_price = f64::NEG_INFINITY;
    let mut ath_idx = 0usize;
    let mut atl_price = f64::INFINITY;
    let mut atl_idx = 0usize;

    for i in 0..num_points {
        let p = prices[i * 2 + 1];
        if p > ath_price {
            ath_price = p;
            ath_idx = i;
        }
        if p < atl_price {
            atl_price = p;
            atl_idx = i;
        }
    }

    let days_since = |idx: usize| -> i64 {
        let ts = prices[idx * 2] as i64;
        (now_ms - ts) / 86_400_000
    };

    let daily_returns: Vec<f64> = (1..num_points)
        .map(|i| {
            let prev = prices[(i - 1) * 2 + 1];
            let curr = prices[i * 2 + 1];
            ((curr - prev) / prev * 100.0).abs()
        })
        .collect();

    let avg_return = |window: usize| -> f64 {
        if daily_returns.len() < window {
            if daily_returns.is_empty() {
                return 0.0;
            }
            return round2(daily_returns.iter().sum::<f64>() / daily_returns.len() as f64);
        }
        let slice = &daily_returns[daily_returns.len() - window..];
        round2(slice.iter().sum::<f64>() / slice.len() as f64)
    };

    Summary {
        symbol: "BTC".to_string(),
        currency: "USD".to_string(),
        date_range: DateRange {
            from: timestamp_to_date(prices[0]),
            to: timestamp_to_date(prices[(num_points - 1) * 2]),
        },
        latest_price,
        price_change_24h: price_change(1),
        price_change_7d: price_change(7),
        price_change_30d: price_change(30),
        all_time_high: AllTimeExtreme {
            price: round2(ath_price),
            date: timestamp_to_date(prices[ath_idx * 2]),
            days_since: days_since(ath_idx),
        },
        all_time_low: AllTimeExtreme {
            price: round2(atl_price),
            date: timestamp_to_date(prices[atl_idx * 2]),
            days_since: days_since(atl_idx),
        },
        volatility: Volatility {
            daily_avg: avg_return(1),
            weekly_avg: avg_return(7),
            monthly_avg: avg_return(30),
            yearly_avg: avg_return(365),
        },
    }
}

#[derive(Serialize)]
struct MaCross {
    r#type: String,
    fast_window: u32,
    slow_window: u32,
    strength: f64,
}

#[derive(Serialize)]
struct RsiDivergence {
    r#type: String,
    strength: f64,
}

#[derive(Serialize)]
struct MacdCrossover {
    direction: String,
    strength: f64,
}

#[derive(Serialize)]
struct BollingerSqueeze {
    active: bool,
    duration_days: usize,
}

#[derive(Serialize)]
struct Indicators {
    ma_cross: Option<MaCross>,
    rsi_divergence: Option<RsiDivergence>,
    macd_crossover: Option<MacdCrossover>,
    bollinger_squeeze: Option<BollingerSqueeze>,
}

#[derive(Serialize)]
struct CompositeScore {
    value: f64,
    label: String,
    confidence: f64,
}

#[derive(Serialize)]
struct SignalEntry {
    date: String,
    indicators: Indicators,
    composite_score: CompositeScore,
    recommendation: String,
}

fn calculate_signals(
    moving_averages: &[MaEntry],
    rsi: &[RsiEntry],
    macd: &[MacdEntry],
    bollinger_bands: &[BollingerEntry],
) -> Vec<SignalEntry> {
    let mut ma_by_date: HashMap<&str, &MaEntry> = HashMap::new();
    for entry in moving_averages {
        ma_by_date.insert(&entry.date, entry);
    }

    let mut rsi_by_date: HashMap<&str, &RsiEntry> = HashMap::new();
    for entry in rsi {
        rsi_by_date.insert(&entry.date, entry);
    }

    let mut macd_by_date: HashMap<&str, &MacdEntry> = HashMap::new();
    for entry in macd {
        macd_by_date.insert(&entry.date, entry);
    }

    let mut bb_by_date: HashMap<&str, &BollingerEntry> = HashMap::new();
    for entry in bollinger_bands {
        bb_by_date.insert(&entry.date, entry);
    }

    let mut all_dates: Vec<&str> = Vec::new();
    for d in ma_by_date.keys() {
        all_dates.push(d);
    }
    for d in rsi_by_date.keys() {
        all_dates.push(d);
    }
    for d in macd_by_date.keys() {
        all_dates.push(d);
    }
    for d in bb_by_date.keys() {
        all_dates.push(d);
    }
    all_dates.sort();

    let mut prev_sma50: Option<f64> = None;
    let mut prev_sma200: Option<f64> = None;
    let mut prev_histogram: Option<f64> = None;
    let mut squeeze_count: usize = 0;
    let mut results = Vec::new();

    for date in &all_dates {
        let ma = ma_by_date.get(date).copied();
        let rsi_entry = rsi_by_date.get(date).copied();
        let macd_entry = macd_by_date.get(date).copied();
        let bb = bb_by_date.get(date).copied();

        let ma_cross = if let Some(ma) = ma {
            let sma50 = ma.smas.get("sma_50").and_then(|v| *v);
            let sma200 = ma.smas.get("sma_200").and_then(|v| *v);

            let cross = if let (Some(cur50), Some(cur200), Some(p50), Some(p200)) =
                (sma50, sma200, prev_sma50, prev_sma200)
            {
                let was_above = p50 >= p200;
                let is_above = cur50 >= cur200;
                if was_above != is_above {
                    Some(MaCross {
                        r#type: if is_above {
                            "golden_cross".to_string()
                        } else {
                            "death_cross".to_string()
                        },
                        fast_window: 50,
                        slow_window: 200,
                        strength: round2((cur50 - cur200).abs() / ma.price),
                    })
                } else {
                    None
                }
            } else {
                None
            };

            if sma50.is_some() {
                prev_sma50 = sma50;
            }
            if sma200.is_some() {
                prev_sma200 = sma200;
            }
            cross
        } else {
            None
        };

        let rsi_divergence = if let Some(re) = rsi_entry {
            if re.rsi > 70.0 {
                Some(RsiDivergence {
                    r#type: "overbought".to_string(),
                    strength: round2((re.rsi - 50.0) / 50.0),
                })
            } else if re.rsi < 30.0 {
                Some(RsiDivergence {
                    r#type: "oversold".to_string(),
                    strength: round2((50.0 - re.rsi) / 50.0),
                })
            } else {
                None
            }
        } else {
            None
        };

        let macd_crossover = if let Some(me) = macd_entry {
            let cross = if let Some(ph) = prev_histogram {
                let was_pos = ph >= 0.0;
                let is_pos = me.histogram >= 0.0;
                if was_pos != is_pos {
                    Some(MacdCrossover {
                        direction: if is_pos {
                            "bullish".to_string()
                        } else {
                            "bearish".to_string()
                        },
                        strength: round2(me.histogram.abs()),
                    })
                } else {
                    None
                }
            } else {
                None
            };
            prev_histogram = Some(me.histogram);
            cross
        } else {
            None
        };

        let bollinger_squeeze = if let Some(bb_entry) = bb {
            let is_squeezed = bb_entry.bandwidth < 5.0;
            if is_squeezed {
                squeeze_count += 1;
            } else {
                squeeze_count = 0;
            }
            Some(BollingerSqueeze {
                active: is_squeezed,
                duration_days: squeeze_count,
            })
        } else {
            None
        };

        let mut score: f64 = 50.0;
        if ma_cross.is_some() {
            score += if ma_cross.as_ref().unwrap().r#type == "golden_cross" {
                20.0
            } else {
                -20.0
            };
        }
        if rsi_divergence.is_some() {
            score += if rsi_divergence.as_ref().unwrap().r#type == "oversold" {
                10.0
            } else {
                -10.0
            };
        }
        if macd_crossover.is_some() {
            score += if macd_crossover.as_ref().unwrap().direction == "bullish" {
                15.0
            } else {
                -15.0
            };
        }
        score = score.max(0.0).min(100.0);

        let confidence = round2(
            (if ma_cross.is_some() { 0.3 } else { 0.0 })
                + (if rsi_divergence.is_some() { 0.3 } else { 0.0 })
                + (if macd_crossover.is_some() { 0.3 } else { 0.0 })
                + (if bollinger_squeeze.as_ref().map_or(false, |b| b.active) {
                    0.1
                } else {
                    0.0
                }),
        );

        let (label, recommendation) = if score >= 65.0 {
            ("bullish".to_string(), "buy".to_string())
        } else if score <= 35.0 {
            ("bearish".to_string(), "sell".to_string())
        } else {
            ("neutral".to_string(), "hold".to_string())
        };

        results.push(SignalEntry {
            date: date.to_string(),
            indicators: Indicators {
                ma_cross,
                rsi_divergence,
                macd_crossover,
                bollinger_squeeze,
            },
            composite_score: CompositeScore {
                value: round2(score),
                label,
                confidence,
            },
            recommendation,
        });
    }

    results
}

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

#[napi]
pub fn calculate_all(prices: Float64Array, sma_windows: Vec<u32>) -> String {
    let cutoff_years: u32 = 9;

    let moving_averages = calculate_moving_averages(&prices, &sma_windows, cutoff_years);
    let rsi = calculate_rsi(&prices, 14, cutoff_years);
    let macd = calculate_macd(&prices, 12, 26, 9, cutoff_years);
    let bollinger_bands = calculate_bollinger_bands(&prices, 20, cutoff_years);
    let summary = calculate_summary(&prices);
    let signals = calculate_signals(&moving_averages, &rsi, &macd, &bollinger_bands);

    let result = AllResult {
        moving_averages,
        rsi,
        macd,
        bollinger_bands,
        summary,
        signals,
    };

    serde_json::to_string(&result).unwrap()
}
