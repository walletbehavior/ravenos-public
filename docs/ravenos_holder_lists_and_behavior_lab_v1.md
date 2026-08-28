# RavenOS holder lists v2 and Behavior Lab v1

## Product boundary

Actual holder drilldowns are a Free Terminal capability. They are market-safety facts, not premium Raven intelligence.

Behavior Lab is a Pro capability. It searches aggregate Raven market-behavior cohorts and keeps denominators, exclusions, confidence, and observed forward-outcome context attached to every row.

Neither capability grants wallet, signing, submission, brokerage, or execution authority.

## Exact-market holder route

`GET /api/onchain/holders`

Required query fields:

- `chain=solana`
- `pair_address`
- `token_address`
- optional exact `quote_address`

The Worker first re-resolves the exact pool and token orientation. It fails closed when the pool, selected mint, or quote identity differs. Symbols never select a holder list.

The response is `ravenos.onchain_holder_list.v2`. The preferred path resolves the mint's Token or Token-2022 program, scans its token accounts using an exact mint filter and provider pagination, decodes balances without floating-point conversion, and aggregates every nonzero token account into its on-chain owner. The public response contains the top 100 owners plus the total owner and token-account counts and top-10/20/50/100 concentration summaries.

The scan is bounded to 25 provider pages and 25,000 source token accounts. `complete_holder_census` is true only when provider pagination ends inside those bounds. If a complete scan cannot be proven, RavenOS discards the partial ranking and returns the independently verified largest-20 view instead. It never presents a partial account scan as a complete or globally ranked census.

An account is identified as the exact pool account only when the exact address matches. Program, exchange, custody, bundle, developer, and insider labels are not guessed.

The list includes rank, address, exact token balance, supply share, token-account count, classification, pool-account exclusion, observation time, slot, and an allowlisted Solscan link. Raw JSON-RPC payloads and provider URLs are never returned.

The census describes current ownership only. Historical balance changes, named exchange/program labels, bundle or coordination claims, and cross-chain holder lists require separately qualified evidence.

## Exact-market risk screen

The Free Terminal derives `ravenos.market_control_risk.v1` beside the holder list. It is a screening contract, not a scam verdict or a numeric rug probability.

The screen keeps three questions separate:

- Token control: pool-excluded wallet concentration, largest observed non-pool wallet, exact mint and freeze authorities, a provider honeypot flag when available, and the current balance of a provider-listed developer address only after an independent on-chain balance check.
- Market integrity: pool age and reported 24-hour turnover relative to the current market-cap or FDV reference.
- Authenticity: whether provider-listed name, image, description, and social metadata is verified by that provider.

CoinGecko's beta holder-distribution percentages include multiple account types. RavenOS does not use that pool-inclusive top-10 percentage as wallet concentration. The holder projection instead classifies and excludes the exact pool account before calculating `top_10_wallet_supply_pct`.

A provider-reported developer percentage is never treated as verified ownership. RavenOS retains the provider-listed address only when it is a valid exact-chain address, then measures that address against the exact mint with `getTokenAccountsByOwner`. The wording remains “provider-listed developer address” because the provider label itself is not independently proven.

Bundle concentration, insider and sniper classification, and liquidity ownership/lock/burn provenance remain explicitly unmeasured until a reviewed source can provide exact-market evidence with public-display rights. Missing values never become zero or a passed check.

## Exact-pool activity

`GET /api/onchain/trades` supplies the Free Terminal's recent-swaps pane. It requires exact chain, pool, token, and quote addresses, re-resolves the pool orientation on the server, and returns at most 120 of the provider's latest 300 trades from the past 24 hours.

The server derives bounded 5-minute, 1-hour, and 24-hour buy/sell counts, USD flow, buy-volume share, and repeat transaction senders within the returned sample. Active traders are descriptive public-chain addresses only. RavenOS does not infer beneficial ownership, relationships, bundles, skill, profitability, or “smart money” status from recurrence.

This tape is useful for reviewing an extreme-turnover warning, but it is not complete lifetime history and does not by itself prove wash trading or manipulation.

## Activation

The Free UI and route require both:

- `RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED=1`
- `RAVENOS_PUBLIC_SOLANA_HOLDERS_RPC_URL=<dedicated HTTPS endpoint>`

The production release enables the first control and requires the second as a server-only Cloudflare secret. Raven's existing paid Solana Alchemy endpoint was structurally validated against the exact BITCAT mint using `getAccountInfo`, `getTokenSupply`, and the exact-mint `getProgramAccounts` scan. No endpoint or key entered a public response or release artifact.

The route does not implicitly fall back to `RAVENOS_SOLANA_RPC_URL`. This prevents an environment mistake from silently placing public-product load on an unrelated private RPC. The configured endpoint must be HTTPS and cannot target local or private-network addresses.

The dedicated endpoint may be an Alchemy Solana endpoint owned by the existing Raven account. It remains a separate environment binding so public holder traffic can be metered, rotated, and disabled without changing Raven's private trading or research access.

Provider operations are coalesced per exact market, bounded to four concurrent operations, cached for three minutes, and limited to current-state JSON-RPC methods. The preferred path uses `getAccountInfo`, `getTokenSupply`, and paginated `getProgramAccounts`. `getTokenLargestAccounts` and `getMultipleAccounts` are allowed only as the truthful fallback. Raw provider errors, endpoints, keys, page keys, and payloads are never returned.

## Behavior Lab

Behavior Lab continues to use the existing authenticated `intelligence.participant_advanced` capability and `/api/v1/intelligence/participants` route. The browser can only search and filter the server-projected aggregate matrix.

Each Pro row includes:

- Stable cohort ID
- Chain, capitalization cohort, and window
- Participation trend and aggregate behavior state
- Descriptive association direction
- Participant success rate and outcome score
- Forward-outcome class and context
- Confidence and score strength
- Observed, usable, and excluded sample counts
- Bounded search terms

Filters cover text, chain, capitalization, window, participation, behavior, outcome, confidence, minimum usable sample, and sorting.

These are descriptive observed associations. They are not causal claims, wallet rankings, or calibrated probabilities. Actor identities, wallet labels, relationship graphs, and private participant data remain excluded.
