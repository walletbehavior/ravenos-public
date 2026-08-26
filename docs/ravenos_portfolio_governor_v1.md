# RavenOS Portfolio Governor v1

Status: authority contract and pure domain foundation; no public persistence or execution route is enabled

Implementation: `lib/portfolio_governor/domain.mjs`

Tests: `tests/portfolio_governor_authority.test.mjs`

## Product boundary

Portfolio Governor is user-authored portfolio policy plus deterministic Raven accounting, monitoring, and calculation. It is not a Raven-selected portfolio and not an autonomous robo-adviser.

The user decides the desired financial structure. Raven determines what exists, compares that measured state with the exact immutable policy version, calculates user-policy-compliant correction paths, and records why an action is available or refused.

Raven market intelligence never has portfolio authority by itself. A market posture can select another policy only through a separately persisted activation rule explicitly authored by the same user and pointing to another already-authored policy version.

Raven's internal treasury teaches implementation patterns—source lineage, idempotency, protected capital, conservation checks, refusal outcomes, and reconciliation. Its targets, asset mix, posture mapping, risk budget, and deployment logic are not customer defaults and are not imported by this module.

## Authority separation

| Layer | Record | Decides or proves | Cannot do |
| --- | --- | --- | --- |
| External/Raven observation | `Observation` | Timestamped market or account fact | Set portfolio policy |
| Raven interpretation | `MarketPosture` | A versioned market read | Mutate or select policy without a user-authored activation rule |
| Raven accounting | `PortfolioSnapshot`, `PortfolioMeasurement` | Positions, values, liabilities, economic exposure, concentration, and freshness | Invent allocation objectives |
| User authority | `UserPolicyVersion` | Bands, buckets, protected assets, concentration limits, allowed assets/venues, profit routing, and execution limits | Grant Raven custody in v1 |
| Raven evaluation | `PolicyViolation`, `PolicyEvaluation` | Whether measured state complies with the exact user policy | Choose a tactical point inside a band |
| Raven calculation | `RebalanceCalculation` | Consequences of an explicit correction path | Authorize execution or substitute an unconfigured asset |
| External execution evidence | `ExecutionQuote` | Current route, executable amounts, friction, expiry, and confidence | Authorize execution |
| User authority | `UserAuthorization` | Approval of one exact expiring quote for one linked wallet | Authorize a changed policy, snapshot, quote, or route |
| Non-custodial orchestration | `ExecutionIntent` | A bounded handoff awaiting the user's wallet signature | Hold assets, access a private key, or imply settlement |
| External/Raven reconciliation | `ExecutionFill`, `SettlementOutcome` | What actually filled and the resulting observed state | Rewrite earlier policy or calculation history |

Each record is separately typed, canonically hashed, deeply immutable in the pure domain layer, and carries a provenance role. The design intentionally has no generic `recommendation` object that could blur observation, calculation, policy, and authorization.

## Provenance chain

The required persisted chain is:

```text
UserPolicyVersion
  -> PortfolioSnapshot
  -> PortfolioMeasurement
  -> PolicyViolation / PolicyEvaluation
  -> RebalanceCalculation
  -> ExecutionQuote
  -> UserAuthorization
  -> ExecutionIntent
  -> ExecutionFill
  -> SettlementOutcome
  -> PortfolioSnapshot
```

Every downstream record carries exact record IDs and canonical hashes for its upstream evidence. A new policy version cannot validate a calculation or quote created under an older version. A changed portfolio snapshot likewise invalidates the quote authorization path. Superseding a policy creates a new immutable version; it never edits history.

Refusals and no-action results are first-class `GovernorOutcome` records. They are persistable and canonically hashed, including outcomes such as `portfolio_within_policy`, `cold_asset_protected`, `quote_expired`, `authorization_missing`, and `policy_changed_since_quote`.

## Policy contract

`UserPolicyVersion` contains only explicit user inputs:

- allocation bands identified by stable rule IDs;
- capital buckets and cold/protected semantics;
- concentration limits by asset, protocol, or stablecoin issuer;
- protected assets;
- allowed assets and venues;
- profit-routing percentages;
- minimum trade, maximum transaction, daily turnover, quote-confidence, and friction limits;
- the current authority mode.

No allocation bands or assets are synthesized when they are absent. An empty policy therefore produces no invented portfolio target. Cold buckets are structurally protected from sale in v1. User-signed mode structurally requires a wallet signature and disallows Raven custody or unrestricted private-key access.

## Deterministic evaluation and planning

