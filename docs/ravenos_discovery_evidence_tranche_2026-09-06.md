# RavenOS discovery evidence tranche — 6 September 2026

Implemented locally and verified with Node 22.23.1: **904/904 contract checks, all prerequisite suites, 251/251 browser checks, build, security architecture, public-asset leak validation, and 37 Worker response checks passed.** Three focused desktop/mobile/expiry browser checks were repeated after shortening compact missing-value labels to “Unknown.” No pre-existing failures appeared in the executed baseline. No production deployment, wallet signature, transaction submission, or live Copy activation occurred.

## Production evidence and baseline

The initial checkout was clean on `codex/community-wallet-growth-20260904`, at `0cf0a6f0ea50f54d2db6450d4d2cf1f2718ab37b`. The applicable parent AGENTS.md makes synced `sources/` read-only. No repository-local or nested AGENTS.md was present. Existing work was preserved.

Read-only production observations on 6 September:

| Observation | Result | Practical limit |
| --- | --- | --- |
| Discover HTML release header | `ravenos-00dcc7130bc4-38dbe182e11b2efd`; Worker version `a283854b-9ad2-4092-8da7-5d6141d5dcf9` | Production was one commit behind the legal candidate at inspection |
| `/api/health`, 14:53:23 UTC | HTTP 200, `ok: true`, status `ok`, about 1.26 s | One request, not an availability SLO |
| Five-chain `/api/onchain/trending`, 14:53:25 UTC | HTTP 200; current; 240 tokens; about 3.57 s | One bounded sample, not a completeness or latency benchmark |
| Token distribution | Solana 90; Robinhood 50; Base 30; BNB 48; Ethereum 22 | Intake distribution, not all chain activity |
| Deduplication | Zero duplicate exact markets and zero duplicate canonical chain/token identities | Distinct same-symbol contracts are intentionally retained |
| Missing capitalization | **31/240 rows had positive FDV without positive market cap** | Material input condition for this fix; no claim that all 31 produced a wrong signal |
| Partial five-minute transaction counts | Zero in this sample | Failure state verified with fixtures |
| Provider coverage | CoinGecko pages 1–3 loaded for all five chains; no supplemental-page failures; Dexch reported healthy | Provider-reported point-in-time health, not Raven-verified accounting or execution |
| Production desktop/mobile browser | 154 rendered rows in each later observation; zero horizontal overflow; zero page-script errors | Visible filtered board differs from raw intake; Chromium at 1440×1100 and 390×844, not physical Safari/iOS |

The measured production breadth is already substantial. This tranche therefore prioritizes trustworthy selection and interpretation rather than raising the 240-token cap or claiming broader chain coverage.

## Current competitive benchmark

Public first-party product surfaces and documentation were read on 6 September. These establish documented workflows, not independently measured competitor performance. No authenticated competitor trade, paid feature, proprietary code, or provider data ingestion was used.

