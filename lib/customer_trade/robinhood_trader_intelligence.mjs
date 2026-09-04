export const ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA = "ravenos.robinhood_trader_intelligence.v1";
export const ROBINHOOD_TRADER_ACTIVITY_SCHEMA = "ravenos.robinhood_trader_activity.v1";

export const RobinhoodTraderIntelligenceLimits = Object.freeze({
  maximum_source_events: 1_000,
  maximum_activity_rows: 100,
  maximum_cluster_rows: 50,
  maximum_relationship_rows: 50,
  maximum_window_hours: 24 * 30,
  maximum_lead_lag_seconds: 24 * 60 * 60,
});

const SOURCE_EVENT_SCHEMA = "ravenos.source_wallet_chain_event.v1";
const ACTIONS = new Set(["all", "buy", "sell"]);
const EVENT_KINDS = new Set(["SWAP_BUY", "SWAP_SELL", "MULTIHOP_SWAP"]);
const EVM_ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const EVENT_ID_RE = /^swe_[a-f0-9]{40}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function integer(value, field, { minimum, maximum, fallback }) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function finite(value, field, { minimum, maximum, fallback }) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function median(values) {
  const rows = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : Number(((rows[middle - 1] + rows[middle]) / 2).toFixed(2));
}

function percentile(values, percent) {
  const rows = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!rows.length) return null;
  return rows[Math.min(rows.length - 1, Math.max(0, Math.ceil((percent / 100) * rows.length) - 1))];
}

function eventTimestamp(event) {
  const value = Date.parse(event?.timing?.detected_at || event?.timing?.decoded_at || "");
  return Number.isFinite(value) ? value : null;
}

function actionForKind(kind) {
  if (kind === "SWAP_BUY") return "buy";
  if (kind === "SWAP_SELL") return "sell";
  return "swap";
}

function exactAsset(asset) {
  if (!asset || typeof asset !== "object") return null;
  const assetId = String(asset.asset_id || "").trim().toLowerCase();
  const contract = String(asset.contract || "").trim().toLowerCase();
  const raw = String(asset.delta_base_units ?? "").trim();
  if (!assetId.startsWith("eip155:4663/") || (contract && !EVM_ADDRESS_RE.test(contract)) || !/^-?(?:0|[1-9]\d*)$/.test(raw)) return null;
  return freeze({
    asset_id: assetId,
    contract: contract || null,
    token_standard: String(asset.token_standard || "").trim().toLowerCase() || null,
    symbol: String(asset.symbol || "").trim().slice(0, 24) || null,
    delta_base_units: raw,
    direction: asset.direction === "in" || asset.direction === "out" ? asset.direction : null,
    settlement_asset: asset.settlement_asset === true,
    settlement_kind: asset.settlement_asset === true ? String(asset.settlement_kind || "").slice(0, 40) || null : null,
    canonical_usdc: asset.canonical_usdc === true,
  });
}

function riskAsset(event, action) {
  const assets = action === "buy" ? event?.economic?.destination_assets : action === "sell" ? event?.economic?.source_assets : [];
  return (Array.isArray(assets) ? assets : []).map(exactAsset).find((asset) => asset && !asset.settlement_asset) || null;
}

function settlementAsset(event, action) {
  const assets = action === "buy" ? event?.economic?.source_assets : action === "sell" ? event?.economic?.destination_assets : [];
  return (Array.isArray(assets) ? assets : []).map(exactAsset).find((asset) => asset?.settlement_asset) || null;
}

function normalizeRow(row) {
  const event = row?.event || row;
  if (
    event?.schema_version !== SOURCE_EVENT_SCHEMA
    || !EVENT_ID_RE.test(String(event.event_id || ""))
    || event.source_wallet?.chain !== "robinhood"
    || event.source_wallet?.network !== "mainnet"
    || Number(event.source_wallet?.chain_id) !== 4663
    || !EVM_ADDRESS_RE.test(String(event.source_wallet?.address || ""))
    || !EVENT_KINDS.has(event.classification?.kind)
  ) return null;
  const observedAtMs = eventTimestamp(event);
  if (observedAtMs === null) return null;
  const profileConfidence = row?.profile_reconstruction_confidence_pct;
  const confidence = profileConfidence === null || profileConfidence === undefined
    ? null
    : Number(profileConfidence);
  return {
    event,
    observed_at_ms: observedAtMs,
    reconstruction_confidence_pct: Number.isFinite(confidence) && confidence >= 0 && confidence <= 100 ? confidence : null,
  };
}

