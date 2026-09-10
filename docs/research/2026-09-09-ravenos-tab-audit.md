# RavenOS production tab audit — 9 September 2026

## Verdict

The main navigation, charts, cached wallet discovery, account balances, Pro research, and reserve quote research load. The complete product is **not yet ready to be described as fully operational**. EVM trade estimates, spot transaction history, some fresh wallet inspections, wallet cost basis, and several intentionally gated execution products remain incomplete.

This audit used the owner's existing signed-in Chrome session and exercised more than 150 page, tab, filter, and overlay states. Counts below are observations during the audit, not fixed product totals. Provider and market values changed during the session. Responsive browser regressions also cover 390px and desktop widths; this was not a physical iPhone test.

No trades were signed or submitted; no funds moved; no payment, wallet export, public-profile opt-in, live agent, or copy strategy was activated. Existing private research saves were preserved. Raw account snapshots and diagnostic traces are private local artifacts and are not included here.

Initial production release: `ravenos-69840770a598-36e436a3dfe4eced`, worker `7748881c-2645-42a7-8765-80ae334afc68`.

**Audit fixes deployed:** `ravenos-d8e502468a1e-45726ec7ef6ce9b1`, worker `63d0d744-6561-4d5d-80bc-2761f7ae9b1e`, serving both production domains at 100%. Code commits: `0e77e50ca` and `d8e502468`. The production verifier passed 39 checks, verified 24 assets and seven authenticated workspaces, and submitted zero transactions. Existing cron schedules were preserved.

## Corrections made in this pass

1. **Solana lifecycle starvation:** The provider supplied 42 bonding candidates, but the all-chain 240-row response could allocate every Solana slot to other candidates. Preserve bounded places for validated, fresh Bonding, Migrated, New, and revival candidates before balancing chains. This does not manufacture a lifecycle or relax the revival rules.
2. **Public Behavior Lab:** Apply market scope before the free preview limit, recognize known all-chain onchain cohorts, and distribute the preview across chains. The old first-six selection could be filtered down to nothing in the browser.
3. **Wallet screener:** Clear old chain counts immediately when switching, keep the selected filter controls consistent, and provide an actual cached-index retry after failure. A failed Solana load must not display Base coverage as though it belongs to Solana.
4. **Wallet/chart context isolation:** Wallet research query parameters no longer replace the chart's chain or selected account context. Repair incompatible chain labels from known exact-market namespaces. The observed failure was a Hyperliquid SOL perpetual labeled Base after visiting a Base wallet.
5. **Wallet balances:** Preserve accepted balance values during same-chain refresh and coalesce duplicate requests. Sign-out and chain changes still clear inappropriate values.
6. **Agents / Community:** Respect the HTML hidden attribute despite grid CSS. Agent and Radar panels must not appear simultaneously; Community must not retain its hidden account-checking panel.
7. **Wallet profile navigation:** The EVM Raven signals link expands its evidence section.
8. **Atlas:** Add return-to-market-map navigation, distinguish options research from licensed display availability, preserve date-only economic release dates in the user's time zone, and use neutral catalog loading copy.
9. **Pro research:** Label filter controls accessibly.
10. **Participation consistency:** Return the map summaries with a group's stored snapshot. Opening a fresh group now updates an older map from that same snapshot without extra provider requests or invented observation times.
11. **Help / pricing:** Replace stale Activity terminology with Trending and Degen explanations, and remove the incorrect footer saying all checkout and trading are closed. Paid subscriptions remain a separately identified rollout boundary.
12. **Search chart coverage:** Evaluate the configured provider fallback order, including enabled embedded charts. The old first-provider-only check mislabeled working Solana charts as unavailable and lowered their search rank. Exact chart loading remains verified on open.

No migration, key-handling change, new provider subscription, new production fee, or live execution flag was introduced by these audit fixes.

## Tab-by-tab results

