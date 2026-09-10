# Pool identity and paced public market reads

This continues roadmap packages 2, 3 and 8. It does not complete the roadmap or the final tab audit.

## Reproduced gaps

- A fresh shared snapshot at 11:39 UTC contained 2,154 observations within two minutes across all five chains. Only 14 of 100 sampled Robinhood rows qualified for the existing Monitor reader. Its exact-market validator accepted 20-byte contract addresses but rejected 32-byte pool identifiers.
- The same address/pool conflation dropped Dexch pool metadata, rejected saved markets and removed otherwise eligible wallet price references. Five operational regressions were reproduced before correction.
- Pasting a full pool URL into search could truncate the pool hash to a 20-byte prefix. A Worker-route regression returned the same-prefix contract instead of the requested pool.
- The collector made 118 logical provider read attempts during a 5.3-second cycle, ending with one upstream 429 and one shared-backoff rejection. This count includes discovery reads and is not an HTTP-request count.

## Changes and boundaries

- Saved markets, Monitor, Dexch normalization and wallet price marks accept complete 20-byte or 32-byte EVM pool identifiers. Token, quote, creator and wallet identities remain 20-byte addresses. Every consumer still checks chain, exact pool and token orientation.
- Browser and server search preserve complete hashes from pasted URLs and filter the returned pool by its full identity. Same-prefix pools and different chains remain separate.
- The shared reader spaces uncached DexScreener market starts by 250 milliseconds within each Worker isolate. Discovery metadata, other providers and successful cache hits do not wait in this queue. Coalesced reads use one slot and retain the original observation time.
- The queue waits at most two seconds (or half the consumer timeout, whichever is shorter); waiting consumes the existing request timeout. Late timers cannot cause a catch-up burst. A newly returned cooldown stops queued reads before they contact the provider. The longest active host/scope cooldown applies.
- The collector's durable lease, provider budget, 25-second collection limit and existing cross-instance cooldown remain in force. This pacing is not a global rate limiter across Cloudflare locations and does not establish sustained provider recovery.
- A full local queue is a recoverable unavailable reference and is not counted as a wallet-mark provider request. No transaction, signature, funding, personal alert rule or outbound delivery is created by this change.

## Validation

- 124 targeted backend, market, wallet, identity, chart, collector and Worker-runtime tests pass. Coverage includes all five discovery chains and the existing 1,000-token catalog collection.
- Real workerd timers space provider starts; the runtime test makes one failed upstream call and stops its two queued requests after a 429. Cached reads cause no new calls.
- Chromium and WebKit each pass the pasted-pool workflow at 390px and 1440px: full hash reaches search, exact pool opens and no public-wallet command is offered for that hash.
- The first one-second queue limit caused missing catalog rows and lost discovery chains in broader tests. It was corrected before packaging; all original population assertions now pass.

Deployment, fresh source qualification and the signed-in production postflight are recorded in the accompanying proof after promotion. The prior horizontal transaction table remains part of the release.

## Production evidence

Release `ravenos-e038ec1c4566-f79a99f1e8baa7b0` is live at 100%. Staging and all 62 production checks pass across 36 assets and 11 authenticated workspaces. Three read-only source snapshots qualified all 488 sampled exact pools per cycle, including full Robinhood pool hashes. Two collector cycles completed without failure; one still returned an upstream 429. Sustained freshness remains open.

Signed-in desktop Discovery showed 100 Robinhood rows. An exact full-hash XCOINS pool opened with a visible DexScreener chart, 120 transactions and 10 observed holders. Seven transaction columns populated; quote amount remains unknown because the token-wide feed lacks quote currency/units. Monitor restored its real empty alert history and Portfolio restored its wallet view and actual empty trade journal. No trade, signature, personal rule or outbound delivery occurred. See [aggregate proof and limits](2026-09-10-pool-identity-and-market-pacing-proof.json). The latest Raven Reads and Discovery count report is the next active investigation.
