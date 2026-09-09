# Mobile workspace and participation board

## Delivered behavior

Onchain, Perps, and Atlas select the instrument family inside the current Discover or Terminal document. Terminal keeps each family's selected market, timeframe, amount and slippage separately for the current visit. A mode change cannot abandon an unresolved submitted trade. Existing browser preferences remain public display preferences; these controls grant no signing authority.

Mobile Onchain Terminal puts the chart, amount, selected-asset balance, continuously updated receive estimate and single Buy action on one page. Extra market facts, route evidence and settings are expandable. The existing prepare, sign, submit and reconciliation pipeline runs behind the single action; errors and pending states remain visible. There is no automatic order on typing. Smaller/shorter screens can scroll the ticket without hiding its action behind navigation.

Discovery uses compact market rows with readable controls. Wallet profiles, holder analysis, market evidence, Pro intelligence and Raven Reads open in dialogs over the existing page. Closing restores focus and scroll; the chart, filters, URL and trade draft remain mounted. Wallet dialogs reuse the account workspace and server-backed research. Opening a cached account surface rechecks session/entitlements before rendering it; closing stops its history polling. No iframe, separate authentication system, wallet ledger or execution ledger was added.

## Participation measurement

Discovery now leads with clickable participation groups and an optional larger map. Onchain groups use exact chain and market-cap intervals, or reported pairs younger than 24 hours. Selecting a group filters the same current rows, with a clear action to restore prior filters. Duplicate pools do not give a token extra votes. Missing market cap is not replaced with FDV.

The current Onchain statistic is median **six-hour token-price change**, not realized wallet P&L or a chain-wide census. Pairs younger than six hours and unknown-age pairs cannot supply a complete six-hour observation. At least five measured tokens and 60% coverage of the tracked group are required for a directional color. Thin or stale evidence stays neutral. Positive breadth, negative tails, coverage and freshness are retained alongside the median.

Perps uses the same interaction, with groups by open interest or funding direction. Its existing shared venue feed supplies **24-hour** price change and notional volume, so that window is labeled explicitly. A six-hour Perps view needs separately measured six-hour inputs; no scaling of 24-hour values is used. Price change is not leveraged trader P&L, and positive funding is not a return forecast.

Large map areas are proportional to reported volume in the stated window. Tiny or unmeasured tiles become readable buttons; mobile uses buttons throughout. Refreshes reuse shared Discovery/venue payloads and preserve keyboard focus. No per-cell RPC calls are introduced.

## Provider reads and measured limits

Dexch's existing BNB/Robinhood lanes now include a bounded high-volume sample alongside trending, new, almost-graduated and graduated tokens. Lanes are interleaved before the per-chain cap of 90. DexScreener exact-identity lookups are batched at 30 tokens. The reader retains its shared cache, in-flight coalescing, timeout and response limits. Raven's known markets seed other chains before fresh discovery. No new paid subscription, overage setting, GMGN credential or wallet-history budget was added.

Two append-only local live-read reports accompany this change. The expanded probe returned 150 rows in 3,001 ms: BNB 89, Robinhood 52, Solana 7, Base 1 and Ethereum 1. It had 56 complete measured samples across 15 groups, of which 14 remained developing and one mixed/fragile. These results are a public-feed probe without the production retained-market cache or configured Jupiter feed; they do not establish production coverage. The neutral cells are a real coverage limitation, not a reason to manufacture colors.

The provider replacement work also adds identity-checked Dexch candles. Its current chain support does not replace CoinGecko for every chain. Robinhood token-scoped candles whose pool differs from the selected pool are rejected. See the separate provider research report and raw measurements.

## Verification and release boundary

Contract suite: 1,038 passing, including participation measurement and existing execution/accounting tests. Browser checks cover 375/390/430-pixel spot tickets, simulated single Buy, EVM flows, modes, overlay close/focus/draft preservation, cached wallet access, Discovery filters and desktop layouts. Fixture trades are not evidence of a completed production trade.

This source document records implementation, not deployment. Exact release and verification receipts establish production status. Existing chart-provider release checks remain required; no failed gate or unavailable provider is converted into a successful receipt.

No database migration, production trade, subscription charge, fund movement or new custody capability is part of this mobile change.