| Workspace / tabs | Observed result | Remaining gap |
|---|---|---|
| Discover: Onchain, five chain filters, Velocity, Trending, Degen | Real exact markets on Solana, Robinhood, Base, BNB, Ethereum. ZEC excluded in the sampled main lists. | Lifecycle candidates were starved by the shared cap; corrected. Tokenized-equity classification still needs broader verified registry coverage. |
| Discover: New, Bonding, Migrated, Trading again | Provider lifecycle evidence exists. One Solana revival qualified during the audit. | A revival is conditional and cannot truthfully be guaranteed every interval. Refresh and source coverage remain important. |
| Discover: Onchain Raven Reads | Zero qualified rows at the observed check. | Evidence/qualification pipeline coverage is inadequate; a functioning empty state is not enough to call this feature populated. |
| Discover: participation buttons and map | Rolling six-hour sample of roughly 1,200–1,330 markets; chain/cap drill-down works. RH $100K–$500K opened 84 displayed markets, led by +345%, +96.09%, and +77.25% six-hour movers. | Map and group could represent different refreshes; corrected. Some source observations are stale or lack a full six-hour return. A temporary BNB volume outlier also needs provider-quality investigation. |
| Discover: Perps and Perps Reads | 178 venue contracts; 24 Reads in an observed snapshot. Open-interest/funding participation families and drill-down work. | Do not portray the venue's 24h participation data as a six-hour sample. |
| Discover: Atlas | Twenty listed instruments; separate scope. | SPY/QQQ Read placeholders with unknown regime are not substantive equity setups. |
| Terminal: spot charts | Solana CATE, RH ASTRO, Base STONKEX, BNB LAPTOP, ETH TAKO charts load. Dexch native chart/TA worked where supplied; DexScreener embeds worked elsewhere. | Native OHLC/TA remains provider-dependent. Embeds do not themselves supply Raven's transaction or holder history. |
| Terminal: spot Txns | Opened on all five chains. | **No exact-pool trade rows** in all five sampled markets. The public tape still calls `fetchGeckoPoolTrades`; replacement chart/discovery providers did not replace this adapter. |
| Terminal: Holders | Solana 20 accounts, about 119K provider holders; RH/Base/ETH 50 indexed candidates each with 20 displayed. Pool accounts excluded from wallet concentration. | BNB sample contained one observed contract account, not a useful holder leaderboard. |
| Terminal: holder wallet overlay | Opens in place; Back closes it and preserves the exact chart URL. | One fresh Solana top-holder inspection repeatedly returned HTTP 503. Stored profiles elsewhere worked. Root exception was not established; generic retry copy is insufficient diagnosis. |
| Terminal: Buy / Sell and route details | A 0.001 SOL read-only estimate produced about 2.04 CATE, the Raven fee, and an enabled Buy button using the existing Raven wallet. | No settlement was tested. RH/BNB/ETH example estimates remained unavailable; Base reported insufficient funds and did not show a useful economic estimate. |
| Terminal: Markets / Chart / Raven overlays | Recent market prices populate; sort controls and overlay dismissal work. | Some Raven market reads remain forming or unavailable when native observations are absent. |
| Perps Terminal: Market / Limit / Trigger | Market and Limit previews, 720 candles, 12 bid/ask levels per side, and 42 recent trades observed. Trigger is explicitly a plan. | No live order was submitted. Trigger/bracket execution is not verified live. |
| Perps: Positions / Balances / Orders / Order history / Fills / Funding | Own-account reads completed, showing zero for the unfunded account. | These are valid empty states, not evidence of a populated trading history. |
| Wallet Screener: All chains and individual chains | Cached seen-wallet lists and analyzed profile lists populate on all five chains. All six category presets exercised. | Profile counts and retained cost-basis depth remain far below the top-50-per-category-per-chain goal. Transient Solana screener failure was observed; retry and state handling corrected. |
| Wallet profiles: Overview / Holdings / Activity / Token results / Raven signals | Stored examples open on all five chains. Addresses are fully shown. Saved-list Open cached works. | Solana and EVM both have unresolved historical cost basis. BNB decoding and fresh holder inspection are particularly weak. |
| Copy: Raven Copy / Shadow feed / Positions | All panels open; account has zero watches and positions. | This is research/shadow functionality. Autonomous live Copy is not operating or verified by this audit. |
| Agents / New agent / Radar | Paper-ready agent form opens and cancels. Existing fleet is empty. | Live agents off; Radar disabled. No basis for claiming a working live agent engine. |
| Community: five boards / Following / Your profile | All panels open. Owner profile controls remain private/unchecked. | No public profiles meet current evidence thresholds. Do not confuse the private wallet index with opted-in public traders. |
| Raven Lab: public Behavior | Originally blank despite underlying cohort data; corrected in projection/scoping. Live recheck showed six slices after Reset, covering the five chains and a cross-chain fresh-pair cohort. | Public preview is bounded. It is not the requested wallet-family attribution system. Duplicate All filter labels and a persistent checking status need cleanup. |
| Raven Lab: Pro Behavior / Positioning / Pressure / Liquidity / Outcomes | 96 aggregate behavior cohorts; 20 positioning, 20 pressure, 20 liquidity rows; 10 outcome rows in the observed views. | Wallet precursor/cohort families are not yet equivalent to these chain/cap aggregates. Recurring wallet context was stale and excluded. |
| Raven Lab: Similar History / Replay | The Solana 24h link opens and preserves the requested slice. | Zero matching analogues in the final check. Completed historical coverage and qualification must improve; this is not a populated replay library. |
| Portfolio / balances | Existing Solana balance displayed; zero EVM and stablecoin balances matched the unfunded accounts. | Helper/Governor unavailable for this account; wallet history is not yet a complete portfolio ledger. |
| Portfolio: Shielded Reserve Deploy / Return / Send / comparison / planner | Actual read-only NEAR routes and standard-vs-ZEC comparison returned. Planner separates ready capital from ZEC reserve. | No integrated Zcash signer or verified shielded balance, and no live shielding/deployment/return. See economics below. |
| Atlas: ETFs / Stocks / Indices / Forex / Futures / Rates / Economy / Energy | All eight catalogs loaded. SPY/AAPL charts and AAPL SEC filings work; FRED rates and EIA energy series return observations. | SPX/ES native provider data unavailable; licensed options display unavailable. Catalog presence alone is not a live data feed. |
| Account: identity / sessions / wallets / funding/export guidance / Pro | Existing sign-in persisted, both Raven wallets ready, two remembered sessions, Pro trial active. Funding and secure export instructions present. | No export or new wallet was performed. Persisted 0.5% slippage was observed; a stored preference is distinct from the current fresh-user 3% default. |
| Rewards / Referrals | Zero rewards and referral non-enrollment presented consistently. | No earned-fee receipt, cashback settlement, referral conversion, or paid checkout was created, so full money-flow reconciliation is not certified here. |
| More / Monitor / recent and saved / Docs / FAQ / Pricing / Legal | Navigation and six current legal documents open. Recent and saved markets populate. | Monitor saved list genuinely empty; alert capability unavailable for the account. Help/pricing inconsistencies corrected. |
| Global search | CATE search returned 24 exact market choices and closed back to the original chart. | False chart-unavailable labels from the first-provider-only coverage check corrected. |

