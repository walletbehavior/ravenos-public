# Shared wallet universe and EVM history

This release replaces opportunistic wallet discovery with a persistent public-market frontier. A bounded bootstrap observed 5,569 unique addresses from 100 already discovered exact markets: 1,233 Solana, 1,401 Robinhood, 826 Base, 867 Ethereum and 1,242 BNB. These are public trade senders, not verified people or profitable traders. No wallet-history RPC was made for the bootstrap. Rows keep their observed timestamps; stale rows are omitted during import.

The normal scheduler processes up to four due markets each five-minute tick, within a shared limit of 48 provider requests per hour. Each market reserves two slots for identity plus tape; cache hits cost less. The job rotates chains, leases work, retries failures with backoff and ordinarily revisits a market after six hours. Market identities come from Raven's retained public registry and already loaded Discover responses. It never launches bulk wallet history, enrolls Copy or signs transactions. All-chain browsing remains database-only.

EVM lookup now retains reduced profiles in Raven's existing append-only profile ledger. New sessions and different users reuse them. A distributed cold-lookup lease prevents concurrent paid scans; refresh uses a five-minute floor and failed refresh can return a clearly dated prior profile. Transfer-only EVM profiles remain visible in the observation list with “bounded history cached.” They do not acquire invented trades, win rates or P&L.

Migrations 0038/0039 expand existing wallet/event chain constraints to Base/Ethereum/BNB and add the market frontier, request budget, run receipts and cold-lookup leases. 0038 copies all existing source identities, events and dependent rows verbatim inside the existing D1 migration transaction; tests validate preservation and foreign keys. No billing, rewards, customer-wallet ownership or trading authorization is changed.

Before production import: apply and verify the migration on preview, export a production D1 backup, apply the migration, check foreign keys and retained row counts, then import the validated observation file idempotently. The bootstrap importer refuses mismatched chain/address provenance, excludes pool/token identities and never rewrites observer cursors.

Commands: `npm run test:wallet-universe`; `npm run test:stack`; `node scripts/harvest-wallet-universe.mjs <retained-markets.json> <observations.jsonl> <maximum-market-requests>`; `node scripts/import-wallet-universe.mjs <observations.jsonl> [--apply]`.
# Production verification follow-up

The initial production import accepted 5,567 observed wallets from 100 retained market projections. Two observations became older than the 24-hour ingestion window between harvest and import and were correctly excluded. Combined with prior observations, the production index contained 5,671 chain-qualified wallet identities at 17:23 UTC on September 7, 2026. These are observations, not 5,671 performance-qualified profiles.

Live account checks found a legacy 25-page UI limit and a release-packaging omission for the new scheduler settings. The follow-up change passes the explicit scheduler enable/budget settings through release packaging and exposes a server-bounded 1,000-page window. A populated 6,000-wallet database test reaches page 500 without history calls. Browser tests cover the same 500-page display and paging.

Wallet discovery now opens on Observed wallets when observations exist. Analyzed profiles has its own performance filters, count and pagination. Saved research and Robinhood flow panels follow the results, so the actual universe is visible before those secondary panels. Both modes browse retained data only; switching modes never starts history analysis. Chain-qualified addresses remain separate, and observations never imply profitable or copy-ready traders. Explicit filters and view choice survive reload; outdated concurrent screener responses cannot replace the current selection.

The independent rewards treasury implementation is in `services/rewards-treasury/`; it is not activated by the public-site release. Funding, scoped treasury credentials and a tiny claim canary remain prerequisites. Automatic Copy, cross-chain limit execution and live Zcash shielding have not been made production-ready by the wallet-universe work.

## Capacity incident and rollout hold

At 18:09 UTC the production auth-start check failed with Cloudflare's confirmed account-wide D1 free-tier daily row-write limit. The migration/import and index writes consumed part of today's quota; the exact contribution of each job has not yet been attributed. The 5,600+ imported observations remain stored, but database writes, including sign-in state and session updates, are blocked until the daily reset or a Workers Paid upgrade. Rolling back the Worker cannot reset this quota.

Automatic universe expansion is paused (`RAVENOS_WALLET_UNIVERSE_ENABLED=0`) pending verified database capacity. The queued frontier and hourly budget are preserved. An authenticated UI check and one actual scheduled receipt must pass after capacity is restored before reporting continuous discovery as operational. The current manual browser verification is incomplete; do not present the earlier import and static release checks as proof that sign-in works during this incident.

Auth route handlers now await database promises inside their error boundary, return a sanitized retryable 503, and preserve cookies on backend failure. Wallet Intelligence distinguishes a failed session check from a signed-out visitor. An abandoned anonymous auth-start preflight is required for future production capacity checks; it does not create a customer account, consent or charge. Cloudflare's Workers Paid checkout was prepared, with no purchase submitted or payment information entered.
