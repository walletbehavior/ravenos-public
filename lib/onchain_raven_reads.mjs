import { createHash } from 'node:crypto';
import { buildDiscoverRadarProjection } from './discover_radar.mjs';
import { spotDiscoveryQuality } from '../ravenos-discover-intelligence.js';

export const ONCHAIN_READ_CLASSIFIER = Object.freeze({ name: 'raven_exact_pool_pressure', version: '2026-09-10.1' });
const windows = ['5m', '1h', '24h'];
const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
function identity(row) {
  const chain = row?.chain_id, pool = row?.pool_address, token = row?.token_address, quote = row?.quote_token_address;
  if (!['solana', 'base', 'ethereum', 'bsc', 'robinhood'].includes(chain)) return null;
  const tokenPattern = chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[\da-fA-F]{40}$/;
  const poolPattern = chain === 'solana' ? tokenPattern : /^0x(?:[\da-fA-F]{40}|[\da-fA-F]{64})$/;
  if (!tokenPattern.test(token || '') || !tokenPattern.test(quote || '') || !poolPattern.test(pool || '')
    || row.instrument_id !== `${chain}:pool:${pool}`) return null;
  return [row.instrument_id, token, quote].join('|');
}
function observation(row) {
  const market = row.market || {}, at = timestamp(row.observed_at);
  if (at === null || !(number(market.price_usd) > 0) || !(number(market.liquidity_usd) >= 5000)) return null;
  return { at, price: number(market.price_usd), liquidity: number(market.liquidity_usd),
    windows: windows.map(window => [number(market[`buys_${window}`]), number(market[`sells_${window}`]),
      number(market[`volume_usd_${window}`]), number(market[`price_change_${window}_pct`])]) };
}
function validObservation(value) {
  return Number.isSafeInteger(value?.at) && value.price > 0 && Number.isFinite(value.price)
    && value.liquidity >= 5000 && Number.isFinite(value.liquidity) && Array.isArray(value.windows)
    && value.windows.length === 3 && value.windows.every(window => Array.isArray(window) && window.length === 4
      && window.every(n => n === null || typeof n === 'number' && Number.isFinite(n)));
}

// Only the collector appends observations. Repeated cached timestamps do not
// manufacture history; changing pool or token orientation resets the sequence.
export function retainOnchainReadObservations(row, previous) {
  const id = identity(row), current = id && observation(row);
  const { raven_observations: ignored, ...clean } = row;
  if (!current) return clean;
  const prior = identity(previous) === id && previous?.raven_observations?.identity === id
    ? previous.raven_observations.samples || [] : [];
  const samples = [];
  for (const sample of [...prior.filter(validObservation), current].filter(sample => sample.at <= current.at && current.at - sample.at <= 600_000).sort((a, b) => b.at - a.at)) {
    if (!samples.length || samples.at(-1).at - sample.at >= 30_000) samples.push(sample);
    if (samples.length === 3) break;
  }
  samples.reverse();
  return { ...clean, raven_observations: { identity: id, samples } };
}

