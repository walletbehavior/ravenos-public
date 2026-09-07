# Retained wallet market evidence

This change makes Raven's observed-wallet universe useful before a full wallet-history reconstruction. It is implemented and tested locally. Production migration and activation are held while the user defers the Cloudflare capacity upgrade. The previous production wallet-universe scheduler remains paused.

## What users can do

- Browse all supported chains or Solana, Robinhood, Base, Ethereum and BNB separately.
- Filter stored observations by last hour, six hours or 24 hours, and by whether history is already cached.
- With Pro, select repeated transactions in one pool, activity in multiple pools, or buys and sells in the same pool; order by recency, busiest sampled pool or observed pool count.
- Inspect each wallet's recent pool samples and open the exact pool in Terminal. Opening a market is a research navigation action, not a prepared or authorized trade.
- Continue through the existing wallet inspection and Raven Copy setup flow. No new wallet system, history provider or Copy ledger was added.

The signed-in page has a smaller introduction and a compact direct-address search. Filters retain their URL state and reset pagination on changes. Missing samples have an explicit unknown state rather than zero activity. Advanced pool filters are independently gated by the server's existing Pro entitlement.

## Data and accounting boundaries

`wallet_market_evidence.mjs` consumes the existing safe public exact-pool trade projection. It checks supported chain, exact pool/token/quote identity, admitted actor identity, timestamps, transaction hashes and buy/sell classification. It processes no more than 120 public rows and includes only admitted wallets. Foreground admission remains capped at 20 wallets; the existing budgeted universe scan admits up to 100 per market.

One current sample is retained per wallet and exact pool. Reversing the token/quote display orientation does not create another observed pool. Repeated transaction hashes count once within that pool. EVM hashes are case-normalized; Solana signatures remain case-sensitive. Buys and sells are sets, so a single transaction can have both sides. Counts are replaced, not accumulated, when a newer sample arrives. An older last-event sample cannot overwrite a newer one.

The largest provider-reported swap USD mark is stored as a decimal micro-USD string, truncating below six decimal places. It is not a reconciled fee or confirmed account balance. Multi-pool counts and USD marks are never summed as wallet-wide trading volume: multi-hop legs can otherwise double-count the same economic action. This layer makes no P&L, cost-basis, skill, identity, bot or Copyability claim.

Read-time filtering requires the whole retained sample to lie inside the current 24-hour window. A partially aged-out sample is withheld until refreshed rather than counting an old transaction as current. This is a bounded incomplete market sample, not an exhaustive daily wallet history. Cards return at most three latest pool samples; the filtered aggregate pool count can be larger.

## Cost controls

No additional RPC or history calls are made to build these facts. Both the public-market ingestion hook and the universe job reuse their existing loaded projection. UI browsing remains database-only. Explicit `view=observed` skips reconstructed-profile screening; `view=analyzed` skips the observation query. Existing API clients retain the combined default.

The normal observation page shares its filtered count and row scan using a SQL window count. When context is enabled, one additional bounded query retrieves up to three samples per returned wallet. An out-of-range page uses a fallback count so it does not incorrectly report an empty universe. Existing index-coverage and authentication/rate-limit operations still apply; this is not a claim of zero total database work.

Identical JSON samples cause zero row updates, including across Worker instances. A bounded per-isolate cache suppresses identical foreground writes for five minutes. New or changed samples do consume D1 writes and index maintenance; no claim is made that this removes the need for database capacity. The existing scheduled worker prunes at most 200 samples older than seven days per run. Expired samples are excluded immediately even if the scheduler is paused.

## Migration and rollout

- `0040_wallet_market_evidence.sql` adds the sample table under existing source-wallet IDs, with a composite primary key, foreign key, JSON/size limits, bounded counts, chronological checks and a recent-sample index.
- `RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED` defaults to `0`, is surfaced in the existing activation contract and is controlled by `wallet_copy.retained_market_evidence_release_enabled` in `config/customer_security.json`. Release packaging enables it only when wallet screening is also active. It is not hardcoded into the base Wrangler configuration.
- With the flag off, normal observation browsing does not query the new table. Advanced context filters fail explicitly if the infrastructure is disabled.
- No customer, wallet ownership, financial ledger, billing, fee, reward, affiliate or live execution migration is included.

After capacity is restored: verify auth writes, back up D1, apply 0040 on preview, validate foreign keys and read/write counts, stage the code, enable context on preview and exercise a real already-loaded projection. Only then apply the additive production migration and activate the flag. Resume the existing bounded universe job separately and verify an actual scheduled receipt. Rollback is flag-off first; retain the additive table. No bulk history scan or unbounded data backfill is needed.

Production population of these new context fields has not been measured yet. The existing 5,600+ observed identities are not thousands of analyzed profiles. Browser screenshots use explicitly mocked QA data and must not be represented as live customer evidence.

## Validation

The local tests cover all five chains, invalid/stale/future data, exact identity, repeated transactions, precise marks, replacement and no-op replay, error isolation, all filter modes before pagination, cached EVM profiles, three-sample limits, expiry, bounded cleanup, flag-off compatibility without the table, Pro gates, view-specific query suppression, and a 6,000-wallet database fixture. Browser checks exercise filtering, paging, reload, exact Terminal links, Pro/Standard behavior, desktop/mobile layout and the unchanged inspection-to-Copy flow.

The broader stack suite also covers existing auth, Privy, billing, rewards, referrals, execution, portfolio and Copy contracts. Final local run: 1,437 Node tests and 318 browser tests passed; security architecture, public-asset leak and 37 Worker-response checks passed. Live trading, claims payouts, automated Copy, cross-chain limit execution and shielded money movement are not enabled by this change.
