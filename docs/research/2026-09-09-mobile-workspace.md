# Mobile workspace and participation board

## Delivered behavior

Onchain, Perps, and Atlas select the instrument family inside the current Discover or Terminal document. Terminal keeps each family's selected market, timeframe, amount and slippage separately for the current visit. A mode change cannot abandon an unresolved submitted trade. Existing browser preferences remain public display preferences; these controls grant no signing authority.

Mobile Onchain Terminal puts the chart, amount, selected-asset balance, continuously updated receive estimate and single Buy action on one page. Extra market facts, route evidence and settings are expandable. The existing prepare, sign, submit and reconciliation pipeline runs behind the single action; errors and pending states remain visible. There is no automatic order on typing. Smaller/shorter screens can scroll the ticket without hiding its action behind navigation.

Discovery uses compact market rows with readable controls. Wallet profiles, holder analysis, market evidence, Pro intelligence and Raven Reads open in dialogs over the existing page. Closing restores focus and scroll; the chart, filters, URL and trade draft remain mounted. Wallet dialogs reuse the account workspace and server-backed research. Opening a cached account surface rechecks session/entitlements before rendering it; closing stops its history polling. No iframe, separate authentication system, wallet ledger or execution ledger was added.

## Participation measurement

Discovery now leads with clickable participation groups and an optional larger map. Onchain groups use exact chain and market-cap intervals, or reported pairs younger than 24 hours. Selecting a group filters the same current rows, with a clear action to restore prior filters. Duplicate pools do not give a token extra votes. Missing market cap is not replaced with FDV.

The current Onchain statistic is median **six-hour token-price change**, not realized wallet P&L or a chain-wide census. Pairs younger than six hours and unknown-age pairs cannot supply a complete six-hour observation. At least five measured tokens and 60% coverage of the tracked group are required for a directional color. Thin or stale evidence stays neutral. Positive breadth, negative tails, coverage and freshness are retained alongside the median.

Perps uses the same interaction, with groups by open interest or funding direction. Its existing shared venue feed supplies **24-hour** price change and notional volume, so that window is labeled explicitly. A six-hour Perps view needs separately measured six-hour inputs; no scaling of 24-hour values is used. Price change is not leveraged trader P&L, and positive funding is not a return forecast.

Large map areas are proportional to reported volume in the stated window. Tiny or unmeasured tiles become readable buttons; mobile uses buttons throughout. Onchain boards now read a separate durable public snapshot; Perps reuses the shared venue payload. Refreshes preserve keyboard focus. Clicking a cell reads its matching cached markets without a provider or RPC scan.

## Provider reads and measured limits

Dexch's existing BNB/Robinhood lanes now include a bounded high-volume sample alongside trending, new, almost-graduated and graduated tokens. Lanes are interleaved before the per-chain cap of 90. DexScreener exact-identity lookups are batched at 30 tokens. The reader retains its shared cache, in-flight coalescing, timeout and response limits. Raven's known markets seed other chains before fresh discovery. No new paid subscription, overage setting, GMGN credential or wallet-history budget was added.

The initial shortlist probe had 77 markets and 27 complete observations; broadening the shortlist alone reached 150 markets and 56 observations. This exposed a sampling bottleneck. Production already retained 2,400 market identities: Solana 1,342, Robinhood 406, BNB 339, Base 117 and Ethereum 196.

The independent reader pages each Dexch chain/cap band separately (up to two pages of 100 per band), combines candidates with the retained universe, and batches exact-market reads at 30 token addresses per call. It reserves up to 450 token candidates per chain so the largest feed cannot consume the entire budget. Existing Jupiter credentials also enable four category/interval seed reads capped at the documented 100 tokens each. No data subscription or overage setting changed.

The final live probe, using the production retained identities and public market APIs, measured **1,468 markets and 1,090 complete six-hour observations**. Coverage: Solana 448, Robinhood 406, BNB 370, Base 87, Ethereum 157. Nineteen groups met the existing coverage/sample thresholds. Collection took 8,420 ms and 74 aggregate API requests, with zero fresh RPC calls, failed lanes or failed batches. No Jupiter credential was used for this local probe. This is a bounded market sample, not complete chain coverage or realized-wallet P&L.

A compressed D1 snapshot retains all these observations without reducing smaller-chain coverage to fit the storage limit. A fenced lease allows one shared refresh across visitors and Worker instances, at most once per minute. A separate two-minute scheduler maintains it without entering wallet ingestion, billing or execution. Failed refreshes retain the previous successful snapshot with its original timestamps. Public board responses contain aggregate cells; selecting a group retrieves up to 200 normalized cached market rows. No per-visitor universe collection occurs. `RAVENOS_PARTICIPATION_UNIVERSE_ENABLED` independently disables this reader.

The provider replacement work also adds identity-checked Dexch candles. Its current chain support does not replace CoinGecko for every chain. Robinhood token-scoped candles whose pool differs from the selected pool are rejected. See the separate provider research report and raw measurements.

## Verification and release boundary

The complete change passed 1,047 contract tests, including snapshot lease, compressed-storage, identity, pagination and host-boundary tests. All 176 relevant browser checks passed. Browser checks cover 375/390/430-pixel spot tickets, simulated single Buy, EVM flows, modes, overlay close/focus/draft preservation, cached wallet access, Discovery filters and desktop layouts. Fixture trades are not evidence of a completed production trade.

This source document records implementation, not deployment. Exact release and verification receipts establish production status. Existing chart-provider release checks remain required; no failed gate or unavailable provider is converted into a successful receipt.

Migration `0048_participation_snapshot.sql` adds one shared public read-model table. It does not add or replace any financial ledger. No production trade, subscription charge, fund movement or new custody capability is part of this change.
