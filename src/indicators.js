export function calculateMovingAverages(prices, smaWindows, cutoffYears = 9) {
  const cutoffIndex = Math.max(0, prices.length - cutoffYears * 365);
  const movingAverages = [];
  const runningSums = new Array(smaWindows.length).fill(0);

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i][1];

    for (let wi = 0; wi < smaWindows.length; wi++) {
      const w = smaWindows[wi];
      runningSums[wi] += price;
      if (i >= w) runningSums[wi] -= prices[i - w][1];
    }

    if (i < cutoffIndex) continue;

    const entry = {
      date: new Date(prices[i][0]).toISOString().split("T")[0],
      price: Math.round(price * 100) / 100,
    };

    for (let wi = 0; wi < smaWindows.length; wi++) {
      const w = smaWindows[wi];
      entry[`sma_${w}`] = i >= w - 1 ? Math.round((runningSums[wi] / w) * 100) / 100 : null;
    }

    movingAverages.push(entry);
  }

  return movingAverages;
}

export function calculateRSI(prices, period = 14, cutoffYears = 9) {
  const cutoffIndex = Math.max(0, prices.length - cutoffYears * 365);
  const startIndex = Math.max(1, cutoffIndex);
  const results = [];

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i][1] - prices[i - 1][1]);
  }

  let avgGain = 0;
  let avgLoss = 0;

  const changeOffset = 1;
  const firstChangeIdx = Math.max(0, startIndex - 1);

  if (firstChangeIdx + period <= changes.length) {
    let gainSum = 0;
    let lossSum = 0;
    for (let i = firstChangeIdx; i < firstChangeIdx + period; i++) {
      if (changes[i] > 0) gainSum += changes[i];
      else lossSum += Math.abs(changes[i]);
    }
    avgGain = gainSum / period;
    avgLoss = lossSum / period;
  }

  for (let i = startIndex; i < prices.length; i++) {
    const changeIdx = i - changeOffset;
    if (changeIdx >= firstChangeIdx + period && changeIdx < changes.length) {
      const change = changes[changeIdx];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (changeIdx >= firstChangeIdx + period - 1) {
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = Math.round((100 - 100 / (1 + rs)) * 100) / 100;
      results.push({
        date: new Date(prices[i][0]).toISOString().split("T")[0],
        rsi,
      });
    }
  }

  return results;
}

export function calculateBollingerBands(prices, period = 20, cutoffYears = 9) {
  const cutoffIndex = Math.max(0, prices.length - cutoffYears * 365);
  const results = [];
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i][1];
    sum += price;
    sumSq += price * price;

    if (i >= period) {
      const oldPrice = prices[i - period][1];
      sum -= oldPrice;
      sumSq -= oldPrice * oldPrice;
    }

    if (i >= period - 1 && i >= cutoffIndex) {
      const mean = sum / period;
      const variance = sumSq / period - mean * mean;
      const stddev = Math.sqrt(Math.max(0, variance));

      const upper = mean + 2 * stddev;
      const lower = mean - 2 * stddev;
      const bandwidth = mean !== 0 ? round2((upper - lower) / mean * 100) : 0;
      const percentB = upper !== lower ? round2((price - lower) / (upper - lower)) : 0.5;

      results.push({
        date: new Date(prices[i][0]).toISOString().split("T")[0],
        upper: round2(upper),
        middle: round2(mean),
        lower: round2(lower),
        bandwidth,
        percent_b: percentB,
      });
    }
  }

  return results;
}

export function expandPrices(oneYearPrices, years = 10) {
  const yearMs = 365 * 24 * 3600 * 1000;
  const prices = [];
  for (let y = years - 1; y >= 0; y--) {
    for (const [ts, p] of oneYearPrices) {
      prices.push([ts - y * yearMs, p]);
    }
  }
  return prices;
}