export function deriveOnchainRavenEvidence(row, { timeframe = '5m', nowMs = Date.now() } = {}) {
  const id = identity(row), current = id && observation(row), index = windows.indexOf(timeframe);
  if (!current || index < 0 || nowMs < current.at || nowMs - current.at > 120_000
    || !spotDiscoveryQuality(row, { nowMs }).eligible || row.raven_observations?.identity !== id) return null;
  const prior = [...(row.raven_observations.samples || [])].filter(validObservation)
    .filter(sample => current.at - sample.at >= 30_000 && current.at - sample.at <= 600_000).at(-1);
  if (!prior) return null;
  const [buys, sells, volume, move] = current.windows[index];
  const [previousBuys, previousSells] = prior.windows[index];
  if (![buys, sells, previousBuys, previousSells].every(value => Number.isInteger(value) && value >= 0)
    || buys + sells < 20 || previousBuys + previousSells < 20 || volume === null || volume < 1000 || move === null) return null;
  const share = buys / (buys + sells), priorShare = previousBuys / (previousBuys + previousSells);
  const demand = share >= .6 && priorShare >= .6, supply = share <= .4 && priorShare <= .4;
  if (!demand && !supply) return null;
  const advancing = current.price > prior.price, declining = current.price < prior.price;
  const aligned = demand ? move >= .5 && advancing : move <= -.5 && declining;
  const divergent = demand ? move <= -.5 && !advancing : move >= .5 && !declining;
  if (!aligned && !divergent) return null;
  const priceDelta = (current.price / prior.price - 1) * 100;
  const liquidityDelta = (current.liquidity / prior.liquidity - 1) * 100;
  if (!Number.isFinite(priceDelta) || !Number.isFinite(liquidityDelta)) return null;
  const pct = value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const title = aligned ? demand ? 'Buy activity with rising price' : 'Sell activity with falling price'
    : demand ? 'Buy activity lacks price follow-through' : 'Price holds against sell activity';
  const artifact = createHash('sha256').update(JSON.stringify([ONCHAIN_READ_CLASSIFIER, id, timeframe, prior, current])).digest('hex').slice(0, 24);
  return {
    genuine_internal_observation: true, instrument_id: row.instrument_id, timeframe,
    observed_at: row.observed_at, freshness: 'current', state: 'qualified',
    classifier: ONCHAIN_READ_CLASSIFIER, lineage: { public_artifact_id: `pool_read_${artifact}` },
    why_raven_noticed: title,
    what_changed: `${timeframe} price ${pct(move)}; ${demand ? 'buy' : 'sell'} trades lead in two observed snapshots.`,
    behavioral_evidence: [
      `${buys} buys / ${sells} sells; $${Math.round(volume).toLocaleString('en-US')} reported ${timeframe} volume.`,
      `Price ${pct(priceDelta)} and liquidity ${pct(liquidityDelta)} between observations ${Math.round((current.at - prior.at) / 1000)}s apart.`,
      `Trade counts describe activity, not net capital flow or wallet accumulation.`,
      `Two snapshots of reported rolling ${timeframe} windows; overlapping windows are not added together.`,
    ],
    confidence_maturity: 'developing', timing_lead_seconds: null,
    contradictions: [liquidityDelta < -5 ? 'Liquidity has fallen more than 5% between observations.'
      : aligned ? 'A reversal in activity share or price weakens this read.' : 'Activity share and price direction disagree.'],
    forward_evidence_status: 'not_yet_measured',
  };
}

export function buildOnchainRavenReads(snapshot, { chains = ['solana', 'base', 'ethereum', 'bsc', 'robinhood'], timeframe = '5m', instrumentId = null, nowMs = Date.now() } = {}) {
  const observedRows = (snapshot?.rows || []).filter(row => chains.includes(row.chain_id) && (!instrumentId || row.instrument_id === instrumentId));
  const rows = observedRows.flatMap(row => {
    const evidence = deriveOnchainRavenEvidence(row, { timeframe, nowMs });
    if (!evidence) return [];
    const { raven_observations, ...publicRow } = row;
    return [{ ...publicRow, source_type: 'raven_spot_attention', raven_evidence: evidence,
      what_changed: evidence.what_changed,
      registry: { first_seen_at: new Date(raven_observations.samples[0].at).toISOString(), last_seen_at: row.observed_at,
        observation_count: raven_observations.samples.length, admission_lanes: ['raven_observation'] },
    }];
  });
  const generatedAt = snapshot?.generated_at || new Date(nowMs).toISOString();
  const radar = buildDiscoverRadarProjection(rows, { timeframe, nowMs, generatedAt, maxRows: Math.max(1, rows.length) });
  return { ok: true, safe_public: true, schema_version: 'ravenos.onchain_raven_reads.v1',
    generated_at: generatedAt, timeframe, chains, discovery_radar: radar,
    selected_discovery_market: instrumentId ? radar.rows.find(row => row.instrument_id === instrumentId) || null : null,
    coverage: { observed_markets: observedRows.length, qualified_reads: radar.rows.length, chain_counts: Object.fromEntries(chains.map(chain => [chain, radar.rows.filter(row => row.chain_id === chain).length])) },
    provenance: { producer: ONCHAIN_READ_CLASSIFIER, source: 'shared_exact_pool_observations', provider_rank_used: false,
      wallet_pnl_claimed: false, timing_advantage_claimed: false, provider_requests: 0 },
    execution_boundary: { research_only: true, actionable: false, signing_available: false, submission_available: false },
  };
}