| Benchmark | Relevant documented strength | Raven response in this tranche / remaining gap |
| --- | --- | --- |
| [Axiom Pulse](https://docs.axiom.trade/axiom/finding-tokens/pulse) | Lifecycle lanes and composable age, capitalization, liquidity, holder, and transaction filters | Existing lifecycle and numeric controls retained. Market-cap filters now exclude FDV-only values; complete transaction totals remain distinct from unknown. Holder-risk filter depth remains evidence-limited. |
| [DEX Screener API](https://docs.dexscreener.com/api/reference) | Chain/address/pair identity, separate market-cap and FDV fields, windowed buy/sell counts | Keeps exact-pool handoff and separate valuation bases throughout selection, filters, and explanations. No claim of matching provider coverage or update latency. |
| [GMGN token/chart workspace](https://docs.gmgn.ai/index/token-page-chart-multicharts-activity-trading-system) | Price/MCap chart modes, cross-chain multicharts, and selected-token activity/trader/holder panels | Existing exact-market chart handoff retained. Field-level Terminal reconciliation and native wallet-cohort annotations remain the next correctness tranche. |
| [Nansen Profiler](https://academy.nansen.ai/en/help/articles/0002013-nansen-profiler-101) | Wallet holdings, transactions, counterparties, and P&L in one research workflow | Existing Raven wallet primitives inspected; no new wallet-history coverage shipped here. |
| [GMGN wallet detail](https://docs.gmgn.ai/index/wallet-detail-page) | Follow/Copy near wallet activity, P&L, hold duration, and cost | Basic-to-deep wallet workflow remains a subsequent tranche. Source performance remains separate from follower results. |
| [OdinBot filters](https://docs.odinbot.io/odinbot-pro/filters) | Composable activity, swaps, trades, active days, and holding-time filters | Raven should rank only complete, qualified measurements. This tranche applies that discipline to discovery revival admission; multichain wallet reconstruction remains open. |
| [Phantom Terminal](https://help.phantom.com/hc/en-us/articles/46527102843027-Trade-in-Phantom-Terminal) | Connected-wallet trading, position management, and wallet tracking | Existing native readiness and optional Privy seams retained. No assertion that Raven embedded signing or every execution lane is operational. |
| [Robinhood Trenches](https://robinhoodtrenches.com/) | Public tracked-wallet tape, closed-position summaries, trader rows, time windows, and exact-token links | Benchmark only. Raven's existing RH event/cluster/lead-lag architecture remains the foundation; no scraping or second intelligence engine. |
| [Robinhood Chain documentation](https://docs.robinhood.com/chain/connecting/) | Distinguishes mainnet 4663 from testnet 46630 and their explorers | Chain identity remains explicit. Documentation is not evidence of Raven wallet, holder, or execution readiness. |

This closes specific correctness gaps in the discovery workflow benchmarked above. It does **not** establish overall parity with any competitor.

## Implementation map and demonstrated changes

| Path | Responsibility and implemented change |
| --- | --- |
| `ravenos-discover-intelligence.js` | Reused shared module for positive market capitalization, complete transaction counts, timestamp-qualified market/route freshness, and existing exact-token pool selection. Pool choice takes an injectable clock for deterministic tests. |
| `lib/discover_radar.mjs` | Market-cap risk ratios, cohorts, and first-observation comparisons no longer use FDV. Expired, future, undated, and explicitly unrouteable quote claims lose ranking/capacity eligibility. Future market timestamps and fractional-second expiry fail currentness. |
| `worker.mjs` | Supplemental discovery priority no longer treats FDV as low market cap or missing/inconsistent transaction windows as proven dormancy. Primary-page and five-chain budgets remain unchanged. |
| `ravenos-discover.js` | Market cap and FDV remain separately labeled. Compact missing MCap/Tx values say “Unknown”; genuine zero transactions say “0.” Inspect shows each valuation separately. Route filters, badges, and evidence expire independently of market facts, including while updates are paused. A current explicit unusable route retains its risk warning and loses positive capacity. Retained expired route evidence cannot override a current route. |
| `public/ravenos-discover*.js` | Regenerated canonical public mirrors using the normal build; byte equality verified. |
| Tests | Extended existing classifier, shared intelligence, Worker-provider, and cross-market browser suites. No new service, database, provider, asset identity, signer, or execution engine. |

Measured deterministic before/after cases:

- First observed market cap $200K, current market cap zero, FDV $450K: previously reported **+125%** by comparing different valuation bases; now that derived change is unavailable.
- FDV $200K with unknown market cap: previously passed a maximum-$250K market-cap filter; now excluded there and included in the unavailable-market-cap filter. FDV remains visible as FDV.
- Four buys with missing sells: previously displayed four transactions; now displays Unknown. Known zero buys plus zero sells displays 0.
- A deeper pool labeled current but older than 120 seconds: previously could displace a current shallower pool; now the current pool wins in either input order, retaining its exact identity.
- A quote 110 seconds old with otherwise fresh market facts: after another 11 seconds on a paused page, capacity and slippage disappear while market facts remain current. The Inspect panel agrees.
- Supplemental FDV-only, partial-activity, and inconsistent-window fixtures: previously could receive low-cap/dormancy admission priority; now a genuinely measured low-cap candidate precedes them. Unknown day totals are not evidence of a quiet preceding day.

The classifier changes from `2026-09-03.2` to `2026-09-06.1`. The existing compatibility rebuild admits the previous classifier and preserves its original version while rebuilding from exact raw facts, so retained history is not silently dropped. Strict future timestamps remain unavailable; device clock skew can suppress currentness. Existing classifier-rebaseline behavior remains in force; a version change does not become a market-transition notification. Historical runtime records are not rewritten. Any earlier first-observation valuation basis that was already ambiguous still needs an upstream provenance audit.

## Architecture and boundaries preserved

The actual repository is a Cloudflare Worker plus generated static assets, despite the old README describing a static-only Pages site. `wrangler.jsonc` runs `worker.mjs`, binds `.deploy-public`, routes `ravenos.xyz/*` and `app.ravenos.xyz/*`, uses customer D1, and declares a five-minute scheduled job. `config/release.json` records the authenticated public-origin contract and qualified provider roles. Existing release scripts package immutable artifacts, require clean source for staging, and require exact-release production authorization.

Canonical chain/token/pool identity, chart data-plane lineage, provider-qualified holder data, Raven evidence, fee policy, user-reviewed Terminal execution, wallet intelligence/Copy, WorkOS account identity, optional Privy, and Community remain their existing primitives. The fee policy still encodes Standard/Pro differentiation; this work does not establish fee collection in a live quote, signature, or receipt.

Commit `944f0a8e242f9697d72845bd0009f93372c97074` (“avoid cached response stream reuse”) is an ancestor of this checkout. Response-stream/cache infrastructure was not changed. The handoff's RS4000 core / RS2000 origin and release-authority split is retained as an operational constraint; those hosts were not re-probed or modified. DigitalOcean was not accessed or reintroduced.

The legal registry, review documents, migration 0033, counsel/release flags, signing flags, and wallet execution bundle have no diff against the starting legal milestone. Legal documents remain review candidates, non-effective, pending counsel and release approval. No credentials were read, moved, or printed. Live Copy, autonomous bridging, delegated signing, tenant/privacy boundaries, and capital boundaries were not broadened.

## Verification and remaining work

Baseline: 895/895 contracts and prerequisites; 53/53 cross-market browser tests. Final: 904/904 contracts and prerequisites; 251/251 configured browser tests; the three changed browser scenarios repeated after compact-label/screenshot polish. Build, security, public no-leak, Worker response validation, mirror equality, and whitespace checks passed. Tests exercise controlled provider, quote, chart, account, and failure fixtures; they are not live-money acceptance tests.

Screenshots supplied with this task distinguish **local synthetic fixtures** (`fixture-desktop.png`, `fixture-mobile-detail.png`) from **unchanged production** (`production-desktop.png`, `production-mobile.png`). The local screenshots were visually inspected. Production browser checks are read-only Chromium observations.

Remaining gaps include five-chain Terminal field-by-field price/chart/valuation/transactions/holders/creation-age reconciliation; sustained provider health and coverage attribution; finer discovery ranking and larger retained-market coverage; RH incremental lot accounting and wallet/token drilldowns; free/basic versus Pro/deep flow acceptance; embedded/external-wallet real-device onboarding; and desktop typography. This tranche adds no new chain, provider, holder authority, wallet dataset, or executable lane.

**Smallest safe next tranche:** build an exact-market reconciliation matrix across Solana, Robinhood, BNB, Base, and Ethereum. Compare Terminal header and chart references with the transaction/holder/creation-age panels, make field-level source/time/basis disagreements visible, and verify provider failure plus expiry on desktop/mobile. Keep it read-only, using existing market-state and chart primitives. Before any separately approved production promotion, package/stage from RS2000 and execute the required immutable-release, route/asset, freshness, no-leak, and 120-health + 120-opportunity concurrency-4 gates.
