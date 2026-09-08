# Wallet intelligence and funded-account balances — 2026-09-08

This release extends the existing shared wallet index and account wallet architecture. It improves the GMGN-style wallet record baseline; it does not claim complete GMGN parity or enable new financial execution.

## Wallet data

- Existing cached profile, event ledger, activity pagination, screener and backfill queue remain the foundation. Browse cached observations without RPC history requests. Registered/observed wallets are not represented as fully analyzed wallets.
- EVM backfill traverses both incoming and outgoing Alchemy ERC20/external transfer indexes over an initial 30-day window. It pins a confirmed head, verifies receipts and block identity, stores private provider cursors, resumes expired page tokens with inclusive block overlap, and deduplicates retained evidence. Completed wallets catch up from the last verified head instead of rescanning a month.
- Each existing worker batch handles at most four unique transactions, 100 RPC calls and 30 seconds. At most 10,000 indexed references per job. Dense histories can therefore take multiple scheduled batches; this is not an instant full-history SLA.
- Solana backfill now retains Helius's actual pagination token. A short page with a continuation token is not history exhaustion. Existing Helius decoding, held-token observation and Pro gating remain.
- Decoder revision 102 verifies supported two-to-four-pool swap paths against reviewed factory membership, pool transfer deltas and connected wallet input/output. Unknown contract calls remain unknown. Verified simple native transfers are transfers, never fake buys.
- Historical opening token balances use archive reads. Empty `balanceOf` responses count as zero only when historical code proves the contract did not yet exist.
- Ledger rows remain append-only. `ravenos_wallet_latest_events` selects the latest decoder revision per source/transaction so improved decoding does not double-count a trade.

## USD reference accounting

- Exact settlement currencies remain visible. Historical native-asset USD reference values are a separate analytical view; canonical USDC is denominated at USDC equivalent. USDG and bridged tokens are not silently pegged to canonical USDC.
- Historical five-minute ETH/SOL/BNB price points are stored once in shared D1 tables. Two missing days at most per invocation. Provider requests contain symbol and time only, not wallet or user identities.
- Missing, future or stale FX references do not become zero-valued trades. Amount calculations use integers/decimal strings and round down to micro-USD. References are not asserted to be exact fill prices.
- Network costs are separately displayed observations, not silently included in net P&L. EVM receipt gas does not claim to cover additional rollup L1 fees.
- FIFO matched-cost realized results and reconciled, priced known holdings determine analytical P&L. Transfers, missing inventory, missing market marks and incomplete history remain explicit limitations.

## Holder and wallet UX

- Holder cards use a bounded, cached-only join to retained wallet/token trade counts, known cost and matched P&L. No per-holder fresh RPC fanout.
- The join explicitly selects public analytical fields; it does not expose user accounts, rewards, private saved lists, referral relationships or Copy settings.
- Wallet records display history-window progress, independent balance freshness, historical USD coverage, transfer observations, risk counts and network fee scope.
- Full wallet addresses remain readable. Solana holder actions lead to the existing Copy setup. Other chains lead to honest Copy availability, not a claim of a functioning live EVM Copy engine.

## Own-account buying power

The previous Portfolio account view was Hyperliquid-only and the Raven Wallet card displayed addresses without loading balances. A shared own-account balance surface now appears in Account, Portfolio and the native trade ticket.

- GET `/api/v1/wallets/balances?chain=solana` authorizes the current Raven session and selects only that user's active linked embedded wallet. Arbitrary wallet-address query parameters are rejected. No card, Pro entitlement, wallet signing or history scan is required.
- Solana reuses the existing Portfolio read-only RPC client and holdings parser: native SOL plus legacy/Token-2022 holdings, three bounded RPC components. SOL and canonical USDC are separate balances. Frozen or unverified token state does not become usable USDC.
- Explicit EVM network selection uses configured Alchemy chain identity and native/accounting-asset balances. Robinhood USDG and BNB's Binance-Peg USDC retain their actual labels. EVM token spendability remains subject to route checks.
- A bounded 30-second per-user/network/wallet server cache and in-flight deduplication prevent repeated page reads from triggering wallet-history scans. Refresh and visible-view polling use the same endpoint. Responses are private/no-store; balances never go into localStorage.
- Missing data is unavailable, never zero. Displayed balances precede network fees; there is no invented spendable-USD total or automatic bridge. A ticket connected to another wallet explicitly distinguishes its address from the account's Raven Wallet.
- A live read-only check verified a funded Solana owner wallet. No transfer, quote submission or private-key export was performed.

