# RavenOS Universal USDC Shadow Execution v1

## Product invariant

The terminal may present a market as trade-ready only when RavenOS has current, exact-asset evidence for both entry and liquidation. Discovery, a marked price, or a one-way quote is not execution evidence.

The intended user abstraction is one economic USDC buying-power balance across qualified chain-local balances. This is not custody and does not imply that funds occupy one account or chain.

## Current release boundary

- Hyperliquid perpetuals: exact-market quote and order-plan review.
- Solana spot: same-chain canonical-USDC entry quote plus immediate token-to-canonical-USDC reverse quote.
- Base, BNB Chain, Ethereum, Robinhood Chain, Arbitrum, Optimism, Polygon, Avalanche, Tron, and Sui: exact-market ticket shell with adapter state; no substituted route.
- Cross-chain funding and settlement: adapter pending.
- Wallet access: optional public-address observation only.
- Signing, approvals, transaction construction, submission, bridging, custody, and fee charging: unavailable.

The Solana shadow adapter deliberately keeps network cost unavailable until it can be priced from transaction-specific evidence. A verified reverse quote can therefore show `Exit verified` while complete round-trip friction and real trade availability remain unavailable.

## Identity

Assets are identified by chain, network, standard, and exact contract or mint. Symbols never select assets. Circle-issued native USDC addresses are held in a bounded registry and kept distinct from USDC.e, bridged, synthetic, or similarly named assets.

## Shadow request and route policy

`UniversalQuoteRequest` specifies canonical USDC, an exact destination asset, amount, slippage, time, and deterministic selection policy. Source chain is selected from future verified routable buying power unless the user explicitly overrides it.

Provider responses normalize into `UniversalRouteCandidate` without transaction material. Candidates retain source/destination chains and assets, expected/minimum output, costs, price impact, timing, venues, intermediates, trust dependencies, and refusal state.

The default policy is friction-complete economic outcome. Provider order never breaks a tie. If costs are incomplete, a sole candidate may be inspected in shadow review but is not described as friction-complete or executable.

## Exit proof

For a buy producing quantity `Q`, RavenOS immediately requests approximately `Q` of the exact destination token back to canonical USDC. The proof keeps these separate:

- input USDC;
- expected and minimum destination quantity;
- expected and minimum executable reverse USDC;
- explicit route/network/provider/Raven costs;
- complete round-trip friction when every cost is known;
- entry and exit quote expiry;
- provider and exact-asset provenance.

Marked value never substitutes for executable liquidation value. Missing reverse liquidity remains unavailable, never zero.

## Future execution lifecycle

Cross-chain execution is sealed behind explicit states: quoted, authorized, source submitted, source confirmed, destination pending, destination filled, and settled. Failure states include quote expired, source failed, destination failed, refund pending, refunded, failed, and indeterminate. Source confirmation alone can never mean filled.

## Next empirical gate

Before signing is designed, shadow observations need append-only retention and checkpoint evaluation across route sizes, assets, and providers. The gate measures quote success, reverse-route success, latency, persistence, deterioration, cost completeness, provider failure, and refusal rate. No production execution capability follows automatically from a passing shadow sample.
