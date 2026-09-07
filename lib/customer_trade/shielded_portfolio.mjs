import { normalizeAssetIdentity, normalizeVenueIdentity } from "../agentic_trading/identity.mjs";
import { createUnifiedPortfolioSnapshot, verifyUnifiedPortfolioSnapshot, inspectLocalCapital } from "../agentic_trading/unified_portfolio.mjs";
import { agenticContractHash } from "../agentic_trading/hashing.mjs";
import { normalizeAtomic } from "../agentic_trading/decimal.mjs";
import { assertNoShieldedSecrets, valueZec, usdToUsdcEquivalent } from "./shielded_reserve.mjs";

export const RESERVE_ASSET = normalizeAssetIdentity({ chain_id: "zcash:mainnet", kind: "native", standard: "native", reference: "zec", symbol: "ZEC", decimals: 8 });
export const RESERVE_VENUE = normalizeVenueIdentity({ slug: "external-shielded-wallet", chain_id: "zcash:mainnet", kind: "chain_observer", environment: "mainnet", capabilities: ["shadow_observe"] });

export function reserveObservation(input) {
  assertNoShieldedSecrets(input);
  const quantity = input.quantity_zatoshis == null ? null : normalizeAtomic(input.quantity_zatoshis);
  const usd = quantity === null || input.zec_price_usd_micros == null ? null : valueZec(quantity, input.zec_price_usd_micros);
  const equivalent = usd === null || input.usdc_price_usd_micros == null ? null : usdToUsdcEquivalent(usd, input.usdc_price_usd_micros);
  return {
    account: { account_id: input.account_id, chain_id: RESERVE_ASSET.chain_id, venue: RESERVE_VENUE, custody_type: "external_user_controlled",
      connection_state: "research_observation_only", observed_at: input.observed_at, provider: "external_wallet_unverified", finality: "unverified" },
    balance: { observation_id: input.observation_id, economic_lot_id: input.economic_lot_id, account_id: input.account_id,
      chain_id: RESERVE_ASSET.chain_id, venue_id: RESERVE_VENUE.venue_id, asset: RESERVE_ASSET,
      quantity_atomic: quantity, available_atomic: "0", capital_compartment: "shielded", state: "unavailable",
      marked_value_usdc_micros: equivalent, executable_value_usdc_micros: "0", valuation_state: equivalent === null ? "unknown" : "marked",
      observed_at: input.observed_at },
    valuation: { asset: "ZEC", quantity_zatoshis: quantity, marked_value_usd_micros: usd, marked_usdc_equivalent_micros: equivalent,
      usdc_price_usd_micros: input.usdc_price_usd_micros ?? null, price_risk: "ZEC_VOLATILITY", shielded_balance_verified: false,
      source: "explicit_research_observation", immediately_executable: false },
  };
}

// A shadow movement updates the SAME economic lot within the existing Portfolio observations.
// It neither records a real transaction nor makes an expected destination balance spendable.
export function appendShadowCapitalTransition(history, { id, economic_lot_id, from, to, observed_at, destination_balance = null }) {
  assertNoShieldedSecrets(destination_balance);
  const valid = { public: ["in_transit"], shielded: ["in_transit"], in_transit: ["public", "shielded", "unresolved"], unresolved: ["public", "shielded"] };
  if (!id || !economic_lot_id || !valid[from]?.includes(to)) throw new Error("capital_transition_invalid");
  const previous = history.at(-1);
  let previousHash = null;
  for (const row of history) {
    const { record_hash, ...core } = row;
    if (agenticContractHash(core) !== record_hash || core.previous_hash !== previousHash || row.economic_lot_id !== economic_lot_id) throw new Error("capital_history_invalid");
    if (row.id === id) throw new Error("duplicate_transition_id");
    previousHash = record_hash;
  }
  if (previous && previous.to !== from) throw new Error("capital_transition_source_mismatch");
  const time = Date.parse(observed_at);
  if (!Number.isFinite(time) || (previous && time <= Date.parse(previous.observed_at))) throw new Error("capital_transition_time_invalid");
  if (["public", "shielded"].includes(to) && !destination_balance) throw new Error("destination_observation_required");
  if (destination_balance && (destination_balance.economic_lot_id !== economic_lot_id || destination_balance.observed_at !== observed_at)) throw new Error("destination_lot_mismatch");
  const core = { id, economic_lot_id, from, to, observed_at, destination_balance: destination_balance ? structuredClone(destination_balance) : null,
    previous_hash: previousHash, evidence: "SIMULATED_ONLY", live_settlement_verified: false };
  return Object.freeze([...history, Object.freeze({ ...core, record_hash: agenticContractHash(core) })]);
}

export function projectShadowCapitalTransitions(portfolioInput, histories) {
  const input = structuredClone(portfolioInput);
  input.balances ||= [];
  const handled = new Set();
  for (const history of histories) {
    let priorHash = null;
    for (const event of history) {
      const { record_hash, ...core } = event;
      if (agenticContractHash(core) !== record_hash || event.previous_hash !== priorHash) throw new Error("capital_history_invalid");
      priorHash = record_hash;
    }
    if (!history.length) continue;
    const last = history.at(-1), lot = last.economic_lot_id;
    if (handled.has(lot)) throw new Error("duplicate_capital_history");
    handled.add(lot);
    const current = input.balances.filter(b => b.economic_lot_id === lot).sort((a,b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
    if (!current || current.capital_compartment !== history[0].from || Date.parse(current.observed_at) >= Date.parse(history[0].observed_at)) throw new Error("capital_source_observation_mismatch");
    for (const event of history) {
      const row = event.destination_balance || current;
      input.balances.push({ ...row, observation_id: `shadow:${event.id}`, observed_at: event.observed_at, capital_compartment: event.to,
        // Even a simulated arrival cannot authorize a real trade.
        state: "unavailable", available_atomic: "0", executable_value_usdc_micros: "0" });
    }
  }
  return createUnifiedPortfolioSnapshot(input);
}

export function evaluateShieldedCopyCapital(snapshot, { location, required_atomic, maximum_latency_ms, deployment_estimate_seconds = null }) {
  const verified = verifyUnifiedPortfolioSnapshot(snapshot);
  if (!verified.ok) return { ready: false, reason: verified.error };
  const local = inspectLocalCapital(snapshot, { ...location, required_atomic });
  const shielded = snapshot.capital_compartments?.shielded.marked_value_usdc_micros ?? null;
  return { ready: local.result === "allow", public_working_capital_atomic: local.available_atomic,
    shielded_backing_usdc_equivalent_micros: shielded, required_prepositioned_atomic: normalizeAtomic(required_atomic),
    shielded_satisfies_hot_reserve: false,
    reason: local.result === "allow" ? null : deployment_estimate_seconds == null ? "SHIELDED_DEPLOYMENT_TIME_UNKNOWN"
      : deployment_estimate_seconds * 1000 > maximum_latency_ms ? "SHIELDED_DEPLOYMENT_TOO_SLOW_FOR_STRATEGY" : "PREPOSITIONED_CAPITAL_REQUIRED",
    actual_live_funding_authorized: false };
}
