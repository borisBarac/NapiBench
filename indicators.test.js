import { test, expect } from "vitest";
import {
  calculateMovingAverages,
  calculateRSI,
  calculateMACD,
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
