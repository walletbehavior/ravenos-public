import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { NearIntentsShieldedProvider, resolveShieldedAsset, amountForUsd, SHIELDED_ASSETS } from "../lib/customer_trade/shielded_route_providers.mjs";
import { SHIELDED_FLAGS, shieldedCapabilities, createShieldedIntent, decimalMicrosFloor, assertNoShieldedSecrets } from "../lib/customer_trade/shielded_reserve.mjs";
import { reserveObservation, appendShadowCapitalTransition, projectShadowCapitalTransitions, evaluateShieldedCopyCapital } from "../lib/customer_trade/shielded_portfolio.mjs";
import { createUnifiedPortfolioSnapshot } from "../lib/agentic_trading/unified_portfolio.mjs";
import { normalizeVenueIdentity, normalizeAssetIdentity } from "../lib/agentic_trading/identity.mjs";
import { decimalToAtomic, multiplyRatioAtomic } from "../lib/agentic_trading/decimal.mjs";
import { appendResearchRecord } from "./research-shielded-reserve.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../prototypes/shielded-reserve");
export function createShieldedResearchServer({ env = {}, provider = new NearIntentsShieldedProvider({ env }), journal = null } = {}) {
  const csrf = randomBytes(32).toString("hex"); let active = 0, cached = null, catalogAt = 0;
  const tokens = async () => { if (!cached || Date.now() - catalogAt > 60000) { cached = await provider.tokens(); catalogAt = Date.now(); } return cached; };
  const server = createServer(async (req, res) => {
    const address = server.address(); const origin = `http://127.0.0.1:${address.port}`;
    const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
    const reply = (status, payload, type = "application/json") => { res.writeHead(status, { ...headers, "content-type": type }); res.end(type === "application/json" ? JSON.stringify(payload) : payload); };
    if (req.headers.host !== `127.0.0.1:${address.port}`) return reply(403, { error: "loopback_host_required" });
    const path = new URL(req.url, origin).pathname;
    if (req.method === "GET" && path === "/api/status") return reply(200, { enabled: shieldedCapabilities(env).enabled, token: csrf, mode: "operator_local_prototype", live_execution_enabled: false });
    const files = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"] };
    if (req.method === "GET" && files[path]) { const [file, type] = files[path]; return reply(200, await readFile(join(root, file)), type); }
    if (req.method !== "POST" || !["/api/quote", "/api/scenario"].includes(path)) return reply(404, { error: "research_route_unavailable" });
    if (req.headers.origin !== origin || req.headers["x-raven-research"] !== csrf) return reply(403, { error: "research_origin_or_token_invalid" });
    if (!shieldedCapabilities(env).enabled) return reply(503, { error: "shielded_disabled" });
    if (active >= 2) return reply(429, { error: "research_busy" });
    active++;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2048) { reply(413, { error: "request_too_large" }); return; } chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")); assertNoShieldedSecrets(input);
      const catalog = await tokens();
      if (path === "/api/quote") {
        const allowed = new Set(["action", "amount_usd", "network", "maximum_delay_seconds"]);
        if (Object.keys(input).some(k => !allowed.has(k)) || !["SHIELDED_DEPLOY", "SHIELDED_RETURN", "SHIELDED_SEND"].includes(input.action)) return reply(400, { error: "research_fields_invalid" });
        const reverse = input.action === "SHIELDED_RETURN";
        const source = reverse ? input.network : "zec", destination = reverse ? "zec" : input.network;
        const amountAsset = resolveShieldedAsset(catalog, input.action === "SHIELDED_SEND" ? destination : source);
        if (!amountAsset || !resolveShieldedAsset(catalog, destination)) return reply(200, { available: false, reason: "unsupported_chain_or_asset" });
        const usd = decimalMicrosFloor(input.amount_usd);
        if (BigInt(usd) > 50000_000000n || usd === "0") return reply(400, { error: "research_size_out_of_range" });
        const intent = createShieldedIntent({ action: input.action, source, destination, amount_atomic: amountForUsd(amountAsset, usd),
          maximum_delay_seconds: input.maximum_delay_seconds, expires_at: new Date(Date.now() + 60000).toISOString() });
        const result = await provider.quote(intent, catalog);
        if (journal) appendResearchRecord(journal, { kind: "local_ui_quote", observed_at: new Date().toISOString(), action: intent.action, result });
        return reply(200, result);
      }
      if (Object.keys(input).some(k => !["hot_usdc", "reserve_zec", "required_usdc", "state"].includes(k)) || !["shielded", "in_transit", "unresolved"].includes(input.state)) return reply(400, { error: "scenario_fields_invalid" });
      const zec = resolveShieldedAsset(catalog, "zec"), usdc = resolveShieldedAsset(catalog, "solana_usdc");
      const stamp = Date.now(), date = new Date(stamp).toISOString();
      const hot = decimalToAtomic(input.hot_usdc, 6), reserveQty = decimalToAtomic(input.reserve_zec, 8), required = decimalToAtomic(input.required_usdc, 6);
      const reserve = reserveObservation({ account_id: "scenario-reserve", observation_id: "s0", economic_lot_id: "reserve-lot", observed_at: date,
        quantity_zatoshis: reserveQty, zec_price_usd_micros: zec.price_usd_micros, usdc_price_usd_micros: usdc.price_usd_micros });
      const venue = normalizeVenueIdentity({ slug: "public-wallet", chain_id: "solana", kind: "chain_observer", environment: "mainnet" });
      const asset = normalizeAssetIdentity({ chain_id: "solana", kind: "stablecoin", symbol: "USDC", decimals: 6, reference: SHIELDED_ASSETS.solana_usdc.contract, standard: "spl", representation: "canonical", issuer_id: "circle" });
      const portfolio = { snapshot_id: "scenario", owner_tenant_id: "local_operator_scenario", observed_at: date, accounts: [reserve.account,
        { account_id: "hot", chain_id: "solana", venue, provider: "scenario", observed_at: date }], balances: [reserve.balance,
        { observation_id: "h0", economic_lot_id: "hot-lot", account_id: "hot", asset, quantity_atomic: hot, available_atomic: hot, state: "available", capital_compartment: "public", marked_value_usdc_micros: hot, executable_value_usdc_micros: hot, valuation_state: "executable", observed_at: date }] };
      let snapshot = createUnifiedPortfolioSnapshot(portfolio);
      if (input.state !== "shielded") {
        let history = appendShadowCapitalTransition([], { id: "departure", economic_lot_id: "reserve-lot", from: "shielded", to: "in_transit", observed_at: new Date(stamp + 1).toISOString() });
        if (input.state === "unresolved") history = appendShadowCapitalTransition(history, { id: "delayed", economic_lot_id: "reserve-lot", from: "in_transit", to: "unresolved", observed_at: new Date(stamp + 2).toISOString() });
        snapshot = projectShadowCapitalTransitions(portfolio, [history]);
      }
      const value = compartment => multiplyRatioAtomic(snapshot.capital_compartments[compartment].marked_value_usdc_micros, usdc.price_usd_micros, "1000000");
      return reply(200, { public_usd_micros: value("public"), shielded_usd_micros: value("shielded"), transit_usd_micros: value("in_transit"), unresolved_usd_micros: value("unresolved"),
        total_usd_micros: multiplyRatioAtomic(snapshot.valuation.marked_assets_usdc_micros, usdc.price_usd_micros, "1000000"), zec_price_usd_micros: zec.price_usd_micros,
        copy: evaluateShieldedCopyCapital(snapshot, { location: { chain_id: asset.chain_id, venue_id: venue.venue_id, asset_id: asset.asset_id }, required_atomic: required, maximum_latency_ms: 1000, deployment_estimate_seconds: 452 }),
        scenario_only: true, actual_wallet_connected: false });
    } catch { return reply(400, { error: "research_request_invalid_or_provider_unavailable" }); }
    finally { active--; }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const enabled = process.argv.includes("--enable-shadow");
  const env = Object.fromEntries(SHIELDED_FLAGS.map(k => [k, enabled ? "1" : "0"]));
  const server = createShieldedResearchServer({ env });
  server.listen(Number(process.env.RAVEN_SHIELDED_RESEARCH_PORT || 4387), "127.0.0.1", () => process.stdout.write(`Raven Capital research: http://127.0.0.1:${server.address().port} · live execution hard-disabled\n`));
}