export function expandPricesFlat(oneYearPrices, years = 10) {
  const yearMs = 365 * 24 * 3600 * 1000;
  const n = oneYearPrices.length;
  const out = new Float64Array(n * years * 2);
  let k = 0;
  for (let y = years - 1; y >= 0; y--) {
    const offset = y * yearMs;
    for (let i = 0; i < n; i++) {
      out[k++] = oneYearPrices[i][0] - offset;
      out[k++] = oneYearPrices[i][1];
    }
  }
  return out;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

export function calculateSummary(prices) {
  const formatDate = (ts) => new Date(ts).toISOString().split("T")[0];
  const now = Date.now();

  const latestPrice = round2(prices[prices.length - 1][1]);

  const priceChange = (days) => {
    const idx = prices.length - 1 - days;
    if (idx < 0) return { absolute: 0, percent: 0 };
    const oldPrice = prices[idx][1];
    const abs = round2(latestPrice - oldPrice);
    const pct = round2(((latestPrice - oldPrice) / oldPrice) * 100);
    return { absolute: abs, percent: pct };
  };

  let athPrice = -Infinity;
  let athIdx = 0;
  let atlPrice = Infinity;
  let atlIdx = 0;

  for (let i = 0; i < prices.length; i++) {
    if (prices[i][1] > athPrice) {
      athPrice = prices[i][1];
      athIdx = i;
    }
    if (prices[i][1] < atlPrice) {
      atlPrice = prices[i][1];
      atlIdx = i;
    }
  }

  const daysSince = (idx) => Math.floor((now - prices[idx][0]) / 86400000);

  const dailyReturns = [];
  for (let i = 1; i < prices.length; i++) {
    dailyReturns.push(Math.abs((prices[i][1] - prices[i - 1][1]) / prices[i - 1][1] * 100));
  }

  const avgReturn = (window) => {
    const slice = dailyReturns.slice(-window);
    if (slice.length === 0) return 0;
    return round2(slice.reduce((a, b) => a + b, 0) / slice.length);
  };

  return {
    symbol: "BTC",
    currency: "USD",
    date_range: {
      from: formatDate(prices[0][0]),
      to: formatDate(prices[prices.length - 1][0]),
    },
    latest_price: latestPrice,
    price_change_24h: priceChange(1),
    price_change_7d: priceChange(7),
    price_change_30d: priceChange(30),
    all_time_high: {
      price: round2(athPrice),
      date: formatDate(prices[athIdx][0]),
      days_since: daysSince(athIdx),
    },
    all_time_low: {
      price: round2(atlPrice),
      date: formatDate(prices[atlIdx][0]),
      days_since: daysSince(atlIdx),
    },
    volatility: {
      daily_avg: avgReturn(1),
      weekly_avg: avgReturn(7),
      monthly_avg: avgReturn(30),
      yearly_avg: avgReturn(365),
    },
  };
}

export function calculateSignals(prices, movingAverages, rsi, macd, bollingerBands) {
  const maByDate = new Map();
  for (const entry of movingAverages) maByDate.set(entry.date, entry);

  const rsiByDate = new Map();
  for (const entry of rsi) rsiByDate.set(entry.date, entry);

  const macdByDate = new Map();
  for (const entry of macd) macdByDate.set(entry.date, entry);

  const bbByDate = new Map();
  for (const entry of bollingerBands) bbByDate.set(entry.date, entry);

  const allDates = new Set([
    ...maByDate.keys(),
    ...rsiByDate.keys(),
    ...macdByDate.keys(),
    ...bbByDate.keys(),
  ]);
  const sortedDates = [...allDates].sort();

  let prevSma50 = null;
  let prevSma200 = null;
  let prevHistogram = null;
  let squeezeCount = 0;
  const results = [];

  for (const date of sortedDates) {
    const ma = maByDate.get(date);
    const rsiEntry = rsiByDate.get(date);
    const macdEntry = macdByDate.get(date);
    const bb = bbByDate.get(date);

    let maCross = null;
    if (ma && ma.sma_50 != null && ma.sma_200 != null && prevSma50 != null && prevSma200 != null) {
      const wasAbove = prevSma50 >= prevSma200;
      const isAbove = ma.sma_50 >= ma.sma_200;
      if (wasAbove !== isAbove) {
        maCross = {
          type: isAbove ? "golden_cross" : "death_cross",
          fast_window: 50,
          slow_window: 200,
          strength: round2(Math.abs(ma.sma_50 - ma.sma_200) / ma.price),
        };
      }
    }
    if (ma && ma.sma_50 != null) prevSma50 = ma.sma_50;
    if (ma && ma.sma_200 != null) prevSma200 = ma.sma_200;

    let rsiDivergence = null;
    if (rsiEntry) {
      if (rsiEntry.rsi > 70) {
        rsiDivergence = { type: "overbought", strength: round2((rsiEntry.rsi - 50) / 50) };
      } else if (rsiEntry.rsi < 30) {
        rsiDivergence = { type: "oversold", strength: round2((50 - rsiEntry.rsi) / 50) };
      }
    }

    let macdCrossover = null;
    if (macdEntry && prevHistogram != null) {
      const wasPos = prevHistogram >= 0;
      const isPos = macdEntry.histogram >= 0;
      if (wasPos !== isPos) {
        macdCrossover = {
          direction: isPos ? "bullish" : "bearish",
          strength: round2(Math.abs(macdEntry.histogram)),
        };
      }
    }
    if (macdEntry) prevHistogram = macdEntry.histogram;

    let bollingerSqueeze = null;
    if (bb) {
      const isSqueezed = bb.bandwidth < 5;
      if (isSqueezed) {
        squeezeCount++;
      } else {
        squeezeCount = 0;
      }
      bollingerSqueeze = { active: isSqueezed, duration_days: squeezeCount };
    }

    let score = 50;
    if (maCross) score += maCross.type === "golden_cross" ? 20 : -20;
    if (rsiDivergence) score += rsiDivergence.type === "oversold" ? 10 : -10;
    if (macdCrossover) score += macdCrossover.direction === "bullish" ? 15 : -15;
    score = Math.max(0, Math.min(100, score));

    const confidence = round2(
      (maCross ? 0.3 : 0) + (rsiDivergence ? 0.3 : 0) + (macdCrossover ? 0.3 : 0) + (bollingerSqueeze?.active ? 0.1 : 0)
    );

    let label, recommendation;
    if (score >= 65) { label = "bullish"; recommendation = "buy"; }
    else if (score <= 35) { label = "bearish"; recommendation = "sell"; }
    else { label = "neutral"; recommendation = "hold"; }

    results.push({
      date,
      indicators: {
        ma_cross: maCross,
        rsi_divergence: rsiDivergence,
        macd_crossover: macdCrossover,
        bollinger_squeeze: bollingerSqueeze,
      },
      composite_score: { value: round2(score), label, confidence },
      recommendation,
    });
  }

  return results;
}

function ema(values, period) {
  const k = 2 / (period + 1);
  const result = [];

  let sum = 0;
  for (let i = 0; i < period && i < values.length; i++) {
    sum += values[i];
  }

  if (values.length < period) return result;

  result.push(sum / period);

  for (let i = period; i < values.length; i++) {
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
  }

  return result;
}

export function calculateMACD(prices, fast = 12, slow = 26, signal = 9, cutoffYears = 9) {
  const closePrices = prices.map((p) => p[1]);

  const fastEma = ema(closePrices, fast);
  const slowEma = ema(closePrices, slow);

  const macdLine = [];
  const slowStart = slow - 1;
  for (let i = 0; i < fastEma.length; i++) {
    const slowIdx = i - (fast - slow);
    if (slowIdx >= 0 && slowIdx < slowEma.length) {
      macdLine.push(fastEma[i] - slowEma[slowIdx]);
    }
  }

  const signalLine = ema(macdLine, signal);

  const cutoffIndex = Math.max(0, prices.length - cutoffYears * 365);
  const results = [];

  const macdStartInPrices = slow - 1 + (fast - slow);

  for (let i = 0; i < signalLine.length; i++) {
    const priceIdx = macdStartInPrices + signal - 1 + i;
    if (priceIdx >= cutoffIndex && priceIdx < prices.length) {
      const macdVal = macdLine[macdLine.length - signalLine.length + i];
      results.push({
        date: new Date(prices[priceIdx][0]).toISOString().split("T")[0],
        macd: Math.round(macdVal * 100) / 100,
        signal: Math.round(signalLine[i] * 100) / 100,
        histogram: Math.round((macdVal - signalLine[i]) * 100) / 100,
      });
    }
  }

  return results;
}
