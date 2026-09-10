# RavenOS roadmap execution record

Tracks the [approved roadmap](2026-09-09-ravenos-roadmap.md) against the [production audit](2026-09-09-ravenos-tab-audit.md). The persistent implementation goal is active. A package is complete only after its stated release gates pass; the final tab-by-tab audit follows implementation.

| Package | Status | Current evidence / next gate |
| --- | --- | --- |
| 1. Everyday trading | In progress | Holder fix deployed and verified on its failing production example. EVM readiness/estimate fix deployed; 39 release checks pass. Specific signed-in provider preview verification remains pending after a browser-policy rejection. Actual settlement, fees and reconciliation remain open. |
| 2. Wallet intelligence | In progress | Retained holdings pagination and refresh resilience implemented. Deep history and qualified category populations remain to be measured. |
| 3. Market data | In progress, prioritized | Qualified breadth/pagination deployed; production returned 1,737 qualified tokens. Persistent index/cursors, partial-refresh retention and minute refresh implemented; verification in progress. Replace the empty CoinGecko-only activity path and continue broader coverage. |
| 4. Portfolio | Pending | Buying-power reconciliation and useful Governor proposals remain required. |
| 5. Pro intelligence | Pending | Sourced wallet families and prospective outcomes remain required. |
| 6. Copy / Agents | Pending | Enforced policy and shadow outcomes must precede an expressly authorized controlled live beta. |
| 7. Shielded Reserve | Pending | Quotes exist; user-controlled signer/recovery and a verified shielded round trip do not. No Raven reserve movement fee. |
| 8. Commercial readiness | Pending | Test commercial-event reconciliation, alerts, onboarding and plan states. |
| Final production audit | Pending | Repeat every workspace, tab, filter and overlay on desktop/mobile after implementation; fix and retest regressions. |

## Holder inspection: response overflow

Reproduced on the signed-in production account by inspecting Solana holder `HDixbrzwwLXczhDBk1JVrurPQsuLE8FUKnW2pucSXN3o`. The request returned HTTP 503 with `wallet_copy_response_too_large`.

The analysis was stored successfully. Its holdings alone occupied 162,642 bytes; adding history and duplicated recent-activity sections exceeded the 256 KiB response limit. This was a delivery failure, not evidence that the upstream RPC lacked this wallet.

Changes:

- Page retained holdings across Solana, Base, Ethereum, BNB and Robinhood with a snapshot-bound cursor. Each page is at most 50 rows and 48 KiB of token rows. Stored history, balances and aggregate P&L are preserved.
- Serve continuation from Raven's retained profile without a new provider call. Reject a cursor for a different wallet or changed balance snapshot.
- Keep the current analysis visible while refreshing the same wallet and after a failed refresh. Switching wallet or chain clears the previous identity.
- Offer additional holdings pages in the profile. A stale or failed page leaves already loaded holdings available.

Validation: 79 existing trading/wallet unit tests passed before changes. The targeted delivery/API suite passed 40 tests; the complete wallet browser suite passed 62 tests, including desktop/mobile pagination, identity isolation and failed-refresh preservation. Security and build checks passed.

Deployed commit `8e81b3ffe` as release `ravenos-8e81b3ffeafb-e8fcfbc2656dd616`, Worker `6a9e9356-d8fd-47ed-961b-41c2bc4a25db`, on both production origins. All 39 release checks passed, covering 24 asset digests and seven authenticated-workspace entry points. No transactions were submitted. No migration or execution-flag change.

Production reproduction now returns HTTP 200, 163,514 response characters, 50 of 348 holdings, and `provider_request_performed: false`. The next holdings page returns HTTP 200 with another 50 rows from the same snapshot and no provider request; the UI shows 100 of 348 loaded. This passes the original delivery failure, not the separate deep-history or cost-basis completeness gates.

## EVM estimates: economic quote discarded by readiness failure

On Base STONKEX/WETH, entering 0.002 ETH triggered the automatic preparation request. It returned HTTP 503 with `insufficient_balance`; the provider's allowance state correctly identified native input as requiring no allowance. Raven discarded the economic estimate when funding was insufficient. This is not a provider outage, and an unfunded account still needs an accurate price preview. No Buy action or transaction was performed in production.

