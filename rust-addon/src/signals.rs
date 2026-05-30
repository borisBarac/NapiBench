use serde::Serialize;

use crate::indicators::{BollingerEntry, MaEntry, MacdEntry, RsiEntry};
use crate::utils::round2;

#[derive(Serialize)]
pub struct MaCross {
    pub r#type: String,
    pub fast_window: u32,
    pub slow_window: u32,
    pub strength: f64,
}

#[derive(Serialize)]
pub struct RsiDivergence {
    pub r#type: String,
    pub strength: f64,
}

#[derive(Serialize)]
pub struct MacdCrossover {
    pub direction: String,
    pub strength: f64,
}

#[derive(Serialize)]
pub struct BollingerSqueeze {
    pub active: bool,
    pub duration_days: usize,
}

#[derive(Serialize)]
pub struct Indicators {
    pub ma_cross: Option<MaCross>,
    pub rsi_divergence: Option<RsiDivergence>,
    pub macd_crossover: Option<MacdCrossover>,
    pub bollinger_squeeze: Option<BollingerSqueeze>,
}

#[derive(Serialize)]
pub struct CompositeScore {
    pub value: f64,
    pub label: String,
    pub confidence: f64,
}

#[derive(Serialize)]
pub struct SignalEntry {
    pub date: String,
    pub indicators: Indicators,
    pub composite_score: CompositeScore,
    pub recommendation: String,
}

pub fn calculate_signals(
    moving_averages: &[MaEntry],
    rsi: &[RsiEntry],
    macd: &[MacdEntry],
    bollinger_bands: &[BollingerEntry],
) -> Vec<SignalEntry> {
    let sma50_idx = moving_averages
        .first()
        .and_then(|e| e.sma_keys.iter().position(|k| k == "sma_50"));
    let sma200_idx = moving_averages
        .first()
        .and_then(|e| e.sma_keys.iter().position(|k| k == "sma_200"));

    let mut ma_i = 0usize;
    let mut rsi_i = 0usize;
    let mut macd_i = 0usize;
    let mut bb_i = 0usize;

    let mut prev_sma50: Option<f64> = None;
    let mut prev_sma200: Option<f64> = None;
    let mut prev_histogram: Option<f64> = None;
    let mut squeeze_count: usize = 0;
    let mut results = Vec::new();

    loop {
        let ma_date = moving_averages.get(ma_i).map(|e| e.date.as_str());
        let rsi_date = rsi.get(rsi_i).map(|e| e.date.as_str());
        let macd_date = macd.get(macd_i).map(|e| e.date.as_str());
        let bb_date = bollinger_bands.get(bb_i).map(|e| e.date.as_str());

        let date = match [ma_date, rsi_date, macd_date, bb_date]
            .iter()
            .filter_map(|&d| d)
            .min()
        {
            Some(d) => d,
            None => break,
        };

        let ma = if ma_date == Some(date) {
            let e = &moving_averages[ma_i];
            ma_i += 1;
            Some(e)
        } else {
            None
        };
        let rsi_entry = if rsi_date == Some(date) {
            let e = &rsi[rsi_i];
            rsi_i += 1;
            Some(e)
        } else {
            None
        };
        let macd_entry = if macd_date == Some(date) {
            let e = &macd[macd_i];
            macd_i += 1;
            Some(e)
        } else {
            None
        };
        let bb = if bb_date == Some(date) {
            let e = &bollinger_bands[bb_i];
            bb_i += 1;
            Some(e)
        } else {
            None
        };

        let ma_cross = if let Some(ma) = ma {
            let sma50 = sma50_idx.and_then(|idx| ma.sma_values[idx]);
            let sma200 = sma200_idx.and_then(|idx| ma.sma_values[idx]);

            let cross =
                if let (Some(cur50), Some(cur200), Some(p50), Some(p200)) =
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
        if let Some(ref mc) = ma_cross {
            score += match mc.r#type.as_str() {
                "golden_cross" => 20.0,
                _ => -20.0,
            };
        }
        if let Some(ref rd) = rsi_divergence {
            score += match rd.r#type.as_str() {
                "oversold" => 10.0,
                _ => -10.0,
            };
        }
        if let Some(ref mc) = macd_crossover {
            score += match mc.direction.as_str() {
                "bullish" => 15.0,
                _ => -15.0,
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
