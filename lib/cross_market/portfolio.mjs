export const RAVENOS_PORTFOLIO_SCHEMA = "ravenos.portfolio.v1";
export const RAVENOS_VALUATION_SCHEMA = "ravenos.valuation.v1";

const VALUE_ROLES = new Set(["cash", "asset_value", "collateral", "option_value", "account_equity"]);

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function conversionRate(conversions, from, to) {
  const source = text(from).toUpperCase();
  const target = text(to).toUpperCase();
  if (source === target) return { rate: 1, source: "identity", observed_at: null, freshness_state: "current" };
  const row = conversions.find((candidate) => text(candidate.from).toUpperCase() === source && text(candidate.to).toUpperCase() === target);
  const rate = finite(row?.rate);
  const freshnessState = text(row?.freshness_state, "unavailable").toLowerCase();
  return rate && rate > 0 && ["fresh", "current", "delayed"].includes(freshnessState)
    ? { ...row, rate, freshness_state: freshnessState }
    : null;
}

function convert(value, currency, numeraire, conversions) {
  const amount = finite(value);
  const conversion = conversionRate(conversions, currency, numeraire);
  if (amount === null || !conversion) return { value: null, conversion: null };
  return { value: amount * conversion.rate, conversion };
}

function deduplicate(rows) {
  const selected = new Map();
  const duplicates = [];
  for (const row of rows) {
    const key = text(row.economic_lot_id || row.custody_position_id || row.holding_id || row.position_id);
    if (!key) {
      selected.set(`unkeyed:${selected.size}`, row);
      continue;
    }
    const previous = selected.get(key);
    if (!previous) {
      selected.set(key, row);
      continue;
    }
    const previousAt = timestamp(previous.observed_at) || 0;
    const nextAt = timestamp(row.observed_at) || 0;
    const keep = nextAt >= previousAt ? row : previous;
    const drop = keep === row ? previous : row;
    selected.set(key, keep);
    duplicates.push({ economic_lot_id: key, dropped_id: drop.holding_id || drop.position_id || null });
  }
  return { rows: [...selected.values()], duplicates };
}

