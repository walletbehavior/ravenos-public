import { atomicToDecimal, multiplyRatioAtomic, normalizeAtomic } from "../agentic_trading/decimal.mjs";
import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { agenticContractHash } from "../agentic_trading/hashing.mjs";
import { assertNoShieldedSecrets, assertShadowAccess, decimalMicrosFloor, feeScenarios, SHIELDED_BOUNDARY, shieldedPrivacyEvidence, verifyShieldedIntent } from "./shielded_reserve.mjs";

export const NEAR_SHADOW_ORIGIN = "https://1click.chaindefuser.com";
export const SHIELDED_ASSETS = Object.freeze({
  hyperliquid_usdc: { chain: "hypercore", decimals: 8, symbol: "USDC", id: "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054", contract: "0x6d1e7cde53ba9467b783cb7c530ce054", settlement_location: "Hyperliquid perps balance; not HyperEVM or spot" },
  zec: { chain: "zec", decimals: 8, symbol: "ZEC", id: "nep141:zec.omft.near", contract: null },
  solana_usdc: { chain: "sol", decimals: 6, symbol: "USDC", id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  solana_sol: { chain: "sol", decimals: 9, symbol: "SOL", id: "nep141:sol.omft.near", contract: null },
  base_usdc: { chain: "base", decimals: 6, symbol: "USDC", id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  base_eth: { chain: "base", decimals: 18, symbol: "ETH", id: "nep141:base.omft.near", contract: null },
  arbitrum_usdc: { chain: "arb", decimals: 6, symbol: "USDC", id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", contract: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  ethereum_usdc: { chain: "eth", decimals: 6, symbol: "USDC", id: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  avalanche_usdc: { chain: "avax", decimals: 6, symbol: "USDC", id: "nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o", contract: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e" },
});
// Public documentation/test-vector destinations. Never substitute a customer destination in this spike.
// The UA is from zcash/zcash-test-vectors, with Sapling + Orchard and NO transparent receiver.
export const SHIELDED_RESEARCH_ADDRESSES = Object.freeze({
  zec: "u1ay3aawlldjrmxqnjf5medr5ma6p3acnet464ht8lmwplq5cd3ugytcmlf96rrmtgwldc75x94qn4n8pgen36y8tywlq6yjk7lkf3fa8wzjrav8z2xpxqnrnmjxh8tmz6jhfh425t7f3vy6p4pd3zmqayq49efl2c4xydc0gszg660q9p",
  sol: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK",
  evm: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D",
});
const fixture = chain => SHIELDED_RESEARCH_ADDRESSES[chain] || SHIELDED_RESEARCH_ADDRESSES.evm;
const unavailable = (reason, extra = {}) => ({ available: false, provider: "near_1click", reason, ...extra, boundary: SHIELDED_BOUNDARY });

async function boundedJson(response, maxBytes = 512_000) {
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("provider_response_too_large");
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error("provider_response_too_large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function resolveShieldedAsset(catalog, key) {
  const expected = SHIELDED_ASSETS[key];
  if (!expected) return null;
  const matches = catalog.filter(t => t.assetId === expected.id);
  if (matches.length !== 1) return null;
  const token = matches[0];
  const contract = token.contractAddress ?? null;
  const sameContract = expected.chain === "sol" ? contract === expected.contract : contract?.toLowerCase() === expected.contract?.toLowerCase();
  if (token.blockchain !== expected.chain || token.decimals !== expected.decimals || token.symbol !== expected.symbol || !sameContract) return null;
  return { ...expected, price_usd_micros: decimalMicrosFloor(token.price), price_observed_at: token.priceUpdatedAt };
}

export function amountForUsd(asset, usdMicros) {
  return multiplyRatioAtomic(usdMicros, (10n ** BigInt(asset.decimals)).toString(), asset.price_usd_micros, "source_amount", { rounding: "ceil" });
}

export class NearIntentsShieldedProvider {
  constructor({ fetchImpl = fetch, env = {}, now = () => Date.now(), timeoutMs = 15000, verifySignature = verifyQuoteSignature } = {}) {
    this.id = "near_1click"; this.fetchImpl = fetchImpl; this.env = env; this.now = now; this.timeoutMs = timeoutMs; this.verifySignature = verifySignature;
  }
  async tokens() {
    assertShadowAccess(this.env, "STANDARD_COMPARE");
    const r = await this.fetchImpl(`${NEAR_SHADOW_ORIGIN}/v0/tokens`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
    if (!r.ok) throw new Error("provider_catalog_unavailable");
    const tokens = await boundedJson(r);
    if (!Array.isArray(tokens) || tokens.length > 5000) throw new Error("provider_catalog_invalid");
    return tokens;
  }
  capabilities(catalog) {
    return { provider: this.id, stage: "live_read_only_quotes", assets: Object.keys(SHIELDED_ASSETS).filter(k => resolveShieldedAsset(catalog, k)),
      missing_routes: { robinhood_usdc: "chain_not_listed" },
      minimum_size: null, maximum_size: null, solver_identity: null, boundary: SHIELDED_BOUNDARY };
  }
  async quote(intent, catalog) {
    const started = this.now();
    try {
      assertNoShieldedSecrets(intent); assertShadowAccess(this.env, intent.action); verifyShieldedIntent(intent, started);
      const source = resolveShieldedAsset(catalog, intent.source), destination = resolveShieldedAsset(catalog, intent.destination);
      if (!source || !destination) return unavailable("unsupported_chain_or_asset");
      if ([source, destination].some(a => !Number.isFinite(Date.parse(a.price_observed_at)) || Math.abs(started - Date.parse(a.price_observed_at)) > 600_000 || a.price_usd_micros === "0")) return unavailable("price_stale_or_unavailable");
      const request = {
        dry: true, swapType: intent.amount_mode, slippageTolerance: 100,
        originAsset: source.id, destinationAsset: destination.id, amount: intent.amount_atomic,
        depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN",
        deadline: intent.expires_at, quoteWaitingTimeMs: 3000, confidentiality: "public",
        refundTo: fixture(source.chain), recipient: fixture(destination.chain),
      };
      // Endpoint and request are closed: callers cannot turn dry off, add app fees, or submit deposits.
      const response = await this.fetchImpl(`${NEAR_SHADOW_ORIGIN}/v0/quote`, {
        method: "POST", redirect: "error", headers: { "content-type": "application/json" },
        body: JSON.stringify(request), signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = await boundedJson(response);
      const latency = this.now() - started;
      if (!response.ok) return unavailable(response.status === 429 ? "provider_rate_limited" : "provider_quote_rejected", { http_status: response.status, quote_latency_ms: latency });
      if (!this.verifySignature(body)) return unavailable("provider_signature_invalid", { quote_latency_ms: latency });
      if (!Number.isFinite(Date.parse(body.timestamp)) || Math.abs(this.now() - Date.parse(body.timestamp)) > 60000) return unavailable("provider_quote_stale");
      const echo = body.quoteRequest, q = body.quote;
      if (!q || !echo || Object.entries(request).some(([key, value]) => echo[key] !== value) || q.depositAddress || q.depositMemo) return unavailable("provider_quote_mismatch");
      verifyShieldedIntent(intent, this.now());
      const amountIn = normalizeAtomic(q.amountIn, "quote_input", { allowZero: false });
      const amountOut = normalizeAtomic(q.amountOut, "quote_output", { allowZero: false });
      const minOut = normalizeAtomic(q.minAmountOut, "quote_minimum", { allowZero: false });
      if ((intent.amount_mode === "EXACT_INPUT" ? amountIn : amountOut) !== intent.amount_atomic || BigInt(minOut) > BigInt(amountOut)) return unavailable("provider_amount_mismatch");
      const inputUsd = decimalMicrosFloor(q.amountInUsd), outputUsd = decimalMicrosFloor(q.amountOutUsd);
      if (inputUsd === "0" || outputUsd === "0") return unavailable("provider_valuation_invalid");
      const frictionPpm = ((BigInt(inputUsd) - BigInt(outputUsd)) * 1_000_000n / BigInt(inputUsd)).toString();
      if (!Number.isSafeInteger(q.timeEstimate) || q.timeEstimate < 0) return unavailable("settlement_estimate_unknown");
      const policyFailures = [];
      if (q.timeEstimate > intent.maximum_delay_seconds) policyFailures.push("maximum_delay_exceeded");
      if (BigInt(frictionPpm) > BigInt(intent.maximum_friction_bps) * 100n) policyFailures.push("maximum_friction_exceeded");
      if (BigInt(minOut) < BigInt(intent.minimum_receive_atomic)) policyFailures.push("minimum_receive_not_met");
      const apps = Array.isArray(echo.appFees) ? echo.appFees : [];
      if (apps.some(a => !Number.isSafeInteger(a.fee) || a.fee < 0 || a.fee > 10000)) return unavailable("provider_fee_invalid");
      const result = {
        available: policyFailures.length === 0, provider: this.id, reason: policyFailures[0] || null, policy_failures: policyFailures,
        intent_hash: intent.intent_hash, source: intent.source, destination: intent.destination,
        source_asset_id: source.id, destination_asset_id: destination.id,
        destination_location: destination.settlement_location || destination.chain,
        amount_in_atomic: amountIn, amount_out_atomic: amountOut, minimum_output_atomic: minOut,
        source_amount: atomicToDecimal(amountIn, source.decimals), destination_amount: atomicToDecimal(amountOut, destination.decimals),
        minimum_destination_amount: atomicToDecimal(minOut, destination.decimals), destination_symbol: destination.symbol,
        input_usd_micros: inputUsd, output_usd_micros: outputUsd, all_in_marked_friction_ppm: frictionPpm,
        gross_output_before_fees: null, solver: null, minimum_size: null, maximum_size: null,
        fee_components: { provider_injected_app_fee_bps: apps.reduce((sum, a) => sum + a.fee, 0), raven_fee_bps: 0,
          withdraw_fee_destination_atomic: q.withdrawFee == null ? null : normalizeAtomic(q.withdrawFee),
          refund_fee_source_atomic: q.refundFee == null ? null : normalizeAtomic(q.refundFee),
          solver_fee: null, network_fee_breakdown: null, fx_spread: null, privacy_premium: null,
          note: "All-in marked friction includes embedded costs. Withdraw/refund fees are not additional summed charges; refund fee applies on refund only." },
        estimated_settlement_seconds: q.timeEstimate, actual_settlement_seconds: null,
        quote_latency_ms: latency, observed_at: new Date(this.now()).toISOString(),
        provider_timestamp: body.timestamp || null, provider_quote_expiry: null,
        research_expires_at: new Date(Math.min(this.now() + 30000, Date.parse(intent.expires_at))).toISOString(),
        expiry_note: "Local 30-second research freshness; dry quote has no executable provider reservation or deposit address.",
        refund: { destination: source.chain === "zec" ? "shielded_only_research_UA" : "source_chain_research_fixture", support: "documented_conditional", guaranteed: false,
          delay_seconds: null, impossible_or_unresolved_requires_review: true },
        privacy: shieldedPrivacyEvidence(intent.action, { provider: this.id, privateUaAccepted: source.chain === "zec" || destination.chain === "zec" }),
        trust: { zcash_bridge: "proof_of_authority", settlement: "NEAR_contract_and_solvers", confidential_intents_requested: false,
          raven_custody: false, protocol_or_bridge_risk: true, provider_signature_present: typeof body.signature === "string", provider_signature_verified: true },
        hypothetical_fees: feeScenarios(inputUsd, outputUsd), boundary: SHIELDED_BOUNDARY,
      };
      return { ...result, quote_hash: agenticContractHash(result) };
    } catch (error) {
      // Provider messages can echo addresses or user input. Only controlled reason codes leave this adapter.
      const controlled = new Set(["shielded_disabled", "shielded_action_disabled", "sensitive_wallet_material_rejected", "intent_expired", "intent_integrity_invalid", "provider_response_too_large"]);
      return unavailable(error?.name === "TimeoutError" ? "provider_timeout" : controlled.has(error?.message) ? error.message : "provider_unavailable_or_invalid", { quote_latency_ms: this.now() - started });
    }
  }
}

export async function compareShieldedProviders(providers, intent, catalog) {
  // No route gets selected as an execution authorization. A future adapter implements the same interface.
  return Promise.all(providers.map(async provider => {
    try { return await provider.quote(intent, catalog); }
    catch { return { available: false, provider: provider.id, reason: "provider_unavailable", boundary: SHIELDED_BOUNDARY }; }
  }));
}
