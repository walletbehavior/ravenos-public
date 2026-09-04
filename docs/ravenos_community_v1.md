# RavenOS Community v1

Status: local dormant candidate. Production activation is not complete.

## Purpose

Raven Community is an opt-in reputation and research-discovery layer built on RavenOS usernames and evidence records. It is not a general social feed. The first release contains public profiles, qualified boards, following, and one constrained positive recognition named **Useful**. It does not contain comments, direct messages, dislikes, quote-posting, activity streaks, or return-only rankings.

## Privacy contract

Creating an account or choosing a username does not publish a profile. A user must explicitly enable `public_profile_enabled`. Every disclosure and every interaction permission defaults to private or off:

- performance, positions, trade history, and strategy breakdown;
- wallet addresses and follower count;
- following, shadowing, Raven Copy, and public referral-link availability.

Email, legal name, billing identity, account balances, connected-account identifiers, copy allocations, and follower capital are never part of the public profile contract. Wallet addresses remain private by default even when the profile itself is public. Public profile output uses the user-selected Raven username; identity-provider first and family names are not public identity.

## Evidence contract

Performance projections are append-only and require a source contract ID, source reference digest, observation window, sample count, and confidence. Every projection keeps one of these classifications:

- `raven_observed`
- `connected_account_observed`
- `user_reported`
- `historically_reconstructed`
- `prospective`
- `simulated`

The classifications are not blended. User-reported and simulated results cannot qualify for performance boards. Profiles may show an explicitly labeled current record when the user has enabled performance disclosure, but Raven never presents that classification as verified performance.

The initial performance boards are deterministic and enforce minimum evidence, sample, and active-period gates. They are Most consistent, Lowest drawdown, Most copyable, and Evidence complete. Most followed is a separate popularity board; followers and Useful recognitions do not affect a performance rank. An empty board reports insufficient evidence rather than filling itself with unqualified profiles.

## Request and storage boundaries

The public read routes are:

- `GET /api/v1/community/boards`
- `GET /api/v1/community/profiles/:username`

All profile-setting, following, and recognition mutations require an authenticated RavenOS session on the authenticated application origin. Mutations require CSRF validation, bounded JSON, rate limiting, exact usernames, and owner-scoped storage. Self-follow and self-recognition are rejected. Duplicate delivery is idempotent.

`customer-migrations/0029_customer_community.sql` stores settings, follows, Useful recognitions, append-only performance evidence, and audit events. It does not store public posts, comments, direct messages, wallet secrets, signing material, or execution material.

## Activation and authority

The feature requires both the customer database migration and `RAVENOS_COMMUNITY_ENABLED=1`. The flag defaults off and is intentionally absent from committed deployment configuration. Missing storage or a disabled flag fails closed. Applying the migration and activating the flag require a separate reviewed release decision.

Community records grant no trading, signing, submission, policy, custody, copy-allocation, or capital authority. Allowing Raven Copy on a profile is only a public availability preference; it cannot activate Raven Copy or weaken the existing execution and policy gates.

## Operational limits

Public boards return at most 50 rows. Following returns at most 100 rows. Profile and interaction requests are bounded and public payloads are capped. The implementation is deliberately a dashboard rather than an infinite feed. Future activity alerts should use meaningful-change thresholds and the existing Raven Monitor architecture.

## Verification

`tests/customer_community.test.mjs` validates private defaults, username-backed opt-in, public-safe output, observation-class separation, deterministic board eligibility, CSRF-bound mutations, follow controls, idempotency, and fail-closed activation. `tests/browser/community.spec.mjs` validates the public board, authenticated profile controls, public profile actions, and mobile containment. The security and no-leak validators include the Community module in the release graph.
