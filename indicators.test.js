import { test, expect } from "vitest";
import {
  calculateMovingAverages,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateSummary,
  calculateSignals,
} from "./indicators.js";

function makePrices(values) {
  const base = new Date("2024-01-01").getTime();
  return values.map((v, i) => [base + i * 86400000, v]);
}

test("calculateMovingAverages returns correct SMA values", () => {
  const prices = makePrices([10, 20, 30, 40, 50]);
  const result = calculateMovingAverages(prices, [3], 1);

  expect(result).toHaveLength(5);

  expect(result[0].sma_3).toBeNull();

  expect(result[1].sma_3).toBeNull();

  expect(result[2].sma_3).toBe(20);
  expect(result[3].sma_3).toBe(30);
  expect(result[4].sma_3).toBe(40);
});

test("calculateMovingAverages respects cutoffYears", () => {
  const prices = makePrices(Array.from({ length: 800 }, (_, i) => i + 1));
  const result = calculateMovingAverages(prices, [3], 1);

  expect(result).toHaveLength(365);
});

test("calculateMovingAverages includes date and price", () => {
  const prices = makePrices([42.5]);
  const result = calculateMovingAverages(prices, [3], 1);

  expect(result[0].date).toBe("2024-01-01");
  expect(result[0].price).toBe(42.5);
});

test("calculateRSI returns ~100 for monotonically increasing prices", () => {
  const prices = makePrices(Array.from({ length: 30 }, (_, i) => 100 + i));
  const result = calculateRSI(prices, 14, 1);

  for (const entry of result) {
    expect(entry.rsi).toBeGreaterThanOrEqual(99);
  }
});

test("calculateRSI returns 0 for monotonically decreasing prices", () => {
  const prices = makePrices(Array.from({ length: 30 }, (_, i) => 200 - i));
  const result = calculateRSI(prices, 14, 1);

  for (const entry of result) {
    expect(entry.rsi).toBe(0);
  }
});

test("calculateRSI returns mid-range for alternating prices", () => {
  const values = [];
  for (let i = 0; i < 40; i++) {
    values.push(i % 2 === 0 ? 100 : 101);
  }
  const prices = makePrices(values);
  const result = calculateRSI(prices, 14, 1);

  expect(result.length).toBeGreaterThan(0);
  for (const entry of result) {
    expect(entry.rsi).toBeGreaterThanOrEqual(40);
    expect(entry.rsi).toBeLessThanOrEqual(60);
  }
});

test("calculateRSI respects cutoffYears", () => {
  const prices = makePrices(Array.from({ length: 800 }, (_, i) => 100 + i));
  const result = calculateRSI(prices, 14, 1);

  expect(result.length).toBeLessThanOrEqual(365);
});

test("calculateRSI includes date field", () => {
  const prices = makePrices(Array.from({ length: 30 }, (_, i) => 100 + i));
  const result = calculateRSI(prices, 14, 1);

  expect(result[0].date).toBeTypeOf("string");
  expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("calculateMACD returns empty for insufficient data", () => {
  const prices = makePrices([100, 101, 102]);
  const result = calculateMACD(prices, 12, 26, 9, 1);

  expect(result).toHaveLength(0);
});

test("calculateMACD returns correct fields", () => {
  const prices = makePrices(
    Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10)
  );
  const result = calculateMACD(prices, 12, 26, 9, 1);

  expect(result.length).toBeGreaterThan(0);
  for (const entry of result) {
    expect(entry).toHaveProperty("date");
    expect(entry).toHaveProperty("macd");
    expect(entry).toHaveProperty("signal");
    expect(entry).toHaveProperty("histogram");
    expect(typeof entry.macd).toBe("number");
    expect(typeof entry.signal).toBe("number");
    expect(typeof entry.histogram).toBe("number");
  }
});

test("calculateMACD histogram equals macd minus signal", () => {
  const prices = makePrices(
    Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10)
  );
  const result = calculateMACD(prices, 12, 26, 9, 1);

  for (const entry of result) {
    const expected = Math.round((entry.macd - entry.signal) * 100) / 100;
    expect(Math.abs(entry.histogram - expected)).toBeLessThanOrEqual(0.02);
  }
});

test("calculateMACD values are rounded to 2 decimals", () => {
  const prices = makePrices(
    Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10)
  );
  const result = calculateMACD(prices, 12, 26, 9, 1);

  for (const entry of result) {
    const macdDecimals = (entry.macd.toString().split(".")[1] || "").length;
    const signalDecimals = (entry.signal.toString().split(".")[1] || "").length;
    const histDecimals = (entry.histogram.toString().split(".")[1] || "").length;

    expect(macdDecimals).toBeLessThanOrEqual(2);
    expect(signalDecimals).toBeLessThanOrEqual(2);
    expect(histDecimals).toBeLessThanOrEqual(2);
  }
});

