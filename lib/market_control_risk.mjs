export const MARKET_CONTROL_RISK_SCHEMA = "ravenos.market_control_risk.v1";

const LEVEL_ORDER = Object.freeze({ forming: 0, measured_low: 1, watch: 2, elevated: 3, high: 4, severe: 5 });

export const MarketControlRiskContract = Object.freeze({
  schema_version: MARKET_CONTROL_RISK_SCHEMA,
  exact_market_identity_required: true,
  technical_control_risk_is_scam_determination: false,
  pool_accounts_must_be_excluded_from_wallet_concentration: true,
  provider_reported_developer_percentage_qualified_without_onchain_recheck: false,
  exact_pool_liquidity_is_a_separate_risk_dimension: true,
  missing_bundle_insider_sniper_or_liquidity_control_data_becomes_zero: false,
  numeric_rug_probability_published: false,
});

function finite(value, minimum = 0, maximum = 1_000_000_000_000_000) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function clean(value, maximum = 180) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function sameAddress(chain, left, right) {
  const a = clean(left, 80);
  const b = clean(right, 80);
  return Boolean(a && b && (chain === "solana" ? a === b : a.toLowerCase() === b.toLowerCase()));
}

function exactIdentity(identity = {}) {
  const chain = clean(identity.chain, 20).toLowerCase();
  const poolAddress = clean(identity.pool_address, 80);
  const tokenAddress = clean(identity.token_address, 80);
  const quoteAddress = clean(identity.quote_token_address, 80);
  if (!chain || !poolAddress || !tokenAddress || !quoteAddress || sameAddress(chain, tokenAddress, quoteAddress)) {
    throw new Error("market_control_risk_identity_invalid");
  }
  return Object.freeze({
    chain,
    pool_address: poolAddress,
    token_address: tokenAddress,
    quote_token_address: quoteAddress,
    instrument_id: `${chain}:pool:${poolAddress}`,
  });
}

function identitiesMatch(expected, actual = {}) {
  return clean(actual.chain, 20).toLowerCase() === expected.chain
    && sameAddress(expected.chain, actual.pool_address, expected.pool_address)
    && sameAddress(expected.chain, actual.token_address, expected.token_address)
    && (!actual.quote_token_address || sameAddress(expected.chain, actual.quote_token_address, expected.quote_token_address));
}

function evidence({ id, label, detail, severity = "info", dimension, source, observedAt }) {
  return Object.freeze({
    id,
    label: clean(label, 80),
    detail: clean(detail, 220),
    severity,
    dimension,
    source: clean(source, 80),
    observed_at: observedAt || null,
  });
}

function levelForEvidence(rows) {
  if (rows.some((row) => row.severity === "critical")) return "severe";
  if (rows.some((row) => row.severity === "high")) return "high";
  const elevated = rows.filter((row) => row.severity === "elevated").length;
  if (elevated >= 2) return "elevated";
  if (elevated === 1) return "watch";
  return "measured_low";
}

function titleFor(level, rows) {
  if (level === "severe") return "Severe control risk";
  if (level === "high" && rows.some((row) => row.dimension === "market_integrity" && row.severity === "high")) return "High market-integrity risk";
  if (level === "high") return "High control risk";
  if (level === "elevated") return "Elevated risk";
  if (level === "watch") return "Risk watch";
  if (level === "measured_low") return "No critical flags observed";
  return "Risk screen forming";
}

function marketValue(snapshot = {}) {
  const marketCap = finite(snapshot.market_cap_usd ?? snapshot.marketCap);
  const fdv = finite(snapshot.fdv_usd ?? snapshot.fdv);
  return marketCap > 0 ? marketCap : fdv > 0 ? fdv : null;
}

function marketFact(snapshot = {}, names = []) {
  for (const name of names) {
    const value = finite(snapshot[name]);
    if (value !== null) return value;
  }
  return null;
}

