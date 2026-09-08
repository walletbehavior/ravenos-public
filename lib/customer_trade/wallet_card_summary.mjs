// Public wallet evidence only. Page-sized indexed reads reuse retained history;
// browsing cards never starts RPC calls, backfills, or holdings lookups.
const DAY = 86400;
const iso = value => Number.isSafeInteger(value) && value >= 0 ? new Date(value * 1000).toISOString() : null;
const amount = value => value !== null && value !== undefined && /^-?\d+(?:\.\d+)?$/.test(String(value)) ? String(value) : null;

export async function walletCardSummariesForPage(db, sourceIds, now) {
  const ids = [...new Set(sourceIds)];
  if (!ids.length) return new Map();
  if (ids.length > 30 || !Number.isSafeInteger(now) || now < 0) throw new Error('wallet_card_query_invalid');
  const placeholders = ids.map(() => '?').join(',');
  const [profiles, activity] = await Promise.all([
    db.prepare(`SELECT c.source_wallet_id, c.generated_at, c.realized_pnl_usdc, c.realized_pnl_sol,
        c.closed_lots, c.source_history_complete, p.history_start_at
      FROM ravenos_source_wallet_current_profiles c
      JOIN ravenos_source_wallet_profiles p ON p.profile_snapshot_id=c.profile_snapshot_id AND p.source_wallet_id=c.source_wallet_id
      WHERE c.source_wallet_id IN (${placeholders})`).bind(...ids).all(),
    // One transaction can have multiple normalized legs and decode versions.
    // Use chain time, never the date Raven imported the history. Failed
    // transactions count too; these are transaction counts, not trade counts.
    db.prepare(`WITH transactions AS (
      SELECT source_wallet_id, transaction_reference,
        MIN(COALESCE(block_time,chain_event_time)) AS at
      FROM ravenos_source_wallet_events
      WHERE source_wallet_id IN (${placeholders}) AND retention_expires_at>?
        AND COALESCE(block_time,chain_event_time)<=?
      GROUP BY source_wallet_id, transaction_reference
    ) SELECT source_wallet_id, MIN(at) AS first_at, MAX(at) AS last_at, COUNT(*) AS retained,
      SUM(CASE WHEN at>? THEN 1 ELSE 0 END) AS d1,
      SUM(CASE WHEN at>? THEN 1 ELSE 0 END) AS d7,
      SUM(CASE WHEN at>? THEN 1 ELSE 0 END) AS d30
      FROM transactions GROUP BY source_wallet_id`).bind(...ids, now, now, now-DAY, now-7*DAY, now-30*DAY).all(),
  ]);
  const byProfile = new Map((profiles.results || []).map(row => [row.source_wallet_id,row]));
  const byActivity = new Map((activity.results || []).map(row => [row.source_wallet_id,row]));
  return new Map(ids.map(id => {
    const profile = byProfile.get(id), events = byActivity.get(id);
    const first = [events?.first_at, profile?.history_start_at].filter(at => Number.isSafeInteger(at) && at >= 0 && at <= now);
    const firstAt = first.length ? Math.min(...first) : null;
    const reconstructed = Number(profile?.closed_lots || 0) > 0 && Number(profile?.generated_at) <= now;
    return [id, {
      schema_version: 'ravenos.wallet_card_summary.v1', as_of: iso(now), provider_request_performed: false,
      age: { first_observed_at: iso(firstAt), seconds_lower_bound: firstAt === null ? null : now-firstAt,
        basis: 'earliest_retained_onchain_activity', creation_date_known: false },
      transactions: { d1: events ? Number(events.d1) : null, d7: events ? Number(events.d7) : null,
        d30: events ? Number(events.d30) : null, last_observed_at: iso(events?.last_at),
        scope: 'retained_transactions_including_failed', window_complete: false },
      pnl: { usdc: reconstructed ? amount(profile.realized_pnl_usdc) : null,
        sol: reconstructed ? amount(profile.realized_pnl_sol) : null, as_of: iso(profile?.generated_at),
        scope: 'reconstructed_realized_pnl', history_complete: profile?.source_history_complete === 1,
        bases_combined: false },
    }];
  }));
}
