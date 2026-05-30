use serde::ser::{SerializeStruct, Serializer};
use serde::Serialize;

use crate::utils::{format_date, round2};

#[cfg(not(feature = "wasm"))]
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(feature = "wasm")]
fn now_ms() -> i64 {
    js_sys::Date::now() as i64
}

pub(crate) struct PriceChange {
    absolute: f64,
    percent: f64,
}

impl Serialize for PriceChange {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("PriceChange", 2)?;
        s.serialize_field("absolute", &self.absolute)?;
        s.serialize_field("percent", &self.percent)?;
        s.end()
    }
}

pub(crate) struct AllTimeExtreme {
    price: f64,
    date_ts: i64,
    days_since: i64,
}

impl Serialize for AllTimeExtreme {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("AllTimeExtreme", 3)?;
        s.serialize_field("price", &self.price)?;
        s.serialize_field("date", &format_date(self.date_ts))?;
        s.serialize_field("days_since", &self.days_since)?;
        s.end()
    }
}

pub(crate) struct Volatility {
    daily_avg: f64,
    weekly_avg: f64,
    monthly_avg: f64,
    yearly_avg: f64,
}

impl Serialize for Volatility {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("Volatility", 4)?;
        s.serialize_field("daily_avg", &self.daily_avg)?;
        s.serialize_field("weekly_avg", &self.weekly_avg)?;
        s.serialize_field("monthly_avg", &self.monthly_avg)?;
        s.serialize_field("yearly_avg", &self.yearly_avg)?;
        s.end()
    }
}

pub(crate) struct DateRange {
    from_ts: i64,
    to_ts: i64,
}

impl Serialize for DateRange {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("DateRange", 2)?;
        s.serialize_field("from", &format_date(self.from_ts))?;
        s.serialize_field("to", &format_date(self.to_ts))?;
        s.end()
    }
}

pub struct Summary {
    pub symbol: String,
    pub currency: String,
    pub date_range: DateRange,
    pub latest_price: f64,
    pub price_change_24h: PriceChange,
    pub price_change_7d: PriceChange,
    pub price_change_30d: PriceChange,
    pub all_time_high: AllTimeExtreme,
    pub all_time_low: AllTimeExtreme,
    pub volatility: Volatility,
}

impl Serialize for Summary {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("Summary", 9)?;
        s.serialize_field("symbol", &self.symbol)?;
        s.serialize_field("currency", &self.currency)?;
        s.serialize_field("date_range", &self.date_range)?;
        s.serialize_field("latest_price", &self.latest_price)?;
        s.serialize_field("price_change_24h", &self.price_change_24h)?;
        s.serialize_field("price_change_7d", &self.price_change_7d)?;
        s.serialize_field("price_change_30d", &self.price_change_30d)?;
        s.serialize_field("all_time_high", &self.all_time_high)?;
        s.serialize_field("all_time_low", &self.all_time_low)?;
        s.serialize_field("volatility", &self.volatility)?;
        s.end()
    }
}

pub fn calculate_summary(prices: &[f64], dates: &[i64]) -> Summary {
    let num_points = prices.len() / 2;
    let now_ms = now_ms();

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

    let max_window = 365usize.min(num_points - 1);
    let mut ring = vec![0.0f64; max_window];
    let mut ring_pos = 0usize;
    let mut ring_filled = 0usize;
    let mut window_sums = [0.0f64; 4];
    let window_sizes = [1usize, 7, 30, 365];

    for i in 1..num_points {
        let prev = prices[(i - 1) * 2 + 1];
        let curr = prices[i * 2 + 1];
        let ret = ((curr - prev) / prev * 100.0).abs();

        if ring_filled >= max_window {
            for (wi, &ws) in window_sizes.iter().enumerate() {
                if ring_filled >= ws {
                    let old_idx = (ring_pos + max_window - ws) % max_window;
                    window_sums[wi] -= ring[old_idx];
                }
            }
        }

        ring[ring_pos] = ret;
        for (wi, &_ws) in window_sizes.iter().enumerate() {
            if ring_filled + 1 >= window_sizes[wi] {
                window_sums[wi] += ret;
            }
        }

        ring_pos = (ring_pos + 1) % max_window;
        ring_filled = ring_filled + 1;

        if ring_filled >= max_window {
            break;
        }
    }

    for i in (max_window + 1)..num_points {
        let prev = prices[(i - 1) * 2 + 1];
        let curr = prices[i * 2 + 1];
        let ret = ((curr - prev) / prev * 100.0).abs();

        for (wi, &ws) in window_sizes.iter().enumerate() {
            let old_idx = (ring_pos + max_window - ws) % max_window;
            window_sums[wi] -= ring[old_idx];
        }

        ring[ring_pos] = ret;
        for (wi, &_ws) in window_sizes.iter().enumerate() {
            window_sums[wi] += ret;
        }

        ring_pos = (ring_pos + 1) % max_window;
    }

    let avg_return = |wi: usize| -> f64 {
        let ws = window_sizes[wi].min(ring_filled);
        if ws == 0 {
            return 0.0;
        }
        round2(window_sums[wi] / ws as f64)
    };

    Summary {
        symbol: "BTC".to_string(),
        currency: "USD".to_string(),
        date_range: DateRange {
            from_ts: dates[0],
            to_ts: dates[num_points - 1],
        },
        latest_price,
        price_change_24h: price_change(1),
        price_change_7d: price_change(7),
        price_change_30d: price_change(30),
        all_time_high: AllTimeExtreme {
            price: round2(ath_price),
            date_ts: dates[ath_idx],
            days_since: days_since(ath_idx),
        },
        all_time_low: AllTimeExtreme {
            price: round2(atl_price),
            date_ts: dates[atl_idx],
            days_since: days_since(atl_idx),
        },
        volatility: Volatility {
            daily_avg: avg_return(0),
            weekly_avg: avg_return(1),
            monthly_avg: avg_return(2),
            yearly_avg: avg_return(3),
        },
    }
}
