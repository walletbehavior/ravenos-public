# RavenOS Portfolio Governor v1

Status: Phase 1 read-only Solana exposure, Phase 2 deterministic policy monitoring, and an authenticated read-only beta preview are implemented. The preview is off unless an account-bound beta wallet registry is explicitly configured. No customer portfolio history, durable wallet link, policy persistence, rebalance construction, wallet signing, or execution route is enabled.

Implementation:

- `lib/portfolio_governor/domain.mjs`
- `lib/portfolio_governor/solana_exposure.mjs`
- `lib/portfolio_governor/solana_preview_provider.mjs`
- `lib/portfolio_governor/preview.mjs`
- `scripts/validate-portfolio-governor-live.mjs`

Tests:

- `tests/portfolio_governor_authority.test.mjs`
- `tests/portfolio_governor_solana_exposure.test.mjs`
- `tests/portfolio_governor_policy_monitor.test.mjs`
- `tests/portfolio_governor_preview.test.mjs`

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

## Authenticated read-only beta preview

The preview route is `GET|POST /api/v1/portfolio/preview` on the isolated authenticated origin. It reuses the existing RavenOS account session, canonical-origin, CSRF, D1 rate-limit, Solana RPC, Jupiter Price v3, Jupiter quote-only order, provider concurrency, and operation-budget contracts.

The customer route never accepts a public address. `GET` returns only opaque account-bound wallet references and labels. `POST` accepts exactly one `wallet_reference`; unknown fields, raw addresses, cross-account references, missing sessions, wrong origins, and missing CSRF proof are rejected before provider access.

Durable wallet linking remains deliberately unimplemented. The temporary beta resolver is an operator-authorized account-to-wallet registry enabled only when both `RAVENOS_PORTFOLIO_PREVIEW_ENABLE=1` and the server-only registry are configured. This is an explicit limitation:

- it is not a Wallet Standard SIWS ownership proof;
- it is not a durable customer wallet link;
- it cannot become signing or transaction permission;
- it is suitable only for owner-authorized beta validation wallets;
- arbitrary public-address lookup remains unavailable.

The production route has no policy repository. A policy is evaluated only when a trusted server-side resolver supplies an existing sealed `UserPolicyVersion` for the exact account and portfolio. Without that resolver the response says `No portfolio policy configured.` It never creates defaults or a compliant state.

### Bounded provider behavior

One analysis is bounded to:

- three Solana RPC calls: native balance, SPL Token accounts, and Token-2022 accounts;
- one Jupiter Price v3 batch containing at most 50 deterministically selected mints;
- at most four Jupiter quote-only exit requests for material mint groups;
- eight provider calls total;
- a 12-second route budget, with shorter provider-specific timeouts;
- provider response ceilings of 64 KiB for native balance, 4 MiB for token accounts, 512 KiB for batched marks, and 256 KiB for each quote-only exit probe;
- account, wallet, and network rate limits before provider analysis;
- in-flight coalescing keyed by the full hashed RPC request, preventing two accounts that reuse an opaque wallet label from sharing an observation.

Native SOL and wrapped SOL positions sharing one input mint use one exit probe. Dust, missing marks, liabilities, numeraire identity, suspected spam, and candidates beyond the bounded quote budget are not repeatedly probed. Oversized response bodies are stopped while streaming, before JSON interpretation. The Jupiter order request omits a taker. Any returned transaction material is rejected as an invalid provider response.

No provider response, endpoint credential, RPC URL, raw token account, user ID, session ID, or wallet address enters the preview DTO. Aggregate telemetry records latency, provider-call counts, position coverage, provider failures, and conservation status without wallet identity or balances.

### Response and refusal behavior

The safe view model separates:

- marked value, executable value, gross exposure, liabilities, and net equity;
- visible holdings and look-through economic exposure;
- protocol and stablecoin dependency overlays;
- unresolved and unsupported positions;
- observed, priced, and quote timestamps;
- optional user-policy findings;
- aggregate provider and conservation diagnostics;
- explicit read-only, no-custody, no-signing, no-submission boundaries.

A complete observation, partial observation, unavailable valuation, stale mark, unrouteable value, unsupported protocol, and unresolved underlying remain different states. An accounting conservation failure refuses the normal portfolio DTO. A route timeout does not rebrand an incomplete result as current. No opaque portfolio health or risk score exists.

### Authorized live validation, 2026-08-26

The no-persistence harness was run against the two Raven-controlled Solana validation wallets available in existing production configuration. Participant/watch wallets and Raven's private actor graph were explicitly excluded. The harness emitted only structural aggregates and verified its report did not contain either address.

| Case | Observation | Resolution and valuation | Provider use | Accounting |
| --- | --- | --- | --- | --- |
| 01 | 5 non-zero SPL positions | 0 resolved; 1 marked; 4 unvalued; marked position was below the automatic $5 exit-probe floor; net equity unavailable | 3 RPC + 1 batched price request; 431–572 ms across three runs; no provider failure | conservation passed; no execution object |
| 02 | empty economic wallet | 0 positions; zero net equity available; no mark or quote needed | 3 RPC requests; 31–45 ms; no provider failure | conservation passed; no execution object |

