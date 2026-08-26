# RavenOS Portfolio Governor v1

Status: Phase 1 read-only Solana exposure engine and Phase 2 read-only deterministic policy monitor are implemented as pure domain modules. No customer persistence, public API, rebalance construction, wallet signing, or execution route is enabled.

Implementation:

- `lib/portfolio_governor/domain.mjs`
- `lib/portfolio_governor/solana_exposure.mjs`

Tests:

- `tests/portfolio_governor_authority.test.mjs`
- `tests/portfolio_governor_solana_exposure.test.mjs`
- `tests/portfolio_governor_policy_monitor.test.mjs`

## Invariant

> Raven's internal treasury policy teaches us how to build the machinery; it does not become the user's investment policy.

Portfolio Governor v1 is:

```text
user-authored policy
  + deterministic Raven measurement
  + non-custodial user authorization at a later, separately gated phase
```

The user decides the desired financial structure. Raven observes the portfolio, resolves economic exposure where evidence permits, measures uncertainty and realizability, and evaluates only the exact rules in the immutable user policy version.

Raven does not infer an objective, risk tolerance, asset list, target allocation, tactical point inside a band, or market-posture consequence. A Raven `MarketPosture` can select another policy only through a separately persisted activation rule authored by the user and referencing another policy version the user already authored.

## Authority and semantic separation

| Layer | Record | Authority or evidence | Explicit limit |
| --- | --- | --- | --- |
| Observed fact | `Observation` | Wallet, protocol, conversion, mark, or quote-only fact with time and source | Cannot set policy |
| Raven interpretation | `MarketPosture` | Versioned market interpretation | Has no portfolio effect by itself |
| Raven accounting | `EconomicExposure`, `PortfolioSnapshot`, `PortfolioMeasurement` | Instrument holdings, look-through exposure, values, liabilities, concentration, freshness, and routeability | Cannot invent a target |
| User authority | `UserPolicyVersion`, `UserPolicyActivationRule` | Bands, limits, buckets, classifications, protection, routing, and optional posture activation | Must be authored by the user |
| Raven evaluation | `PolicyViolation`, `PolicyIndeterminacy`, `PolicyEvaluation`, `GovernorOutcome` | Deterministic comparison of measurement bounds with the exact policy version | Cannot calculate a correction in the current phase |
| Future calculation | `RebalanceCalculation` | Pre-existing forward-compatible contract, not connected by this pass | Cannot authorize or execute |
| Future execution evidence and authority | `ExecutionQuote`, `UserAuthorization`, `ExecutionIntent` | Pre-existing non-custodial contract, not connected by this pass | No live route, signer, submission, or custody |

There is no generic recommendation object. Every sealed record has a distinct type, canonical content hash, immutable payload, upstream references where applicable, and provenance identifying whether the user decided it, Raven calculated it, or an external source was observed.

## Existing-source audit and adapter decisions

This pass reused existing Raven/RavenOS capabilities and added no provider, database, framework, agent, signer, or execution system.

| Requirement | Existing capability found | Phase 1 decision |
| --- | --- | --- |
| Native SOL and SPL inventory | Existing Solana JSON-RPC/Helius-compatible request machinery | Use three bounded read-only calls: native balance, SPL Token accounts, and Token-2022 accounts |
| Token identity and metadata | Existing token-identity machinery plus locally verified canonical identities | Keep the built-in exact set deliberately small; malformed or unknown identity remains unresolved |
| Mark values | Existing Raven price/data-plane sources | Accept timestamped mark observations through an explicit evidence contract; never infer a price from a symbol |
| Executable values | Existing Jupiter quote-only machinery | Accept quote-only exit observations; select automatic quote candidates with materiality and count limits |
| LST recognition | Existing Solana identity knowledge | Recognize JitoSOL, but require contemporaneous conversion evidence before assigning SOL underlying |
| LP and lending positions | No sufficiently general live customer-position adapter was proven | Support typed protocol observations and adversarial fixtures; unavailable protocol state remains unresolved |
| Liabilities | Existing accounting concepts, but no general live customer lending adapter | Preserve supplied assets and borrowed liabilities separately when observed |
| Spam and dust | Existing identity/risk conventions | Preserve spam positions visibly but exclude unverified spam marks from NAV; keep dust in marked NAV and skip automatic quote load |
| Solana leveraged/perpetual positions | No proven general wallet adapter in this pass | Report the capability gap explicitly; do not synthesize exposure |

