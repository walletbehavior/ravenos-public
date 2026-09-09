import { observedWalletMarketEvidence, pruneWalletMarketEvidence } from "./wallet_market_evidence.mjs";
import { createHash, randomUUID } from 'node:crypto';
import { MARKET_WALLET_INDEX_CHAINS, observedMarketWallets } from './market_wallet_index.mjs';

export const WalletUniverseDefaults = Object.freeze({ markets_per_cycle: 4, requests_per_hour: 48, rescan_seconds: 21600, wallets_per_market: 100, maximum_markets: 2400 });
const hash = value => createHash('sha256').update(value).digest('hex');
const seconds = () => Math.floor(Date.now() / 1000);
function bounded(value, fallback, max) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? Math.min(n,max) : fallback; }
export function walletUniversePolicy(env = {}) {
  return { enabled: env.RAVENOS_WALLET_UNIVERSE_ENABLED === '1',
    markets_per_cycle: bounded(env.RAVENOS_WALLET_UNIVERSE_MARKETS_PER_CYCLE, 4, 20),
    requests_per_hour: bounded(env.RAVENOS_WALLET_UNIVERSE_REQUESTS_PER_HOUR, 48, 240),
    rescan_seconds: bounded(env.RAVENOS_WALLET_UNIVERSE_RESCAN_SECONDS, 21600, 86400),
    wallets_per_market: 100 };
}
export function marketUniverseIdentity(row) {
  const chain = row?.chain_id || row?.chain;
  if (!MARKET_WALLET_INDEX_CHAINS.includes(chain)) return null;
  const identity = { chain, pool_address: row.pool_address || row.pair_address, token_address: row.token_address,
    quote_token_address: row.quote_token_address || row.quote_address };
  const address = chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/;
  const pool = chain === 'solana' ? address : /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
  if (!pool.test(identity.pool_address || '') || !address.test(identity.token_address || '') || !address.test(identity.quote_token_address || '')) return null;
  if (chain !== 'solana') for (const key of ['pool_address','token_address','quote_token_address']) identity[key] = identity[key].toLowerCase();
  if (identity.token_address === identity.quote_token_address) return null;
  return { market_id: 'wum_' + hash(JSON.stringify(identity)).slice(0,40), ...identity };
}
export function createWalletUniverseStore(db) {
  return {
    async rememberMarkets(rows, now = seconds()) {
      const unique = new Map();
      for (const row of rows.slice(0,240)) { const id = marketUniverseIdentity(row); if (id) unique.set(id.market_id,id); }
      const statements = [...unique.values()].map(id => db.prepare(`INSERT INTO ravenos_wallet_universe_markets
        (market_id,chain,identity_json,first_seen_at,last_seen_at,next_scan_at) VALUES (?,?,?,?,?,0)
        ON CONFLICT(market_id) DO UPDATE SET last_seen_at=MAX(last_seen_at,excluded.last_seen_at)
        WHERE excluded.last_seen_at > last_seen_at + 300`).bind(id.market_id,id.chain,JSON.stringify(id),now,now));
      for (let i=0;i<statements.length;i+=40) await db.batch(statements.slice(i,i+40));
      await db.prepare(`DELETE FROM ravenos_wallet_universe_markets WHERE market_id IN (
        SELECT market_id FROM ravenos_wallet_universe_markets WHERE lease_token IS NULL
        ORDER BY last_seen_at DESC,market_id LIMIT -1 OFFSET ?)`)
        .bind(WalletUniverseDefaults.maximum_markets).run();
      return unique.size;
    },
    async claim(now, maximum, budget, token) {
      const hour = now - now%3600;
      await db.prepare('INSERT OR IGNORE INTO ravenos_wallet_universe_budget (hour_start,used_requests) VALUES (?,0)').bind(hour).run();
      // Rank by durable attempts across the whole chain frontier, including
      // active leases. Alphabetical ties alone starve the fifth chain whenever
      // four markets are selected and every chain has a cold backlog.
      const rows = await db.prepare(`WITH frontier AS (
        SELECT *, SUM(scan_count + CASE WHEN lease_token IS NOT NULL AND lease_expires_at>? THEN 1 ELSE 0 END)
          OVER (PARTITION BY chain) AS chain_attempts
        FROM ravenos_wallet_universe_markets
      ) SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY chain ORDER BY next_scan_at,market_id) AS chain_rank
        FROM frontier WHERE next_scan_at<=? AND last_seen_at>=?
          AND (lease_token IS NULL OR lease_expires_at<=?)
      ) ORDER BY chain_rank,chain_attempts,next_scan_at,chain,market_id LIMIT ?`).bind(now,now,now-7*86400,now,maximum).all();
      const claimed=[];
      for(const row of rows.results || []) {
        // Charge the budget before any provider operation. A crash wastes a
        // slot, never overspends the limit or releases an uncertain request.
        const charged=await db.prepare('UPDATE ravenos_wallet_universe_budget SET used_requests=used_requests+2 WHERE hour_start=? AND used_requests+2<=?').bind(hour,budget).run();
        if (!charged.meta?.changes) break;
        const result=await db.prepare(`UPDATE ravenos_wallet_universe_markets SET lease_token=?,lease_expires_at=?
          WHERE market_id=? AND next_scan_at<=? AND (lease_token IS NULL OR lease_expires_at<=?)`).bind(token,now+180,row.market_id,now,now).run();
        if (result.meta?.changes) claimed.push(row);
      }
      await db.prepare('DELETE FROM ravenos_wallet_universe_budget WHERE hour_start<?').bind(hour-7*86400).run();
      return claimed;
    },
    async finish(row, token, count, failed, now, interval) {
      const failures = failed ? row.failure_count+1 : 0;
      const delay=failed ? Math.min(86400, 300 * 2**Math.min(failures,8)) : interval;
      await db.prepare(`UPDATE ravenos_wallet_universe_markets SET lease_token=NULL,lease_expires_at=NULL,next_scan_at=?,
        scan_count=scan_count+1,failure_count=?,last_wallet_count=?,last_error=? WHERE market_id=? AND lease_token=?`)
        .bind(now+delay,failures,count,failed?'market_projection_unavailable':null,row.market_id,token).run();
    },
    async report(report) {
      await db.prepare('INSERT INTO ravenos_wallet_universe_runs VALUES (?,?,?,?,?,?,?,?)').bind(report.run_id,report.started_at,report.finished_at,report.attempted,report.succeeded,report.wallets_observed,report.failure_count,JSON.stringify(report)).run();
      await db.prepare('DELETE FROM ravenos_wallet_universe_runs WHERE finished_at<?').bind(report.finished_at-30*86400).run();
    }
  };
}
export async function runWalletUniverse(env, { marketStore, walletStore, loadTrades, loadCandidates, loadRetainedHolders, now = seconds(), clock = seconds } = {}) {
  const policy = walletUniversePolicy(env);
  if (!policy.enabled || !env.RAVENOS_CUSTOMER_DB?.prepare || env.RAVENOS_WALLET_INTELLIGENCE_ENABLED !== '1' || env.RAVENOS_WALLET_SCREENER_ENABLED !== '1') return { state:'disabled' };
  const store=marketStore || createWalletUniverseStore(env.RAVENOS_CUSTOMER_DB);
  const token=randomUUID(); const rows=await store.claim(now,policy.markets_per_cycle,policy.requests_per_hour,token);
  const report={run_id:'wur_'+token,started_at:now,finished_at:now,attempted:rows.length,succeeded:0,wallets_observed:0,failure_count:0,
    wallet_history_requests:0,copy_enrollments:0,maximum_provider_requests:rows.length*2};
  for(const row of rows) {
    let count=0, failed=false;
    try {
      const identity=JSON.parse(row.identity_json);
      const holders=typeof loadRetainedHolders==='function'?await loadRetainedHolders(identity).catch(()=>null):null;
      if(holders?.schema_version==='ravenos.onchain_holder_list.v2' && holders?.identity?.chain===identity.chain
        && holders.identity.pool_address===identity.pool_address && holders.identity.token_address===identity.token_address) {
        for(const wallet of observedMarketWallets(holders,{now:clock(),maximum_rows:policy.wallets_per_market})) {
          await walletStore.recordSeenMarketWallet(wallet,clock());count++;
        }
      }
      // Candidate-only providers use the same two-request reservation. Their
      // token-wide samples are not rewritten as an exact-pool trade ledger.
      const candidates=typeof loadCandidates==='function'?await loadCandidates(identity):null;
      if(candidates!==null) {
        const unique=new Map(candidates.map(wallet=>[wallet.source_wallet_id,wallet]));
        for(const wallet of [...unique.values()].slice(0,policy.wallets_per_market)) {await walletStore.recordSeenMarketWallet(wallet,clock());count++;}
        if(!count)throw Error('market_candidates_unavailable');
        report.succeeded++;
      } else {
      const projection=await loadTrades(identity);
      if(projection?.ok!==true || projection.schema_version!=='ravenos.onchain_pool_trades.v1' || projection.identity?.chain!==identity.chain ||
        (identity.chain==='solana' ? projection.identity.pool_address!==identity.pool_address : projection.identity.pool_address?.toLowerCase()!==identity.pool_address) ||
        (identity.chain==='solana' ? projection.identity.token_address!==identity.token_address : projection.identity.token_address?.toLowerCase()!==identity.token_address)) throw Error('projection_identity_mismatch');
      const admitted = observedMarketWallets(projection,{now:clock(),maximum_rows:policy.wallets_per_market});
      for (const wallet of admitted) {
        await walletStore.recordSeenMarketWallet(wallet,clock()); count++;
      }
      if (env.RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED === '1' && walletStore.recordSeenMarketEvidence) {
        await walletStore.recordSeenMarketEvidence(observedWalletMarketEvidence(projection, {now:clock(),admitted_wallets:admitted}));
      }
      report.succeeded++;
      }
    } catch { failed=true; report.failure_count++; }
    report.wallets_observed+=count;
    await store.finish(row,token,count,failed,clock(),policy.rescan_seconds);
  }
  if (env.RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED === '1') await pruneWalletMarketEvidence(env.RAVENOS_CUSTOMER_DB,clock());
  report.finished_at=clock(); await store.report(report);
  return {state:'completed',...report};
}
