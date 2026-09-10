# EVM receipt finality and background recovery

The terminal stops polling once it verifies that tokens arrived. The existing rewards sweeper only rereads retained evidence. That left Base/Ethereum finality dependent on an open browser, and the Robinhood report never supplied the finalized evidence required by the shared rewards ledger.

The report handlers now share a strict finality check. It validates the latest/finalized block numbers and hashes, then checks the exact receipt block again after reading the finalized head. A missing head, conflicting canonical block or receipt above that head stays pending. Already verified token movements remain inspectable while finality is pending. The evidence says `provider_finalized_tag`; it does not assert independently observed Ethereum/L1 finality. Robinhood's separate `l1_finality_observed: false` remains intact. [Robinhood finality documentation](https://docs.robinhood.com/chain/transaction-finality/) describes these separate stages.

Every five minutes, read-only recovery considers at most four existing, account-owned EVM submissions with a stored transaction hash. It cannot create an order, ticket, wallet, signature or submission. An expired quote does not discard an already submitted transaction. Recovery reuses previously verified receipt economics only for the same stored transaction, verifies the provider's chain, and rechecks the canonical block. A changed block forces a fresh transaction/receipt verification. Missing receipts and finality outages remain retryable.

Limits apply across Robinhood, Base, BNB and Ethereum: 36 request reservations per run, 360 per UTC hour in a shared atomic database counter, a 25-second deadline for starting requests, 2.5-second transport timeouts, two-minute leases and five-minute retries. Failed network attempts consume the cap. Only one unauthenticated public endpoint per chain is used, with redirects disabled and no paid-provider fallback. Empty queues make zero RPC calls. Completed jobs stop polling. Aggregate cycle logs contain counts/states rather than customer identifiers.

Receipt evidence and the intent transition now commit in one [D1 batch transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Legacy confirmation upgrades compare the latest stored event and cannot replace finalized evidence. An intent update failure rolls back its accompanying event. Equal-second observations use insertion order rather than random event IDs, so status and cashback select the later receipt. A recovery outage cannot prevent the existing rewards maintenance.

The additive `0052_execution_reconciliation.sql` migration creates a lease/backoff table and the shared hourly counter. It changes no existing customer balance, fee rate, signing permission or submission. Release activation is `RAVENOS_EXECUTION_RECOVERY_ENABLED`, packed from the read-only reconciliation configuration.

## Provider evidence

Read-only probes on September 10, 2026 at approximately 06:34–06:39 UTC verified chain IDs and finalized headers:

| Chain | Public endpoint | Chain ID | Observed finalized block |
| --- | --- | --- | --- |
| Robinhood | `https://rpc.mainnet.chain.robinhood.com` | 4663 | `0x3871600` |
| Base | `https://mainnet.base.org` | 8453 | `0x30bf798` |
| BNB | `https://bsc-dataseed.bnbchain.org` | 56 | `0x736ac79` |
| Ethereum | `https://ethereum-rpc.publicnode.com` | 1 | `0x18be46a` |

The sampled Robinhood finalized block timestamp was 06:20:49 UTC, versus 06:34:36 UTC for the sampled latest block. This is a point-in-time observation, not a finality-latency guarantee. The previously configured Cloudflare Ethereum endpoint returned RPC error -32046 for the finalized-header request; recovery uses the endpoint published by [Ethereum PublicNode](https://ethereum.publicnode.com/). These are header probes, not customer settlement evidence.

## Qualification and remaining gates

The 186-case EVM selection passes, including delayed finality, wrong chain, canonical changes, missing receipts, account isolation, unsigned records, stale upgrades, atomic rollback, equal-second ordering, concurrency leases and budget exhaustion. The 69-case rewards/Solana/runtime selection passes. Native workerd coverage checks the public recovery transport and rejects redirects. The final recovery selection repeats after the deadline guard adjustment.

A controlled Base fixture becomes finalized after the browser leaves and credits exactly one 30% cashback amount from its verified canonical-USDC fee. Robinhood finality resolves in controlled fixtures, while its non-USDC fee remains `valuation_required`. No native refund proof, non-USDC dollar valuation or actual customer round trip is inferred. Production migration, staging and postflight evidence are recorded separately once completed. All remaining roadmap gates stay open.