The adapter accepts an opaque wallet reference and uses the public address only for the transient RPC request. The address is not copied into observations, diagnostics, snapshots, or measurements. Partial RPC success is preserved with sanitized failure diagnostics.

## Phase 1: read-only Solana exposure engine

The accounting path is explicit:

```text
public Solana address
  -> raw Observation records
  -> normalized visible positions
  -> EconomicExposure records
  -> valuation and routeability resolution
  -> PortfolioSnapshot
  -> PortfolioMeasurement
```

### Separate views of the same capital

The engine preserves both instrument truth and economic truth without counting them twice.

Example:

```text
instrument held: JitoSOL
economic underlying: SOL
protocol exposure: Jito
```

Primary asset and liability components count toward accounting totals. Instrument, protocol, issuer, dependency, and chain rows are analytical overlays over the same capital. Receipt tokens explicitly linked to a protocol position are representation-only and cannot also count as principal.

### Valuation outputs

`PortfolioMeasurement` separates:

- total marked asset value;
- current executable asset value;
- liabilities;
- net equity;
- gross asset and gross economic exposure;
- unresolved value;
- stale value;
- proven unrouteable value;
- value with unknown routeability;
- executable coverage;
- leverage;
- asset, instrument, protocol, stablecoin issuer/dependency, chain, liability, and unresolved dimensions.

Displayed mark times balance is never treated as equivalent to realizable value. A current conservative minimum quote is the executable value. Expired quotes remain stale, no-route results remain unrouteable, and missing quotes remain unknown.

Automatic quote planning is bounded by an absolute materiality threshold, a portfolio-weight threshold, and a maximum candidate count. It produces quote-probe descriptions only. It does not produce `ExecutionQuote`, transaction material, signing requests, or submission permission.

### Resolution and uncertainty

Every economic exposure records its source instrument, position and lot, resolution state and basis, source observations, freshness, routeability, marked value, and executable value.

Unresolved underlying is first-class. It is not relabeled as `other`, SOL, or a stablecoin. Measurements can therefore support statements such as:

> Resolved SOL exposure is 58%. Another 12% of net equity has unresolved underlying exposure, so supported SOL exposure is currently bounded between 58% and 70%.

Unresolved bounds are dimension-specific. An unresolved position whose protocol is already observed does not create a second copy of possible protocol exposure. Unknown underlying can widen asset or issuer bounds only where the evidence leaves that dimension unresolved.

### Conservation

The engine verifies:

- each visible position's marked capital equals its primary look-through components;
- wrapper, LP, and lending receipt overlays do not add NAV;
- assets minus liabilities equals net equity;
- an unvalued liability makes net equity unavailable instead of becoming zero debt;
- gross exposure may exceed net equity only through explicit liabilities/leverage;
- identical immutable observations produce identical records and hashes.

### Phase 1 support boundary

Proven in adversarial tests:

- native SOL, wrapped SOL, and both together;
- one and multiple recognized LSTs;
- USDC, USDT, issuer and shared-dependency dimensions;
- unknown, spam, dust, malformed, missing-metadata, closed, and zero-balance SPL cases;
- missing, stale, expired, unrouteable, and materially impaired valuations;
- non-50/50 LP look-through and unavailable LP state;
- lending supply, borrow, and combined leveraged accounting;
- receipt/principal double-count prevention;
- multiple protocols exposing the same economic asset;
- large illiquid, unknown-only, empty, and partially observed wallets.

Not claimed as live protocol coverage:

- general Meteora/Orca position discovery;
- general Solana lending-account discovery;
- general Solana perpetual or leveraged-position discovery;
- complete SPL metadata, scam classification, or executable coverage for every asset.

These gaps produce unsupported, unavailable, or unresolved state rather than synthetic exposure.

## Phase 2: read-only user-policy evaluation

The current evaluation path is:

```text
UserPolicyVersion
  + PortfolioSnapshot
  + PortfolioMeasurement
  -> deterministic rule evaluation
  -> PolicyViolation / PolicyIndeterminacy / GovernorOutcome
```

It stops there.

No `RebalanceCalculation`, `ExecutionQuote`, transaction bundle, wallet authorization request, or `ExecutionIntent` is created.

Supported user-authored rules include:

