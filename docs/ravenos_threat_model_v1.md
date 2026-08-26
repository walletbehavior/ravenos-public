# RavenOS customer threat model v1

Status: Stage A implementation threat model; production provider/preview review pending
Method: asset/trust-boundary review plus STRIDE and abuse-case analysis  
Date: 2026-07-21

## Scope

This model covers the inactive Stage A RavenOS account/session implementation plus future verified wallet links, persistent Portfolio/watchlist/alert data, subscriptions, broker connections, quote review, and eventual non-custodial transaction signing/submission.

It does not claim customer authentication is active or that later-stage systems exist. Public signing and submission remain disabled.

## Protected assets

Highest-impact assets:

- customer account control and recovery;
- passkey/provider credential bindings;
- opaque session and CSRF secrets;
- wallet-link ownership and public addresses;
- portfolio holdings, positions, annotations, alerts, and watchlists;
- Stripe customer/subscription mapping and entitlement state;
- broker OAuth refresh tokens and account identifiers;
- reviewed quote, trade intent, prepared transaction, signature, and submission state;
- security flags, execution kill switches, program/contract allowlists, and provider routing;
- Raven private evidence, actor graphs, proprietary thresholds, prompts, secrets, and public-origin token;
- audit integrity and release identity.

## Actors

- legitimate anonymous, customer, subscriber, Pro, and future transaction user;
- external wallet and wallet extension/mobile bridge;
- managed identity provider;
- Stripe and future broker/venue providers;
- RavenOS application and customer security service;
- Raven private services and public-safe projection;
- support and administrative operators;
- opportunistic attacker, bot, credential-stuffer, phisher, malicious site, malicious browser extension, compromised third-party script, malicious customer, compromised provider, and insider.

## Trust boundaries

1. Public browser to `ravenos.xyz`.
2. Authenticated browser to future `app.ravenos.xyz`.
3. Browser to external wallet.
4. RavenOS to managed identity provider.
5. Worker/application to session/customer store.
6. RavenOS to Stripe, broker, quote, chain, and venue providers.
7. Public Raven projection to RavenOS.
8. Private Raven services to public-safe projection.
9. Administrative origin to customer systems.
10. Source/build pipeline to immutable release and Cloudflare production promotion.

No data crossing a boundary is trusted solely because it came through Cloudflare, a connected wallet, an authenticated browser, or a known provider hostname.

## Current high-priority findings

| ID | Finding | Current control | Required disposition |
|---|---|---|---|
| TM-01 | Legacy wallet-address access/Stripe code lacks account and session principals | Worker routes quarantined; assets excluded | Remove or retain only as non-deployable migration evidence before Stage A |
| TM-02 | Legacy Solana access message lacks nonce, expiry, chain, request ID, and replay consumption | Route unreachable | Replace only with SIWS contract after Stage A |
| TM-03 | Current public CSP is Terminal-only and permits inline script/style | No authenticated app exists | Strict nonce/hash CSP before Stage A |
| TM-04 | Public and future authenticated surfaces currently share one planned product origin | Future origin not launched | Separate `app.ravenos.xyz` and internal admin origin before customer data |
| TM-05 | Current browser storage holds selected market context and legacy code can hold wallet address | No auth token is stored; legacy asset excluded | Auth/session secrets prohibited; minimize future wallet metadata |
| TM-06 | Public quote scaffolding exists without customer transaction authorization | Signing/submission hard-disabled | Preserve boundary through Stage D; separate Stage E review |

## Threat analysis

