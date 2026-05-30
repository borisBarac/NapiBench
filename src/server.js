import { createRequire } from "node:module";
import express from "express";
import { calculateMovingAverages, calculateRSI, calculateMACD, calculateBollingerBands, calculateSummary, calculateSignals, expandPrices, expandPricesFlat } from "./indicators.js";
import { PRICE_SERVER_PORT, APP_SERVER_PORT } from "./ports.config.js";

const require = createRequire(import.meta.url);
const native = require("../napibench-native.node");

export function getTimeRange() {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 365 * 24 * 3600;
  return { from, to };
}

export { expandPrices, expandPricesFlat };

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
      const bollingerBands = calculateBollingerBands(prices);
      const summary = calculateSummary(prices);
      const signals = calculateSignals(prices, movingAverages, rsi, macd, bollingerBands);

      res.json({ data_points: prices.length, summary, moving_averages: movingAverages, rsi, macd, bollinger_bands: bollingerBands, signals });
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
      const n = body.prices.length;
      const oneYearFlat = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        oneYearFlat[i * 2] = body.prices[i][0];
        oneYearFlat[i * 2 + 1] = body.prices[i][1];
      }
      const rustResult = native.calculateAllFromRawHttp(oneYearFlat, n, 10, [25, 50, 100, 200]);
      res.type('json').send(rustResult);
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