Implemented a bounded economic projection of the validated 0x response. Funding/allowance/gas blockers remain enforced, but the UI retains expected tokens, exact minimum, configured slippage, known impact, the included 1% Raven fee and separate native network cost. No calldata or execution ticket is exposed by this projection. Unknown routes, wrong identities and absent trading fees cannot qualify. A later Buy must still meet the previously displayed minimum. Funding and gas failures now use HTTP 409 rather than masquerading as a provider outage.

Validation: 33 focused economic/approval tests and 126 existing EVM execution tests pass. Thirty terminal browser cases passed initially; the remaining desktop case asserted the superseded inline research behavior. It now verifies the requested research overlay, unchanged Terminal URL and restoration on Close, and passes. All four EVM chains have native/stable unfunded-preview browser coverage, with no simulated signing/approval call. Wrong-wallet estimates and worse prices after funding recovery are rejected. Security/build checks pass. Deployed `d51ac98136e2` as release `ravenos-d51ac98136e2-a73c98ad55665866`, Worker `27517350-af8a-4ec3-aab6-da1a3a59460f`. Production verification passed 39 checks, 24 assets and seven authenticated workspace entry points. The browser URL policy rejected the specific trading-page navigation for the provider preview check; it remains unverified, with no workaround attempted. No transaction was submitted.

This is the first readiness separation: automatic EVM requests still use the existing preparation endpoint for funded routes. A dedicated read-only economic endpoint, broader provider diagnoses and actual user-authorized settlement remain open package-1 work.

## Discover: usable breadth before ranking

New user priority: remove one-holder/dust markets and show substantially more useful tokens, with DexScreener's paginated trending board as the reference.

Production baseline at 2026-09-09 23:53 UTC: the pulse returned exactly 240 rows (48 per chain). Its own source counters reported 1,252 cached-universe markets. Eleven returned rows had one holder and 15 had less than $5,000 reported liquidity. Only 203 passed the new qualification policy. The same deployment showed only 53 Solana candidates in the browser. Thus the visible count was a bounded candidate slice, not Raven's entire stored market universe.

Implementation:

- Apply a shared qualification policy before candidate selection and in the browser. Require at least $5,000 reported pool liquidity, at least 10 holders where a census is supplied, and meaningful volume or transactions. Known low holder counts follow the token across alternate pools. Unknown counts remain unknown. Current evidenced bonding curves with unreported depth require at least 25 holders, 20 transactions and $1,000 volume, and display liquidity as unreported; known zero depth cannot use this exception.
- Remove the 240-row producer/classifier/browser bottleneck for broad Discover. Retain a 2,000-token projection budget to bound Worker memory, report its delivery limit separately from qualified and sampled coverage, and keep only one full projection in isolate memory. This is still a bounded market sample, not a complete global index.
- Page the browser at 100 tokens, applying chain/lifecycle/range filters before pagination. Reset the page when filters change. Preserve complete-cohort ranking across pages.
- Expand the shared collector to at most 750 exact token identities per supported chain, reusing known and prior identities. Dexch cap-band discovery uses a liquidity floor. Existing provider and durable refresh leases remain in use; no wallet RPC, paid plan or execution authority is added.
- Add bounded, rotating seeds from DexScreener's official category pages, recent profile updates and community takeovers. Fresh pair facts still come from exact-token pair requests; profile or category membership never creates a Raven signal.