Case 01 was not a double-count or provider bug. All five positions lacked a trusted asset definition, so the exact reason was `unresolved_asset_identity`. Raven did not assume that an arbitrary SPL token was a plain self-exposure rather than a wrapper, receipt, LP artifact, or claim. A sanitized five-token/one-dust-mark regression now preserves that behavior.

This live sample proves bounded observation, unknown-only and empty-wallet behavior, address-free diagnostics, fail-closed net equity, and conservation against current chain state. It does not prove live coverage for a wallet holding known majors, current LST conversion, LPs, lending, or leverage. Those remain explicit coverage gaps rather than claimed support.

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

## Current beta UI/API output shape

The authenticated Account surface now renders:

- net equity, gross exposure, marked value, current executable value, unresolved value, and liabilities;
- visible instrument holdings alongside underlying asset exposure;
- protocol and stablecoin issuer/dependency dimensions, plus holding-level routeability;
- source-position counts, evidence state, freshness, and supported exposure ranges;
- `Your policy`, `Your configured range`, `Policy drift`, `Confirmed violation`, `Indeterminate`, and `No configured rule` language;
- current policy findings when an existing user-authored policy is supplied.

The safe API response also preserves the exact snapshot, measurement, and optional policy-version references behind each result. The utilitarian beta UI does not yet expose a provenance drill-down or a separate chain-exposure table; Phase 1 is Solana-only and those would add visual complexity without improving this validation gate.

It accepts an opaque wallet selection only and has no address field. The browser renders untrusted labels with `textContent`, stores no wallet/session/portfolio data in browser storage, and refuses a response whose read-only, transaction-material, signing, or address-redaction boundary is absent. Desktop and 390-by-844 mobile checks passed without horizontal overflow.

Avoid `recommended portfolio`, `optimal mix`, `Raven-selected allocation`, `appropriate for your risk profile`, or any wording that turns Raven measurement into discretionary portfolio authority.

## Persistence, retention, and deletion boundary

No migration, portfolio cache, snapshot history, or customer holding log was added. The current request exists only in Worker memory for the duration of analysis; provider in-flight coalescing is transient and does not become portfolio history.

Before storing any customer portfolio record, resolve:

- durable wallet-link ownership proof and object-level authorization;
- explicit public-address persistence consent and retention/deletion behavior;
- insert-only policy versions, snapshots, measurements, findings, and outcomes;
- RPC/price/quote cache and rate limits;
- source freshness budgets and unsupported-protocol presentation;
- separation from Raven's private wallet-intelligence graph;
- wallet-data and internal-state no-leak validation.

Retention design must classify raw wallet address, holdings, liabilities, snapshots, policy, findings, and operational telemetry separately. Account deletion must be able to remove customer-identifying wallet and holding data without rewriting immutable policy/action provenance into a false history. Any legally required retained record needs a documented purpose, minimum retention window, access boundary, and irreversible account de-identification. Until that design and deletion test exist, portfolio history stays off.

## Next architectural gate: `PolicyViolation` to `RebalanceCalculation`

This is a design boundary only. It is not implemented by the preview.

The calculation must take an exact immutable `UserPolicyVersion`, `PortfolioSnapshot`, `PortfolioMeasurement`, and one or more policy findings. It may calculate deterministic correction paths to the user's rules, but cannot add an asset, target, risk tolerance, policy rule, or market-posture consequence.

Candidate paths should be ordered and explained as:

1. already-authorized incoming deposits and retained cash;
2. settled distributable profit under the user's explicit routing rule;
3. rewards or cash flows already attributable to the user;
4. sales only when the user policy allows them and protected/cold assets remain untouched.

Every path must preserve before/after allocations, unresolved bounds, minimum trade size, per-transaction cap, daily turnover, routeability, estimated friction, quote-required status, and any future tax-lot dependency. Multiple feasible paths remain alternatives; Raven does not silently choose a discretionary tactical allocation.

First-class calculation refusals include protected cold assets, absent authority, unresolved or stale evidence capable of changing the result, no route, insufficient quote confidence, uneconomic friction, minimum trade not met, transaction/turnover limits, stablecoin or protocol concentration worsening, and policy/snapshot changes. A refusal is sealed evidence, not a relaxed rule.

The later gates remain separate:

```text
PolicyViolation
  -> RebalanceCalculation

RebalanceCalculation
  -> ExecutionQuote
  -> UserAuthorization
  -> ExecutionIntent
  -> wallet signature
  -> settlement
```

No code in the preview crosses either boundary.

The smallest next implementation step is to add a qualified, non-discretionary asset-definition and protocol-resolution source for the five live unresolved positions, beginning with instrument identity only and preserving unresolved economic underlying until wrapper/receipt semantics are proven. Durable SIWS wallet linking and policy persistence remain separate security and privacy gates. Rebalancing remains behind a new evidence review.