export function normalizeRobinhoodTraderIntelligenceQuery(searchParams, { now = new Date().toISOString() } = {}) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || "");
  const allowed = new Set(["hours", "limit", "action", "min_confidence", "min_wallets", "min_shared_entries", "maximum_lag_seconds"]);
  if ([...params.keys()].some((key) => !allowed.has(key))) fail("robinhood_trader_query_invalid");
  const nowIso = timestamp(now, "robinhood_trader_now");
  const hours = integer(params.get("hours"), "robinhood_trader_hours", {
    minimum: 1,
    maximum: RobinhoodTraderIntelligenceLimits.maximum_window_hours,
    fallback: 24,
  });
  const limit = integer(params.get("limit"), "robinhood_trader_limit", {
    minimum: 1,
    maximum: RobinhoodTraderIntelligenceLimits.maximum_activity_rows,
    fallback: 30,
  });
  const action = String(params.get("action") || "all").trim().toLowerCase();
  if (!ACTIONS.has(action)) fail("robinhood_trader_action_invalid");
  const minConfidence = finite(params.get("min_confidence"), "robinhood_trader_min_confidence", {
    minimum: 0,
    maximum: 100,
    fallback: 0,
  });
  return freeze({
    schema_version: ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA,
    chain: "robinhood",
    network: "mainnet",
    chain_id: 4663,
    evaluated_at: nowIso,
    since_at: new Date(Date.parse(nowIso) - hours * 60 * 60 * 1_000).toISOString(),
    hours,
    limit,
    action,
    min_confidence_pct: minConfidence,
    min_wallets: integer(params.get("min_wallets"), "robinhood_trader_min_wallets", { minimum: 2, maximum: 25, fallback: 2 }),
    min_shared_entries: integer(params.get("min_shared_entries"), "robinhood_trader_min_shared_entries", { minimum: 2, maximum: 1_000, fallback: 2 }),
    maximum_lag_seconds: integer(params.get("maximum_lag_seconds"), "robinhood_trader_maximum_lag", {
      minimum: 1,
      maximum: RobinhoodTraderIntelligenceLimits.maximum_lead_lag_seconds,
      fallback: 60 * 60,
    }),
  });
}

