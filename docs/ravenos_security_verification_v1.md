# RavenOS security verification v1

Status: verification plan and current boundary evidence  
Baseline: OWASP ASVS 5.0.0  
Target: Level 2 minimum; selected Level 3 controls for high-impact customer and transaction operations

## Evidence rules

A control is not verified merely because it is documented, configured in a client, protected by Cloudflare, or represented by a green unit test against a mock.

Acceptable verification evidence names:

- exact ASVS 5.0.0 requirement ID;
- implementation commit and release ID;
- automated test file and scenario name;
- environment tested;
- relevant WAF/IdP/Stripe/provider configuration export with secrets redacted;
- timestamp and result;
- reviewer and exception/risk record where applicable.

Allowed status values:

- `verified_current`: implemented and proven in the current target.
- `required_not_implemented`: required before the named stage and unable to pass because the system does not exist.
- `blocked`: implementation exists but a required verification fails.
- `external_review_required`: automation is complete but independent review remains mandatory.
- `not_applicable`: written rationale and reviewer approval required.

Skipped, TODO, or mock-only tests cannot be counted as passed security controls.

## ASVS control profile

The complete ASVS 5.0.0 Level 2 checklist remains in scope. The following requirements are central to the customer design and must have direct RavenOS evidence:

| Area | ASVS 5.0.0 requirements | RavenOS evidence target |
|---|---|---|
| Encoding/XSS | `V1.1.2`, `V1.2.1`-`V1.2.4`, `V1.3.1`-`V1.3.7` | structured text rendering, contextual encoding, no raw provider/narrator HTML |
| Business logic | `V2.1.1`-`V2.1.3`, `V2.2.1`-`V2.2.3`, `V2.3.1`-`V2.3.4`, `V2.4.1` | documented limits, sequential transaction state, atomic nonce/intent operations |
| Browser security | `V3.3.1`-`V3.3.4`, `V3.4.1`, `V3.4.3`-`V3.4.6`, `V3.5.1`, `V3.5.4` | secure host cookie, strict CSP, anti-framing, origin separation, CSRF |
| Authentication | `V6.1.1`, `V6.1.3`, `V6.3.1`, `V6.3.3`-`V6.3.8`, `V6.4.3`-`V6.4.4`, `V6.5.1`-`V6.5.6`, `V6.7.2`, `V6.8.1`-`V6.8.4` | managed Google and email authentication, recovery, enumeration resistance, recent-auth evidence |
| Sessions | `V7.1.1`, `V7.1.3`, `V7.2.1`, `V7.2.3`, `V7.2.4`, `V7.3.1`, `V7.3.2`, `V7.4.1`-`V7.4.5`, `V7.5.1`, `V7.5.2` | opaque backend sessions, rotation, expiry, revocation, inventory |
| Authorization | `V8.1.1`, `V8.1.2`, `V8.2.1`-`V8.2.3`, `V8.3.1`, `V8.3.2`, `V8.4.1` | route/object/field authorization and immediate entitlement enforcement |
| OAuth/OIDC | `V10.1.2`, `V10.2.1`-`V10.2.3`, `V10.5.1`, `V10.5.3` | state/PKCE/nonce/issuer/redirect/scope validation if used |
| Randomness/crypto | `V11.4.1`, `V11.5.1` | CSPRNG identifiers and challenges, approved hashes |
| Service security | `V12.3.5` | authenticated service paths and protected origins |
| Secrets/data | `V13.3.2`, `V14.2.1`, `V14.3.1`, `V14.3.3` | least-privilege secrets, no credentials in URLs/storage, logout cleanup |
| Logging/errors | `V16.2.5`, `V16.3.2`, `V16.3.3`, `V16.5.1` | redacted security events and bounded errors |

References must use the versioned form such as `v5.0.0-V7.2.4` in audit reports.

## Current verified boundary

