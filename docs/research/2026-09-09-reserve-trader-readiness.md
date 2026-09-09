# Shielded Reserve: trader capital workflow

Shielded Reserve belongs in Portfolio → Capital helper. The trader controls the source wallet, reserve wallet, destination wallet and amount. Shield, Deploy and Return are customer capital movements. They do not feed Raven's fee collector, rewards ledger or operator treasury. The user confirmed on September 9: **no Raven fee on Portfolio/Shielded Reserve capital movements; trading fees remain separate.** The adapter requests no Raven app fee and reports `raven_fee_bps: 0`; provider and network costs remain visible.

ZEC spot representations are excluded from memecoin Discover, Raven Reads and participation groups, including retained snapshots. ZEC perps remain in Perps. A memecoin using ZEC as its quote asset remains a memecoin. This presentation rule does not classify a public-chain ZEC token balance as shielded capital.

## Verified today

At 2026-09-09T19:58:57Z two real provider dry quotes passed signature and request-identity verification using only published research addresses:

| Action | Input | Expected output | Provider settlement estimate | Quote latency |
|---|---|---|---|---|
| Deploy ZEC → Solana USDC | $100 equivalent ZEC | 99.636580 USDC | 452 seconds | 3,228 ms |
| Return Solana USDC → ZEC | $100 equivalent USDC | 0.07954794 ZEC | 135 seconds | 3,459 ms |

Both report zero Raven fee. These are indicative quotes, not transfers, measured settlement times or shielded-receipt proofs. Wallet confirmation/spendability can add time. The current privacy classification remains UNKNOWN. Hash-linked records are in `outputs/shielded-gap-proof-2026-09-09/routes.jsonl`.

The current Portfolio API explicitly reports wallet integration, settlement reconciliation, refund recovery and shielded-receipt verification as unavailable. Live signing/submission are hard disabled. The existing compartment accounting and copy-capital planner are shadow implementations.

## Required implementation, in order

1. **User-controlled Zcash wallet adapter.** Establish an actually supported external-wallet transport, shielded receiver validation, source-spend capability, recovery behavior and optional balance observation. Raven's existing Privy EVM/Solana adapter does not provide a Zcash signer. A viewing key is not spending permission; do not require or collect one merely to route to an external shielded receiver.
2. **Shield action from an existing trading wallet.** Bind the user's source wallet, asset/amount, provider deposit instructions, shielded destination and refund destination to one authenticated capital intent. Reuse Raven's existing wallet execution abstraction. A real provider quote and user-authorized funding transaction are missing; changing the existing dry flag alone is not an implementation.
3. **Deploy and Return execution.** Connect external shielded spending to the user's public trading wallet and reverse public capital back into the reserve. Show the expected receive, cost and time at the action. Keep wallet credentials and customer destinations out of research/test-vector routes.
4. **Durable settlement and recovery.** Store an idempotent customer-owned transfer record. Track source confirmation, in-transit value, destination receipt, delays, refunds and unresolved outcomes. Reconcile the same economic lot in Portfolio so source and destination cannot both count as available. A provider success response alone cannot prove a shielded note was received.
5. **End-to-end validation and beta release.** Verify the actual provider/wallet shielded and refund semantics, finish signing/security and the existing counsel review, then perform explicitly authorized small forward/reverse and failure-recovery tests. This turn moved no funds. Start with one complete Solana ↔ reserve path before expanding chains.

NEAR's [quote API](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) confirms that dry quotes initiate no swap and generate no deposit address. Its [bridge documentation](https://docs.near-intents.org/integration/bridging/overview) lists Zcash under its proof-of-authority bridge. [Privy's chain documentation](https://docs.privy.io/wallets/overview/chains) was checked; no Zcash shielded-wallet integration is assumed from generic key-curve support. Sources checked September 9, 2026.

The next delivery should be a complete customer capital path with zero Raven reserve fee. The no-fee decision applies to the Portfolio feature, not just its research phase. Ordinary trading retains its separate fee policy. No spend-key custody, pooled reserve or automatic profit sweep is introduced. See the [wallet backend evaluation](2026-09-09-reserve-wallet-backend.md).