export function buildRobinhoodTraderActivity(rows = [], query) {
  if (!query || query.schema_version !== ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA) fail("robinhood_trader_query_invalid");
  if (!Array.isArray(rows) || rows.length > RobinhoodTraderIntelligenceLimits.maximum_source_events) fail("robinhood_trader_events_invalid");
  const since = Date.parse(query.since_at);
  const deduplicated = new Map();
  for (const row of rows) {
    const normalized = normalizeRow(row);
    if (!normalized || normalized.observed_at_ms < since) continue;
    const action = actionForKind(normalized.event.classification.kind);
    if (query.action !== "all" && action !== query.action) continue;
    if (normalized.reconstruction_confidence_pct !== null && normalized.reconstruction_confidence_pct < query.min_confidence_pct) continue;
    if (query.min_confidence_pct > 0 && normalized.reconstruction_confidence_pct === null) continue;
    if (!deduplicated.has(normalized.event.event_id)) deduplicated.set(normalized.event.event_id, normalized);
  }
  const projected = [...deduplicated.values()]
    .sort((left, right) => right.observed_at_ms - left.observed_at_ms || right.event.event_id.localeCompare(left.event.event_id))
    .slice(0, query.limit)
    .map(({ event, observed_at_ms: observedAtMs, reconstruction_confidence_pct: confidence }) => {
      const action = actionForKind(event.classification.kind);
      const asset = riskAsset(event, action);
      const settlement = settlementAsset(event, action);
      return freeze({
        schema_version: ROBINHOOD_TRADER_ACTIVITY_SCHEMA,
        event_id: event.event_id,
        observed_at: new Date(observedAtMs).toISOString(),
        action,
        classification: event.classification.kind,
        trader: {
          source_wallet_id: event.source_wallet_id,
          chain: "robinhood",
          network: "mainnet",
          chain_id: 4663,
          address: event.source_wallet.address,
          controller_identity_claimed: false,
        },
        token: asset,
        settlement_asset: settlement,
        size: {
          token_delta_base_units: asset?.delta_base_units || null,
          settlement_delta_base_units: settlement?.delta_base_units || null,
          usd: null,
          state: "unavailable_without_verified_decimals_and_price_evidence",
        },
        wallet_quality: {
          reconstruction_confidence_pct: confidence,
          performance_quality: null,
          state: confidence === null ? "insufficient_profile_evidence" : "activity_evidence_only",
        },
        chain_evidence: {
          transaction_reference: event.chain_evidence?.transaction_reference || null,
          block_number: Number.isSafeInteger(Number(event.chain_evidence?.block_number)) ? Number(event.chain_evidence.block_number) : null,
          block_hash: event.chain_evidence?.block_hash || null,
          finality: event.chain_evidence?.finality || null,
          providers: Array.isArray(event.chain_evidence?.providers) ? [...event.chain_evidence.providers] : [],
          independently_confirmed: event.chain_evidence?.independent_provider_confirmation_complete === true,
          evidence_hash: event.evidence_hash || null,
        },
        copy_readiness: {
          source_signal_ready: event.copy_signal?.source_signal_ready === true,
          entry_quote_proved: event.copy_signal?.entry_quote_proved === true,
          reverse_exit_proved: event.copy_signal?.reverse_exit_proved === true,
          state: event.copy_signal?.state || "route_proof_required",
        },
        terminal_handoff: asset?.contract ? {
          chain: "robinhood",
          chain_id: 4663,
          token_address: asset.contract,
          state: "fresh_route_required",
        } : null,
        execution_authorized: false,
      });
    });
  return freeze({
    schema_version: ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA,
    state: projected.length ? "available" : "empty",
    scope: {
      chain: "robinhood",
      chain_id: 4663,
      window_hours: query.hours,
      action: query.action,
      minimum_reconstruction_confidence_pct: query.min_confidence_pct,
      global_chain_completeness_claimed: false,
      indexed_wallets_only: true,
    },
    events: projected,
    unknowns: [
      "Dollar size is unavailable until token decimals and contemporaneous price evidence are verified.",
      "A public wallet address is not a Raven username or verified real-world identity.",
      "Observed activity is not a recommendation and does not authorize copying.",
    ],
  });
}

export function buildRobinhoodClusteredActivity(activity, query) {
  if (activity?.schema_version !== ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA) fail("robinhood_trader_activity_invalid");
  const groups = new Map();
  for (const event of activity.events || []) {
    if (event.action !== "buy" || !event.token?.asset_id) continue;
    const group = groups.get(event.token.asset_id) || { token: event.token, rows: [] };
    group.rows.push(event);
    groups.set(event.token.asset_id, group);
  }
  const clusters = [];
  for (const group of groups.values()) {
    const byWallet = new Map();
    for (const row of group.rows) {
      const previous = byWallet.get(row.trader.source_wallet_id);
      if (!previous || Date.parse(row.observed_at) > Date.parse(previous.observed_at)) byWallet.set(row.trader.source_wallet_id, row);
    }
    if (byWallet.size < query.min_wallets) continue;
    const wallets = [...byWallet.values()].sort((left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at));
    const confidences = wallets.map((row) => row.wallet_quality.reconstruction_confidence_pct).filter(Number.isFinite);
    clusters.push(freeze({
      token: group.token,
      qualifying_wallet_count: wallets.length,
      qualifying_wallets: wallets.slice(0, 10).map((row) => ({
        source_wallet_id: row.trader.source_wallet_id,
        address: row.trader.address,
        observed_at: row.observed_at,
        reconstruction_confidence_pct: row.wallet_quality.reconstruction_confidence_pct,
      })),
      first_entry_at: wallets[0].observed_at,
      latest_entry_at: wallets.at(-1).observed_at,
      median_wallet_reconstruction_confidence_pct: median(confidences),
      observable_combined_notional_usd: null,
      combined_notional_state: "unavailable_without_verified_trade_values",
      interpretation: "Multiple independently indexed wallets entered the same exact token in the selected window.",
      coordination_claimed: false,
      terminal_handoff: group.token.contract ? { chain: "robinhood", chain_id: 4663, token_address: group.token.contract, state: "fresh_route_required" } : null,
    }));
  }
  clusters.sort((left, right) => right.qualifying_wallet_count - left.qualifying_wallet_count || Date.parse(right.latest_entry_at) - Date.parse(left.latest_entry_at) || left.token.asset_id.localeCompare(right.token.asset_id));
  return freeze({
    schema_version: ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA,
    state: clusters.length ? "available" : "insufficient_evidence",
    clusters: clusters.slice(0, RobinhoodTraderIntelligenceLimits.maximum_cluster_rows),
    definition: "Clustered activity means distinct indexed wallets entered the same exact contract within the selected window. It does not imply coordination.",
  });
}