| Control | Status | Current evidence |
|---|---|---|
| Customer signing off | `verified_current` | `lib/customer_trade/feature_flags.mjs`, Worker flags, contract/browser/release preview tests |
| Customer submission off | `verified_current` | same boundary; no submit route enabled |
| Legacy customer routes fail closed | `verified_current` after this change | `worker.mjs`, `tests/customer_security_foundation.test.mjs` |
| Legacy wallet/trade bundles excluded | `verified_current` after this change | `scripts/prepare-deploy-assets.mjs`, release asset test |
| Public-origin secret server-only | `verified_current` | current-intelligence tests, no-leak scans, isolated Cloudflare preview |
| Exact release tuple and rollback | `verified_current` | `tests/release_cohesion.test.mjs`, release packaging/staging verification |
| Public response and asset no-leak | `verified_current` | `scripts/validate-public-no-leak.mjs`, `scripts/validate-worker-responses.mjs` |
| Production customer authentication | `verified_current` | production AuthKit tenant, exact callback, Google OAuth, email authentication, encrypted Worker bindings, and release verification |
| Authenticated-origin strict CSP | `verified_current` | isolated `app.ravenos.xyz` boundary, account browser tests, and release-preview header verification |
| Server session and CSRF | `verified_current` | opaque session, expiry, rotation, revocation, ownership, CSRF, D1 persistence, and browser tests |
| Authenticated read-only Portfolio preview | `verified_current` in code and authorized live harness; activation feature-gated | exact authenticated origin, opaque account-bound wallet selection, CSRF, D1 rate limits, bounded providers, address-free DTO/telemetry, conservation refusal, and no persistence/signing/submission in `tests/portfolio_governor_preview.test.mjs` |
| Hosted recovery enumeration timing | `external_review_required` | RavenOS failures are generic; managed-provider recovery timing remains an external provider-path review |
| Managed edge-rule review | `external_review_required` | keyed application rate limits are active; an independent Cloudflare rule audit remains defense in depth |
| Wallet linking | `required_not_implemented` | deliberately absent |
| Billing and entitlements | `required_not_implemented` | legacy routes quarantined; replacement absent |
| Persistent customer Portfolio | `required_not_implemented` | read-only preview is transient; snapshot history, durable wallet linking, retention, and deletion remain deliberately absent |
| Transaction authorization | `required_not_implemented` | design only |

This table is not an ASVS certification.

## Required scenario matrix

The canonical machine-readable inventory is `config/customer_security.json`.

### Stage A — account, session, browser, and authorization

| ID | Scenario | Expected proof |
|---|---|---|
| `SEC-SES-001` | Session fixation and rotation | pre-auth token cannot survive; old token denied after auth, reauth, or privilege change |
| `SEC-SES-002` | Expired session | idle and absolute expiry enforced by server clock |
| `SEC-SES-003` | Revoked session | current/other/all session revocation immediately denies reuse |
| `SEC-CSRF-001` | Cross-site state change | missing/wrong CSRF, Origin, or Fetch Metadata rejected; same-origin valid request works |
| `SEC-AUTHZ-001` | Privilege/entitlement bypass | client tier mutation, stale entitlement, and direct protected API access denied |
| `SEC-AUTHZ-002` | Cross-user object access | guessed IDs and altered owner IDs never disclose or mutate another account |
| `SEC-ENUM-001` | Account enumeration | login/registration/recovery results and timing do not reveal existence |
| `SEC-EDGE-001` | WAF/rate-limit behavior | isolated target proves endpoint-specific policy without becoming authorization |
| `SEC-XSS-001` | Narrator/metadata XSS | HTML, SVG, URL, template, and event-handler payloads render inert |
| `SEC-CSP-001` | CSP enforcement | unapproved inline/eval/external script and framing attempts blocked and reported |

Run these against unit/service tests and an isolated production-equivalent Cloudflare preview. Browser tests must inspect cookies, headers, CSP reports, storage, and cross-origin behavior.

### Stage B — wallet proof and portfolio ownership

| ID | Scenario | Expected proof |
|---|---|---|
| `SEC-WAL-001` | Nonce replay | first valid proof consumes; every replay fails |
| `SEC-WAL-002` | Wrong domain/URI | exact mismatch fails before mutation |
| `SEC-WAL-003` | Wrong chain/network | exact mismatch fails before mutation |
| `SEC-WAL-004` | Expired/not-yet-valid challenge | server time enforcement; no grace fallback |
| `SEC-WAL-005` | Duplicate wallet linking/race | uniqueness and atomic transaction permit at most one owner |
| `SEC-WAL-006` | No recent reauth | link, unlink, primary change, and transfer denied |

