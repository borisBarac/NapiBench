import data from "./prices.json";

Bun.serve({
  port: 3022,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/prices") return Response.json(data);
    return new Response("Not found", { status: 404 });
  },
});

console.log("Fake BTC price server running on http://localhost:3022");