| Threat | Example | Impact | Required controls |
|---|---|---|---|
| Spoofing account | attacker replays IdP callback or guesses account identifier | account takeover | managed IdP, state/PKCE/nonce, issuer/audience/origin validation, random `user_id`, server sessions |
| Session fixation/theft | attacker sets or extracts session token | full account impersonation | new token after auth/reauth, 256-bit opaque token, secure host-only cookie, CSP, revocation, expiry |
| Wallet proof replay | copied signature links wallet again | wallet/resource takeover | standardized scoped message, atomic one-time nonce, short expiry, exact domain/URI/chain/address |
| Wallet/account confusion | connected wallet treated as signed-in user | authorization bypass | explicit state separation; every API checks account session and object ownership |
| IDOR/BOLA | guessed portfolio or session ID returns another user's data | privacy/financial exposure | random IDs, object-level server authorization, uniform errors, cross-user tests |
| CSRF | malicious site links wallet, opens billing, changes alert | account mutation | host-only SameSite cookie, session CSRF token, Origin/Fetch Metadata checks, restrictive CORS |
| XSS/content injection | token metadata or Raven/Atlas prose executes script | session theft/deceptive signing | text rendering, schema/length validation, contextual encoding, strict CSP, no arbitrary third-party JS |
| Clickjacking | hidden wallet/recovery control receives clicks | account or signing deception | `frame-ancestors 'none'`, anti-framing headers, wallet confirmation outside page |
| Entitlement forgery | client changes tier state or forged webhook grants Pro | revenue/data exposure | server authorization, raw-body Stripe signature, replay tolerance, dedupe, reconciliation |
| Account enumeration | response/timing reveals email exists | targeted phishing | generic responses, comparable work/timing, rate limits, tests |
| Recovery abuse | support moves wallet after email request | account/wallet theft | managed recovery, equivalent assurance, no support override based only on email, notifications |
| Broker token disclosure | refresh token reaches browser/log | account trading/data compromise | server-only encrypted storage, scopes, rotation/revocation, redaction |
| Quote/transaction substitution | prepared transaction changes route/recipient | loss of funds | immutable intent hash, semantic decode, simulation, exact allowlists, fresh review |
| Unlimited approval deception | route adds broad spender approval | future asset loss | bounded approvals, explicit review, decoded amount/spender, default prohibition |
| Replay/double submit | repeated request broadcasts twice | duplicate order/trade | intent state machine, idempotency, atomic submission, reconciliation |
| Wrong chain/wallet | user signs valid payload for another context | loss or wrong account action | exact chain and signer binding, wallet adapter checks, prepared semantic comparison |
| Provider compromise | quote/market/broker response is malicious | data deception or transaction loss | schemas, bounds, allowlists, independent decode/simulation, circuit breaker, provider health |
| Edge bypass | attacker reaches origin outside WAF controls | brute force/abuse | origin authentication, application rate limits, auth independent of edge, private service paths |
| Admin abuse | support accesses or mutates customer data | broad compromise | separate origin, strong auth, least privilege, approval for high-risk actions, immutable audit |
| Log leakage | sessions, wallet signatures, provider tokens logged | durable credential disclosure | structured allowlisted fields, redaction, retention, access controls, leak scanning |
| Release mix/supply chain | Worker and assets differ or dependency compromised | security control bypass | immutable release tuple, exact staging/promotion, lockfile review, dependency/SBOM scanning, rollback |
| Raven boundary leak | customer wallet joins private actor graph or public projection | privacy/proprietary exposure | physical/logical separation, no-leak tests, purpose limitation, public adapter allowlist |

## Critical abuse cases

### Malicious site links its wallet to a victim account

The victim has an authenticated cookie. A malicious origin submits a wallet-link request. Required rejection layers: SameSite behavior, exact Origin, Fetch Metadata, CSRF token, recent reauth, challenge bound to the victim session/user and exact address, explicit wallet interaction, atomic nonce consumption.

### Attacker reuses a valid wallet signature

A signature is captured from browser history, logs, or malicious JavaScript. Required rejection layers: message never in URL, nonce verifier stored server-side, five-minute expiry, exact purpose/request/session binding, consumed-at check in an atomic transaction, uniqueness constraint, audit alert.

### Compromised narrator or token metadata injects a signing overlay

An upstream text field contains HTML/script. Required controls: schema and length bounds, text-only components, contextual encoding, Trusted Types evaluation where practical, strict CSP, no raw `innerHTML`, no wallet prompt initiated from content render, UI state machine requires explicit user action.

### Client claims a paid entitlement

The browser changes local state or submits `tier=pro`. Required controls: client claims ignored, server reads current entitlement by `user_id`, webhook signature and dedupe, reconciliation with Stripe, immediate cancellation enforcement, object/field authorization.

### Quote provider changes recipient after review

The provider or transit response changes a fee recipient or adds an instruction. Required controls: server-held reviewed intent, canonical hash, independent decoding of every prepared action, program/contract and recipient allowlists, simulation, mismatch invalidation, new review.

### Support operator transfers a wallet after an email request

Required controls: no direct support mutation, controlled transfer workflow, strong source/destination proof, fresh wallet proof, delay/notification, dual control for exceptional recovery, audit.

## Security control ownership

| Layer | Owns | Does not own |
|---|---|---|
| Cloudflare | WAF, DDoS, edge rate limits, bot signals, origin isolation | account identity, resource authorization, nonce/signature verification |
| Managed IdP | passkey ceremony, recovery factors, provider assertion | RavenOS object ownership, wallet links, entitlements, transaction intent |
| RavenOS security service | user/session/resource authorization, CSRF, wallet challenge, audit | wallet private keys, card data |
| Stripe | hosted payment UI and authoritative billing objects | RavenOS API authorization |
| External wallet | custody and final signature confirmation | RavenOS account session or entitlement |
| Quote/provider service | bounded market/route data | authority to alter reviewed intent or submit |
| Raven public projection | public-safe market intelligence | customer identity or wallet resources |

## Risk acceptance

No customer-security control may be marked verified from design review alone. A control needs executable evidence in the target environment. Any exception to ASVS Level 2 or the selected Level 3 overlays requires a written rationale, owner, expiration, compensating controls, and explicit risk acceptance.

Public signing and submission have no accepted residual-risk posture yet and remain prohibited.

## Review triggers

Update this model before:

- choosing an IdP or session store;
- launching `app.ravenos.xyz`;
- enabling recovery, wallet linking, portfolio persistence, Stripe, broker OAuth, or entitlements;
- adding any new wallet/chain/venue adapter;
- preparing signable transactions;
- changing third-party scripts, CSP, admin access, or customer-data flow;
- any relevant incident or external review finding.