- allocation minimums and maximums for assets, instruments, protocols, chains, stablecoin issuers/dependencies, and capital buckets;
- wildcard maximum concentration limits for assets, protocols, issuers, and dependencies;
- maximum unresolved or unrouteable exposure;
- minimum executable coverage;
- maximum liability exposure or gross leverage;
- position/account/asset/protocol assignments to user-created cold, warm, reserve, retained, excluded, unclassified, or custom buckets;
- user-selected protected assets and cold/protected bucket semantics.

Classification is not a target. Marking a position cold or reserve does not create a desired percentage. A reserve minimum exists only if the user separately creates that rule.

### Evaluation states

Each configured rule produces one or more inspectable results:

| State | Meaning |
| --- | --- |
| `confirmed_compliant` | The complete supported measurement interval stays inside the user's rule |
| `confirmed_violation` | Even the conservative bound violates the user's rule |
| `indeterminate` | Unresolved, stale, unavailable, or unknown-routeability evidence can change the answer |

A confirmed violation includes the exact policy, snapshot, measurement, and rule references; current supported bound; user boundary; delta; contributing positions and economic exposures; and a plain explanation. Indeterminacy is separately typed and persistable. Unknown never silently becomes safe.

An absent rule creates no test and no violation. An empty policy is vacuously compliant but reports zero configured rules and zero inferred targets. Conflicting bands for the same scope are rejected when the combined user policy has no feasible intersection.

### Capital and profit accounting fixtures

`FundingEvent` now separates gross amount, fees, friction, net distributable profit, and capital class. Deterministic tests prove:

- deposits remain principal and are never distributable profit;
- positive settled profit routes only through explicit user-authored percentages;
- fees and friction reduce distributable profit;
- zero PnL, losses, and fee-heavy profits with zero net distributable value create a persistable `no_distributable_profit` result;
- an absent customer profit-routing rule cannot inherit Raven internal treasury percentages;
- no balance mutation or live asset routing occurs.

## Current provenance

Current read-only chain:

```text
Observation
  -> EconomicExposure
  -> PortfolioSnapshot
  -> PortfolioMeasurement

UserPolicyVersion
  + PortfolioSnapshot
  + PortfolioMeasurement
  -> PolicyViolation / PolicyIndeterminacy / PolicyEvaluation / GovernorOutcome
```

Every evaluation references the exact immutable policy and measured state. A later policy cannot be made to appear to have governed an earlier finding. Replaying identical immutable inputs produces identical hashes; changing the policy or snapshot changes downstream provenance.

The longer non-custodial chain remains a future architectural gate:

```text
PolicyViolation
  -> RebalanceCalculation
  -> ExecutionQuote
  -> UserAuthorization
  -> ExecutionIntent
  -> ExecutionFill
  -> resulting PortfolioSnapshot
```

Forward-compatible types for that chain predate this pass and remain isolated. They are not a live product capability.

## Future UI/API output shape

A read-only surface can now render:

- net equity, gross exposure, marked value, current executable value, unresolved value, and liabilities;
- visible instrument holdings alongside underlying asset exposure;
- protocol, stablecoin issuer/dependency, chain, liquidity, and routeability dimensions;
- source positions, evidence state, freshness, and supported exposure ranges;
- `Your policy`, `Your configured range`, `Policy drift`, `Confirmed violation`, `Indeterminate`, and `No configured rule` language;
- the exact policy version and snapshot behind each result.

Avoid `recommended portfolio`, `optimal mix`, `Raven-selected allocation`, `appropriate for your risk profile`, or any wording that turns Raven measurement into discretionary portfolio authority.

## Persistence and release boundary

No migration was added. Before public persistence or an authenticated route, resolve:

- wallet-link ownership and object-level authorization;
- explicit public-address persistence consent and retention/deletion behavior;
- insert-only policy versions, snapshots, measurements, findings, and outcomes;
- RPC/price/quote cache and rate limits;
- source freshness budgets and unsupported-protocol presentation;
- separation from Raven's private wallet-intelligence graph;
- wallet-data and internal-state no-leak validation.

The smallest next implementation step is an authenticated, rate-limited, read-only Solana portfolio preview that uses the existing wallet-link/RPC and price contracts, keeps the submitted address transient unless the user opts into persistence, and returns the sealed snapshot/measurement contract. Policy persistence and evaluation should follow only after that preview is validated against live wallets. Rebalancing remains behind a separate evidence review.
