# Robinhood wallet-event adapter

Status: staged contract only. It does not expose a public route, write D1, activate a service, create a shadow decision, quote a trade, or authorize execution.

RavenOS's first source-wallet tables and observer were deliberately Solana-specific. Their IDs, addresses, signatures, slots, transports, profile fields, position assets, and database checks encode Solana semantics. A Robinhood transaction must not be forced into those columns by calling a block number a slot or an EVM address a mint.

`source_wallet_chain_identity.mjs` introduces the narrow shared identity primitive:

- Solana mainnet public key → the existing unchanged `sw_sol_*` identity;
- Robinhood mainnet chain ID `4663` plus exact EVM address → `sw_rh_*` identity;
- chain-specific transaction-reference validation;
- no ticker-based identity, controller identity, subscriber identity, or cross-address ownership inference.

`robinhood_wallet_event_adapter.mjs` accepts only the reviewed Raven Core economic-event contract. It verifies the exact economic actor, transaction and block identity, finality, independent-provider state, asset identities and net deltas, canonical-USDC truth, privacy boundary, and all-disabled execution boundary. An agreed event becomes `ROUTE_PROOF_REQUIRED`; a single-provider event remains `PROVIDER_CONFIRMATION_REQUIRED`. Neither state is a trade decision.

This contract is the seam for the future chain-neutral D1 migration. The migration must update the existing shared source-wallet system coherently—identity, events, observer deliveries/jobs/latency, watches, positions, profiles, backfill, screener, and copyability—rather than create a parallel Robinhood wallet product. Until that migration and its rollback plan are reviewed, the adapter remains unwired and Robinhood data is not represented as Solana data.