export function buildMarketControlRiskProjection({
  identity: suppliedIdentity = {},
  holder_projection: holders = null,
  market_profile: profile = null,
  developer_holding: developerHolding = null,
  market_snapshot: market = null,
  observed_at: suppliedObservedAt = null,
} = {}) {
  const identity = exactIdentity(suppliedIdentity);
  if (holders && (!identitiesMatch(identity, holders.identity) || holders.schema_version !== "ravenos.onchain_holder_list.v2")) {
    throw new Error("market_control_risk_holder_identity_mismatch");
  }
  if (profile && (!identitiesMatch(identity, profile.identity) || profile.schema_version !== "ravenos.onchain_market_profile.v1")) {
    throw new Error("market_control_risk_profile_identity_mismatch");
  }
  if (developerHolding && (!identitiesMatch(identity, developerHolding.identity) || developerHolding.schema_version !== "ravenos.solana_owner_holding.v1")) {
    throw new Error("market_control_risk_developer_identity_mismatch");
  }

  const observedAt = clean(suppliedObservedAt || holders?.observed_at || profile?.fetched_at || new Date().toISOString(), 40);
  const risks = [];
  const mitigants = [];
  const facts = [];
  const unknowns = [];
  const holderObservedAt = holders?.observed_at || observedAt;
  const profileObservedAt = profile?.fetched_at || observedAt;
  const onchainControls = holders?.token_controls || {};
  const profileControls = profile?.token_controls || {};

  const top10WalletPct = finite(holders?.summary?.top_10_wallet_supply_pct, 0, 100);
  const largestWalletPct = (Array.isArray(holders?.holders) ? holders.holders : [])
    .filter((row) => row?.excluded_from_wallet_concentration !== true)
    .map((row) => finite(row?.supply_share_pct, 0, 100))
    .filter((value) => value !== null)
    .sort((left, right) => right - left)[0] ?? null;
  if (top10WalletPct !== null) {
    facts.push(evidence({
      id: "top_10_wallet_concentration",
      label: "Top 10 wallets",
      detail: `${top10WalletPct.toFixed(1)}% of supply after excluding the exact pool account.`,
      severity: "info",
      dimension: "control",
      source: "Solana on-chain accounts",
      observedAt: holderObservedAt,
    }));
    if (top10WalletPct >= 50) risks.push(evidence({ id: "top_10_wallet_concentration_high", label: "Highly concentrated holders", detail: `The top 10 non-pool wallets hold ${top10WalletPct.toFixed(1)}% of supply.`, severity: "high", dimension: "control", source: "Solana on-chain accounts", observedAt: holderObservedAt }));
    else if (top10WalletPct >= 30) risks.push(evidence({ id: "top_10_wallet_concentration_elevated", label: "Concentrated holders", detail: `The top 10 non-pool wallets hold ${top10WalletPct.toFixed(1)}% of supply.`, severity: "elevated", dimension: "control", source: "Solana on-chain accounts", observedAt: holderObservedAt }));
    else mitigants.push(evidence({ id: "top_10_wallet_concentration_bounded", label: "Pool-excluded concentration", detail: `Top 10 non-pool wallets hold ${top10WalletPct.toFixed(1)}% of supply.`, severity: "positive", dimension: "control", source: "Solana on-chain accounts", observedAt: holderObservedAt }));
  } else unknowns.push("Top-wallet concentration after excluding the exact pool");

  if (largestWalletPct !== null) {
    if (largestWalletPct >= 15) risks.push(evidence({ id: "largest_wallet_high", label: "Large single holder", detail: `The largest observed non-pool wallet holds ${largestWalletPct.toFixed(1)}% of supply.`, severity: "high", dimension: "control", source: "Solana on-chain accounts", observedAt: holderObservedAt }));
    else if (largestWalletPct >= 8) risks.push(evidence({ id: "largest_wallet_elevated", label: "Notable single holder", detail: `The largest observed non-pool wallet holds ${largestWalletPct.toFixed(1)}% of supply.`, severity: "elevated", dimension: "control", source: "Solana on-chain accounts", observedAt: holderObservedAt }));
  }

  for (const [key, label] of [["mint_authority", "Mint authority"], ["freeze_authority", "Freeze authority"]]) {
    const value = clean(onchainControls[key], 20).toLowerCase();
    if (value === "enabled") risks.push(evidence({ id: `${key}_active`, label: `${label} active`, detail: `${label} remains active on the exact token mint.`, severity: "critical", dimension: "control", source: "Solana mint account", observedAt: holderObservedAt }));
    else if (value === "disabled") mitigants.push(evidence({ id: `${key}_disabled`, label: `${label} disabled`, detail: `${label} is disabled on the exact token mint.`, severity: "positive", dimension: "control", source: "Solana mint account", observedAt: holderObservedAt }));
    else unknowns.push(label);
  }

  const honeypot = clean(profileControls.honeypot, 24).toLowerCase();
  if (honeypot === "flagged") risks.push(evidence({ id: "honeypot_flag", label: "Honeypot flag", detail: "The current token profile carries a honeypot warning.", severity: "critical", dimension: "control", source: "CoinGecko Onchain", observedAt: profileObservedAt }));
  else if (honeypot === "not_flagged") mitigants.push(evidence({ id: "honeypot_not_flagged", label: "No honeypot flag", detail: "The current token profile does not carry a honeypot flag.", severity: "positive", dimension: "control", source: "CoinGecko Onchain", observedAt: profileObservedAt }));
  else unknowns.push("Honeypot behavior");

  const developerPct = developerHolding?.state === "available" ? finite(developerHolding.supply_share_pct, 0, 100) : null;
  if (developerPct !== null) {
    facts.push(evidence({ id: "developer_holding", label: "Provider-listed developer wallet", detail: `${developerPct.toFixed(developerPct < 1 ? 2 : 1)}% of supply in the provider-listed address after an independent on-chain balance check.`, severity: "info", dimension: "control", source: "Solana on-chain accounts", observedAt: developerHolding.observed_at }));
    if (developerPct >= 20) risks.push(evidence({ id: "developer_holding_critical", label: "High developer-address exposure", detail: `The provider-listed developer address holds ${developerPct.toFixed(1)}% of supply after an independent on-chain balance check.`, severity: "critical", dimension: "control", source: "Solana on-chain accounts", observedAt: developerHolding.observed_at }));
    else if (developerPct >= 10) risks.push(evidence({ id: "developer_holding_high", label: "Developer-address exposure", detail: `The provider-listed developer address holds ${developerPct.toFixed(1)}% of supply after an independent on-chain balance check.`, severity: "high", dimension: "control", source: "Solana on-chain accounts", observedAt: developerHolding.observed_at }));
    else if (developerPct >= 5) risks.push(evidence({ id: "developer_holding_elevated", label: "Developer-address exposure", detail: `The provider-listed developer address holds ${developerPct.toFixed(1)}% of supply after an independent on-chain balance check.`, severity: "elevated", dimension: "control", source: "Solana on-chain accounts", observedAt: developerHolding.observed_at }));
    else mitigants.push(evidence({ id: "developer_holding_bounded", label: "Low listed-developer balance", detail: `The provider-listed developer address holds ${developerPct.toFixed(developerPct < 1 ? 2 : 1)}% of supply after an independent on-chain balance check.`, severity: "positive", dimension: "control", source: "Solana on-chain accounts", observedAt: developerHolding.observed_at }));
  } else unknowns.push("Provider-listed developer address independently rechecked on-chain");

  const ageMs = marketFact(market || {}, ["pairAgeMs", "pool_age_ms"]);
  const volume24h = marketFact(market || {}, ["volume24h", "volume_24h_usd", "volume_usd_24h"]);
  const liquidityUsd = marketFact(market || {}, ["liquidityUsd", "liquidity_usd", "reserve_in_usd"]);
  const valuation = marketValue(market || {});
  const turnover = volume24h !== null && valuation !== null && valuation > 0 ? volume24h / valuation : null;
  const liquidityToValuationPct = liquidityUsd !== null && valuation !== null && valuation > 0
    ? (liquidityUsd / valuation) * 100
    : null;
  if (ageMs !== null && ageMs < 2 * 60 * 60 * 1_000) risks.push(evidence({ id: "very_new_pool", label: "Very new pool", detail: `The pool is about ${Math.max(1, Math.round(ageMs / 60_000))} minutes old, so control and holder evidence has little time to mature.`, severity: "elevated", dimension: "market_integrity", source: "Exact-pool market snapshot", observedAt }));
  else if (ageMs !== null && ageMs < 24 * 60 * 60 * 1_000) facts.push(evidence({ id: "new_pool", label: "New pool", detail: `The pool is about ${Math.max(1, Math.round(ageMs / 3_600_000))} hours old.`, severity: "info", dimension: "market_integrity", source: "Exact-pool market snapshot", observedAt }));
  if (turnover !== null && turnover >= 20) risks.push(evidence({ id: "extreme_turnover", label: "Extreme turnover", detail: `Reported 24h volume is ${turnover.toFixed(turnover < 100 ? 1 : 0)}× the current valuation reference. That can reflect intense churn, automation, or distorted activity and needs trade-level review.`, severity: "high", dimension: "market_integrity", source: "Exact-pool market snapshot", observedAt }));
  else if (turnover !== null && turnover >= 8) risks.push(evidence({ id: "high_turnover", label: "High turnover", detail: `Reported 24h volume is ${turnover.toFixed(1)}× the current valuation reference.`, severity: "elevated", dimension: "market_integrity", source: "Exact-pool market snapshot", observedAt }));
  if (liquidityUsd !== null) {
    facts.push(evidence({ id: "exact_pool_liquidity", label: "Exact-pool liquidity", detail: `$${liquidityUsd.toLocaleString("en-US", { maximumFractionDigits: liquidityUsd < 100 ? 2 : 0 })} reported for this exact pool.`, severity: "info", dimension: "market_integrity", source: "Exact-pool market snapshot", observedAt }));
    if (liquidityUsd < 100) risks.push(evidence({ id: "exact_pool_liquidity_effectively_gone", label: "Exact-pool liquidity effectively gone", detail: `Only $${liquidityUsd.toFixed(2)} of liquidity is reported for this exact pool. A practical route may not exist.`, severity: "critical", dimension: "market_integrity", source: "Exact-pool market snapshot", observedAt }));
    else if (liquidityUsd < 5_000) risks.push(evidence({ id: "exact_pool_liquidity_critical", label: "Critically thin exact-pool liquidity", detail: `Only $${liquidityUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} of liquidity is reported for this exact pool.`, severity: "high", dimension: "market_integrity", source: "Exact-pool market snapshot", observedAt }));
    else if (liquidityUsd < 25_000 || (liquidityToValuationPct !== null && liquidityToValuationPct < 2)) risks.push(evidence({ id: "exact_pool_liquidity_thin", label: "Thin exact-pool liquidity", detail: `$${liquidityUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} of liquidity is reported for this exact pool${liquidityToValuationPct === null ? "." : ` (${liquidityToValuationPct.toFixed(1)}% of the valuation reference).`}`, severity: "elevated", dimension: "market_integrity", source: "Exact-pool market snapshot", observedAt }));
  } else unknowns.push("Exact-pool liquidity");

  if (profile?.token?.gt_verified === false) risks.push(evidence({ id: "metadata_unverified", label: "Project metadata unverified", detail: "The displayed name, image, description, and social links are provider-listed metadata, not proof that this token is affiliated with the named project or brand.", severity: "elevated", dimension: "authenticity", source: "CoinGecko Onchain", observedAt: profileObservedAt }));
  else if (profile?.token?.gt_verified === true) mitigants.push(evidence({ id: "metadata_verified", label: "Provider-verified metadata", detail: "CoinGecko marks this token metadata as verified.", severity: "positive", dimension: "authenticity", source: "CoinGecko Onchain", observedAt: profileObservedAt }));
  else unknowns.push("Project metadata verification");

  unknowns.push("Bundled-launch concentration", "Insider and sniper classification", "Liquidity ownership, lock, and burn provenance");
  const uniqueUnknowns = [...new Set(unknowns)].slice(0, 8);
  const evidenceCount = risks.length + mitigants.length + facts.length;
  const level = evidenceCount ? levelForEvidence(risks) : "forming";
  const primary = risks.sort((left, right) => {
    const severityOrder = { critical: 4, high: 3, elevated: 2, info: 1 };
    return (severityOrder[right.severity] || 0) - (severityOrder[left.severity] || 0);
  })[0] || null;
  const holderContext = top10WalletPct === null ? "" : ` Measured top-10 wallet concentration is ${top10WalletPct.toFixed(1)}% after excluding the exact pool.`;
  const summary = primary
    ? `${primary.detail}${holderContext}`
    : evidenceCount
      ? `The measured checks do not show a critical control flag.${holderContext}`
      : "Raven does not yet have enough exact-market control evidence to classify this pool.";

  return Object.freeze({
    ok: evidenceCount > 0,
    safe_public: true,
    schema_version: MARKET_CONTROL_RISK_SCHEMA,
    state: evidenceCount ? "available" : "forming",
    identity,
    observed_at: observedAt,
    level,
    level_order: LEVEL_ORDER[level],
    title: titleFor(level, risks),
    summary: clean(summary, 420),
    risk_factors: Object.freeze(risks),
    mitigating_checks: Object.freeze(mitigants),
    measured_facts: Object.freeze(facts),
    unmeasured: Object.freeze(uniqueUnknowns),
    metrics: Object.freeze({
      top_10_wallet_supply_pct: top10WalletPct,
      largest_non_pool_wallet_supply_pct: largestWalletPct,
      developer_supply_pct: developerPct,
      volume_to_valuation_multiple: turnover,
      exact_pool_liquidity_usd: liquidityUsd,
      liquidity_to_valuation_pct: liquidityToValuationPct,
      pool_age_ms: ageMs,
    }),
    coverage: Object.freeze({
      measured_check_count: evidenceCount,
      risk_factor_count: risks.length,
      mitigating_check_count: mitigants.length,
      unmeasured_count: uniqueUnknowns.length,
      complete: false,
    }),
    interpretation: Object.freeze({
      technical_control_screen: true,
      scam_or_rug_determination: false,
      numeric_probability: false,
      safe_controls_mean_safe_token: false,
      guidance: level === "severe" || level === "high" ? "Review the flagged evidence before routing a trade." : "Review unmeasured controls and live flow before routing a trade.",
    }),
  });
}