## Empirical Robinhood check

Public sample: `0xe68c499fd93805404a0df4b8d936c5004e4cabca`.

- Five bounded history batches, 18 indexed references, 10 unique transactions.
- Eight verified buys, two native transfers out, zero decoder failures in this sample.
- Both transfer-index directions exhausted within the initial 30-day search; this is not proof of every possible internal transfer or lifetime activity.
- Three token opening balances proved zero at the window boundary.
- 135 RPC requests, approximately 10.17 seconds aggregate provider/runtime elapsed over the five test batches; not a production queue completion SLA.
- 699 shared five-minute price points obtained with three historical-price requests. All eight buys priced. Immediate repeat required zero historical-price requests.
- Historical USD reference buy cost: 6,235.847969 USD. No sells, so realized P&L and win rate remain unknown. Three held tokens lack reliable current USD marks; no unrealized profit is fabricated.

Raw local checkpoints can contain provider pagination tokens and must not be published. The validation scripts output sanitized summaries and keep raw research artifacts outside this repository.

## Remaining parity gaps

- Robinhood transfer indexing does not enumerate internal-only native transfers. Receipt/call tracing for discovered candidates cannot close that discovery gap.
- Coverage remains limited to reviewed protocol families and proven transfer paths. Arbitrary routers, unsupported DEXes and unresolved histories are excluded from profitability claims.
- Current USD marks for long-tail Robinhood tokens need broader reliable pricing coverage.
- Recently registered wallet identities are not automatically thousands of complete 30-day profiles. Existing priority/lease/cost controls govern enrichment; throughput should be measured before increasing it.
- Subsecond live EVM Copy readiness is separate work. This release does not bypass entry/exit checks or turn historical trades into Copy signals.

## Rollout and validation

Migration: `customer-migrations/0042_wallet_history_cursors.sql` (additive cursor column, decoder index/read view, shared price tables). Apply to preview and production before the new Worker reads the view.

Feature flags: `RAVENOS_EVM_WALLET_BACKFILL_ENABLED`, `RAVENOS_WALLET_HISTORICAL_USD_ENABLED`, `RAVENOS_WALLET_HOLDER_CONTEXT_ENABLED`, layered on the existing wallet-history activation policy.

Validation: 1,496 complete Node tests passed; 29 wallet-browser tests and 30 targeted balance/account-wallet/Portfolio/terminal-review browser tests passed. Desktop/mobile screenshots inspected. Build, security and public no-leak checks passed.

Existing 100 bps execution fees, 30% Pro cashback, no-card trials, referral/billing ledgers, Hyperliquid economics, legal assent and live execution flags are preserved. No production trade, claim, bridge, Copy action or shielded movement is part of this release.

## Primary references

- [GMGN wallet detail baseline](https://docs.gmgn.ai/index/wallet-detail-page)
- [Alchemy Robinhood API overview](https://www.alchemy.com/docs/robinhood-chain/robinhood-chain-api-overview)
- [Alchemy Transfers endpoint](https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers)
- [Alchemy transfer pagination](https://www.alchemy.com/docs/reference/transfers-api-quickstart)
- [Alchemy historical token prices](https://www.alchemy.com/docs/data/prices-api/prices-api-endpoints/prices-api-endpoints/get-historical-token-prices)
- [Helius transaction history pagination](https://www.helius.dev/docs/rpc/gettransactionsforaddress)
