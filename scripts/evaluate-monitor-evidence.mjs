import { readFileSync } from 'node:fs';
import { cloudflareReleaseEnv } from './lib/cloudflare-release-env.mjs';
import { createParticipationSnapshotStore } from '../lib/participation_universe.mjs';
import { createD1CustomerMonitorAlertStore } from '../lib/customer_monitor_alerts.mjs';
import { buildOnchainMonitorEvidence } from '../lib/customer_monitor_evidence.mjs';

// Aggregate-only production qualification. This adapter cannot execute writes,
// run the evaluator, create rules or call any market provider.
try {
  const env = cloudflareReleaseEnv(process.cwd());
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const database = config.d1_databases.find(row => row.binding === 'RAVENOS_CUSTOMER_DB');
  let reads = 0, rowsWritten = 0;
  const db = { prepare(sql) {
    if (!/^\s*(SELECT\b|WITH monitor_clock AS \(SELECT \? AS now\)\s+SELECT\b)/i.test(sql)) throw new Error('probe_read_only');
    return { bind(...params) {
      const query = async () => {
        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database/${encodeURIComponent(database.database_id)}/query`, {
          method: 'POST', headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(20_000), redirect: 'error',
        });
        const body = await response.json();
        if (!response.ok || body.success !== true || body.result?.[0]?.success !== true) throw new Error('probe_database_unavailable');
        reads++; rowsWritten += Number(body.result[0].meta?.rows_written || 0);
        return body.result[0];
      };
      return { first: async () => (await query()).results[0] || null, all: query };
    } };
  } };
  const stored = await createParticipationSnapshotStore(db).read();
  const now = Math.floor(Date.now() / 1000), snapshot = stored.payload, byChain = {};
  for (const chain of ['solana', 'base', 'ethereum', 'bsc', 'robinhood']) {
    const rows = (snapshot?.rows || []).filter(row => row.chain_id === chain);
    const current = rows.filter(row => { const age = now - Date.parse(row.observed_at) / 1000; return age >= 0 && age <= 120; });
    const sample = current.slice(0, 100);
    const evidence = buildOnchainMonitorEvidence({ ...snapshot, rows }, sample.map(row => row.instrument_id), { now });
    byChain[chain] = { retained_markets: rows.length, current_markets: current.length, sampled_markets: sample.length,
      qualified_pool_snapshots: Object.keys(evidence).length,
      qualified_flow_measurements: Object.values(evidence).filter(row => row.classifications.pressure_regime).length };
  }
  const due = await createD1CustomerMonitorAlertStore(db).listDueRules(now, null);
  const totals = await db.prepare(`SELECT (SELECT COUNT(*) FROM ravenos_customer_monitor_rules) AS rules,
    (SELECT COUNT(*) FROM ravenos_customer_monitor_rules WHERE state='active') AS active_rules,
    (SELECT COUNT(*) FROM ravenos_customer_notification_events) AS notifications`).bind().first();
  if (rowsWritten !== 0) throw new Error('probe_read_only_violation');
  console.log(JSON.stringify({ observed_at: new Date(now * 1000).toISOString(), snapshot_generated_at: snapshot?.generated_at || null,
    source: 'existing_shared_participation_snapshot', by_chain: byChain, existing_alert_totals: totals,
    due_rule_query_rows: due.length, database_reads: reads, database_rows_written: rowsWritten,
    market_provider_calls: 0, personal_rules_created: 0, notifications_created: 0, evaluator_invoked: false }, null, 2));
} catch {
  console.error('Monitor read-only evidence probe could not complete.');
  process.exitCode = 1;
}
