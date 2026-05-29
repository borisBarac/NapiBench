import { createRequire } from "node:module";
import express from "express";
import { calculateMovingAverages, calculateRSI, calculateMACD } from "./indicators.js";
import { PRICE_SERVER_PORT, APP_SERVER_PORT } from "./ports.config.js";

const require = createRequire(import.meta.url);
const native = require("./napibench-native.node");

export function getTimeRange() {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 365 * 24 * 3600;
  return { from, to };
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

export function createServer(port = APP_SERVER_PORT) {
  const app = express();

  app.get("/price", async (req, res) => {
    try {
      const apiRes = await fetch(`http://localhost:${PRICE_SERVER_PORT}/prices`);

      if (!apiRes.ok) {
        return res.status(503).json({
          error: "Failed to fetch from fake price server",
          status: apiRes.status,
        });
      }

      const body = await apiRes.json();
      const prices = expandPrices(body.prices);
      const movingAverages = calculateMovingAverages(prices, [25, 50, 100, 200]);
      const rsi = calculateRSI(prices);
      const macd = calculateMACD(prices);

      res.json({ data_points: prices.length, moving_averages: movingAverages, rsi, macd });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/price-rust", async (req, res) => {
    try {
      const apiRes = await fetch(`http://localhost:${PRICE_SERVER_PORT}/prices`);

      if (!apiRes.ok) {
        return res.status(503).json({
          error: "Failed to fetch from fake price server",
          status: apiRes.status,
        });
      }

      const body = await apiRes.json();
      const prices = expandPrices(body.prices);
      const movingAverages = native.calculateMovingAverages(prices, [25, 50, 100, 200]);
      const rsi = native.calculateRsi(prices);
      const macd = native.calculateMacd(prices);

      res.json({ data_points: prices.length, moving_averages: movingAverages, rsi, macd });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  return server;
};

createServer(parseInt(process.env.PORT || String(APP_SERVER_PORT), 10));
