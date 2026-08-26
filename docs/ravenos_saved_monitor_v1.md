# RavenOS Saved Monitor v1

Status: local implementation candidate; not deployed or promoted.

Saved Monitor is a customer research-continuity feature on the isolated authenticated origin. It is not a wallet monitor, alert engine, portfolio-history store, trading surface, or execution permission.

## Stored contract

One owner-scoped record represents one canonical exact market:

- exact `instrument_id`, instrument type, identity scope, asset class, chain, venue, and market type;
- a plain-text normalized display label and optional base/quote symbols;
- workspace schema `ravenos.saved_workspace.v1`;
- allowlisted timeframe, indicators, Raven overlays, density, and selected panel;
- server-managed revision and content hash;
- explicit `available`, `unavailable`, `superseded`, or `unverified` state with a last-checked time;
- created and updated timestamps.

The database uniqueness boundary is `(user_id, instrument_id)`. Identically named pools therefore remain separate. Symbols and labels can never select, replace, or remap a canonical identity.

The record excludes raw provider payloads, wallet addresses or balances, private cohorts, arbitrary HTML, alerts, quote or order objects, transaction material, signing data, and executable content.

## Routes and origin

The only customer surface is `https://app.ravenos.xyz/monitor/`. The host-only `__Host-ravenos_session` cookie remains confined to that host; there is no Domain cookie and no browser-stored bearer token.

Authenticated routes:

- `GET /api/v1/research-state` lists the current customer's records without provider refreshes.
- `POST /api/v1/research-state/watch-items` validates and idempotently creates or updates one exact market.
- `POST /api/v1/research-state/watch-items/:watch_id/refresh` refreshes normalized availability for an already owned item.
- `DELETE /api/v1/research-state/watch-items/:watch_id` idempotently removes an owned item and does not reveal another customer's item.
- `DELETE /api/v1/research-state` requires an explicit confirmation value and removes every record owned by the customer.

All mutations require JSON, exact same-origin and Fetch Metadata checks, an authenticated server session, and the session-bound CSRF token. Authenticated reads also reject an explicit cross-origin request before returning customer state. Request bodies are capped at 8 KiB. Account quotas and application rate limits are enforced independently of the user interface.

## Public handoff

Discover and Terminal build a bounded link to Saved Monitor containing only exact identity assertions and allowlisted workspace preferences. The sign-in return path is rebuilt from that local allowlist rather than forwarding the original query. The authenticated endpoint treats every parameter as untrusted, derives canonical identity from `instrument_id`, rejects contradictions, and persists only the server-normalized record. A missing exact market is saved as unavailable; RavenOS does not search by symbol or substitute a pool.

Opening a saved item always returns to the public exact-market Terminal URL. Saved timeframe, indicators, Raven overlays, density, and panel are restored when supported. An unavailable or superseded item opens the same exact identity and reaches Terminal's explicit unavailable state.

## Retention and deletion gate

Saved research state is convenience state, not an append-only research or execution ledger. Individual deletion removes the owned row. Delete-all removes every row owned by the account. Deleting a RavenOS account will cascade these rows through the user foreign key when account deletion is implemented.

Before production activation:

1. apply `customer-migrations/0002_customer_research_state.sql` to the correct customer database in an isolated release stage;
2. run authorization, CSRF, quota, malformed-input, XSS/no-leak, exact-identity, unavailable-market, cross-device, and delete-all tests against the staged origin;
3. verify account-deletion orchestration and backup retention language;
4. verify D1 restore/backup access is operationally restricted and documented;
5. complete an isolated release preview and production promotion decision.

No alert, wallet, portfolio-history, signing, submission, or trading capability is activated by this contract.
