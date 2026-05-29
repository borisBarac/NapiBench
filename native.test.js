import { test, expect } from "vitest";
import { createRequire } from "node:module";
import {
  calculateMovingAverages,
  calculateRSI,
  calculateMACD,
} from "./indicators.js";

const require = createRequire(import.meta.url);
const native = require("./napibench-native.node");

function makePrices(values) {
  const base = new Date("2024-01-01").getTime();
  return values.map((v, i) => [base + i * 86400000, v]);
}

test("native calculateMovingAverages returns correct SMA values", () => {
  const prices = makePrices([10, 20, 30, 40, 50]);
  const result = native.calculateMovingAverages(prices, [3], 1);

  expect(result).toHaveLength(5);
  expect(result[0].sma_3).toBeNull();
  expect(result[1].sma_3).toBeNull();
  expect(result[2].sma_3).toBe(20);
  expect(result[3].sma_3).toBe(30);
  expect(result[4].sma_3).toBe(40);
});

test("native calculateMovingAverages respects cutoffYears", () => {
  const prices = makePrices(Array.from({ length: 800 }, (_, i) => i + 1));
  const result = native.calculateMovingAverages(prices, [3], 1);

  expect(result).toHaveLength(365);
});

test("native calculateMovingAverages includes date and price", () => {
  const prices = makePrices([42.5]);
  const result = native.calculateMovingAverages(prices, [3], 1);

  expect(result[0].date).toBe("2024-01-01");
  expect(result[0].price).toBe(42.5);
});

test("native calculateMovingAverages works with multiple windows", () => {
  const prices = makePrices(Array.from({ length: 250 }, (_, i) => 100 + i));
  const result = native.calculateMovingAverages(prices, [25, 50, 100, 200], 1);

  expect(result.length).toBeGreaterThan(0);
  const last = result[result.length - 1];
  expect(last.sma_25).toBeTypeOf("number");
  expect(last.sma_50).toBeTypeOf("number");
  expect(last.sma_100).toBeTypeOf("number");
  expect(last.sma_200).toBeTypeOf("number");
});

test("native calculateRsi returns ~100 for monotonically increasing prices", () => {
  const prices = makePrices(Array.from({ length: 30 }, (_, i) => 100 + i));
  const result = native.calculateRsi(prices, 14, 1);

  for (const entry of result) {
    expect(entry.rsi).toBeGreaterThanOrEqual(99);
  }
});

test("native calculateRsi returns 0 for monotonically decreasing prices", () => {
  const prices = makePrices(Array.from({ length: 30 }, (_, i) => 200 - i));
  const result = native.calculateRsi(prices, 14, 1);

  for (const entry of result) {
    expect(entry.rsi).toBe(0);
  }
});

test("native calculateRsi returns mid-range for alternating prices", () => {
  const values = [];
  for (let i = 0; i < 40; i++) {
    values.push(i % 2 === 0 ? 100 : 101);
  }
  const prices = makePrices(values);
  const result = native.calculateRsi(prices, 14, 1);

  expect(result.length).toBeGreaterThan(0);
  for (const entry of result) {
    expect(entry.rsi).toBeGreaterThanOrEqual(40);
    expect(entry.rsi).toBeLessThanOrEqual(60);
  }
});

test("native calculateRsi respects cutoffYears", () => {
  const prices = makePrices(Array.from({ length: 800 }, (_, i) => 100 + i));
  const result = native.calculateRsi(prices, 14, 1);

  expect(result.length).toBeLessThanOrEqual(365);
});

test("native calculateMacd returns empty for insufficient data", () => {
  const prices = makePrices([100, 101, 102]);
  const result = native.calculateMacd(prices, 12, 26, 9, 1);

  expect(result).toHaveLength(0);
});

test("native calculateMacd returns correct fields", () => {
  const prices = makePrices(
    Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10)
  );
  const result = native.calculateMacd(prices, 12, 26, 9, 1);

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

test("native calculateMacd histogram equals macd minus signal", () => {
  const prices = makePrices(
    Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10)
  );
  const result = native.calculateMacd(prices, 12, 26, 9, 1);

  for (const entry of result) {
    const expected = Math.round((entry.macd - entry.signal) * 100) / 100;
    expect(Math.abs(entry.histogram - expected)).toBeLessThanOrEqual(0.02);
  }
});

test("native calculateMacd values are rounded to 2 decimals", () => {
  const prices = makePrices(
    Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10)
  );
  const result = native.calculateMacd(prices, 12, 26, 9, 1);

  for (const entry of result) {
    const macdDecimals = (entry.macd.toString().split(".")[1] || "").length;
    const signalDecimals = (entry.signal.toString().split(".")[1] || "").length;
    const histDecimals = (entry.histogram.toString().split(".")[1] || "").length;

    expect(macdDecimals).toBeLessThanOrEqual(2);
    expect(signalDecimals).toBeLessThanOrEqual(2);
    expect(histDecimals).toBeLessThanOrEqual(2);
  }
});

test("native output matches JS output for all three functions", () => {
  const prices = makePrices(
    Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i) * 10)
  );

  const jsMa = calculateMovingAverages(prices, [25, 50, 100, 200], 1);
  const rustMa = native.calculateMovingAverages(prices, [25, 50, 100, 200], 1);
  expect(rustMa).toHaveLength(jsMa.length);
  for (let i = 0; i < jsMa.length; i++) {
    expect(rustMa[i].price).toBe(jsMa[i].price);
    for (const w of [25, 50, 100, 200]) {
      expect(rustMa[i][`sma_${w}`]).toBe(jsMa[i][`sma_${w}`]);
    }
  }

  const jsRsi = calculateRSI(prices, 14, 1);
  const rustRsi = native.calculateRsi(prices, 14, 1);
  expect(rustRsi).toHaveLength(jsRsi.length);
  for (let i = 0; i < jsRsi.length; i++) {
    expect(Math.abs(rustRsi[i].rsi - jsRsi[i].rsi)).toBeLessThanOrEqual(0.01);
  }

  const jsMacd = calculateMACD(prices, 12, 26, 9, 1);
  const rustMacd = native.calculateMacd(prices, 12, 26, 9, 1);
  expect(rustMacd).toHaveLength(jsMacd.length);
  for (let i = 0; i < jsMacd.length; i++) {
    expect(Math.abs(rustMacd[i].macd - jsMacd[i].macd)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(rustMacd[i].signal - jsMacd[i].signal)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(rustMacd[i].histogram - jsMacd[i].histogram)).toBeLessThanOrEqual(0.01);
  }
});
