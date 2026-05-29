import { test, expect } from "vitest";
import { createServer } from "./index.js";

test("GET /price returns moving averages and measures time", async () => {
  const server = createServer(3033);

  const start = performance.now();
  const res = await fetch("http://localhost:3033/price");
  const elapsed = performance.now() - start;

  console.log(`\nRequest completed in ${elapsed.toFixed(2)}ms`);

  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.data_points).toBeGreaterThan(0);
  expect(Array.isArray(body.moving_averages)).toBe(true);
  expect(body.moving_averages.length).toBeGreaterThan(0);

  const first = body.moving_averages[0];
  expect(first).toHaveProperty("date");
  expect(first).toHaveProperty("price");
  expect(first).toHaveProperty("sma_25");
  expect(first).toHaveProperty("sma_50");
  expect(first).toHaveProperty("sma_100");
  expect(first).toHaveProperty("sma_200");

  console.log(`Data points: ${body.data_points}`);
  console.log(`Moving average entries: ${body.moving_averages.length}`);

  expect(body.summary).toBeDefined();
  expect(body.summary.symbol).toBe("BTC");
  expect(body.summary.date_range.from).toBeDefined();
  expect(body.summary.volatility).toBeDefined();

  expect(Array.isArray(body.bollinger_bands)).toBe(true);
  expect(body.bollinger_bands.length).toBeGreaterThan(0);

  expect(Array.isArray(body.signals)).toBe(true);
  expect(body.signals.length).toBeGreaterThan(0);
  expect(body.signals[0].indicators).toBeDefined();
  expect(body.signals[0].composite_score).toBeDefined();
  expect(["buy", "sell", "hold"]).toContain(body.signals[0].recommendation);

  server.close();
});
