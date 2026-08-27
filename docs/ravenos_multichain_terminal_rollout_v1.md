# RavenOS multi-chain Terminal rollout v1

## Product objective

RavenOS Terminal is intended to become an all-chain exact-market workspace comparable in coverage to crypto-native terminals. Coverage expands in independently reviewed layers rather than treating lookup, charting, routing, signing, and submission as one capability.

The first expansion adds BNB Chain exact-token lookup and exact-pool chart contracts. It does not activate BNB trade routing or execution.

## Capability model

Every chain is evaluated separately for:

1. Exact token and pool lookup
2. Exact-pool candles and current market facts
3. Raven observations with exact lineage
4. Route and slippage review
5. Wallet/network compatibility
6. Transaction preparation
7. User signing
8. Submission and post-trade reconciliation

A capability at one layer never implies the next layer. In particular, a chartable pool is not described as tradeable, and a route preview is not described as executable.

## Current customer-visible coverage

| Chain or venue | Exact lookup | Chart | Route review | Signing | Submission |
|---|---:|---:|---:|---:|---:|
| Hyperliquid perps | Yes | Yes | Review only | No | No |
| Solana | Yes | Yes | Separate reviewed boundary | No | No |
| BNB Chain | Yes | Yes | Not active | No | No |
| Base | Yes | Yes | Not active | No | No |
| Ethereum | Yes | Yes | Not active | No | No |
| Robinhood Chain | Yes | Yes | Not active | No | No |

Provider-listed markets on other chains can appear in universal search only when exact identity is retained. A chain without a verified chart contract remains lookup-only and must say so.

## Expansion order

The next EVM adapter cohort is Arbitrum, Polygon, Avalanche, and Optimism. Tron and Sui follow as a separate high-activity non-EVM cohort. Additional provider-listed chains remain long-tail lookup candidates until chart and route behavior are independently verified.

This sequence is operational rather than exclusive. A high-demand chain can move forward when it has:

- stable exact-pool identity and token orientation;
- qualified public-display rights for required market data;
- bounded provider pacing, caching, and circuit behavior;
- verified candle continuity and price units;
- a reviewed router and slippage model;
- wallet/network protections and transaction simulation;
- signing, submission, and reconciliation security review.

## Exact-identity requirements

- Contract and mint addresses, not symbols, select tokens.
- Pool addresses, chain, venue, quote token, and selected-token orientation select charts.
- Identically named assets and same-symbol pools never merge.
- A missing or migrated pool never silently follows another pool.
- A token found on the quote side of a provider pair is reoriented before display. Provider base-token price, market-cap, and flow direction are not reused for the selected quote token.
- Full pasted messages may contain bounded EVM or Solana addresses; RavenOS extracts those exact identities before provider lookup.

## Provider and legal boundary

No rollout stage overrides provider display rights. API access, a free key, or a paid account is not by itself redistribution permission. Production activation of a chart source remains subject to its reviewed public-display policy, attribution, caching, and commercial terms.

The browser never receives provider credentials. External lookups run through RavenOS server pacing, caching, response bounds, and circuit behavior.

## Execution boundary

This version is research-only. It adds no wallet signing, transaction preparation, submission, brokerage connection, or custody. When execution work begins, each chain adapter must fail closed on chain mismatch, token mismatch, quote mismatch, stale block state, simulation failure, excessive slippage, and changed route bindings.

## Acceptance conditions

- The supplied BNB contract resolves to the selected token even when it is on a provider pair's quote side.
- The exact BNB pool opens with validated candles and no execution controls.
- A full pasted message resolves the embedded address without triggering redundant fake address searches.
- The Terminal visibly distinguishes chart, route-review, signing, and submission states.
- Unsupported chains remain searchable where provider identity exists but never inherit another chain's chart or route capability.
- Desktop and mobile remain contained, keyboard-operable, and exact-market URLs preserve chain, pool, token, and quote identity.
