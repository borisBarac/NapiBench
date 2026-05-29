import data from "./prices.json";
import { PRICE_SERVER_PORT } from "./ports.config.js";

Bun.serve({
  port: PRICE_SERVER_PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/prices") return Response.json(data);
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Fake BTC price server running on http://localhost:${PRICE_SERVER_PORT}`);
