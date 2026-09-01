# Robinhood Chain ingestion source verification

Verified on: **2026-09-01**

Scope: read-only, resource-bounded Robinhood Chain ingestion and Agent Radar evidence projection. This file records the authoritative network and provider facts used by the implementation. It does not authorize live execution, publish a contract registry, or establish that any agent or contract is safe.

## Verified facts and implementation consequences

1. [Robinhood Chain: Connecting](https://docs.robinhood.com/chain/connecting/)
   - Mainnet chain ID is `4663`; testnet chain ID is `46630`; ETH is the native gas asset.
   - Robinhood documents Alchemy HTTPS and WebSocket endpoints as its recommended developer infrastructure.
   - Robinhood also publishes rate-limited public RPC endpoints and states that they are not recommended for production workloads.
   - Robinhood recommends an archive endpoint for historical reads and indexing.
   - Implementation consequence: the runtime uses configurable Alchemy RPC/WebSocket as primary, the official public RPC as a bounded fallback, verifies `eth_chainId`, keeps gas identity explicit, and does not represent the fallback as production-grade continuity.

2. [Robinhood Chain: Transaction Finality](https://docs.robinhood.com/chain/transaction-finality/)
   - Finality progresses through sequencer soft confirmation, posting to Ethereum, and Ethereum finality.
   - The documentation says soft confirmation is sub-second, posting usually takes minutes, and Ethereum finality is approximately thirteen minutes after posting.
   - A soft-confirmed transaction is not equivalent to Ethereum-finalized settlement.
   - Implementation consequence: indexed logs are labeled `soft_confirmation`; `posted_to_ethereum` and `ethereum_finalized` remain unresolved unless separate explicit evidence is provided. Block depth is never relabeled as full finality.

3. [Alchemy: Robinhood Chain API Overview](https://www.alchemy.com/docs/robinhood-chain/robinhood-chain-api-overview)
   - Robinhood Chain supports standard read methods including `eth_blockNumber`, `eth_chainId`, `eth_getBlockByNumber`, `eth_getLogs`, `eth_getTransactionReceipt`, `eth_call`, `eth_getCode`, and `eth_estimateGas`.
   - Implementation consequence: the provider wrapper exposes an explicit read-method allowlist. Transaction submission methods are rejected before network I/O.

4. [Alchemy: Robinhood Chain `eth_getLogs`](https://www.alchemy.com/docs/chains/robinhood-chain/robinhood-chain-api-endpoints/eth-get-logs)
   - The documented free-tier maximum request span for Robinhood Mainnet is ten blocks; responses are capped by the provider at 150 MB.
   - Implementation consequence: the default ingestion cycle spans ten blocks, applies a much smaller Raven response bound, bounds query count and concurrency, and advances its durable cursor only after all evidence for the range is accepted.

5. [Robinhood Chain: Run a full node](https://docs.robinhood.com/chain/run-a-full-node/)
   - Robinhood documents a modern 8+ core CPU, 64 GB RAM with 128 GB recommended, locally attached NVMe storage, and several TB of capacity for a full node; archive nodes require more.
   - Robinhood explicitly points applications that only need RPC access to public or managed-provider endpoints.
   - Implementation consequence: no local full/archive-node dependency, synchronization process, or raw-block warehouse is introduced. Only watched derived observations, block anchors, cursor state, gaps, reorg evidence, and audit events are retained.

6. [Robinhood Chain: Token Contracts](https://docs.robinhood.com/chain/contracts/)
   - Robinhood states that contract address, rather than a matching name or ticker, establishes canonical Stock Token identity.
   - The stock-token table is generated from an onchain asset registry.
   - Implementation consequence: the indexer accepts only exact contract addresses from a provenance-bearing operator registry. No agent-token, Stock Token, launchpad, router, pool, or Virtuals address is hardcoded from this prompt or an article.

7. [Robinhood Chain: Bridging](https://docs.robinhood.com/chain/bridging/)
   - Robinhood documents that a bridged ERC-20 contract on Robinhood Chain differs from its Ethereum address and that bridge timing/finality varies by route.
   - Implementation consequence: the ingestion model does not collapse cross-chain assets by ticker and does not introduce bridging or capital-transfer execution.

## Deliberately unverified and disabled

- Agent-token launch contracts, Virtuals contracts, launchpads, DEX routers/factories, and pool registries: no address is active until independently reviewed and loaded through `RAVENOS_ROBINHOOD_CHAIN_WATCH_REGISTRY_JSON` with provenance and a start block.
- Agent endpoints and manifests: treated as untrusted claims unless a separate probe produces bounded evidence; they are never fetched by the Agent Radar projection.
- L1 posting and Ethereum-finality state: unavailable from ordinary log depth alone.
- Live transaction construction, signing, broadcasting, autonomous bridging, and live execution: always false in this module.
- Profitability, revenue, and safety: never inferred from token volume, metadata, or agent-language claims.

## Runtime configuration

- `RAVENOS_ROBINHOOD_CHAIN_INGESTION_ENABLED=1` enables the read-only ingestion runtime. Default is disabled.
- `RAVENOS_ROBINHOOD_CHAIN_NETWORK` selects `mainnet` or `testnet`.
- `RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_API_KEY` builds the documented Alchemy HTTPS and WSS endpoints without placing the key in serializable runtime state.
- `RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_RPC_URL` and `RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_WSS_URL` may instead provide explicit endpoints.
- `RAVENOS_ROBINHOOD_CHAIN_FALLBACK_RPC_URL` may override the official public fallback.
- `RAVENOS_ROBINHOOD_CHAIN_ALLOWED_RPC_HOSTS` adds explicit operator-controlled provider hosts; local and IP-literal hosts are rejected.
- `RAVENOS_ROBINHOOD_CHAIN_WATCH_REGISTRY_JSON` supplies exact reviewed contracts, categories, topics, start blocks, provenance, and an explicit `enabled: true` per watched entry. Missing registry configuration or omitted entry activation produces no scan for that contract.
- `RAVENOS_ROBINHOOD_CHAIN_MAX_BLOCKS_PER_CYCLE`, `RAVENOS_ROBINHOOD_CHAIN_MAX_LOG_QUERIES`, `RAVENOS_ROBINHOOD_CHAIN_MAX_CONCURRENCY`, `RAVENOS_ROBINHOOD_CHAIN_MAX_REORG_DEPTH`, `RAVENOS_ROBINHOOD_CHAIN_HEAD_LAG_BLOCKS`, and `RAVENOS_ROBINHOOD_CHAIN_RPC_TIMEOUT_MS` tune bounded work within enforced ceilings.
- `RAVENOS_ROBINHOOD_CHAIN_MAX_LOG_QUERIES_PER_SCHEDULE`, `RAVENOS_ROBINHOOD_CHAIN_MAX_RPC_ATTEMPTS_PER_SCHEDULE`, `RAVENOS_ROBINHOOD_CHAIN_MAX_RESPONSE_BYTES_PER_SCHEDULE`, and `RAVENOS_ROBINHOOD_CHAIN_MAX_SCHEDULE_WALL_TIME_MS` cap aggregate scheduled-run provider work. The same budget instance is shared by every catch-up cycle in one scheduled invocation.

## Resource assumptions and remaining storage integration

Default work is bounded to ten blocks per catch-up cycle, 64 log queries per cycle, concurrency four, 10,000 accepted logs, a 2 MB response limit per RPC call, and 60 KiB of raw data per normalized log. One scheduled invocation also shares aggregate defaults of 192 RPC attempts, 128 log queries, 8 MiB of response data, and 25 seconds of wall time. Serialized observation rows are capped at 128 KiB. WebSocket batches stop after 1,000 head signals and reconnect backoff caps at 60 seconds. A large or overly fragmented registry becomes `configuration_blocked`; the indexer does not broaden the scan.

The module defines a compare-and-set durable store contract for cursor, block anchors, normalized observations, gaps, reorg invalidation, and append-only audit events. `createMemoryRobinhoodIngestionStore` exists only for deterministic tests and demonstrations. Migration `0025_agentic_trading.sql` and the D1 adapter implement the durable schema, including a canonical-observation view that excludes reorged rows from derived reads while retaining their append-only evidence. The migration remains unapplied until separately authorized.