## Wallet depth measured

Approximate snapshot during the audit:

| Chain | Seen wallets | Analyzed profiles | Matching current screener filters |
|---|---:|---:|---:|
| Solana | 6,826 | 105 | 79 |
| Robinhood | 11,853 | 129 | 10 |
| Base | 4,154 | 96 | 4 |
| BNB | 5,040 | 76 | 1 |
| Ethereum | 3,485 | 100 | 27 |

Solana later advanced to 6,844 seen and 110 analyzed. Categories across all chains returned: Evidence First 12, Consistent Winners 8, Broad Edge 9, Active Swing 6, Fast Patterns 26, Follower Tested 0. These are query results, not evidence of 50 strong profiles in each category.

One Solana example had 500 decoded records, 164 normalized trades, and only one day covered; reliable closed-lot basis was absent. EVM examples exposed transactions and token records but unresolved incoming basis. The next depth work must prioritize durable pagination, swap reconstruction, token identity and historical marks, then closed-lot attribution. Increasing the address count alone will not fix P&L.

## Reserve quote evidence

These are indicative snapshots, not executable guarantees. Reference ZEC price was about $1,244.71. The route provider sees request amounts and destinations; public destination activity remains visible. No viewing or spending key was supplied.

| Research action | Observed quote | Estimate |
|---|---|---|
| Deploy about $500 from ZEC to Solana USDC | 497.423282 USDC; minimum 492.449049 | About 8 min; 0.530% friction |
| Return about $500 USDC toward ZEC | 0.40212011 ZEC; minimum 0.3980989 | About 3 min; 0.061% friction |
| Send 500 USDC from ZEC reserve concept | About 0.40791016 ZEC required, about $506.88 | About 8 min; 1.359% friction |
| Standard Base USDC → Solana USDC | 499.279566 USDC; minimum 494.286770 | 32 sec; 0.158% friction |
| Same goal through ZEC | 498.002202 USDC; no atomic combined minimum | About 11 min plus wallet wait; 0.414% friction |

No Raven reserve fee is configured. Trading fees remain a separate product action. ZEC exposure is variable-value capital, not USDC; quote success does not establish the missing wallet shielding path.

## Priority work remaining

