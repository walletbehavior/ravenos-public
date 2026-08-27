# RavenOS holder lists and Behavior Lab v1

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

The response is `ravenos.onchain_holder_list.v1` and contains at most 20 owner rows derived from Solana's largest token accounts. Multiple top token accounts with the same parsed owner are aggregated. An account is identified as the exact pool account only when the exact address matches; program, exchange, custody, and insider labels are not guessed.

The list includes rank, address, exact token balance, supply share, token-account count, classification, pool-account exclusion, observation time, slot, and an allowlisted Solscan link. Raw JSON-RPC payloads and provider URLs are never returned.

This is not described as a complete holder census. Full pagination, historical balance changes, named exchange/program labels, and cross-chain holder lists require a separately qualified indexed source.

## Activation

The Free UI and route are implemented, but Solana holder delivery requires both:

- `RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED=1`
- `RAVENOS_PUBLIC_SOLANA_HOLDERS_RPC_URL=<dedicated HTTPS endpoint>`

The route does not reuse `RAVENOS_SOLANA_RPC_URL`. This prevents accidental public-product load on Raven's private trading or research RPC. The configured endpoint must be HTTPS and cannot target local or private-network addresses.

Provider operations are coalesced per exact market, bounded to four concurrent operations, cached for 60 seconds, and limited to three JSON-RPC methods: `getTokenLargestAccounts`, `getTokenSupply`, and `getMultipleAccounts`.

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
