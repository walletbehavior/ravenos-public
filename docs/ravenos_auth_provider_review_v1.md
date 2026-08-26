# RavenOS managed identity provider review v1

Status: implementation selected; provider tenant and production activation pending
Reviewed: 2026-08-26
Scope: RavenOS account creation, authentication, recovery, and provider-to-RavenOS identity exchange

## Decision

RavenOS Stage A uses WorkOS AuthKit as the managed identity provider. The RavenOS account remains the application principal. WorkOS credentials prove authentication to RavenOS; a wallet address, browser flag, provider access token, or email address never becomes authorization by itself.

AuthKit provides a hosted authentication surface for email/password, social login, Magic Auth, MFA, and related account flows. Its authorization-code flow supports state and PKCE. Passkeys are supported for sign-up and sign-in, with a production custom authentication domain required to avoid relying on a provider-hosted development domain.

Primary references:

- [AuthKit overview](https://workos.com/docs/authkit/overview)
- [Hosted UI](https://workos.com/docs/authkit/hosted-ui)
- [Authorization URL](https://workos.com/docs/reference/authkit/authentication/get-authorization-url)
- [Code authentication exchange](https://workos.com/docs/reference/authkit/authentication)
- [Passkeys](https://workos.com/docs/authkit/passkeys)

## RavenOS implementation boundary

The Worker implementation in `lib/customer_identity.mjs`:

- begins authentication only after exact same-origin and Fetch Metadata checks;
- creates a one-time, server-stored authorization state and PKCE verifier;
- accepts the callback only on `https://app.ravenos.xyz/api/v1/auth/callback`;
- consumes state atomically before exchanging the one-time code;
- requires a verified managed-provider email and rejects impersonation responses;
- keys credentials by provider issuer and subject, never by email or wallet;
- discards provider access and refresh tokens after the identity exchange;
- creates a random RavenOS `user_id` and a new opaque session token;
- stores only one-way session and CSRF verifiers;
- rotates any existing browser session after completed authentication;
- enforces 30-minute idle, 12-hour absolute, and five-minute recent-authentication windows;
- exposes session inventory and same-user revocation without exposing internal user IDs;
- leaves wallet linking, transaction signing, and submission disabled.

The account UI never receives a provider secret, provider bearer token, session verifier, internal user ID, seed phrase, private key, or wallet signature. Session cookies are host-only, Secure, HttpOnly, SameSite=Lax, and unavailable to JavaScript. Authenticated responses are non-cacheable.

The authenticated hostname serves only the account document, immutable first-party assets, and the account/session API family. Market workspaces stay on `ravenos.xyz`; they are not allowed to become same-origin with the customer session merely because both surfaces use the RavenOS Worker.

## Required tenant configuration

Production activation remains prohibited until all of the following are captured as redacted evidence:

1. Create separate WorkOS test and production environments owned by RavenOS-controlled organization accounts.
2. Register the exact callback `https://app.ravenos.xyz/api/v1/auth/callback`; remove wildcard and localhost callbacks from production.
3. Configure and verify a RavenOS custom authentication domain before advertising production passkeys.
4. Enable Google OAuth and confirm the RavenOS consent-screen identity, support address, and approved domains.
5. Enable a RavenOS-approved first-party sign-in path: email/password and passkey, with verified email and managed recovery. Magic Auth may be added only after enumeration and replay testing.
6. Require MFA or an equivalent step-up ceremony for recovery and later wallet, billing, broker, or signing security changes.
7. Configure provider session/credential revocation and signed lifecycle webhooks where required; never place webhook or API secrets in assets.
8. Establish minimum provider roles, two-person production administration, audit export, breach response, retention, deletion, and test-user cleanup.
9. Store `WORKOS_API_KEY` and `RAVENOS_AUTH_HASH_PEPPER` as server-only Cloudflare secrets. Configure `WORKOS_CLIENT_ID` as a server-controlled deployment binding; it is an OAuth client identifier and necessarily appears in the browser authorization URL. The pepper must be independently generated and must not be reused as another secret.
10. Run the full Stage A matrix against an isolated production-equivalent Worker version before setting `customer_capabilities_enabled` to true.

## Known limitations and decisions

- A wallet connection is not account authentication. Phantom and MetaMask become linked credentials only after the SIWS/SIWE Stage B contract is implemented and verified.
- Email is a verified attribute and recovery channel, not an account lookup authority. Cross-provider account linking stays under the managed provider's verified policy.
- RavenOS does not implement or store passwords. Password hashing, password policy, passkey ceremonies, social provider handling, and recovery are delegated to the managed provider.
- The hosted provider UI is outside the RavenOS CSP boundary. RavenOS sends only bounded protocol values and receives only a one-time callback code and state.
- Local and mocked tests do not prove provider, DNS, WAF, cookie, custom-domain, or real-browser behavior. Those controls remain blocked in `config/customer_security.json` until preview evidence exists.

## Activation decision

The provider adapter, account schema, account surface, and local automated verification exist. Production customer capabilities remain disabled because the WorkOS tenant, RavenOS custom authentication domain, provider secrets, WAF controls, and production-equivalent preview evidence are not yet present. No unavailable capability may be represented as active merely because the code path exists.
