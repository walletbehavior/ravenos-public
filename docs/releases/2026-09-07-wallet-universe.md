# Shared wallet universe and EVM history

This release replaces opportunistic wallet discovery with a persistent public-market frontier. A bounded bootstrap observed 5,569 unique addresses from 100 already discovered exact markets: 1,233 Solana, 1,401 Robinhood, 826 Base, 867 Ethereum and 1,242 BNB. These are public trade senders, not verified people or profitable traders. No wallet-history RPC was made for the bootstrap. Rows keep their observed timestamps; stale rows are omitted during import.

The normal scheduler processes up to four due markets each five-minute tick, within a shared limit of 48 provider requests per hour. Each market reserves two slots for identity plus tape; cache hits cost less. The job rotates chains, leases work, retries failures with backoff and ordinarily revisits a market after six hours. Market identities come from Raven's retained public registry and already loaded Discover responses. It never launches bulk wallet history, enrolls Copy or signs transactions. All-chain browsing remains database-only.

EVM lookup now retains reduced profiles in Raven's existing append-only profile ledger. New sessions and different users reuse them. A distributed cold-lookup lease prevents concurrent paid scans; refresh uses a five-minute floor and failed refresh can return a clearly dated prior profile. Transfer-only EVM profiles remain visible in the observation list with “bounded history cached.” They do not acquire invented trades, win rates or P&L.

Migrations 0038/0039 expand existing wallet/event chain constraints to Base/Ethereum/BNB and add the market frontier, request budget, run receipts and cold-lookup leases. 0038 copies all existing source identities, events and dependent rows verbatim inside the existing D1 migration transaction; tests validate preservation and foreign keys. No billing, rewards, customer-wallet ownership or trading authorization is changed.

Before production import: apply and verify the migration on preview, export a production D1 backup, apply the migration, check foreign keys and retained row counts, then import the validated observation file idempotently. The bootstrap importer refuses mismatched chain/address provenance, excludes pool/token identities and never rewrites observer cursors.

Commands: `npm run test:wallet-universe`; `npm run test:stack`; `node scripts/harvest-wallet-universe.mjs <retained-markets.json> <observations.jsonl> <maximum-market-requests>`; `node scripts/import-wallet-universe.mjs <observations.jsonl> [--apply]`.
