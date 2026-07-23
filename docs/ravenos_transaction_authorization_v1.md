# RavenOS transaction authorization v1

Status: design only; public signing and submission remain disabled  
Contract: `ravenos.transaction_authorization.v1`

## Invariant

A Raven Plan, Raven Read, forecast, alert, quote, or connected wallet never authorizes a transaction.

The user must review and authorize one exact, expiring economic intent. A prepared transaction is acceptable only when its decoded semantics match that immutable server record. Any material change returns the flow to Quote or Review.

## Current boundary

The current RavenOS Worker exposes read-only quote/review scaffolding and reports:

- `signing_available: false`;
- `submission_available: false`;
- no customer transaction preparation intended for signing;
- no confirmed-trade or customer position-monitoring system.

`lib/cross_market/trade_intent.mjs` is a preliminary non-signing product contract. It is not the authorization service described here.

`lib/customer_trade/execution_readiness.mjs` is now a pure, internal-only readiness model for the immutable review binding, allowed state transitions, payload comparison, quote expiry, recent-reauthentication gate, and at-most-once submission rule described below. Its focused tests use fixtures only. It has no Worker import, route, browser bundle, signer, provider submission call, persistence service, or live venue access. The current gate deliberately reports owner-only execution unavailable because signing, submission, the private kill-switch clearance, and fill/position reconciliation are all false. This checkpoint strengthens the future contract; it does not change the public boundary above.

## Required state machine

```text
draft
  -> quoted
  -> reviewed
  -> prepared
  -> wallet_confirmation_requested
  -> signed
  -> submitted
  -> confirmed | failed | expired
```

Allowed terminal states also include `cancelled` and `rejected`. State transitions are append-only, sequential, idempotent, and server-authorized. Skipping a state or moving backward is rejected. A new quote creates a new intent version or intent ID.

Stage D stops at a read-only reviewed or simulated state. `prepared`, wallet confirmation, signing, submission, and confirmation remain unavailable until Stage E authorization.

## Immutable intent record

Before any future transaction is prepared, the server stores:

```json
{
  "schema_version": "ravenos.transaction_intent.v1",
  "intent_id": "int_random",
  "intent_version": 1,
  "user_id": "usr_random",
  "session_public_id": "sespub_random",
  "wallet_link_id": "wlt_random",
  "chain_namespace": "solana_or_eip155",
  "network_reference": "exact_network",
  "canonical_instrument_id": "exact_ravenos_identity",
  "market_identity": "exact_pool_contract_or_venue_market",
  "side": "buy_sell_long_or_short",
  "input_asset": "exact_asset_identity",
  "input_amount_base_units": "integer_string",
  "source_custody_domain": "exact_chain_venue_or_broker_account_domain",
  "expected_output_asset": "exact_asset_identity",
  "expected_output_amount_base_units": "integer_string",
  "minimum_output_amount_base_units": "integer_string",
  "destination_custody_domain": "exact_chain_venue_or_broker_account_domain",
  "slippage_bps": 0,
  "route_id": "provider_independent_route_identity",
  "route_hops": [],
  "cross_domain_transfer": null,
  "program_or_contract_allowlist": [],
  "spender_and_approval": null,
  "fee_items": [],
  "gas_or_network_fee_bound": null,
  "quote_observed_at": "RFC3339",
  "expires_at": "RFC3339",
  "idempotency_key_verifier": "server_side_verifier",
  "reviewed_at": null,
  "reviewed_authentication_time": null,
  "canonical_intent_hash": "sha256_of_canonical_record",
  "state": "quoted"
}
```

Amounts use integers in base units plus separately validated decimals; floating-point values are display-only. The canonical hash uses a specified deterministic serialization such as RFC 8785 JSON Canonicalization Scheme and SHA-256. The server stores the record and recomputes the hash; a client-supplied hash is never authoritative.

The record also binds exact provider quote identity and bounded source lineage internally. Raw provider payloads and secrets do not enter browser responses.

## Review contract

The user sees plain-language, decoded facts:

- account and wallet that would act;
- exact chain/network and instrument/pool/contract;
- exact funding source and delivery custody domains;
- side and input amount;
- expected and minimum received amount;
- route and each economically material hop, including any bridge, issuer transfer, venue deposit, wrapper, or solver;
- price impact, slippage, network fee, RavenOS/provider/referral fees;
- contract/program addresses and spender approvals;
- quote timestamp and countdown to expiry;
- simulation result where supported;
- relevant current Raven risk context, clearly separated from authorization.

The review cannot be hidden behind hover behavior and must remain usable on mobile. Unlimited approvals are prohibited by default. Any unavoidable approval must be decoded, bounded, separately acknowledged, and included in the intent hash.

Review confirmation requires an active session, CSRF protection, object ownership, wallet-link ownership, current route capability, current entitlement if applicable, and recent reauthentication within the transaction policy window.

## Preparation and semantic comparison

Future transaction preparation occurs server-side or through a bounded provider path only after review. Before returning anything to a wallet, RavenOS decodes the prepared transaction and verifies:

1. exact chain/network and recent block/nonce context;
2. exact signer/wallet;
3. exact input and output assets;
4. exact input amount and minimum output;
5. route hops, pools, programs, contracts, recipients, and fee recipients;
6. approval target and amount;
7. gas/network-fee bounds;
8. absence of undeclared instructions, calls, transfers, signers, or writable accounts;
9. quote and intent have not expired;
10. current route is still compatible with the reviewed identity.

