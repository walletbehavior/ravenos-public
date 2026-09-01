# Robinhood wallet-event adapter

Status: staged shared-ledger implementation; activation remains disabled. The code now includes the chain-neutral D1 migration, bounded Robinhood activity profiles, shared screener projection, private ingress boundary, and RavenOS Pro chain selector. Migration `0023` has not been applied to production, no Raven Core delivery service is activated, and no shadow decision, quote, transaction construction, fee collection, signing, broadcasting, custody, or live execution is authorized.

RavenOS's first source-wallet tables and observer were deliberately Solana-specific. Their IDs, addresses, signatures, slots, transports, profile fields, position assets, and database checks encode Solana semantics. A Robinhood transaction must not be forced into those columns by calling a block number a slot or an EVM address a mint.

`source_wallet_chain_identity.mjs` introduces the narrow shared identity primitive:

- Solana mainnet public key → the existing unchanged `sw_sol_*` identity;
- Robinhood mainnet chain ID `4663` plus exact EVM address → `sw_rh_*` identity;
- chain-specific transaction-reference validation;
- no ticker-based identity, controller identity, subscriber identity, or cross-address ownership inference.

`robinhood_wallet_event_adapter.mjs` accepts only the reviewed Raven Core economic-event contract. It verifies the exact economic actor, transaction and block identity, finality, independent-provider state, asset identities and net deltas, canonical-USDC truth, privacy boundary, and all-disabled execution boundary. An agreed event becomes `ROUTE_PROOF_REQUIRED`; a single-provider event remains `PROVIDER_CONFIRMATION_REQUIRED`. Neither state is a trade decision.

Migration `0023_source_wallet_chain_neutral.sql` extends the shared source-wallet and event ledger without relabeling EVM transaction hashes as Solana signatures or EVM blocks as slots. Existing Solana identifiers and rows remain stable. RavenOS can ingest an already-normalized adapter event into that ledger, build an activity-only Robinhood profile, save the wallet for research, and screen the bounded Robinhood index through the same filter engine.

The current profile deliberately leaves cost basis, P&L, ROI, win rate, historical entry liquidity, balances, marks, and executable value unavailable. USDG, wrapped ETH, native ETH, and canonical USDC remain distinct. The Robinhood Shadow control remains disabled until Raven can prove a current exact entry and reverse liquidation route. The existing Solana observer universe is explicitly restricted to Solana rows, so the transition cannot send an EVM address into Solana transport or backfill code.

Activation still requires a reviewed private Raven Core → RavenOS delivery path, production migration approval and rollback evidence, bounded Robinhood archive backfill, asset metadata/decimal evidence, and exact entry plus reverse-exit routing. Those are operational milestones; the staged implementation grants no execution authority.
