# RavenOS managed identity provider review v1

Status: production tenant configured; Stage A account activation approved
Reviewed: 2026-08-26
Scope: RavenOS account creation, authentication, recovery, and provider-to-RavenOS identity exchange

## Decision

RavenOS Stage A uses WorkOS AuthKit as the managed identity provider. The RavenOS account remains the application principal. WorkOS credentials prove authentication to RavenOS; a wallet address, browser flag, provider access token, or email address never becomes authorization by itself.

AuthKit provides a hosted authentication surface for email/password, social login, Magic Auth, MFA, and related account flows. Its authorization-code flow supports state and PKCE. RavenOS enables Google OAuth, email/password, Magic Auth, and optional MFA. Passkeys remain disabled because a production custom authentication domain is a paid add-on that has not been approved.

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

## Production tenant configuration

The Stage A account scope uses the following production configuration:

1. Separate WorkOS test and production environments are owned by the RavenOS account.
2. Production uses the exact callback `https://app.ravenos.xyz/api/v1/auth/callback`; no wildcard or localhost callback is registered.
3. Google OAuth uses RavenOS branding, basic identity scopes, and does not return Google OAuth access or refresh tokens to RavenOS.
4. Email/password, Magic Auth, and optional MFA are enabled. Passkeys are not advertised or reported by the RavenOS capability API.
5. The provider requires verified email before RavenOS creates an account. Hosted recovery remains provider-managed.
6. RavenOS keeps wallet, billing, broker, signing, and submission changes disabled; their later stages require recent reauthentication and separate review.
7. `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and an independently generated `RAVENOS_AUTH_HASH_PEPPER` are encrypted Cloudflare Worker secrets and are absent from source and public assets.
8. The Stage A unit, browser, no-leak, release-cohesion, and isolated-preview gates must pass before production promotion.

## Known limitations and decisions

- A wallet connection is not account authentication. Phantom and MetaMask become linked credentials only after the SIWS/SIWE Stage B contract is implemented and verified.
- Email is a verified attribute and recovery channel, not an account lookup authority. Cross-provider account linking stays under the managed provider's verified policy.
- RavenOS does not implement or store passwords. Password hashing, password policy, passkey ceremonies, social provider handling, and recovery are delegated to the managed provider.
- The hosted provider UI is outside the RavenOS CSP boundary. RavenOS sends only bounded protocol values and receives only a one-time callback code and state.
- Local and mocked tests do not prove every provider-recovery timing property or independently managed edge rule. Those items remain marked `external_review_required` in `config/customer_security.json` rather than being represented as fully verified.

## Activation decision

Stage A account creation, authentication, and revocable server-side sessions are approved for production activation. Passkeys, wallet linking, saved customer data, subscriptions, entitlements, broker connections, transaction signing, and submission remain disabled. Provider-recovery enumeration review and managed edge-rule review remain external follow-up controls; neither expands the active authorization scope.
