# Wallet discovery sources and deep cached history

This release prioritizes wallets users asked for: known KOL lists, smart-money lists, top holders and observed traders. It extends the existing chain/address registry, backfill queue, event archive and profile UI. Source labels are provenance, not verified identities, performance ratings or Copy recommendations.

## Discovery and cost

- Kolscan's public daily leaderboard is read as HTML every six hours, using its public account links. No API key, private endpoint or third-party P&L import. One shared database reservation prevents each user or overlapping Worker from issuing another read. Failures preserve cached identities and retry after an hour.
- The initial reviewed import contains 170 source observations and 111 unique Solana addresses: 50 daily, 50 weekly and 50 monthly Kolscan entries, plus 10 public GMGN KOL and 10 public GMGN smart-money entries. These are lists captured on September 8, not an exhaustive catalog. Weekly/monthly Kolscan and GMGN imports are snapshots; only the Kolscan daily page refreshes automatically.
- Existing cached holder projections and exact-pool transaction observations continue to populate the same multichain registry. Top-holder evidence is prioritized. Repeated sampled transactions identify active pool traders; they do not establish profitable top traders.
- The validated `ravenos.wallet_source_list.v1` import format also accepts other free/public or licensed lists for supported chains. It retains provider, public URL, observed time and rank, rejects malformed addresses and stale/future evidence, and deduplicates by chain and full address. No names or claimed returns are imported.
- List membership expires for priority purposes: KOL 30 days, smart-money 7 days, holder/trader 1 day. Wallet identities and retained histories are not deleted. Repeated imports do not overwrite newer evidence.
- Customer requests precede sourced discovery. Discovery warms at most four new wallets per scheduled cycle toward 1,000 events each. Browsing/filtering the screener performs no provider history requests.

## History and honest scope

Requested Solana history can grow to 50,000 retained events using the existing durable cursor. A 1,000-event warmup or older 10,000-event job is promoted without resetting its cursor or deleting decoded evidence. History is paged from storage with a keyset index. EVM retains its existing 10,000-event bound and providers.

Helius pages now support up to 1,000 full transactions. Production starts at 500 per call with a worst-case reservation of 600 background credits per hour shared across Workers. This is a configurable cost ceiling, not a promise that every wallet receives 50,000 events immediately. Oversized payloads may retry at 100 with a second budget reservation. Budget exhaustion defers the job until the next hour without using up its failure retries. Full transaction results are normalized directly; they are not individually fetched again after temporary-cache eviction.

The analytical profile remains bounded to the latest 2,000 Solana / 10,000 EVM normalized events. The deeper archive supports history recall; it does not automatically make P&L or cost-basis reconstruction complete. Coverage and analytical-window limits remain visible. Helius's associated-token-account filter does not cover transactions before December 2022, so provider exhaustion does not establish complete lifetime history.

## UI

Wallet intelligence offers KOL, smart-money, top-holder, top-trader-list and active-pool-trader source filters across all supported chains or one chain. Full addresses are retained. Source and history preferences survive a URL refresh. A selected source list can still show an already analyzed wallet and open its cached profile. External labels carry a plain explanation and do not change Community reputation or Copyability.

## Controls and rollout

Migration `0044_wallet_source_priority_and_history.sql` adds discovery provenance, per-job history targets, archive pagination indexes, a shared Helius reservation counter and public-list refresh state. Apply to preview and production before promoting the Worker. This is additive; it touches no account entitlement, fee, reward, subscription or signing table.

Enabled data flags are `RAVENOS_WALLET_PUBLIC_LISTS_ENABLED`, `RAVENOS_WALLET_PRIORITY_WARMUP_ENABLED`, `RAVENOS_HELIUS_BACKFILL_PAGE_SIZE=500` and `RAVENOS_HELIUS_BACKFILL_CREDITS_PER_HOUR=600`.

The previous valuation release omitted forwarding `RAVENOS_WALLET_DEX_MARKS_ENABLED` into its generated Worker configuration. This release corrects that packaging omission; fallback pricing must be verified on the deployed Worker, not inferred from the source configuration.

Disable public-list and warmup flags independently without affecting normal wallet lookups. Existing financial execution flags, secrets, pricing and billing policies are preserved.

## Validation

Tests cover actual SQLite recall beyond event 24,000 in a 25,010-event archive, cursor-preserving promotion, full 1,000-transaction Helius pages without per-transaction refetches, shared credit reservations, budget deferral, deduplication, source expiry, rank freshness, priority ordering, public-page failures and overlapping refreshes. Browser checks cover full addresses, source selection, no lookup-on-browse, refresh restoration and mobile containment. The 25,010-event archive is synthetic regression evidence, not a claim that a real 25,010-event wallet was fetched in this test.

The source import is reviewable with `node scripts/import-wallet-universe.mjs <public-sources.jsonl>` and writes only with `--apply`. Final deployment IDs, test results and production observations belong in the deployment receipt.

## Sources

- [Kolscan public leaderboard](https://kolscan.io/leaderboard): public wallet discovery links, with daily/weekly/monthly views.
- [Kolscan FAQ](https://kolscan.io/): public feature and coverage description.
- [GMGN smart-money tracking documentation](https://docs.gmgn.ai/index/track-smart-money): external reference lists. Continuous API access is separate from the captured public page.
- [Helius getTransactionsForAddress](https://www.helius.dev/docs/rpc/gettransactionsforaddress): full-transaction pagination, documented credit increments and associated-token-account history limitation.
