import { createShieldedIntent, assertShadowAccess, SHIELDED_BOUNDARY } from './shielded_reserve.mjs';
import { resolveShieldedAsset, amountForUsd } from './shielded_route_providers.mjs';
import { agenticContractHash } from '../agentic_trading/hashing.mjs';

// Compare the same source amount and final asset. The intermediate reserve is
// ZEC exposure, not a bridge guaranteeing a fixed stablecoin return.
export const RESERVE_COMPARISON_ASSETS = Object.freeze(['solana_usdc', 'base_usdc', 'arbitrum_usdc', 'ethereum_usdc', 'avalanche_usdc']);
export async function compareShieldedRoutes({ source, destination, usd_micros }, { provider, catalog, env, now = () => Date.now() }) {
  assertShadowAccess(env, 'SHIELDED_RETURN');
  assertShadowAccess(env, 'SHIELDED_DEPLOY');
  if (!RESERVE_COMPARISON_ASSETS.includes(source) || !RESERVE_COMPARISON_ASSETS.includes(destination) || source === destination) throw Error('request_invalid');
  const asset = resolveShieldedAsset(catalog, source);
  const base = { source, destination, boundary: SHIELDED_BOUNDARY, atomic_route: false, combined_minimum_output_atomic: null, privacy_classification: 'UNKNOWN' };
  if (!asset || !resolveShieldedAsset(catalog, destination) || !resolveShieldedAsset(catalog, 'zec')) return { ...base, available: false, reason: 'unsupported_chain_or_asset' };
  if (asset.price_usd_micros === '0' || !Number.isFinite(Date.parse(asset.price_observed_at)) || Math.abs(now() - Date.parse(asset.price_observed_at)) > 600000) return { ...base, available: false, reason: 'price_stale_or_unavailable' };
  const amount = amountForUsd(asset, usd_micros);
  const quote = (action, from, to, amount_atomic) => {
    const time = now();
    return provider.quote(createShieldedIntent({ action, source: from, destination: to, amount_atomic, expires_at: new Date(time + 60000).toISOString() }, { now: time }), catalog);
  };
  const direct = await quote('STANDARD_COMPARE', source, destination, amount);
  if (!direct.available) return { ...base, available: false, failed_leg: 'direct', reason: direct.reason };
  const returning = await quote('SHIELDED_RETURN', source, 'zec', amount);
  if (!returning.available) return { ...base, available: false, failed_leg: 'return', reason: returning.reason };
  // Deploy exactly the first leg's expected ZEC output; never revalue or round
  // it through a second USD conversion. This is not its guaranteed minimum.
  const deploying = await quote('SHIELDED_DEPLOY', 'zec', destination, returning.amount_out_atomic);
  if (!deploying.available) return { ...base, available: false, failed_leg: 'deploy', reason: deploying.reason };
  const legs = [direct, returning, deploying];
  const expires = Math.min(...legs.map(q => Date.parse(q.research_expires_at)));
  if (!Number.isFinite(expires) || expires <= now()) return { ...base, available: false, reason: 'comparison_expired' };
  if (direct.amount_in_atomic !== returning.amount_in_atomic || deploying.amount_in_atomic !== returning.amount_out_atomic || legs.some(q => q.trust?.provider_signature_verified !== true)) return { ...base, available: false, reason: 'comparison_evidence_mismatch' };
  const firstUsd = BigInt(returning.input_usd_micros);
  const result = { ...base, available: true, provider: provider.id, source_amount_atomic: amount,
    direct, reserve: { return: returning, deploy: deploying,
      estimated_receive: deploying.destination_amount,
      expected_output_atomic: deploying.amount_out_atomic,
      all_in_marked_friction_ppm: ((firstUsd - BigInt(deploying.output_usd_micros)) * 1000000n / firstUsd).toString(),
      provider_time_sum_seconds: returning.estimated_settlement_seconds + deploying.estimated_settlement_seconds,
      additional_wallet_wait_seconds: null, total_settlement_seconds: null,
      zec_price_risk: true, intermediate_zec_atomic: returning.amount_out_atomic,
      subsequent_quote_uses: 'expected_return_output', combined_minimum_output_atomic: null },
    destination_output_difference_atomic: (BigInt(deploying.amount_out_atomic) - BigInt(direct.amount_out_atomic)).toString(),
    observed_at: new Date(now()).toISOString(), research_expires_at: new Date(expires).toISOString(),
    disclosures: ['Three independent dry quotes; no locked round-trip price or guaranteed combined minimum.',
      'An external wallet spendability wait can add time beyond both provider estimates.',
      'The intermediate reserve is ZEC and can change in value before deployment.',
      'Both public-chain endpoints, amounts and timing remain observable. Shielded settlement and reduced linkage are unproved.'] };
  return { ...result, comparison_hash: agenticContractHash(result) };
}
