# Chart provider replacement — 9 September 2026

Owner instruction: Dexch is the primary source, remove CoinGecko from the active routing policy, use existing providers without buying another subscription, and remove the DexPaprika chili logo.

## Verified capabilities

Live requests to https://api.dexch.art/api/v1/filter-options and /api/v1/stats returned BNB (`bsc`) and Robinhood. Direct `/api/v1/tokens?chains=solana&limit=1`, Ethereum and Base requests returned HTTP 400 `UNSUPPORTED_CHAIN`, naming `bsc, robinhood`. This is current deployment coverage; additional chains need a working provider endpoint before Raven advertises them. Official API: https://dexch.art/api-docs.

The native BNB BREW/WBNB anchor returned 240 one-minute candles in 1.5 seconds through Raven's actual Worker adapter. Pool, selected token, quote token, post-migration history and OHLCV continuity were checked. No fabricated gaps or alternative pools were substituted.

DexScreener's documented REST API supplies exact pool identity and current metrics; it does not expose a documented candle endpoint. Raven uses its existing embedded chart surface where Dexch has no matching native history. The Solana SOL/USDC Raydium embed was visually verified in normal Chrome with populated candlesticks, volume and timeframe controls. An isolated headless session instead encountered provider CORS failures; HTTP 200 alone is insufficient visual verification. API: https://docs.dexscreener.com/api/reference.

DexPaprika terms section 3.6 requires a paid plan for commercial API use; section 3.10's logo requirement is separate. No paid account was authorized. The adapter remains available only for development evaluation, is rejected in release mode, and is not in the active provider order. The logo asset and all shared-header references are removed. https://dexpaprika.com/api/terms.

## Runtime and user experience

Production order: Dexch native history, then a DexScreener exact-pool chart. CoinGecko is explicitly disabled even if its old credential remains provisioned; the selected chart pipeline does not require that credential. Native Terminal fees, quote preparation, signing, cashback and perps feeds are unchanged.

Both paths verify the selected pool and token before rendering. A DexScreener embed cannot be used for an inverted pool orientation. Its URL is rebuilt from an allowlisted chain, validated public pool/token identities and a supported timeframe. It receives no Raven wallet, account, viewing key or session data; the iframe uses a no-referrer policy and a cross-origin sandbox. The external provider necessarily observes network/browser information and the public market being viewed.

A provider-managed chart is recorded as `chart_surface.kind=provider_embed`, with no Raven candle series, no measured bar count and no Raven candle-derived analysis. Its own indicators and controls remain available. Raven's independent market/holder intelligence and trade ticket stay in place. Opening intelligence overlays preserves the chart and the entered amount. Native Dexch charts continue to support Raven candle-derived analysis.

## Release validation

The retired CoinGecko-only release assertion is replaced by an exact-market chart-surface check on Solana and current pools on Base, BNB, Ethereum and Robinhood. Embedded charts must have validated identities, allowlisted URLs and explicit non-native semantics. A separate native Dexch anchor still must return at least 120 real one-minute bars with verified continuity; an iframe cannot satisfy that requirement.

Contract tests cover all five chains, disabled retired adapters, URL injection, inverted/wrong token rejection and absence of native-data claims. Browser checks cover mobile/desktop layouts, the persistent trade amount, overlay closure and transition to the native perps chart. Live staging and normal Chrome checks provide provider evidence beyond mocked UI tests. Deployment status is recorded in the immutable release receipt, not inferred from this document.

The outer Terminal status and chart tab recognize provider-rendered charts independently of native candle availability. The Markets list can display a timestamped exact-pool market snapshot, with no invented candle change, volume or sparkline.

## Release binding capacity

Cloudflare rejected staging with 151 text bindings: 97 public configuration values plus 54 existing secrets. Packaging now groups 73 explicitly allowlisted boolean switches into one `RAVENOS_RELEASE_FLAGS` JSON binding, leaving release identity, enforcement, endpoints and identifiers separate. Both Worker HTTP and scheduled entrypoints expand the flags. Existing flat overrides take precedence; malformed or undeclared packed fields fail closed.

Staging checks that every existing public setting is represented before replacing plain bindings. Wrangler `versions upload` preserves secrets independently of `keep_vars`; the stage script then verifies every previous secret against the uploaded version and checks its exact public-binding inventory before running release qualification. No secret values are read through Cloudflare or copied into the JSON binding. This change preserves the existing feature values, including disabled live shielded/copy execution.

## Additional provider research

Raven core's existing Mobula key successfully retrieved 240 native one-minute bars on Solana, Base and Ethereum on September 9, with matching pool/base/quote metadata. This research has not activated a Mobula adapter in RavenOS. Its next integration needs shared credit budgeting, Worker transport qualification, and additional launch/migration coverage. MadeOnSol's free plan permits internal use only; its candles and public-display rights require paid tiers, so it is not selected as a free RavenOS source.