Any mismatch invalidates the prepared artifact and the user must review a new intent. RavenOS does not ask the wallet to sign first and inspect later.

## Chain-specific requirements

### Solana

- Decode every instruction, account meta, signer, writable account, program ID, token mint, amount, destination, fee/tip, address lookup table, and recent blockhash.
- Allowlist exact programs and instruction variants for each supported route.
- Simulate against the intended cluster and reject unexpected balance, token-account, authority, or ownership effects.
- Bind the expected wallet and cluster; reject durable nonce or versioned-transaction behavior unless explicitly supported and reviewed.

### EVM

- Decode destination, selector, calldata, value, chain ID, nonce policy, gas bounds, token, spender, approval amount, recipient, and calls in multicall/batch structures.
- Verify exact contract bytecode identity or approved deployment registry where appropriate.
- Detect delegatecall/proxy implications and undeclared value transfers.
- Prefer exact or bounded approvals. Unlimited approvals require an explicit separately authorized product decision.
- Simulate state changes and display decoded asset movements.

### Perpetual or broker venue

- Bind exact venue account, instrument, side, quantity, order type, limit/trigger values, reduce-only state, time in force, leverage/margin mode, client order ID, and expiry.
- Preserve actual venue collateral and settlement rules.
- A broker OAuth scope or venue session never substitutes for a current RavenOS user authorization.

### Adapter invariance

The Terminal and reviewed intent contract are provider-neutral; the execution adapter is not. Jupiter, Hyperliquid, Tradier, or any future provider may translate a reviewed exact intent into its own quote or order representation only after capability and account compatibility are established server-side.

An adapter may narrow capability or fail unavailable. It may never:

- replace the selected instrument, pool, contract, listing, venue account, chain, or settlement asset;
- broaden an order type, approval, OAuth scope, wallet permission, leverage limit, or transaction flag;
- treat provider authentication as RavenOS transaction authorization;
- skip quote, review, recent reauthentication, intent binding, simulation/semantic validation, or idempotency;
- report execution, submission, or confirmation from an optimistic client state.

A cross-domain adapter must return one end-to-end route from the reviewed funding source to the reviewed destination. It must expose the transfer provider, all material custody-domain changes, expected timing, expiry, fees, gas, and failure/refund behavior. A partial route that leaves the customer to operate a bridge manually is unavailable, not “ready.” RavenOS still requires explicit review of the transfer even when the user does not have to leave the application.

Regulated securities execution and custody remain with the authorized broker. Non-custodial on-chain signing remains with the user wallet. Perpetual collateral and order semantics remain with the venue account. RavenOS supplies the exact instrument context, research, provider-neutral intent, review, policy boundary, and orchestration without collapsing those legal and custody roles.

## Idempotency and replay defense

- Quote, review, preparation, and submission use distinct idempotency domains.
- Idempotency keys are bound to account, session, wallet, action, and intent version.
- A signed artifact may be submitted at most once through RavenOS. Concurrent submissions serialize on the intent record.
- Provider timeouts resolve through reconciliation before retrying.
- Expired, cancelled, failed, confirmed, or superseded intents cannot re-enter preparation or submission.
- The browser cannot choose a prior intent ID belonging to another user or wallet.

## Wallet confirmation boundary

The wallet retains custody and performs final signing in its own confirmation interface. RavenOS never requests seed phrases, private keys, recovery phrases, or raw signer material.

Immediately before wallet handoff, RavenOS shows the reviewed intent hash/ID and warns the user to reject if the wallet presents materially different chain, amount, asset, recipient, approval, or program details. Wallet display limitations are documented per adapter.

The UI labels the pipeline accurately:

```text
Quote -> Review -> Prepared -> Awaiting wallet confirmation -> Signed -> Submitted -> Confirmed/failed
```

No optimistic label may skip from click to “trade complete.”

## Failure behavior

Fail closed on unknown or changed:

- user, session, entitlement, wallet link, chain, network, instrument, pool, contract, venue account;
- amount, decimals, output bound, slippage, route, fee, recipient, approval, quote time, expiry;
- simulation, decode, provider health, program registry, security flag, or kill switch.

Stale or unavailable Raven intelligence may remove decision-support context but must not be silently relabeled current. Whether it blocks a future transaction is an explicit route policy, never an implicit UI assumption.

## Audit and privacy

Audit state transitions, actor IDs, intent IDs, result codes, and bounded hashes. Do not log raw session credentials, CSRF secrets, private keys, signatures beyond a necessary bounded transaction identifier, full provider payloads, secret headers, or recovery material.

Customer transaction data remains separate from Raven private research evidence and public projections.

## Stage-E authorization gate

Public signing/submission requires all of the following:

- Stage A through D security gates verified;
- dedicated execution threat model and chain-specific abuse cases;
- automated mismatch, stale quote, wrong wallet, wrong chain, altered route, replay, and duplicate-broadcast tests;
- independent application penetration test;
- independent wallet/transaction security review;
- incident-response, kill-switch, provider-disable, reconciliation, and rollback runbooks;
- explicit owner authorization naming supported chains, venues, instruments, limits, and release identity.

Until then, all signing and submission controls stay unavailable and server flags stay off.