test("calculateMACD respects cutoffYears", () => {
  const prices = makePrices(
    Array.from({ length: 800 }, (_, i) => 100 + Math.sin(i) * 10)
  );
  const result = calculateMACD(prices, 12, 26, 9, 1);

  expect(result.length).toBeLessThanOrEqual(365);
});

test("calculateBollingerBands returns correct band structure", () => {
  const prices = makePrices(Array.from({ length: 30 }, (_, i) => 100 + i));
  const result = calculateBollingerBands(prices, 20, 1);

  expect(result.length).toBeGreaterThan(0);
  for (const entry of result) {
    expect(entry.upper).toBeGreaterThan(entry.middle);
    expect(entry.middle).toBeGreaterThan(entry.lower);
    expect(entry.bandwidth).toBeGreaterThan(0);
    expect(entry.percent_b).toBeGreaterThanOrEqual(0);
    expect(entry.percent_b).toBeLessThanOrEqual(1);
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});

test("calculateBollingerBands skips entries with insufficient data", () => {
  const prices = makePrices([100, 101, 102, 103, 104]);
  const result = calculateBollingerBands(prices, 20, 1);
  expect(result).toHaveLength(0);
});

test("calculateBollingerBands respects cutoffYears", () => {
  const prices = makePrices(Array.from({ length: 800 }, (_, i) => 100 + i));
  const result = calculateBollingerBands(prices, 20, 1);
  expect(result.length).toBeLessThanOrEqual(365);
});

test("calculateSummary returns all nested fields", () => {
  const prices = makePrices(Array.from({ length: 100 }, (_, i) => 100 + i));
  const result = calculateSummary(prices);

  expect(result.symbol).toBe("BTC");
  expect(result.currency).toBe("USD");
  expect(result.date_range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(result.date_range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(typeof result.latest_price).toBe("number");
  expect(typeof result.price_change_24h.absolute).toBe("number");
  expect(typeof result.price_change_24h.percent).toBe("number");
  expect(typeof result.price_change_7d.absolute).toBe("number");
  expect(typeof result.price_change_7d.percent).toBe("number");
  expect(typeof result.price_change_30d.absolute).toBe("number");
  expect(typeof result.price_change_30d.percent).toBe("number");
  expect(result.all_time_high.price).toBeGreaterThan(0);
  expect(result.all_time_high.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(typeof result.all_time_high.days_since).toBe("number");
  expect(result.all_time_low.price).toBeGreaterThan(0);
  expect(result.all_time_low.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(typeof result.all_time_low.days_since).toBe("number");
  expect(typeof result.volatility.daily_avg).toBe("number");
  expect(typeof result.volatility.weekly_avg).toBe("number");
  expect(typeof result.volatility.monthly_avg).toBe("number");
  expect(typeof result.volatility.yearly_avg).toBe("number");
});

test("calculateSummary finds correct ATH and ATL", () => {
  const prices = makePrices([200, 50, 300, 10, 150]);
  const result = calculateSummary(prices);
  expect(result.all_time_high.price).toBe(300);
  expect(result.all_time_low.price).toBe(10);
});

test("calculateSignals returns correct nested structure", () => {
  const prices = makePrices(Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i) * 10));
  const ma = calculateMovingAverages(prices, [25, 50, 100, 200], 1);
  const rsi = calculateRSI(prices, 14, 1);
  const macd = calculateMACD(prices, 12, 26, 9, 1);
  const bb = calculateBollingerBands(prices, 20, 1);
  const result = calculateSignals(prices, ma, rsi, macd, bb);

  expect(result.length).toBeGreaterThan(0);
  for (const entry of result) {
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.indicators).toHaveProperty("ma_cross");
    expect(entry.indicators).toHaveProperty("rsi_divergence");
    expect(entry.indicators).toHaveProperty("macd_crossover");
    expect(entry.indicators).toHaveProperty("bollinger_squeeze");
    expect(entry.composite_score.value).toBeGreaterThanOrEqual(0);
    expect(entry.composite_score.value).toBeLessThanOrEqual(100);
    expect(["bullish", "bearish", "neutral"]).toContain(entry.composite_score.label);
    expect(entry.composite_score.confidence).toBeGreaterThanOrEqual(0);
    expect(["buy", "sell", "hold"]).toContain(entry.recommendation);
  }
});

test("calculateSignals handles null optional fields", () => {
  const prices = makePrices(Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i) * 10));
  const ma = calculateMovingAverages(prices, [25, 50, 100, 200], 1);
  const rsi = calculateRSI(prices, 14, 1);
  const macd = calculateMACD(prices, 12, 26, 9, 1);
  const bb = calculateBollingerBands(prices, 20, 1);
  const result = calculateSignals(prices, ma, rsi, macd, bb);

  const hasNullMaCross = result.some((e) => e.indicators.ma_cross === null);
  const hasNullRsi = result.some((e) => e.indicators.rsi_divergence === null);
  const hasNullMacd = result.some((e) => e.indicators.macd_crossover === null);
  expect(hasNullMaCross).toBe(true);
  expect(hasNullRsi).toBe(true);
  expect(hasNullMacd).toBe(true);
});
