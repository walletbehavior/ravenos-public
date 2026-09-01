# RavenOS multi-chain agentic trading v1

Status: the typed control plane, deterministic policy path, realistic paper execution, durable multi-leg orchestration, read-only venue adapters, bounded Robinhood Chain ingestion, Agent Radar projection contract, and authenticated Agents workspace are implemented. All production and venue live-execution paths remain disabled. Migration `0025_agentic_trading.sql` is not applied by this change.

## Product boundary

Raven remains the evidence and proof producer. RavenOS owns the customer control plane:

```text
Unified portfolio
  -> EvidencePacket
  -> TradePlan
  -> TradeIntent legs
  -> deterministic PolicyDecision
  -> preview or paper receipt
  -> reconciliation
  -> OutcomeRecord
```

No model constructs a transaction, selects an arbitrary destination, signs, broadcasts, weakens policy, or converts an unresolved leg into a completed plan. A typed and hashed `AgentSpec`, not its source prose, is authoritative.

This release is intentionally limited to `preview` and `paper`. It adds no custody, keys, account approvals, transaction calldata, order submission, autonomous bridge, or automatic compensation trade.

## Existing systems reused

- Portfolio Governor semantics for user-owned, versioned deterministic risk policy.
- Universal USDC and portfolio semantics that distinguish marked, executable, stale, unavailable, and chain-local capital.
- Exact Solana route review and Jupiter quote evidence; no second Solana quote engine.
- Hyperliquid L2, account, fee, margin, and funding evidence; no second Hyperliquid market stack.
- Raven source envelopes, typed source identities, provenance digests, chronology/finality, source-service epoch, safety booleans, and official funding evidence.
- Existing RavenOS sessions, CSRF protection, Pro grants, D1, Worker scheduling, route generation, and app-shell conventions.
- Existing wallet screening and copy evidence as future signal inputs. This layer does not duplicate their observer or accounting systems.

## Canonical identity

All identity is exact and versioned:

- `ChainId` distinguishes Solana, EVM chain IDs, Hyperliquid ledger/environment, and offchain brokerage venues.
- `VenueId` identifies the execution venue and environment independently of chain.
- `AssetId` includes chain, exact mint/contract or venue asset, token standard, issuer, and representation.
- `InstrumentId` distinguishes spot, perpetual, equity, ETF, option, tokenized equity, synthetic, lending, LP, and borrowed exposure.
- `SettlementAsset` keeps accounting, quote, settlement, fee, and native gas assets separate.

`USDC` is never sufficient identity. Native and bridged representations remain separate. SOL spot, SOL perpetual, wrapped SOL, and an offchain brokerage instrument cannot collide.

## Raven evidence mapping

`EvidencePacket` preserves Raven fields without collapsing them into a generic observation ID:

- envelope and integrity digests: schema/contract/semantic IDs, row and prior-row digests, package/receipt/activation digests, and source-service epoch;
- typed source identities: cycle, bar, frame, entry/trigger/checkpoint observation, position, outcome, root, and route-evidence references;
- chain, venue, protocol, factory/router/quoter/pool manager, pool, exact token addresses, provider coin, direction, and explicit unknown values;
- observation, capture, availability, query, block/slot, finality, lag, strict-source, payload, and provider-book chronology;
- Hyperliquid official funding boundary, raw row and digest, reduced rational rate, price/quantity atoms, signed PnL atoms, bracket timestamps, activation identity, and a separate completeness gate;
- all Raven safety booleans verbatim.

Evidence never confers execution authority. Missing funding, liquidity, gas, finality, balance, quote decomposition, or exit evidence remains unknown and blocks the affected conclusion.

## Records and durable lifecycle

The immutable records are `AgentSpec`, `EvidencePacket`, `TradePlan`, `TradeIntent`, `CapitalTransferIntent`, `PolicyDecision`, `ExecutionReceipt`, and `OutcomeRecord`. Each is schema-versioned, validated, canonicalized, hash-bound, and checked for secret-bearing or execution-payload fields.

Agent and plan state changes are explicit. Economic evidence and audit events are append-only. Mutable saga, reservation, and outbox rows are separate operational state.

