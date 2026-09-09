const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

// Jupiter Tokens V2 reports graduation separately from first-pool creation.
// PumpSwap membership and a missing graduation field never prove graduation.
export function jupiterDiscoveryLifecycle(token, pair, observedAt) {
  if (!ADDRESS.test(token?.id || '') || pair?.chainId !== 'solana' || pair.tokenAddress !== token.id) return null;
  const now = Date.parse(observedAt), graduated = timestamp(token.graduatedAt);
  const hasGraduation = ADDRESS.test(token.graduatedPool || '') && graduated !== null && graduated <= now;
  const bonding = ['pumpfun', 'pump.fun'].includes(String(pair.dexId || '').toLowerCase())
    && ['pumpfun', 'pump.fun'].includes(String(token.launchpad || '').toLowerCase())
    && !token.graduatedPool && !token.graduatedAt;
  if (!Number.isFinite(now) || (!hasGraduation && !bonding)) return null;
  // A retired bonding curve is not an active post-graduation market.
  const contradictions = hasGraduation && ['pumpfun', 'pump.fun'].includes(String(pair.dexId || '').toLowerCase())
    ? ['graduated_token_on_bonding_curve'] : [];
  return {
    schema_version: 'ravenos.token_lifecycle.v1', provider: 'jupiter', evidence_class: 'JUPITER_REPORTED',
    chain_id: 'solana:mainnet-beta', token_address: token.id,
    state: hasGraduation ? 'GRADUATED' : 'BONDING', observed_at: observedAt,
    migrated_at: hasGraduation ? new Date(graduated).toISOString() : null,
    graduated_pool: hasGraduation ? token.graduatedPool : null,
    launchpad: typeof token.launchpad === 'string' ? token.launchpad.slice(0, 60) : null,
    // No percentage is inferred from market cap or virtual curve reserves.
    progress_bps: hasGraduation ? 10_000 : null,
    evidence_basis: hasGraduation ? 'reported_graduated_at_and_pool' : 'reported_launchpad_and_active_exact_pumpfun_market',
    quality: { contradictions }, raven_verified: false, execution_authority: false,
  };
}

export function jupiterDiscoveryAge(token, observedAt) {
  const now = Date.parse(observedAt), created = timestamp(token?.createdAt), first = timestamp(token?.firstPool?.createdAt);
  const age = value => value !== null && value <= now ? Math.floor((now - value) / 1_000) : null;
  // Some provider records have a createdAt later than their first pool. Keep
  // that inconsistency from making an older token look like a new launch.
  const tokenAge = first !== null && created !== null && created > first ? null : age(created);
  return { token_age_seconds: tokenAge, token_created_at: tokenAge === null ? null : new Date(created).toISOString(),
    first_pool_age_seconds: age(first), first_pool_created_at: age(first) === null ? null : new Date(first).toISOString() };
}
