// A free projection intentionally omits the decision-history table. Confirm
// absence on the exact market endpoint instead of treating missing data as none.
export async function findPerpWithoutDecisionHistory({ universe, projection, probe }) {
  const attached = new Set((projection?.data?.instrument_context?.rows || [])
    .filter((row) => row?.context_available === true)
    .map((row) => String(row.instrument || "").trim().toUpperCase()));
  const candidates = (universe?.results || []).filter((row) => row?.symbol
    && !attached.has(String(row.asset || `${row.symbol}-PERP`).toUpperCase())
    && Number(row.mark_price) > 0 && row.funding_rate !== null
    && Number(row.open_interest_usd) > 0 && Number(row.day_notional_volume_usd) > 0);
  for (const candidate of candidates.slice(0, 12)) {
    const result = await probe(candidate);
    if (result.payload?.raven_context?.context_available === true) continue;
    // Leave all availability, freshness, schema, identity and execution checks
    // to the caller; never skip a broken response to make verification pass.
    return { candidate, ...result };
  }
  throw new Error("Hyperliquid universe has no verified market outside retained Raven decision history within the bounded probe");
}
