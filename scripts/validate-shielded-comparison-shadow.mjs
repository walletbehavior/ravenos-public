import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { NearIntentsShieldedProvider } from '../lib/customer_trade/shielded_route_providers.mjs';
import { compareShieldedRoutes } from '../lib/customer_trade/shielded_route_comparison.mjs';
import { SHIELDED_FLAGS } from '../lib/customer_trade/shielded_reserve.mjs';
import { appendResearchRecord } from './research-shielded-reserve.mjs';

// Public test-vector dry quotes only. No credentials, addresses or signer input.
const output = process.argv[2];
if (!output) throw Error('Usage: node scripts/validate-shielded-comparison-shadow.mjs <output-directory>');
const directory = resolve(output); mkdirSync(directory, { recursive: true });
const env = Object.fromEntries(SHIELDED_FLAGS.map(key => [key, '1']));
const provider = new NearIntentsShieldedProvider({ env });
const catalog = await provider.tokens();
const run = new Date().toISOString();
for (const amount of [25, 500, 5000]) {
  const comparison = await compareShieldedRoutes({ source: 'base_usdc', destination: 'solana_usdc', usd_micros: String(BigInt(amount) * 1000000n) }, { provider, catalog, env });
  appendResearchRecord(join(directory, 'comparisons.jsonl'), { run_id: run, observed_at: new Date().toISOString(), requested_usd: String(amount), result: comparison });
  console.log(JSON.stringify({ amount_usd: amount, available: comparison.available, reason: comparison.reason,
    direct_receive: comparison.direct?.destination_amount, reserve_receive: comparison.reserve?.estimated_receive,
    direct_seconds: comparison.direct?.estimated_settlement_seconds, reserve_provider_seconds: comparison.reserve?.provider_time_sum_seconds,
    direct_friction_ppm: comparison.direct?.all_in_marked_friction_ppm, reserve_friction_ppm: comparison.reserve?.all_in_marked_friction_ppm,
    live_execution: comparison.boundary.live_execution_enabled }));
}
