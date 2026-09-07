import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createShieldedResearchServer } from "../scripts/serve-shielded-reserve.mjs";
import { SHIELDED_FLAGS } from "../lib/customer_trade/shielded_reserve.mjs";
import { SHIELDED_ASSETS } from "../lib/customer_trade/shielded_route_providers.mjs";
const env = Object.fromEntries(SHIELDED_FLAGS.map(k => [k, "1"]));
const tokens = () => Object.values(SHIELDED_ASSETS).map(a => ({ assetId: a.id, decimals: a.decimals, blockchain: a.chain, symbol: a.symbol, contractAddress: a.contract, price: a.symbol === "ZEC" ? "100" : "1", priceUpdatedAt: new Date().toISOString() }));
async function withServer(fn, flags = env) {
  let requests = 0;
  const server = createShieldedResearchServer({ env: flags, provider: { tokens: async () => tokens(), quote: async intent => { requests++; return { available: true, action: intent.action, live_execution_enabled: false }; } } });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const origin = `http://127.0.0.1:${server.address().port}`;
  const status = await (await fetch(`${origin}/api/status`)).json();
  const post = (path, body, headers = {}) => fetch(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json", "x-raven-research": status.token, ...headers }, body: JSON.stringify(body) });
  try { await fn({ origin, post, status, requests: () => requests }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test("local research server blocks foreign origins and arbitrary wallet fields", () => withServer(async ({ post, requests }) => {
  const body = { action: "SHIELDED_DEPLOY", amount_usd: "100", network: "solana_usdc", maximum_delay_seconds: 600 };
  assert.equal((await post("/api/quote", body, { origin: "https://attacker.example" })).status, 403);
  assert.equal((await post("/api/quote", { ...body, recipient: "arbitrary-wallet" })).status, 400);
  assert.equal((await post("/api/quote", { ...body, viewing_key: "secret" })).status, 400);
  assert.equal(requests(), 0);
}));
test("local server has no live-execution route and no cross-origin read permission", () => withServer(async ({ post, origin }) => {
  assert.equal((await post("/api/execute", {})).status, 404);
  const r = await fetch(`${origin}/`); assert.equal(r.headers.get("access-control-allow-origin"), null);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
}));
test("local server default off cannot request quotes", () => withServer(async ({ post, status, requests }) => {
  assert.equal(status.enabled, false); assert.equal((await post("/api/quote", {})).status, 503); assert.equal(requests(), 0);
}, {}));
test("local quote and reserve transition projections work without customer infrastructure", () => withServer(async ({ post, requests }) => {
  const q = await post("/api/quote", { action: "SHIELDED_RETURN", amount_usd: "100", network: "solana_usdc", maximum_delay_seconds: 600 });
  assert.equal(q.status, 200); assert.equal((await q.json()).action, "SHIELDED_RETURN"); assert.equal(requests(), 1);
  const scenario = async state => (await post("/api/scenario", { hot_usdc: "2400", reserve_zec: "10", required_usdc: "5000", state })).json();
  const reserve = await scenario("shielded"), transit = await scenario("in_transit"), unresolved = await scenario("unresolved");
  assert.equal(reserve.total_usd_micros, "3400000000"); assert.equal(transit.total_usd_micros, reserve.total_usd_micros); assert.equal(unresolved.total_usd_micros, reserve.total_usd_micros);
  assert.equal(transit.shielded_usd_micros, "0"); assert.equal(unresolved.transit_usd_micros, "0"); assert.equal(reserve.copy.ready, false);
}));
