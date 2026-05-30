import { test, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/server.js";
import { PRICE_SERVER_PORT } from "../src/ports.config.js";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const priceData = JSON.parse(fs.readFileSync(join(__dirname, "..", "prices.json"), "utf-8"));

let fakeServer;
let app;

beforeAll(async () => {
  await new Promise((resolve) => {
    fakeServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PRICE_SERVER_PORT}`);
      if (url.pathname === "/prices") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(priceData));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    fakeServer.listen(PRICE_SERVER_PORT, resolve);
  });
  app = createServer(3033);
});

afterAll(() => {
  app.close();
  fakeServer.close();
});

test("GET /price returns moving averages and measures time", async () => {
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
});