export function normalizePortfolioSnapshot(input = {}) {
  const numeraire = text(input.economic_numeraire, "USDC").toUpperCase();
  const conversions = Array.isArray(input.conversions) ? input.conversions : [];
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  const rawHoldings = Array.isArray(input.holdings) ? input.holdings : [];
  const rawPositions = Array.isArray(input.positions) ? input.positions : [];
  const holdingDedupe = deduplicate(rawHoldings);
  const positionDedupe = deduplicate(rawPositions);
  const warnings = [];
  if (holdingDedupe.duplicates.length || positionDedupe.duplicates.length) warnings.push("duplicate_economic_lots_removed");

  const holdings = holdingDedupe.rows.map((row) => {
    const role = text(row.valuation_role, "asset_value").toLowerCase();
    const sourceValue = finite(row.value);
    const currency = text(row.value_currency || row.currency, numeraire).toUpperCase();
    const normalized = convert(sourceValue, currency, numeraire, conversions);
    if (sourceValue !== null && normalized.value === null) warnings.push(`conversion_unavailable:${currency}:${numeraire}`);
    if (normalized.conversion?.freshness_state === "delayed") warnings.push(`conversion_delayed:${currency}:${numeraire}`);
    return {
      ...row,
      valuation_role: role,
      source_value: sourceValue,
      source_currency: currency,
      normalized_value: normalized.value,
      normalized_currency: numeraire,
      conversion: normalized.conversion,
    };
  });

  const positions = positionDedupe.rows.map((row) => {
    const sourceNotional = finite(row.notional_value ?? row.notional);
    const currency = text(row.value_currency || row.currency, numeraire).toUpperCase();
    const normalizedNotional = convert(sourceNotional, currency, numeraire, conversions);
    const unrealized = convert(row.unrealized_pnl, currency, numeraire, conversions);
    if (normalizedNotional.conversion?.freshness_state === "delayed" || unrealized.conversion?.freshness_state === "delayed") {
      warnings.push(`conversion_delayed:${currency}:${numeraire}`);
    }
    return {
      ...row,
      valuation_role: text(row.valuation_role, "derivative_exposure"),
      normalized_notional: normalizedNotional.value,
      normalized_unrealized_pnl: unrealized.value,
      normalized_currency: numeraire,
      conversion: normalizedNotional.conversion || unrealized.conversion,
    };
  });

  const accountRows = accounts.map((account) => {
    const accountId = text(account.account_id);
    const authoritative = finite(account.authoritative_equity);
    const authoritativeCurrency = text(account.authoritative_equity_currency || account.currency, numeraire).toUpperCase();
    const authoritativeValue = convert(authoritative, authoritativeCurrency, numeraire, conversions);
    const childHoldings = holdings.filter((row) => text(row.account_id) === accountId);
    const childUnavailable = childHoldings.some((row) => row.source_value !== null && row.normalized_value === null);
    const childValue = childHoldings
      .filter((row) => VALUE_ROLES.has(row.valuation_role) && row.valuation_role !== "account_equity")
      .reduce((sum, row) => sum + (finite(row.normalized_value) || 0), 0);
    const childValueAvailable = childHoldings.length > 0 && !childUnavailable;
    const normalizedEquity = authoritativeValue.value !== null
      ? authoritativeValue.value
      : childValueAvailable
        ? childValue
        : null;
    if (authoritative !== null && authoritativeValue.value === null && !childValueAvailable) {
      warnings.push(`account_valuation_unavailable:${accountId || "unknown"}`);
    }
    if (authoritativeValue.conversion?.freshness_state === "delayed") {
      warnings.push(`conversion_delayed:${authoritativeCurrency}:${numeraire}`);
    }
    return {
      account_id: accountId,
      venue: text(account.venue, "unknown"),
      custody_type: text(account.custody_type, "unknown"),
      connection_state: text(account.connection_state, "unavailable"),
      observed_at: account.observed_at || null,
      normalized_equity: normalizedEquity,
      normalized_currency: numeraire,
      valuation_source: authoritativeValue.value !== null
        ? "authoritative_account_equity"
        : childValueAvailable
          ? "child_asset_sum"
          : "unavailable",
      conversion: authoritativeValue.conversion,
      stale: Boolean(account.stale),
    };
  });

  const totalValue = accountRows.reduce((sum, account) => sum + (finite(account.normalized_equity) || 0), 0);
  const unassignedValue = holdings
    .filter((row) => !text(row.account_id) && VALUE_ROLES.has(row.valuation_role) && row.valuation_role !== "account_equity")
    .reduce((sum, row) => sum + (finite(row.normalized_value) || 0), 0);
  const derivativeNotional = positions.reduce((sum, row) => sum + Math.abs(finite(row.normalized_notional) || 0), 0);
  const unavailableValuations = holdings.filter((row) => row.source_value !== null && row.normalized_value === null).length
    + accountRows.filter((row) => row.normalized_equity === null).length;
  if (unavailableValuations) warnings.push("portfolio_valuation_incomplete");

  return {
    schema_version: RAVENOS_PORTFOLIO_SCHEMA,
    generated_at: input.generated_at || new Date().toISOString(),
    economic_numeraire: numeraire,
    valuation: {
      schema_version: RAVENOS_VALUATION_SCHEMA,
      total_value: totalValue + unassignedValue,
      currency: numeraire,
      derivative_notional: derivativeNotional,
      unavailable_valuations: unavailableValuations,
      usd_usdc_parity_assumed: false,
    },
    accounts: accountRows,
    holdings,
    positions,
    conversions: conversions.map((row) => ({
      from: text(row.from).toUpperCase(),
      to: text(row.to).toUpperCase(),
      rate: finite(row.rate),
      source: text(row.source, "unavailable"),
      observed_at: row.observed_at || null,
      freshness_state: text(row.freshness_state, "unavailable"),
    })),
    deduplication: {
      holdings_removed: holdingDedupe.duplicates,
      positions_removed: positionDedupe.duplicates,
      key_contract: "economic_lot_id_or_custody_position_id",
    },
    state: accounts.length || holdings.length || positions.length ? (unavailableValuations ? "partial" : "available") : "unavailable",
    warnings: [...new Set(warnings)],
    demonstration_data: false,
  };
}