Portfolio measurements are computed from economic lots using integer minor-unit values. Allocation comparisons use basis points. Missing executable valuations make policy evaluation unavailable rather than silently treating missing value as zero.

The initial calculation function accepts an explicit correction path and validates it against the user's policy. It can model:

- routing a new inflow to a user-allowed asset and bucket; or
- reallocating value from one exact routeable, unprotected position to a user-allowed destination through a user-allowed venue.

It refuses paths that sell cold/protected assets, exceed transaction or turnover limits, use unallowed assets or venues, fail to reduce the cited violation, cross the opposite side of a user band, create a new band violation, or worsen a configured protocol/issuer concentration limit.

The result is an expected calculated state, not a factual `PortfolioSnapshot`. Only post-settlement observation may create the next factual snapshot.

## Execution boundary

The domain foundation has no Worker route, database mutation, signer, provider submission, wallet adapter, or live venue import. A successful v1 authorization can create only an `ExecutionIntent` in `awaiting_user_signature` state with:

- non-custodial custody model;
- exact policy, snapshot, calculation, quote, authorization, and wallet-link references;
- no Raven private-key access;
- no Raven omnibus account;
- no submission authorization.

Future integration should adapt a Governor intent into the existing exact customer transaction-authorization pipeline. The adapter must preserve the Governor references in the immutable review binding. It must not treat a policy, Raven Read, connected wallet, or quote as authorization.

## Persistence proposal

The existing authenticated customer D1 boundary can support future storage without a new database or framework. The proposed tables are append-oriented:

| Table | Key and immutable linkage |
| --- | --- |
| `portfolio_governor_portfolios` | Customer-scoped portfolio identity and state only |
| `portfolio_governor_policy_versions` | `(policy_id, version)` unique; immutable JSON/hash; supersedes reference |
| `portfolio_governor_snapshots` | Snapshot ID/hash, owner, observation time, normalized payload |
| `portfolio_governor_measurements` | Snapshot ID/hash plus methodology version and measurement payload |
| `portfolio_governor_violations` | Exact policy, snapshot, measurement, and rule references |
| `portfolio_governor_calculations` | Exact violation and expected-state calculation |
| `portfolio_governor_quotes` | Exact calculation plus source time, expiry, route, and execution evidence |
| `portfolio_governor_authorizations` | User/session/wallet link plus exact quote hash and expiry |
| `portfolio_governor_intents` | Authorization-bound non-custodial state machine |
| `portfolio_governor_fills` | Provider/chain settlement evidence and idempotency identity |
| `portfolio_governor_settlement_outcomes` | Fill-to-resulting-snapshot reconciliation |
| `portfolio_governor_outcomes` | Refusal/no-action records and exact evidence references |

This pass deliberately does not add the migration. Wallet-link ownership, explicit public-address persistence consent, retention/deletion policy, transaction authorization rollout, and quote/fill reconciliation must be resolved before freezing a customer-data schema.

## Phase 1 implementation boundary

Phase 1 remains read-only Solana policy monitoring:

1. accept a public Solana wallet address with explicit observation/persistence semantics;
2. normalize spot tokens, liquid staking tokens, LPs, lending positions, liabilities, protocols, and stablecoin issuers into economic lots;
3. append a factual snapshot and deterministic measurement;
4. let the user author buckets, bands, protection, and concentration rules;
5. show current exposure, policy drift, exact rule deltas, valuation confidence, and routeability;
6. calculate deposit-first correction paths without executing them;
7. persist no-action and refusal outcomes alongside actionable calculations.

Execution quotes, wallet authorization, and settlement types exist now only to prevent an architectural rewrite later. They are not public execution capability.

## UI language

Use:

- Your policy
- Your configured range
- Outside your selected allocation
- Policy drift
- Portfolio exposure
- Current executable value
- Correction required by your policy
- Proposed rebalance
- Expected post-trade allocation
- Approve / Reject
- No action economically justified

Do not use `recommended portfolio for you`, `optimal portfolio`, `Raven-selected allocation`, `best investment mix`, or language implying that Raven inferred the user's objective or risk tolerance.

## Required release gates

- authenticated ownership and object-level authorization for every persisted resource;
- insert-only policy versions and provenance records, with explicit supersession;
- no address flow from customer Portfolio into Raven's private wallet-intelligence graph;
- no execution without exact unexpired user authorization and wallet signature;
- quote/policy/snapshot invalidation under concurrent changes;
- append-only refusal visibility;
- source freshness, routeability, valuation confidence, and partial-portfolio behavior;
- no-leak scanning for wallet data, credentials, transaction payloads, and internal Raven research state.
