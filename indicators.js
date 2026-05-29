export function calculateMovingAverages(prices, smaWindows, cutoffYears = 9) {
  const cutoffIndex = Math.max(0, prices.length - cutoffYears * 365);
  const movingAverages = [];

  for (let i = cutoffIndex; i < prices.length; i++) {
    const entry = {
      date: new Date(prices[i][0]).toISOString().split("T")[0],
      price: Math.round(prices[i][1] * 100) / 100,
    };

    for (const w of smaWindows) {
      const start = i - w + 1;
      if (start >= 0) {
        let sum = 0;
        for (let j = start; j <= i; j++) sum += prices[j][1];
        entry[`sma_${w}`] = Math.round((sum / w) * 100) / 100;
      } else {
        entry[`sma_${w}`] = null;
      }
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