1. **Trading:** Make EVM economic estimates independent of funding checks, expose specific route errors, reproduce the unavailable RH/BNB/ETH examples, then verify prepare/sign/settle with an explicitly user-controlled transaction. Preserve the single Buy action and existing wallet selection.
2. **Holder → profile reliability:** Diagnose the HTTP 503 from fresh Solana holder inspection; retain any established profile while a refresh fails. Add operational error codes without logging addresses, provider secrets, or account credentials.
3. **Spot activity:** Add provider-neutral exact-pool trade tape adapters using existing available providers. A chart iframe cannot fill Txns. Expand BNB and other EVM holder candidate ingestion alongside it.
4. **Wallet P&L:** Finish cost-basis reconstruction and durable deep-history coverage before filling performance categories. Rank only supported profiles; missing basis is not zero profit.
5. **Participation and Reads:** Keep six-hour snapshots refreshing reliably; investigate anomalous source volumes and tokenized-equity classification. Grow Onchain qualified reads without inserting perps or unsupported signals.
6. **Product readiness:** Treat live Copy, live Agents, Portfolio Governor, Monitor alerts, and live Shielded Reserve as unfinished capabilities. Implement and verify their actual execution/accounting paths before advertising them as live.
7. **Community and Pro cohorts:** Build evidence-backed wallet family membership and voluntary performance profiles. Aggregate chain/cap cohorts do not satisfy precursor-wallet attribution.

## Verification record

Targeted contract and browser suites passed for candidate retention, worker projections, public/Pro intelligence, context isolation, wallet screening, wallet balances, reserve UI, Agents, Community, Atlas, participation, and public copy. The combined context/public-copy/cross-market run passed 35 unit checks and 104 browser checks; later participation changes passed 22 unit/runtime checks and six focused browser checks. Repeated suite runs are not additive coverage counts.

The release process includes build/security/no-leak checks, immutable package digests, preview verification, promotion, and production asset/workspace verification. A successful release verifier confirms routes and release integrity; it does not certify real-money settlement or every upstream provider.

## Final production recheck

The complete session recorded 161 UI states, including post-release repeats. Final live evidence:

- **Solana lifecycle:** The 240-row all-chain API retained six Bonding and nine Graduated candidates in its 48 Solana slots. The browser's combined discovery feeds subsequently displayed **30 Bonding and 29 Migrated Solana tokens**, with actual market cards. API and UI counts refer to different bounded feed combinations and observation times.
- **Behavior:** All six public preview slices populated after Reset. Opening the Solana slice showed its own participation coverage. No completed directional comparison was attached to that broad slice, and its linked Similar History page had no qualified analogue.
- **Search:** CATE/SOL appeared with chart coverage checked on open. The response selected the enabled DexScreener embed fallback and no longer incorrectly marked the market's chart unavailable solely because Dexch was unavailable for Solana.
- **Participation:** An RH $100K–$500K response returned 90 markets and the matching shared board of 1,309 markets. A later browser snapshot contained 1,326 markets but showed stale/no measured six-hour returns on the visible tiles. The map/group consistency fix is live; dependable source freshness remains unfinished and is explicitly included in the roadmap.
- **Release integrity:** Build/security/no-leak checks and both preview and production verification passed. The immutable archive SHA256 is `cb8ec7362df52dd619e2938f399567b43dc9387ce2965446a8a7141d9544c667`; 964 source digests were checked before staging.

The next implementation sequence is in the [post-audit roadmap](2026-09-09-ravenos-roadmap.md). It includes the failures found in this audit rather than treating successful navigation as proof of full product readiness.

## Mobile transaction follow-up, 10 September UTC

The owner's horizontal-scroll reference is implemented and verified on production at 390 pixels. Time, side, USD and token amount lead the table; horizontal scrolling reveals quote amount, price, complete wallet address and transaction link. Rows use 14-pixel text and 44-pixel height. Solana's exact-pool sample renders all 120 returned rows, with no page-wide overflow. Small positive quote amounts remain nonzero (`0.003409` for a reported `0.00340934 SOL`), and individual rows retain precise reported amounts. Chart + Txns / Chart / Txns views share market context; amount/side filters work locally.

Mobula supplies verified bounded exact-pool samples for Solana, Base and Ethereum; the latest three-chain provider proof returned 120 swaps and 24 senders per pool. Robinhood/BNB Dexch activity remains token-wide when pool/quote identity is absent. No unsupported quote amount is invented. A full wallet address opens the existing intelligence overlay, and Close restores the selected Terminal URL and transaction pane.

The linked Solana profile exposed split-route accounting omissions. Release `ravenos-c79ea3b87aba-b89ef66fbd3efbb0` fixes the analytical direction; a signed-in production refresh now shows 18 buys, one CODEC token record, and 5.689204119 SOL of known open cost. No matched sells or realized profit were asserted. Release verification passed all 39 checks with zero transactions submitted. These affected-path checks do not replace the still-pending full roadmap audit or user-authorized trading round trips.
