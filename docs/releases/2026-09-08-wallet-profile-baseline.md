# Wallet profile baseline — 2026-09-08

Wallet profiles now lead with performance and activity, followed by holdings, recent events and per-token trading results. Raven research and follower evidence remain available in a separate expandable section. EVM transfer-only profiles start with that section collapsed. The 24H / 7D / 30D / all-observed control and token search operate entirely on the loaded snapshot.

Wallet addresses are complete in the screener, observed universe, saved research, Copy source identity, holder and trader rows, global wallet search, Account, Portfolio and connected Terminal displays. Long addresses wrap on mobile. Profile headers offer copy-address and chain-specific explorer actions. Token/program/transaction references in ancillary evidence may still use compact labels; wallet identity does not.

## Data implementation

The existing Solana FIFO model emits `ravenos.wallet_trading_record.v1`, profile version 6. It adds per-period decoded buys/sells, exact settlement buy cost and average size, sell proceeds, matched-sell holding duration and return buckets. Token records expose matched cost, matched proceeds, realized result and remaining known open cost. Newly aggregated amounts use integer settlement units; USDC and SOL are separate. Division for average buy size rounds down to the settlement unit. Existing source and follower accounting remain distinct.

The token list includes up to 100 most recently traded tokens with known-cost activity. Coverage and truncation are explicit. Return buckets count matched sell observations, not unique winning tokens. Costs are matched FIFO costs, not the cost of all observed inventory; network fees remain separate. Transfers and unresolved starting inventory do not become profit. First retained activity does not establish wallet creation time.

Legacy Solana snapshots acquire this read model from existing retained events at the original snapshot cutoff, through both cached-profile GET and address inspection. No RPC, new balance observation or historical profile rewrite is involved. Existing authorization and Pro detail gating apply.

EVM observed transaction counts now count distinct retained transaction references instead of a hardcoded zero. A missing provider-wide transaction count is displayed as retained transfer coverage, not zero transactions. Holdings tables show only supplied balances and marks. No valuation, P&L or wallet-wide trade count is manufactured from transfer rows.

## GMGN comparison and remaining data gaps

Sources checked September 7, 2026 (local): [GMGN wallet detail documentation](https://docs.gmgn.ai/index/wallet-detail-page), [GMGN portfolio field reference](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-portfolio/SKILL.md), and the live [public wallet ranking](https://gmgn.ai/trade?chain=sol). The public ranking exposed balance, period P&L, win rate, buy/sell counts, outcome distribution and average holding duration. Opening an individual wallet required GMGN login; no account was created or linked for this comparison.

| Baseline | Raven implementation | Remaining gap |
| --- | --- | --- |
| Wallet identity / follow / Copy entry | Full address, explorer, private Save, existing Copy policy entry | Live automated Copy remains independently gated |
| Holdings and activity | Balance/mark table and filterable retained events | Many Solana token rows lack symbol/price enrichment; EVM history is bounded |
| Period P&L and trade statistics | Solana matched FIFO periods, buys/sells, costs, duration | EVM receipt-backed transfer scans are not full swap/cost-basis reconstruction |
| Token realized results | Exact matched Solana settlement amounts | No universal starting-inventory reconstruction |
| Unrealized and total marked P&L | Explicitly unavailable without reliable costs and valuation | Current token marks and cost-complete inventory reconciliation still required |
| Outcome distribution | Matched-sell buckets from real decoded evidence | Not interchangeable with GMGN's per-token distribution |
| Raven differentiation | Existing research thesis, profit quality, cohorts, follower route evidence | These cannot substitute for missing baseline history |

This release improves the baseline and exposes more real data. It does **not** establish full GMGN data parity. That requires further EVM swap reconstruction, historical valuation and cost-complete inventory work.

## Verification and production scope

Baseline: 57 targeted tests passed before edits. New coverage checks partial FIFO sells, exact rounding, period boundaries, transfer exclusion, SOL denomination, legacy cache enrichment, period/filter zero-provider behavior, full address rendering and mobile containment. The complete regression suite is run for release; production receipts are retained separately in workspace outputs.

No migration, financial flag, pricing, subscription, cashback, affiliate or signing change. No funds moved. Universe collection stays at four markets per cycle and 48 reserved provider requests per hour. A production audit at 2026-09-08 01:48 UTC confirmed 9,196 observed source identities, five stored analyses, scheduled receipts and budget enforcement. Observed identities are not complete wallet histories.
