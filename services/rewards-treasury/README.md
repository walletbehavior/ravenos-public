# Raven Rewards treasury service

This implements the missing `/quote` and `/payout` service binding used by the existing rewards dispatcher. It is a separate Worker with a durable Solana USDC outbox. The customer Worker does not receive treasury signing credentials. No new reward balance or liability ledger is introduced.

**Default: disabled. No production payout has been made.** The checked-in configuration has no public routes, no customer database binding, no credentials and no funded treasury. It is not activated by the normal RavenOS release script.

## Implemented boundaries

- A payout must match an existing reserved claim, its user, destination and integer amount. The service re-reads the existing rewards ledger and verifies the embedded-wallet association or consumed external signature challenge.
- Only canonical mainnet Solana USDC is supported initially. Treasury and recipient must be on-curve wallet addresses. Source/destination ATAs are derived; existing token account mint, authority, state, delegation and close authority are checked. Missing recipient ATA creation is idempotent and included in network cost.
- Quotes measure transaction fee and ATA rent. A current Jupiter SOL price is checked against its block timestamp and an operator-configured upper valuation bound. Integer arithmetic rounds cost upward. The minimum claim, maximum claim, daily payout limit, absolute cost cap and cost percentage are configuration, not product constants selected by this implementation.
- Signing uses Privy's `signTransaction` endpoint with a P-256 authorization signature, request expiry and a deterministic idempotency key. The returned transaction must have exactly the constructed message and a valid treasury signature. No signing request goes to a customer-owned Privy wallet.
- The durable coordinator serializes payouts and charges its daily budget before signing. It stores the exact unsigned message, then signed bytes and signature **before broadcast**. A timeout retries the same bytes. Expired or failed transactions enter review; they are never automatically rebuilt with a fresh blockhash.
- The existing customer dispatcher independently verifies finalized canonical USDC balance deltas before marking rewards claimed. Treasury submission alone does not settle the reward ledger.
- Provider response bodies and credentials are never returned or logged. The public quote omits transaction bytes. Turning off `TREASURY_LIVE_ENABLED` stops signing, sending and retry alarms.

## Required activation inputs

1. A company-controlled **dedicated treasury wallet**, funded with canonical USDC and SOL for transaction fees/ATA rent. Do not substitute the user's embedded wallet, a Jupiter referral PDA, or arbitrary token fee account.
2. Privy treasury wallet ID, app ID, app secret and an authorization key scoped to that treasury wallet. Configure provider-side policies to restrict the canonical token, treasury authority and spending limits. Keep these only on this isolated service: `TREASURY_PRIVY_WALLET_ID`, `TREASURY_PRIVY_APP_ID`, `TREASURY_PRIVY_APP_SECRET`, `TREASURY_PRIVY_AUTHORIZATION_KEY`.
3. Read-only `TREASURY_SOLANA_RPC_URL` and `TREASURY_JUPITER_API_KEY` bindings. Mainnet identity is checked before construction.
4. `TREASURY_POLICY_JSON` containing `wallet_address`, `minimum_claim_micros`, `maximum_claim_micros`, `daily_limit_micros`, `maximum_network_cost_micros`, `maximum_cost_bps`, and `sol_price_ceiling_micros`. All money fields are positive integer strings. Choose the minimum after measuring whether a recipient already has a USDC ATA; Raven absorbs costs.
5. Bind the existing customer database as `RAVENOS_CUSTOMER_DB` to this service and bind the service as `RAVENOS_REWARDS_TREASURY` on the customer Worker. The service code performs only SELECTs on the customer database. Its outbox and budget live in its own Durable Object.
6. Mirror the network, treasury, minimum and network-cost policy in the customer's existing `RAVENOS_REWARD_CLAIM_NETWORKS_JSON`. Stage with quotes enabled and live disabled. Verify exact quote and unsigned construction against the actual treasury, then run a user-confirmed tiny claim canary before enabling claims broadly.

An expired unresolved claim requires independent chain review before the existing accounting operation can be released or replaced. The service deliberately has no arbitrary admin transfer/reissue endpoint. This is an operational requirement before general availability; a failed market trade is not a reason to reverse ordinary earned rewards.

## Validation and references

Run `node --test --experimental-test-isolation=none tests/rewards_treasury.test.mjs` and the existing rewards/claim tests. Fixtures use generated test-only signing keys and intercept every provider request; no production funds move.

Current official contracts used: [Privy Solana signTransaction](https://docs.privy.io/api-reference/wallets/solana/sign-transaction), [Privy authorization signing](https://docs.privy.io/controls/authorization-keys/using-owners/sign/direct-implementation), [Jupiter Price V3](https://developers.jup.ag/docs/price). Privy idempotency may retain a failed response; this implementation does not change keys automatically after an uncertain signing request.