A multi-leg plan cannot become `completed` while a required leg is unresolved. A one-sided spot fill plus failed hedge becomes `partially_executed`, exposes the unhedged position, and enters reconciliation. Restart resumes reconciliation without replaying the fill. Retry, unwind, or compensation requires a current policy decision; it is never inferred from the original approval.

Capital reservations are exact to user, chain, venue, and asset. Capital on another chain cannot satisfy the leg. Network/gas cost is included in the local debit and an unavailable native gas reserve blocks the plan.

## Deterministic policy

The engine evaluates every leg and the combined portfolio. It supports exact allowlists and limits for capital, chain, venue, instrument, notional, gross exposure, concentration, slippage, impact, friction, gas, quote/evidence age, provider health, local balance, local gas reserve, partial exposure, unhedged duration, and approval.

Hard invariants:

- indeterminate never becomes allow;
- changed plan, intent, quote, portfolio, or policy invalidates a prior decision;
- splitting legs cannot bypass plan limits;
- every required leg needs a current leg decision and the plan needs a current combined decision;
- provider failure and stale evidence fail closed;
- duplicate delivery cannot duplicate a paper fill.

## Venue adapters

| Adapter | Current capability | Live placement |
| --- | --- | --- |
| Solana | Existing exact route/economic evidence -> normalized quote/preview/paper | Throws `live_execution_disabled` |
| Hyperliquid | Existing L2/account/fee/funding evidence -> normalized quote/preview/paper | Throws `live_execution_disabled` |
| Robinhood Chain | Remote RPC observation, health, gas/preview foundation | Disabled |
| Generic EVM | Exact chain/contract/account observation foundation | Disabled |
| Robinhood brokerage | Separate read-only capability/preview boundary | Disabled; no credentials requested |

Paper fills use executable bid/ask, depth, or route evidence. They never fill from a last-traded price. They model precision, available depth, partial fills, latency, expiry, rejection, venue fees, provider fees, funding, network cost, gas, and slippage.

## Robinhood Chain ingestion and Agent Radar

The observer is a bounded remote-RPC indexer, not a full node. It uses Alchemy HTTPS/WebSocket as configurable primary and Robinhood's public RPC as configurable fallback. It verifies chain ID, rejects unsafe endpoint hosts, deduplicates provider deliveries, persists cursor/anchor/log evidence, detects gaps and bounded reorgs, and advances the cursor only after evidence is durably stored.

Raw observations remain append-only after a reorg. Derived consumers must use `ravenos_robinhood_canonical_log_observations`, which admits an observation only when its block hash matches the latest persisted anchor at that height. This preserves the replaced evidence without letting it silently re-enter a current projection.

The watch surface is empty by default. Scans require a reviewed registry entry containing exact chain, contract, category, topics, start block, and provenance. The service never expands to an unbounded all-log scan.

Agent Radar separates:

- verified facts;
- external claims;
- explicit unknowns;
- capability/control warnings;
- attributable current activity.

Token volume does not become agent revenue, agent performance, or proof that an agent is active. No opaque `safe` label is produced.

Authoritative references verified on 2026-09-01:

