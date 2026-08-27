# RavenOS Free/Pro Projection Split + Authenticated Workspace v1

Status: local dormant candidate. Nothing in this document represents a deployed entitlement, purchasable subscription, checkout path, or production activation.

## Product boundary

This milestone turns the existing server-owned entitlement foundation into a coordinated projection boundary for Perps and Participant Intelligence. The public RavenOS experience remains useful: exact identity, current evidence timestamps, limitations, unavailable reasons, Terminal market facts, the current Raven Read and chart action, Saved Exact Market, a six-market Perps overview, and six aggregate Participant conditions remain free.

Advanced data is never sent to the public browser and then blurred. When a capability's coordinated split is active, the Worker builds a deterministic Free DTO before responding to `/api/perps`, `/api/behavior`, `/ravenos/perps.json`, or `/ravenos/behavior.json`. Public consumers render that DTO directly. The Free response contains no advanced table object and no hidden rows in HTML, the DOM, or the accessibility tree.

All activation controls remain absent and false by default. With them off, the current anonymous routes retain their pre-split contracts. A partial flag state does not narrow the public product and does not activate an authenticated projection. Activation therefore requires a deliberate coordinated state rather than one broad environment switch.

## Free contracts

The Free Perps projection is bounded to six markets. Each row is allowlisted to exact Hyperliquid instrument ID, symbol, venue, instrument group, funding rate and regime, open interest, volume, mark, basic pressure state, and coverage. It also carries aggregate pressure/liquidity bucket counts, participant-evidence state, provenance, freshness, and explicit limitations. It contains no cross-market spread/depth rows, tightest-book table, wide/thin-book table, outcome attribution, actor leaderboard, wallet identity, synthetic liquidation data, provider payload, or execution object.

The Free Participant projection is bounded to six aggregate conditions. Each row is allowlisted to chain, capitalization band, window, participation trend, observed sample, usable sample, and plain-language interpretation. It contains no success-rate value, win-rate band, confidence or score strength, outcome-strength detail, excluded-sample breakdown, wallet identity or label, relationship graph, or coordination claim.

Neither contract can remove exact identity, timestamps, provenance, limitations, or unavailable reasons. Stale, malformed, incomplete, or non-public-safe source evidence produces an explicit unavailable response rather than a widened fallback.

## Pro contracts

The authenticated Perps projection is bounded to forty rows per qualified table and may include positioning, pressure/crowding, tightest and wide/thin books, spread and depth comparison, aggregate outcome attribution, and instrument/funding/pressure/liquidity filter metadata.

The authenticated Participant projection is bounded to 160 aggregate condition rows and may include participant success-rate and win-rate bands, confidence, score strength, outcome strength, average-outcome classification, excluded-sample integrity, and chain/capitalization/window filters.

Both are deterministic allowlist transformations of already qualified public-safe Raven artifacts. Neither adds a provider or expands data rights. Actor identities, wallet labels, relationship graphs, coordination claims, raw provider payloads, provider credentials, synthetic liquidation data, account positions, signing, submission, and execution remain absent.

## Authenticated workspace

`https://app.ravenos.xyz/account/intelligence/` uses the established host-only `__Host-ravenos_session` boundary. It first resolves the signed-in session, then the server-owned capability summary, then requests only the private route mapped to each available capability. The browser cannot submit a user ID, plan, tier, capability, or owner selector. Authenticated responses use `Cache-Control: private, no-store`, vary by Cookie and Origin, enforce exact app origin and Fetch Metadata, and pass through the existing user- and network-aware rate limit.

The workspace distinguishes active, unavailable, not-granted, expired, suspended, and revoked states. It renders untrusted values with DOM text nodes, retains an exact allowlisted Hyperliquid market context without symbol substitution, and strips unknown return-navigation parameters. It is read-only and contains no checkout, upgrade action, wallet connection, broker, order, signing, submission, or transaction flow.

## Artifact and alternate-route boundary

The qualified full artifact remains an internal source input for the authenticated projection builder. It is not returned by a Pro route without the capability check. When coordinated splitting is active, the Worker intercepts both public API routes and the two direct deploy artifact aliases before the asset binding is reached. Query parameters cannot select a capability or widen a response. Generated release manifests do not create a second serving origin or an alternate authenticated route; all customer and public requests still pass through the same Worker-first boundary.

The source repository may retain public-safe research fixtures for deterministic tests and dormant backward compatibility. Those files are not authorization contracts. Production activation must verify the served route differential and direct artifact aliases against the staged release before promotion.

## Atlas invariant

Entitlement never creates customer-display rights. No authenticated Atlas route or Atlas projection split exists in this milestone. Massive/Polygon remains internal-only, Tradier restricted, Yahoo withheld, ICE BofA data obtained through FRED internal-only, and every other source remains subject to its reviewed route-specific display policy. TradingView stays isolated in its iframe with symbol change disabled. An active intelligence grant cannot change `atlas_display_rights.mjs`, expose a restricted value, or replace “Risk posture is forming.” with a proxy.

## Activation gate

Before any production split, RavenOS must stage the entitlement migration, create operator-controlled test grants, activate only the coordinated capability controls, compare Free and Pro responses byte-for-byte by allowlist, test expiry/revocation/suspension/downgrade, verify direct artifacts and generated assets through the staged Worker, rerun Atlas display-rights tests with active grants, complete external entitlement and licensing review, and obtain separate approval.

Billing, public enrollment, Individual purchase, Desk organizations and seats, Enterprise access, alerts, saved scans, wallet linking, brokerage, execution, provider expansion, and production promotion remain outside this milestone.
