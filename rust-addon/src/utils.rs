pub fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

pub fn format_date(ts: i64) -> String {
    let days_since_epoch = ts / 86400000;
    let z = days_since_epoch + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

pub fn precompute_dates(prices: &[f64]) -> Vec<i64> {
    let num_points = prices.len() / 2;
    (0..num_points)
        .map(|i| prices[i * 2] as i64)
        .collect()
}
