# Reserve wallet creation and cashback conversion

Product decisions recorded September 9, 2026. These are follow-on requirements; this change does not enable transfers or add a nonfunctional customer control.

## Create Shielded Reserve

Keep the existing Raven login and expose one Portfolio action once the wallet implementation is usable. Privy's current [Create wallet API](https://docs.privy.io/api-reference/wallets/create), checked September 9, lists no Zcash wallet chain type. Its EVM/Solana wallet creation cannot create a Zcash shielded receiver or signer. Generic curve support is not an Orchard wallet implementation.

The Zcash adapter therefore needs its own supported user-controlled wallet backend behind Raven's existing wallet abstraction. Select and verify a real wallet transport/SDK before exposing Create. Wallet sync, receiver discovery, shielding, spending, recovery, optional observation and settlement must work. Holding a ZEC token on Solana or EVM never qualifies as a shielded reserve. No new Raven custody or spend-key collection is authorized by the wallet-creation UI request.

## Convert cashback to Shielded Reserve

An opt-in trader action after the reserve path is complete:

1. Select available cashback in USDC; pending, reserved and already claimed rewards cannot be selected again.
2. Preview the expected ZEC, USD equivalent, provider/network costs, minimum receive, quote expiry, destination and timing. ZEC carries price risk; the conversion does not preserve a stable USDC balance.
3. Reuse the existing reward claim to pay USDC into the user's Raven wallet. Link the confirmed claim receipt to a separate customer-owned reserve conversion intent. Never substitute Raven's fee collector or payout treasury as the trader's reserve wallet.
4. Execute the reserve conversion after the trader authorizes the quoted amount and destination. Apply zero Raven reserve fee, as confirmed by the user on September 9. Provider/network costs remain disclosed. Do not reuse the ordinary spot-trade fee or award recursive cashback on the capital movement.
5. Reconcile the claim and conversion independently. A confirmed claim consumes the cashback liability once. A failed conversion leaves the user's USDC available or in a reconciled refund path; it must not recreate already paid cashback. A delayed/unknown transaction remains reserved or in transit until resolved, without automatic resubmission.

The UI can present this as one workflow, with the claim and conversion statuses visible when necessary. Reserve balance appears only after receipt verification. Initial conversion is manual and opt-in. Scheduled top-ups, direct payout-to-shielded routes and pooled conversions are not part of the first implementation.

Existing ledger integration points: `lib/customer_rewards.mjs`, `lib/customer_reward_claims.mjs`, and `lib/customer_reward_payouts.mjs`. Existing capital integration points: `lib/customer_trade/shielded_reserve.mjs`, `lib/customer_trade/shielded_portfolio.mjs`, and `lib/customer_shielded_routes.mjs`. No reward-rate, fee-collection, ledger or custody code is changed by this specification.
