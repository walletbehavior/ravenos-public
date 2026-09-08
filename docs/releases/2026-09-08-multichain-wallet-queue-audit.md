# Multichain cached analysis and queue fairness

The follow-up audit covers Solana, Base, Ethereum, BNB Chain, and Robinhood. The prior release fixed market-discovery starvation and distinguished temporary cached-profile read failures from missing profiles. This release closes the same class of ordering problem further down the wallet pipeline.

## Findings and changes

- Background wallet admission previously let a continuous high-priority list from one chain fill every warmup slot. Admission now chooses one wallet per chain before additional wallets, rotating by the last durable background admission. KOL, smart-money, and top-holder/trader priorities still order wallets within each chain. Disabled providers are excluded before the limit; already queued or analyzed wallets are not admitted again.
- History leases previously gave one chain's source-list priority every background slot. Selection now rotates chains using durable service timestamps, including attempts and active leases. Customer watches, saved research, and direct lookups retain their higher demand bands. Cursor persistence, compare-and-set leases, history limits, retries, and provider credit controls are unchanged.
- Profile refresh selection could likewise spend every slot on one chain. Each demand band now rotates eligible chains on the existing five-minute cadence, including when previous profile construction failed and wrote no snapshot. Within each chain, demand, evidence, and age still order candidates. This requires no migration or additional refresh slots.
- Cached analysis retrieval uses the shared, chain-aware route and exact source ID. Added browser regressions cover both analyzed and observed-wallet cards on all four EVM chains, including a temporary 503 followed by the correct cached profile. The selected chain and complete address remain correct; retries never launch a provider inspection or Copy enrollment.

The background warmup/history and profile-refresh fairness tests failed against the previous ordering and pass with these changes. This is a scheduling correction, not a claim that every discovered wallet already has reconstructed history. Provider availability, retained evidence, and existing budgets continue to determine coverage.

## Validation

- 158 backend tests passed across wallet discovery, history, profile storage, retained indexes, EVM lookup/reconstruction, chain identity, wallet cards, and screener access.
- 51 wallet browser tests passed, including all four EVM chains, Solana, mobile cards, transient and persistent read failures, access/rate/missing boundaries, and exact address/chain selection.
- High-priority Solana source backlogs do not exclude EVM chains. Four-slot batches serve all five chains across successive turns. Direct user requests remain ahead of background research. Disabled history providers do not consume enabled chains' admission slots.
- The existing Solana-only Copy observer/admission boundaries are intentional and remain unchanged; this audit does not enable live EVM Copy.

No migration, provider budget increase, execution-pricing change, or financial activation is included. Source discovery and cached analysis remain separate from signing and trading.
