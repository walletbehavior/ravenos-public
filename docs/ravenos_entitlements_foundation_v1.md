# RavenOS Server-Enforced Pro Entitlements Foundation v1

Status: local dormant foundation. It is not deployed, commercially active, or a customer purchase path.

## Boundary

This milestone separates authenticated identity, server-owned product capability, customer entitlement, market-data display rights, and transaction authority. Signing in does not create an entitlement. An entitlement does not create provider redistribution rights. Neither creates wallet, broker, custody, signing, submission, or execution authority.

All entitlement and projection controls default off. With those controls off, the anonymous RavenOS APIs and Public Intelligence Surfacing v1 remain byte-for-byte governed by their existing routes. No public field is removed and no current user loses access. The authenticated preview says that Pro beta is unavailable; it does not advertise a price, checkout, upgrade promise, or purchasable plan.

## Server-owned capability contract

The only implemented-but-dormant capability keys are:

- `intelligence.perps_advanced`
- `intelligence.participant_advanced`

Reserved keys remain unavailable even if a grant row exists:

- `intelligence.replay_advanced`
- `intelligence.export`
- `research.saved_state_extended`
- `research.saved_scans`
- `research.alerts`
- `atlas.native_breadth`
- `atlas.filing_comparisons`
- `atlas.native_filing_marks`
- `atlas.portfolio_context`
- `atlas.options_intelligence`
- `atlas.authenticated_broker_overlay`

Clients do not select a tier, capability, owner, or plan. Each authenticated route is mapped to one capability in server code. Unknown capabilities fail closed. No customer mutation route exists.

## Separate dormant activation controls

The following server controls are independently required and absent from production configuration:

1. `RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE`
2. `RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE`
3. `RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE`
4. `RAVENOS_PRO_PERPS_ADVANCED_ENABLE` for advanced Perps
5. `RAVENOS_PRO_PARTICIPANT_ADVANCED_ENABLE` for advanced Participant Intelligence

One broad flag cannot enable every capability. An advanced route requires authenticated-origin admission, a valid host-only session, successful rate limiting, all applicable foundation controls, its own capability control, an active owner-matched grant, and a current public-safe source projection.

## Storage and privacy

Migration `0003_customer_entitlements.sql` defines owner-scoped grants with an opaque grant ID, stable capability key, bounded state, server-controlled source, optional activation and expiry, revision, timestamps, and an audit-safe source reference. User deletion cascades through the existing account foreign key.

The table contains no payment credential, provider credential, raw provider response, wallet, position, order, transaction, execution object, private Atlas observation, or customer-authored plan name. Customer routes cannot insert, extend, reactivate, suspend, revoke, or delete grants. Operator and test control remain the only grant sources until billing and administrative authorization receive separate review.

Authenticated responses omit grant source and source reference. Responses are owner-resolved without a user selector, are never shared across users, and use `Cache-Control: private, no-store`, `Vary: Cookie, Origin`, exact authenticated-origin validation, Fetch Metadata validation, and the existing opaque host-only session.

## Projection boundary

Free and Pro DTOs are deterministic allowlist transformations of the existing public-safe Perps and Behavior artifacts. They are not new provider feeds.

The free Perps contract keeps top-level market coverage, exact Hyperliquid identity, funding, open interest, basic pressure and liquidity summaries, freshness, provenance, limitations, and an explicit statement that qualified liquidation data is unavailable. The Pro contract may additionally expose longer positioning, pressure/crowding, tight/wide book, spread/depth, outcome-attribution, and filtering tables.

The free Participant contract keeps the aggregate read, evidence state, freshness, basic trend, observed and usable denominators, and privacy/outcome limitations. The Pro contract may additionally expose the complete bounded aggregate condition matrix, success and win-rate bands, confidence, score strength, outcome strength, excluded-sample detail, and cross-chain/capitalization/window filters.

Neither projection contains actor leaderboards, wallet identities or labels, relationship graphs, private provider details, raw payloads, synthetic liquidation data, or execution data. Stale or unavailable source evidence produces an unavailable authenticated projection rather than a silently widened fallback.

## Atlas display-rights invariant

Authentication and payment do not create display rights. All Atlas capability keys remain reserved and unavailable in this milestone. The entitlement resolver cannot change an Atlas provider policy or turn restricted, internal-only, or unknown observations into customer-displayable data.

The governing policy remains external to entitlements and subordinate to `atlas_display_rights.mjs`: Massive/Polygon stays internal-only, Tradier stays restricted, Yahoo observations remain withheld, ICE BofA observations obtained through FRED stay internal-only, and SEC/EIA observations require a separately reviewed route-specific public-display policy. TradingView remains an isolated iframe with `allow_symbol_change: false`; RavenOS does not extract iframe values.

No authenticated Atlas intelligence route is created. Atlas risk posture must continue to say “Risk posture is forming.” when qualified public observations are insufficient. No proxy posture may substitute for missing data.

## Future SEC security master

A later zero-incremental-cost public security-master milestone may normalize SEC `company_tickers_exchange.json` and `company_tickers_mf.json` into ticker, issuer or fund name, CIK, equity-versus-ETF class, exchange, and TradingView symbol. Ambiguous symbols must fail closed. SEC requests must use a monitored RavenOS contact in the User-Agent. OpenFIGI may later validate ambiguity but is not required initially. Tradier must not remain the public security-master dependency.

This foundation does not implement that security master, native filing marks, options, SnapTrade, brokerage overlays, or SEC filing comparisons.

## Activation sequence

Activation remains a separate owner decision and review:

1. Checkpoint and verify the Atlas public-data cleanup.
2. Stage the entitlement migration.
3. Verify operator grants on an isolated authenticated origin.
4. Run free-versus-Pro response differential tests.
5. Verify expiration, revocation, suspension, and downgrade behavior.
6. Verify Atlas display-rights enforcement with active Pro grants.
7. Complete external entitlement and licensing review.
8. Establish a legitimate way for customers to obtain Pro access.
9. Obtain separate approval to activate projection splitting.
10. Only then consider checkout or paid-plan publication.

Until those steps are approved, billing, subscriptions, checkout, wallet linking, alerts, persistent portfolio history, brokerage integration, customer signing, and transaction submission remain unavailable.
