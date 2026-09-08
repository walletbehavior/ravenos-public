export const WalletHistoryPolicy = Object.freeze({
  solana_deep_events: 50_000,
  discovery_warmup_events: 1_000,
  maximum_helius_page: 1_000,
  default_helius_page: 500,
  default_hourly_credits: 600,
  solana_analysis_events: 2_000,
  evm_analysis_events: 10_000,
});

export function heliusBackfillPolicy(env = {}) {
  const bounded = (value, fallback, min, max) => Number.isSafeInteger(Number(value))
    && Number(value) >= min ? Math.min(Number(value), max) : fallback;
  return {
    page_size: bounded(env.RAVENOS_HELIUS_BACKFILL_PAGE_SIZE, WalletHistoryPolicy.default_helius_page, 100, 1000),
    hourly_credits: bounded(env.RAVENOS_HELIUS_BACKFILL_CREDITS_PER_HOUR, WalletHistoryPolicy.default_hourly_credits, 10, 10000),
  };
}

export const heliusFullTransactionCredits = count => Math.max(10, Math.ceil(count / 100) * 10);

export async function reserveHeliusBackfillCredits(db, { limit, budget, now = Date.now() }) {
  if (!db?.prepare || !Number.isInteger(limit) || limit < 1 || limit > 1000
    || !Number.isInteger(budget) || budget < 10 || budget > 10000) throw Error('helius_history_budget_invalid');
  const seconds = Math.floor(now / 1000), hour = seconds - seconds % 3600;
  const credits = heliusFullTransactionCredits(limit);
  await db.prepare('INSERT OR IGNORE INTO ravenos_wallet_history_budget VALUES (?,0)').bind(hour).run();
  const result = await db.prepare('UPDATE ravenos_wallet_history_budget SET reserved_credits=reserved_credits+? WHERE hour_start=? AND reserved_credits+?<=?')
    .bind(credits, hour, credits, budget).run();
  if (!result.meta?.changes) {
    const error = new Error('helius_history_budget_exhausted');
    error.code = 'helius_history_budget_exhausted';
    error.retry_at = (hour + 3600) * 1000;
    throw error;
  }
  await db.prepare('DELETE FROM ravenos_wallet_history_budget WHERE hour_start<?').bind(hour - 7 * 86400).run();
  return credits;
}