Verified official endpoints: [DexScreener API reference](https://docs.dexscreener.com/api/reference). Live probes returned 18 trending categories, 30 updated profiles, and 42 pairs in the Cat category (including all five Raven chains). The documented API does not expose the website's complete paginated pair table. No claim of 193,000 indexed Raven markets is made.

Validation: 91 focused unit/API tests passed, including 600 cached candidates producing 598 qualified results with zero provider requests. Four desktop/mobile browser checks passed for 100-row pagination, page isolation, chain-filter reset and six-hour participation drilldown. The broader 56-case browser selection passed 51 initially; the other five asserted the old counter wording or admitted sub-$5K liquidity/inactive launches. Those fixtures now distinguish adequate day activity from a quiet current window and enforce the new liquidity floor; all five pass, plus two additional Solana lifecycle cases. Build, security and response-leak checks pass. Production population verification follows deployment.

Deployed commit `20de87e6ae2a`, release `ravenos-20de87e6ae2a-460a7d31c1d0f1bf`, Worker `8dab9b06-1b05-44a2-a2e9-5c33122473fb`. All 39 release checks pass (24 assets, seven authenticated workspaces; no transactions). At 2026-09-10 00:02 UTC the production API returned 1,737 qualified tokens: Solana 465, Robinhood 607, BNB 489, Base 72 and Ethereum 104. No returned token had one reported holder or known liquidity below $5,000. The shared sample contained 2,074 markets. Later counts fell sharply; a point-in-time result is not proof of sustained breadth.

### Durable discovery and refresh continuation

The subsequent production check exposed two independent causes of shrinking coverage: an incomplete successful refresh replaced the entire previous snapshot, and the two-minute collector cadence plus cache age could exceed the 120-second fresh-market contract. Eleven pair batches failed in one otherwise successful collection. A local probe with a bounded 3 MiB pair response limit instead of 1 MiB returned 1,726 current markets with zero failed batches in 6.5 seconds. A second cycle returned 1,753 current markets, zero failed batches, and 1,621 passing Raven's quality policy. The response-size limit is a plausible contributor to the former failures; new sanitized failure-code counts distinguish it from outages/rate limits going forward.

Implemented a compressed per-chain discovery frontier, separate from price snapshots. It retains up to 10,000 identities per chain (50,000 total), current provider cursors, refresh attempts and retry timing. This is storage capacity, not a claim that 50,000 tokens have been observed or qualify. Its state and the public snapshot commit under the same existing collection lease. A late collector cannot overwrite newer cursors. Successful empty/dead pool responses remove old quotes; failed or unattempted batches preserve the actual prior observation time. Prices are never made fresh by retention.

Provider collection advances four Dexch pages per chain each cycle, rather than restarting the same market-cap pages. A real bounded probe found 1,200 distinct Robinhood tokens with continuation still available, and 850 BNB tokens across nine pages, before Raven qualification. The [Jupiter tag endpoint](https://developers.jup.ag/docs/tokens/token-information) supplies an additional hourly seed catalog of verified Solana mint identities using the existing server-side credential. A verified mint remains subject to liquidity, activity, holder and scope checks; the live catalog count still requires production verification.

Refresh selection combines a hot set with oldest-attempted rotation, with a shared ceiling of 140 pair batches of at most 30 tokens. Small chains retain fair coverage. The minute schedule now invokes the same leased public collector while preserving the independent wallet-ingestion task; the existing two-minute trigger is harmless because both must claim the same lease. Provider in-memory responses also have a 24 MiB byte limit. No paid wallet-RPC budget or execution flag is raised.

Selecting a chain now requests that chain's full current sample, instead of filtering only the smaller all-chain response. The current response remains bounded to 2,000 classified rows for Worker/mobile memory. Explicit counts identify a limited response; further server pagination is still needed before presenting an arbitrarily large filtered index. This is not DexScreener's complete-chain index. The 100-row mobile/desktop pagination tests also caught and fixed a retained-order race after a chain request.

Validation: 108 unit/API/ingestion tests passed initially. A new catalog-specific test caught a missing scope import before release; it and all 13 other participation tests pass after correction. Four targeted browser cases pass. The 41-case broader Discover browser selection passed 38 initially; the three failures exposed refresh-order and research-panel visibility regressions, which were fixed. All affected tests and associated navigation cases pass (two sets of five). Coverage includes failed batches, all-empty invalidation, cursor continuation, 50,000-identity storage bounds, chain fairness, lease races, catalog growth past top-100 seeds, no exposed credential/cursor state, and pagination without duplicate rows. Build/security/no-leak checks pass. Migration `0049_market_discovery_frontier.sql` adds only a replaceable public cache table. Production verification and sustained source/freshness measurements follow deployment.

## Deeper history: concrete remaining blocker

Read-only production inspection found two Solana backfill jobs dead-lettered at exactly 10,000 decoded transactions. The backfill-job table still constrains `signatures_seen` to 10,000 even though newer policy targets 50,000; the later migrations widened page limits and targets but not this constraint. A preserving migration and restart/reconciliation are needed, with dependent page/progress rows retained.

The configured shared Helius budget is also being exhausted: recent hours consumed 600/600 and 560 credits. More paid RPC is not the first fix. Scheduling, retained analysis and progress reporting need to respect the existing budget. A Base inspection briefly returned `account_service_unavailable`, then succeeded on retry with 15 holdings; its underlying history was queued. Neither that transient failure nor the depth target is counted as resolved by holdings pagination.