- [Robinhood Chain connecting](https://docs.robinhood.com/chain/connecting/)
- [transaction finality](https://docs.robinhood.com/chain/transaction-finality/)
- [account abstraction](https://docs.robinhood.com/chain/account-abstraction/)
- [Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [contracts](https://docs.robinhood.com/chain/contracts/)
- [node requirements](https://docs.robinhood.com/chain/run-a-full-node/)
- [Robinhood agentic trading overview](https://robinhood.com/us/en/support/articles/agentic-trading-overview/)
- [Alchemy Robinhood Chain API](https://www.alchemy.com/docs/robinhood-chain/robinhood-chain-api-overview)

The verified network identifiers are mainnet `4663`, testnet `46630`, with native gas asset ETH. No contract is activated solely because it appears in documentation or marketing.

## UI and access

`/agents/` is an authenticated Raven Pro workspace. The API is app-origin-only, owner-scoped, private/no-store, size-bounded, and gated by the existing entitlement system plus `RAVENOS_AGENTIC_PAPER_ENABLED`.

The workspace shows paper state, venue-local capital, warnings, current plan legs, policy decisions, partial/reconciliation states, append-only activity, and Agent Radar facts/claims/unknowns. Pause and kill require CSRF and append an audit event. Kill does not place an unwind.

The two-venue demonstration fixture is accepted only on localhost with `?fixture=two-venue`; production cannot select it and the API never returns fixture data.

## Feature flags and configuration

Defaults are off:

- `RAVENOS_AGENTIC_PAPER_ENABLED`
- `RAVENOS_ROBINHOOD_CHAIN_INGESTION_ENABLED`
- `RAVENOS_AGENT_RADAR_ENABLED`

Robinhood observer configuration:

- `RAVENOS_ROBINHOOD_CHAIN_NETWORK`
- `RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_API_KEY`, or explicit primary RPC/WSS URLs
- `RAVENOS_ROBINHOOD_CHAIN_FALLBACK_RPC_URL`
- `RAVENOS_ROBINHOOD_CHAIN_ALLOWED_RPC_HOSTS`
- `RAVENOS_ROBINHOOD_CHAIN_WATCH_REGISTRY_JSON`
- bounded cycle/query/concurrency/reorg/lag/timeout settings documented in `lib/agentic_trading/robinhood/robinhood_chain_sources_2026-09-01.md`

All apparent live-enable variables are ignored by the agent API. Global live agents, every venue's agent execution, autonomous bridging, and automated compensation remain hard false in code.

## Resource model

Default Robinhood ingestion work is at most four catch-up cycles per schedule, ten blocks per cycle, 64 log queries per cycle, and concurrency four. The entire scheduled invocation shares harder defaults of 192 RPC attempts, 128 log queries, 8 MiB of response data, and 25 seconds of wall time. Enforced configuration ceilings are 100 blocks per cycle, 256 queries per cycle, 512 aggregate RPC attempts or log queries, 32 MiB per schedule, 120 seconds, and concurrency eight. Individual normalized logs are capped at 60 KiB and serialized observations at 128 KiB; cursor-based derived evidence is retained rather than raw blocks.

Expected steady memory is dominated by bounded RPC responses and a small in-cycle log set, not chain history. Storage grows with reviewed-contract observations, anchors, reorg/gap evidence, health events, Radar projections, and agent records. Real staging measurements are still required before activating a registry or choosing retention and schedule frequency.

## Threat boundary

- External token metadata, manifests, websites, RPC responses, and claims are untrusted data.
- RPC URLs are validated; local/IP-literal endpoints are rejected unless already controlled by runtime configuration.
- Exact chain ID, contract, mint, venue, decimals, finality, and quote identity are validated.
- No secrets are serialized into runtime/provider state, records, logs, fixtures, or responses.
- No arbitrary URL fetch, calldata, destination address, transaction payload, signature, or bearer credential is accepted by the record plane.
- Owner-scoped queries and CSRF protect the authenticated surface.
- Append-only hashes, idempotency keys, CAS cursors, reservations, and reconciliation handle replay, redelivery, and crash ambiguity.

## Activation and remaining blockers

Before any staging activation:

1. Apply migration `0025` only in an authorized staging database and verify all migrations plus foreign keys.
2. Load a separately reviewed Robinhood contract registry with provenance and start blocks.
3. Configure secrets outside source control and validate provider terms, cost, latency, finality, and fallback behavior.
4. Exercise the exact Node 22 runtime, scheduled Worker budget, D1 growth, reorg/gap replay, and UI against non-fixture evidence.
5. Add the evidence-derived Agent Radar projection producer. The projection schema, append-only table, authenticated reader, and explicitly labeled local fixture exist; no process currently converts indexed logs into production Radar rows.
6. Measure chain-head growth against the ten-block provider query window and choose an activation cadence/catch-up budget that cannot accumulate structural lag.
7. Confirm Raven's reviewed strict-source successor receipt after its activation boundary. Its reviewed schema contract and manifest are known, but the write-once live receipt digest is intentionally absent until Raven emits and validates it; RavenOS must not synthesize one.

Live money additionally requires a separate legal/security release, noncustodial authorization design, per-venue transaction construction and simulation, settlement reconciliation, emergency controls, and explicit owner approval. None is implemented or activated here.
