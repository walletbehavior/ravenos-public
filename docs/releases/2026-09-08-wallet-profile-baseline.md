# Wallet profile baseline — 2026-09-08

Wallet profiles now lead with performance and activity, followed by holdings, recent events and per-token trading results. Raven research and follower evidence remain available in a separate expandable section. EVM transfer-only profiles start with that section collapsed. The 24H / 7D / 30D / all-observed control and token search operate entirely on the loaded snapshot.

Wallet addresses are complete in the screener, observed universe, saved research, Copy source identity, holder and trader rows, global wallet search, Account, Portfolio and connected Terminal displays. Long addresses wrap on mobile. Profile headers offer copy-address and chain-specific explorer actions. Token/program/transaction references in ancillary evidence may still use compact labels; wallet identity does not.

## Data implementation

The existing Solana FIFO model emits `ravenos.wallet_trading_record.v1`, profile version 6. It adds per-period decoded buys/sells, exact settlement buy cost and average size, sell proceeds, matched-sell holding duration and return buckets. Token records expose matched cost, matched proceeds, realized result and remaining known open cost. Newly aggregated amounts use integer settlement units; USDC and SOL are separate. Division for average buy size rounds down to the settlement unit. Existing source and follower accounting remain distinct.

The token list includes up to 100 most recently traded tokens with known-cost activity. Coverage and truncation are explicit. Return buckets count matched sell observations, not unique winning tokens. Costs are matched FIFO costs, not the cost of all observed inventory; network fees remain separate. Transfers and unresolved starting inventory do not become profit. First retained activity does not establish wallet creation time.

Legacy Solana snapshots acquire this read model from existing retained events at the original snapshot cutoff, through both cached-profile GET and address inspection. No RPC, new balance observation or historical profile rewrite is involved. Existing authorization and Pro detail gating apply.

EVM observed transaction counts now count distinct retained transaction references instead of a hardcoded zero. A missing provider-wide transaction count is displayed as retained transfer coverage, not zero transactions. Holdings tables show only supplied balances and marks. No valuation, P&L or wallet-wide trade count is manufactured from transfer rows.

Follow-up live verification found that old automatic saved-wallet labels still contained abbreviated addresses. Those labels now display the full address without rewriting saved history or changing custom research labels.

Solana inspection also batches up to 64 unique held/recently traded mints through the existing Helius connection. The optional DAS enrichment returns sanitized token labels and available USD marks, matched by exact mint and token decimals. Token results and activity can use these labels, including tokens no longer held. Raw metadata URLs, images and descriptions are neither fetched nor exposed. Shared public-mint cache entries last ten minutes (one minute for missing records); persisted profiles reuse the facts without another request. Background history rebuilds preserve the original holdings and metadata observation dates.

Mark valuations multiply integer token units by expanded decimal prices and round down to micro-USD only at the result. Symbols never establish asset trust. Missing marks, non-USD prices, mismatched decimals, unrelated assets and provider errors remain unknown. Visible marked value covers priced token rows only, excluding native balance and unpriced inventory; it is not executable buying power or unrealized profit. The oldest metadata observation is shown beside the holdings. Provider caching plus Raven caching can add twenty minutes of price lag at retrieval, and retained snapshots can be older; the UI does not call these live prices. References: [Helius batch contract](https://www.helius.dev/docs/api-reference/das/getassetbatch), [price cache behavior](https://www.helius.dev/docs/das/get-nfts), [request credit schedule](https://www.helius.dev/docs/billing/credits).

## GMGN comparison and remaining data gaps

Sources checked September 7, 2026 (local): [GMGN wallet detail documentation](https://docs.gmgn.ai/index/wallet-detail-page), [GMGN portfolio field reference](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-portfolio/SKILL.md), and the live [public wallet ranking](https://gmgn.ai/trade?chain=sol). The public ranking exposed balance, period P&L, win rate, buy/sell counts, outcome distribution and average holding duration. Opening an individual wallet required GMGN login; no account was created or linked for this comparison.

| Baseline | Raven implementation | Remaining gap |
| --- | --- | --- |
| Wallet identity / follow / Copy entry | Full address, explorer, private Save, existing Copy policy entry | Live automated Copy remains independently gated |
| Holdings and activity | Balance/mark table, batch Solana labels/available marks and filterable retained events | Price coverage is provider-dependent; EVM history is bounded |
| Period P&L and trade statistics | Solana matched FIFO periods, buys/sells, costs, duration | EVM receipt-backed transfer scans are not full swap/cost-basis reconstruction |
| Token realized results | Exact matched Solana settlement amounts | No universal starting-inventory reconstruction |
| Unrealized and total marked P&L | Explicitly unavailable without reliable costs and valuation | Current token marks and cost-complete inventory reconciliation still required |
| Outcome distribution | Matched-sell buckets from real decoded evidence | Not interchangeable with GMGN's per-token distribution |
| Raven differentiation | Existing research thesis, profit quality, cohorts, follower route evidence | These cannot substitute for missing baseline history |

This release improves the baseline and exposes more real data. It does **not** establish full GMGN data parity. That requires further EVM swap reconstruction, historical valuation and cost-complete inventory work.

## Verification and production scope

Baseline: 57 targeted tests passed before edits. New coverage checks partial FIFO sells, exact rounding, period boundaries, transfer exclusion, SOL denomination, legacy cache enrichment, period/filter zero-provider behavior, full address rendering and mobile containment. The complete regression suite is run for release; production receipts are retained separately in workspace outputs.

Migration `0041_wallet_profile_details.sql` adds bounded, immutable extended profile storage. No financial flag, pricing, subscription, cashback, affiliate or signing change. No funds moved. Universe collection stays at four markets per cycle and 48 reserved provider requests per hour. A production audit at 2026-09-08 01:48 UTC confirmed 9,196 observed source identities, five stored analyses, scheduled receipts and budget enforcement. Observed identities are not complete wallet histories.

## Extended history storage

Live refresh verification reproduced a profile persistence failure: 170 retained public events produced a 66,229-character analysis, exceeding the existing 65,536-character snapshot constraint. Migration 0041 preserves all existing snapshots and dependent Copy/research foreign keys. Larger analyses retain screener query fields inline and store the complete snapshot in a separate append-only row capped at 1 MiB. Both rows are inserted atomically before publishing the current-profile pointer. Reads return the full original analysis, while historical inline snapshots remain readable. No token records are removed to satisfy the old bound.

All 1,449 server tests passed after this fix, including large-profile round trips, immutable/idempotent storage, intact screener fields, byte limits and rollback to the prior good snapshot after a failed detail write.
