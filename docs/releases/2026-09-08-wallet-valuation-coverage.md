# Wallet valuation coverage

The existing Solana profile remains the presentation model. This release expands useful EVM and Solana valuation data without treating incomplete history or missing prices as zero.

## What changed

- Solana profile holdings and token metadata now use the configured Helius connection, independently of the public holder-projection switch. History continues through the existing bounded Helius pipeline.
- A provider-verified empty Solana history can produce a normal wallet profile with confirmed holdings. An empty or failed response without exhaustion evidence remains unavailable. No trade, cost, profit or Copy signal is fabricated.
- EVM balance refreshes retain the durable history window and reconstruct its USD reference view from Raven's existing historical FX cache. Missing historical price windows remain the background worker's responsibility. Cached FX remains readable without provider credentials.
- Solana's held-token balances now reconcile against retained trade quantities and cost before USD-reference unrealized P&L can appear. Changed quantities or unknown inventory keep the result unavailable.
- A shared token-reference adapter uses Raven's already seen DEX Screener responses first, then its token-level memory/edge cache, then bounded missing-token batches. Existing Helius/Alchemy marks remain primary. Only public token contracts are sent to the fallback, never the wallet/account identity.
- Overview shows priced/unpriced token counts. Holdings explain low liquidity, inactive markets, conflicting prices and unavailable marks. Price evidence includes the provider, observation time and reference-pool liquidity. Historical USD cost and current indicative marks are separately identified.

## Cache and pricing policy

`WalletMarkPolicy` centralizes all controls: up to 60 contracts, 30 per provider request, at most two requests per lookup, 3.5-second request timeout, 512 KiB response limit, 2,048 memory entries, 300-second positive cache and 60-second missing/error cache. Simultaneous identical batches share provider work.

The Cloudflare edge cache is shared within a location, not a global D1 price ledger. Existing append-only wallet profiles and history remain the durable shared browsing layer. A repeated cached profile does not run fresh history or holdings RPCs. Market responses are seeded only when fetched; revisiting an existing cache entry does not reset its observation timestamp.

The fallback requires exact chain/base-token/pool identity, a positive USD reference, at least $10,000 provider-reported liquidity and observed activity in the preceding provider hour. Substantial pools disagreeing by more than 15% are rejected. These conservative reference thresholds are not liquidity guarantees or token-safety ratings. Pool timestamps are unavailable in this API; the observation time is Raven's retrieval time. A position exceeding 10% of reported pool liquidity is flagged in its mark evidence.

Money calculations use decimal strings and integer micro-USD, rounded down. The reference is neither an executable exit price nor a historical fill. No execution, fee, reward, affiliate or Copy authority consumes these marks.

## Live read-only evidence

The actual adapter was exercised against seven public Robinhood token contracts and one Solana token contract. Four Robinhood references and the Solana reference passed the policy. Two Robinhood pools were below the liquidity floor; another token had no qualified market. All repeat reads made zero additional provider requests.

One previously observed Robinhood pool fell from approximately $155,000 reported liquidity to below the floor during this work. Its mark was withheld on the new observation. This is a useful illustration of why cached marked value cannot represent a guaranteed exit.

Contracts and sanitized results are in the workspace artifact `outputs/RavenOS-wallet-pricing-shadow-2026-09-08.json`. Token names do not establish issuer identity, safety or any relationship with Robinhood. These samples verify the adapter, not complete historical coverage or investment suitability.

## Rollout and boundaries

Feature flag: `RAVENOS_WALLET_DEX_MARKS_ENABLED`. Turning it off removes fallback requests; normal balances, cached profiles, Alchemy/Helius metadata and trading remain independent. No migration is required for this release. The previous returning-access migration remains required.

Full wallet history, arbitrary EVM router interpretation, internal-only Robinhood native transfer discovery and sustained enrichment throughput remain coverage gaps. This release does not claim full GMGN parity or thousands of complete wallet histories. Live Copy, claims, signing and Shielded Reserve execution flags are unchanged.

Validation: 1,527 full Node regression checks passed, plus one additional Solana reconciliation test and 34 final targeted checks. All 36 wallet/balance browser checks passed across the original run and corrected rechecks. The mobile layout remains contained and full wallet addresses remain visible. Build, security and no-leak checks passed; the final release receipt records production verification.

Sources: [DEX Screener API](https://docs.dexscreener.com/api/reference), [GMGN wallet detail baseline](https://docs.gmgn.ai/index/wallet-detail-page), [Helius address history](https://www.helius.dev/docs/rpc/gettransactionsforaddress).
