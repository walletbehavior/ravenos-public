# RavenOS legal acceptance architecture

Status: implemented candidate; production enforcement off
Schema: `ravenos.customer_legal.v1`

## Design goals

- One registry for every user-facing legal document.
- Exact document type, version, path, and SHA-256—not a mutable “latest terms” boolean.
- Append-only acceptance records bound to the authenticated Raven user.
- No IP address required in the acceptance ledger.
- Server validation; an unchecked or client-only checkbox is insufficient.
- Separate capability acceptance for account creation, trading, Copy, embedded-wallet activation, Community publication, and affiliate enrollment.
- Reacceptance can block new affected activity without blocking account access, wallet withdrawal, wallet export, or wallet recovery.
- Drafts cannot accidentally become operative. Enforcement requires both an enable flag and an independent counsel-approved flag.

## Registry

`lib/customer_legal_registry.mjs` declares:

- immutable document metadata;
- capability-to-document requirements;
- exact submission validation;
- runtime readiness;
- the public manifest returned by `GET /api/v1/legal/documents`.

The checked-in documents are `review_candidate` records. Their paths live under `/legal/review/` and are visibly marked not effective. The current `/terms/` and `/privacy/` pages remain untouched until a reviewed successor is promoted.

## Persistence

Migration `0033_customer_legal.sql` adds:

- `legal_acceptance_json` to the one-time OAuth state;
- `ravenos_legal_documents` for immutable, content-hashed document versions;
- `ravenos_legal_acceptances` for append-only user assent.

Database triggers reject update or deletion of document and acceptance rows. A correction or new material term is a new version, not an overwrite. Operational privacy deletion must be reconciled with any legal obligation to retain acceptance evidence; the user foreign key is `RESTRICT` by design and requires a reviewed pseudonymization/deletion procedure.

## Account-creation flow

1. The account UI fetches `/api/v1/auth/config`.
2. If legal enforcement is active, it fetches `/api/v1/legal/documents`.
3. Create Account shows an unchecked Terms/Privacy control. Sign In does not.
4. The client sends the exact type/version/hash and `agreed` or `acknowledged` value.
5. `/api/v1/auth/start` validates the exact current documents before creating one-time OAuth state.
6. The bounded acceptance payload is stored with that state; it contains no email, IP, wallet, provider token, or secret.
7. The callback consumes the state, validates the documents again, resolves the Raven identity, and appends the acceptance rows before creating the session.
8. A changed document hash, missing assent, reused state, or unavailable acceptance store fails closed.

This avoids trusting a client-supplied user ID and binds the pre-account click to the identity returned by the managed provider.

## Authenticated acceptance flow

- `GET /api/v1/legal/status` returns current acceptances and capability status for the authenticated user.
- `POST /api/v1/legal/acceptances` requires the Raven session, same-origin request boundary, CSRF token, a recognized capability, and exact current submissions.
- Duplicate delivery is idempotent through the user/document/version/hash uniqueness constraint.
- `requireCustomerLegalCapability` returns HTTP `428` with the missing document metadata when operative terms have not been accepted.
- If legal enforcement was requested but the counsel flag, database, or registry is invalid, the protected activation returns `503`; it never silently allows.

## Capability map

| Capability | Required documents | Notes |
| --- | --- | --- |
| Account creation | Terms + Privacy | Explicit unchecked signup assent |
| Account access | None | Existing users can always sign in |
| Trading activation | Terms + Privacy + Trading Risk | Applied to creation of a new live prepare ticket, not receipt/report reconciliation |
| Copy activation | Terms + Privacy + Trading Risk + Copy | Hook exists; live Copy remains off |
| Embedded-wallet activation | Terms + Privacy + Trading Risk | Initial Privy link/session only; existing linked-wallet recovery access is not re-gated |
| Community publication | Terms + Privacy + Community Guidelines | Applied when settings increase public exposure; privacy reductions remain allowed |
| Affiliate enrollment | Terms + Privacy + Affiliate Terms | Current program has attribution only and no compensation |
| Withdrawal/export/recovery | None | Must remain available independent of new trading terms |

## Material updates

Counsel or the accountable operator classifies a successor as:

- `informational_update`;
- `material_update`; or
- `requires_reacceptance`.

Engineering does not infer legal materiality. A successor that does not require
reacceptance must explicitly list each predecessor version and hash whose assent
remains valid. There is no implicit “any old version is good enough” rule. The
registry rejects predecessor carry-forward when `requires_reacceptance` is true.

To require reacceptance:

1. publish a new immutable document version and hash;
2. preserve the prior row;
3. update capability requirements to the new current version;
4. set `requires_reacceptance` to `true` and leave `accepted_predecessors` empty;
5. show the change and collect exact assent before new affected activity.

Existing open transactions must retain access to status and reconciliation. A terms change must not prevent the user from reducing public visibility, ending a subscription, or using supported withdrawal/export/recovery controls.

## Activation sequence

The candidate is intentionally impossible to enforce until all of the following are true:

1. Counsel reviews and approves the exact content.
2. The owner approves the exact feature/geography configuration.
3. Approved pages replace or supersede the current documents at their approved canonical paths.
4. The registry and a successor seed migration contain the exact approved hashes and `effective` status.
5. Database migration is applied before the Worker release.
6. Tests recompute each page hash and match the registry.
7. `RAVENOS_LEGAL_COUNSEL_APPROVED=1` is set.
8. `RAVENOS_LEGAL_ACCEPTANCE_ENABLED=1` is set.

The two flags must not be used to treat this review candidate as approved. A release checklist should name the counsel approval artifact and immutable content hashes.

## Audit and privacy

An acceptance record includes only:

- Raven user ID;
- document type;
- document version;
- content hash;
- agreed/acknowledged value;
- accepted timestamp;
- acceptance method.

It excludes email, legal name, IP, provider tokens, wallet secrets, private keys, and transaction payloads. The user ID comes from the authenticated server session or provider callback, never from request JSON.

## Failure behavior

- Legal feature off: existing product behavior continues.
- Feature requested but counsel flag absent: protected activation unavailable; sign-in and recovery-sensitive paths remain available.
- Registry hash malformed: protected activation unavailable.
- Database missing: protected activation unavailable.
- Document changes between start and callback: account creation fails generically; user restarts and reviews the new version.
- Duplicate submission: no duplicate acceptance row.
- Missing acceptance: affected activation returns `428` with required documents.
- Provider outage during signup: one-time state can be retried only within its existing security semantics; no acceptance exists until identity resolution succeeds.

## Remaining work before effective launch

- Counsel-approved content and legal entity/contact details.
- Region/age/sanctions controls.
- Reviewed account deletion and legal-record retention process.
- First-live-Copy activation wiring when the execution feature itself is enabled.
- Current effective-document promotion migration.
- Subscription cancellation/refund terms and live checkout validation.
- Production Privy export/recovery/withdrawal proof.
- Accessibility, mobile Safari, multi-tab, and end-to-end release verification.
