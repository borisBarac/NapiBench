use serde::Serialize;

use crate::indicators::{BollingerEntry, MaEntry, MacdEntry, RsiEntry};
use crate::utils::{format_date, round2};

#[derive(Serialize)]
pub struct MaCross {
    pub r#type: &'static str,
    pub fast_window: u32,
    pub slow_window: u32,
    pub strength: f64,
}

#[derive(Serialize)]
pub struct RsiDivergence {
    pub r#type: &'static str,
    pub strength: f64,
}

#[derive(Serialize)]
pub struct MacdCrossover {
    pub direction: &'static str,
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
    pub label: &'static str,
    pub confidence: f64,
}

pub struct SignalEntry {
    pub date_ts: i64,
    pub indicators: Indicators,
    pub composite_score: CompositeScore,
    pub recommendation: &'static str,
}

impl Serialize for SignalEntry {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("SignalEntry", 4)?;
        s.serialize_field("date", &format_date(self.date_ts))?;
        s.serialize_field("indicators", &self.indicators)?;
        s.serialize_field("composite_score", &self.composite_score)?;
        s.serialize_field("recommendation", &self.recommendation)?;
        s.end()
    }
}

pub fn calculate_signals(
    ma_sma_keys: &[String],
    moving_averages: &[MaEntry],
    rsi: &[RsiEntry],
    macd: &[MacdEntry],
    bollinger_bands: &[BollingerEntry],
) -> Vec<SignalEntry> {
    let sma50_idx = ma_sma_keys.iter().position(|k| k == "sma_50");
    let sma200_idx = ma_sma_keys.iter().position(|k| k == "sma_200");

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
        let ma_ts = moving_averages.get(ma_i).map(|e| e.date_ts);
        let rsi_ts = rsi.get(rsi_i).map(|e| e.date_ts);
        let macd_ts = macd.get(macd_i).map(|e| e.date_ts);
        let bb_ts = bollinger_bands.get(bb_i).map(|e| e.date_ts);

        let date_ts = match [ma_ts, rsi_ts, macd_ts, bb_ts]
            .iter()
            .filter_map(|&t| t)
            .min()
        {
            Some(t) => t,
            None => break,
        };

        let ma = if ma_ts == Some(date_ts) {
            let e = &moving_averages[ma_i];
            ma_i += 1;
            Some(e)
        } else {
            None
        };
        let rsi_entry = if rsi_ts == Some(date_ts) {
            let e = &rsi[rsi_i];
            rsi_i += 1;
            Some(e)
        } else {
            None
        };
        let macd_entry = if macd_ts == Some(date_ts) {
            let e = &macd[macd_i];
            macd_i += 1;
            Some(e)
        } else {
            None
        };
        let bb = if bb_ts == Some(date_ts) {
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
                                "golden_cross"
                            } else {
                                "death_cross"
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
                    r#type: "overbought",
                    strength: round2((re.rsi - 50.0) / 50.0),
                })
            } else if re.rsi < 30.0 {
                Some(RsiDivergence {
                    r#type: "oversold",
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
                            "bullish"
                        } else {
                            "bearish"
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
            score += match mc.r#type {
                "golden_cross" => 20.0,
                _ => -20.0,
            };
        }
        if let Some(ref rd) = rsi_divergence {
            score += match rd.r#type {
                "oversold" => 10.0,
                _ => -10.0,
            };
        }
        if let Some(ref mc) = macd_crossover {
            score += match mc.direction {
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

        let (label, recommendation): (&'static str, &'static str) = if score >= 65.0 {
            ("bullish", "buy")
        } else if score <= 35.0 {
            ("bearish", "sell")
        } else {
            ("neutral", "hold")
        };

        results.push(SignalEntry {
            date_ts,
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