export function buildRobinhoodLeadLagRelationships(activity, query) {
  if (activity?.schema_version !== ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA) fail("robinhood_trader_activity_invalid");
  const byToken = new Map();
  for (const event of activity.events || []) {
    if (event.action !== "buy" || !event.token?.asset_id) continue;
    const wallets = byToken.get(event.token.asset_id) || new Map();
    const prior = wallets.get(event.trader.source_wallet_id);
    if (!prior || Date.parse(event.observed_at) < Date.parse(prior.observed_at)) wallets.set(event.trader.source_wallet_id, event);
    byToken.set(event.token.asset_id, wallets);
  }
  const pairs = new Map();
  for (const [assetId, walletMap] of byToken) {
    const entries = [...walletMap.values()].sort((left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at));
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const first = entries[leftIndex];
        const second = entries[rightIndex];
        const lagSeconds = Math.round((Date.parse(second.observed_at) - Date.parse(first.observed_at)) / 1_000);
        if (lagSeconds < 0 || lagSeconds > query.maximum_lag_seconds) continue;
        const addresses = [first.trader.address, second.trader.address].sort();
        const key = addresses.join("|");
        const pair = pairs.get(key) || {
          wallet_a: addresses[0],
          wallet_b: addresses[1],
          a_before_b: [],
          b_before_a: [],
          assets: new Set(),
        };
        const bucket = first.trader.address === pair.wallet_a ? pair.a_before_b : pair.b_before_a;
        bucket.push(lagSeconds);
        pair.assets.add(assetId);
        pairs.set(key, pair);
      }
    }
  }
  const relationships = [];
  for (const pair of pairs.values()) {
    const total = pair.a_before_b.length + pair.b_before_a.length;
    if (total < query.min_shared_entries || pair.assets.size < query.min_shared_entries) continue;
    const aLeads = pair.a_before_b.length >= pair.b_before_a.length;
    const leading = aLeads ? pair.wallet_a : pair.wallet_b;
    const following = aLeads ? pair.wallet_b : pair.wallet_a;
    const lags = aLeads ? pair.a_before_b : pair.b_before_a;
    const leadCount = lags.length;
    const leadRate = Number(((leadCount / total) * 100).toFixed(2));
    relationships.push(freeze({
      leading_wallet: leading,
      following_wallet: following,
      shared_entry_count: total,
      independent_token_sample: pair.assets.size,
      leading_wallet_entered_first_count: leadCount,
      lead_rate_pct: leadRate,
      median_lead_seconds: median(lags),
      p25_lead_seconds: percentile(lags, 25),
      p75_lead_seconds: percentile(lags, 75),
      relationship_state: total >= 20 && leadRate >= 80 ? "strong_observed_ordering" : total >= 5 && leadRate >= 70 ? "repeated_observed_ordering" : "limited_observed_ordering",
      copy_relationship_claimed: false,
      interpretation: "Observed lead/lag relationship; causation and copying are not established.",
    }));
  }
  relationships.sort((left, right) => right.independent_token_sample - left.independent_token_sample || right.lead_rate_pct - left.lead_rate_pct || left.leading_wallet.localeCompare(right.leading_wallet));
  return freeze({
    schema_version: ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA,
    state: relationships.length ? "available" : "insufficient_evidence",
    relationships: relationships.slice(0, RobinhoodTraderIntelligenceLimits.maximum_relationship_rows),
    definition: "Ordering is measured across independent exact-token entries inside the configured lag window. It is correlation, not proof one wallet copied another.",
  });
}