Add malformed/oversized messages, invalid signatures, wrong address, wrong request ID, wrong purpose, unsupported contract wallet, inactive session, missing CSRF, and cross-user `wallet_link_id` cases.

### Stage C — billing and persistence

| ID | Scenario | Expected proof |
|---|---|---|
| `SEC-BIL-001` | Forged webhook | invalid signature/raw-body mutation/test-live mismatch rejected |
| `SEC-BIL-002` | Replay/duplicate webhook | signed timestamp bounded; event dedupe is idempotent |
| `SEC-BIL-003` | Out-of-order event | entitlement derives from reconciled authoritative state, not arrival order |

Also test CSRF on Checkout/Portal creation, account ownership of Stripe customer, cancellation enforcement, failed reconciliation, transaction rollback, and client “payment succeeded” claims.

### Stage D/E — transaction review and execution

| ID | Scenario | Expected proof |
|---|---|---|
| `SEC-TX-001` | Quote/prepared mismatch | any economic or semantic difference invalidates preparation |
| `SEC-TX-002` | Stale quote | expired quote/intent cannot prepare, sign, or submit |
| `SEC-TX-003` | Altered route/recipient/approval | undeclared hop, program, contract, fee, recipient, or approval rejected |
| `SEC-TX-004` | Wrong wallet | signer/link mismatch rejected |
| `SEC-TX-005` | Wrong chain/network | chain mismatch rejected |
| `SEC-TX-006` | Duplicate broadcast | concurrent/replayed submit produces at most one provider submission |
| `SEC-TX-007` | Flags off | every signing/preparation/submission path remains unavailable |

Add amount/decimals, minimum output, slippage, nonce/blockhash, simulation delta, unexpected instruction/call, provider timeout/reconciliation, and kill-switch tests per chain.

## CI and release gates

### Every change now

1. complete contract suite;
2. complete browser suite with no test-count shrinkage;
3. `tests/customer_security_foundation.test.mjs`;
4. `scripts/validate-security-architecture.mjs`;
5. generated Worker-response scan;
6. deployable JS/CSS/map/manifest no-leak scan;
7. synthetic payload search;
8. release cohesion checks;
9. `git diff --check`;
10. parent `.env` byte-identity check unless the owner explicitly reports an intentional change.

### Stage A activation gate

- provider security review and separate test/production tenants;
- all `SEC-SES`, `SEC-CSRF`, `SEC-AUTHZ`, `SEC-ENUM`, `SEC-EDGE`, `SEC-XSS`, and `SEC-CSP` tests implemented and green;
- strict CSP and authenticated-origin header scan;
- dynamic application test against isolated preview;
- dependency/SBOM and secret scan;
- recovery and incident tabletop follow-up recorded where provider-managed behavior cannot be proven by RavenOS automation.

### Before Stage B/C

- all prior gates plus wallet/billing suites;
- concurrent atomicity tests against the actual persistence service;
- privacy/data-flow review;
- provider outage and rollback tests;
- exported redacted WAF/rate-limit configuration evidence.

### Before Stage E

- all transaction tests against each exact supported chain/venue;
- independent penetration test;
- independent wallet/transaction review;
- incident, reconciliation, provider-disable, and kill-switch exercise;
- explicit owner authorization and immutable release identity.

## Edge test constraints

A local mock cannot prove Cloudflare WAF, Turnstile, cookie behavior at the real hostname, or isolated-origin policy. These require a non-production version/preview carrying production-equivalent non-secret bindings and dedicated test identities. Cloudflare controls remain defense in depth; tests must also prove application-side identity, authorization, nonce, and signature checks.

## Reporting format

Every security release report includes:

```json
{
  "security_architecture_version": "ravenos.customer_security_architecture.v1",
  "asvs_version": "5.0.0",
  "release_id": "immutable_release_id",
  "environment": "isolated_preview",
  "scenario_id": "SEC-SES-001",
  "status": "verified_current",
  "test_file": "exact/path",
  "evidence_artifact": "redacted/path-or-hash",
  "verified_at": "RFC3339",
  "reviewer": "named_reviewer"
}
```

Never place secrets, session tokens, wallet signatures, raw webhook secrets, broker tokens, or sensitive provider payloads in the report.

## External authority

- [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP Content Security Policy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [Cloudflare WAF rate-limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Stripe webhook verification](https://docs.stripe.com/webhooks)
