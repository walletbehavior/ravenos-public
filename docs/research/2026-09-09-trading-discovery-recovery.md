# Trading and Discovery recovery — 2026-09-09

## Reported failures and causes

- The live trade gate imposed a 12-hour authentication-age limit on otherwise valid remembered sessions. Production live flags were already enabled; an unexpired iPhone session older than 12 hours was refused.
- Existing embedded wallets were not restored at terminal startup. The first Buy opened the signer, adding avoidable latency and a misleading connecting state.
- Production verification exposed an additional host handoff: authenticated Discover redirected to the public host, whose terminal could not use the host-only app session. Discover, Terminal, Perps and Atlas now stay on the app host; public workspace bookmarks redirect there with the full instrument/filter query preserved. Cookie scope is unchanged.
- Older browsers can retain those permanent redirects. Workspace links use a stable `raven_app=1` migration marker and public redirects are `no-store`, preventing a cached redirect loop without clearing login cookies.
- A failed exact-pool provider request returned HTTP 200 with an empty result whenever a token was selected. Terminal treated temporary upstream failure as a missing market. Failed reads now remain retryable, retain exact chain/pool/token matching, and trigger one bounded automatic retry that respects provider backoff. A newer selection cancels the old handoff.
- The slippage setting defaulted to 3% in one panel while empty and pending estimates still displayed an older 0.5% fallback.
- Participation measured six-hour returns, but its click-through showed activity/velocity ranking and five-minute changes. The group API also truncated before ranking.
- Stock tokens appeared as primary Onchain assets. Some provider names already classified as reference assets; Backpack Securities names remained unclassified. A stock used as the quote asset must not replace or exclude the coin being traded.

## Resulting behavior

Remember-device is checked by default at sign-in. A valid remembered session renews its secure HttpOnly cookie and server expiry on activity, with a 365-day inactivity horizon. Original authentication time remains unchanged. Explicit non-remembered and legacy short sessions retain their limits. Expired/revoked sessions cannot renew; signing out revokes the session. Sensitive account actions keep their separate recent-authentication requirement. Trading accepts the server-validated session lifetime, with explicit operator limits still honored.

Existing Raven Solana and EVM wallet addresses restore on terminal load. The selected signer warms without creating wallets, requesting a signature, or placing an order. Buy waits for any existing warmup and handles preparation, exact allowance where required, signing and submission in the existing single-action flow. Explicitly selected external wallets are preserved. Existing minimum-receive, wallet identity, expiry and unresolved-submission checks remain.

Spot slippage defaults to 3%; explicit saved preferences remain. Manual choices extend to 10%. Slippage and price impact strictly above 5% produce visible, nonblocking warnings. Emptying an amount removes stale impact. 0x v2 lacks a price-impact field, so the EVM warning uses an explicitly estimated net execution-value comparison against the existing exact-token USD snapshot; this includes fees/spread, snapshot drift and stable-asset peg assumptions. Unknown/stale references do not become zero impact. No extra pricing requests are introduced.

Mobile Markets uses visible sort choices and shows named-list controls only when lists exist. Market brief evidence is included in the Raven overlay.

Onchain classification looks only at the primary asset, never its quote's name or ticker. Explicit tokenized-equity metadata and bounded provider issuer-name patterns exclude stock-primary rows; bare tickers and names such as Stockland remain ambiguous and are not treated as securities. This is a presentation classification, not issuer verification or execution authority. Trending paired stocks can still seed discovery of their companion coins. Those coins retain their own exact-pool price, changes, address and terminal target, without borrowing the stock's metrics.

Green participation cells open six-hour gainers in the same chain/cap band; red cells show the largest declines. Full-window current returns rank ahead of unknown returns, and volume only breaks ties. Server ranking precedes the 200-row limit. The browser uses the shared group's observations and clearly labels the six-hour move. Perp cells use their actual 24-hour venue return window. The map's statistics and color thresholds are not changed to manufacture stronger results.

Selected group identities remain visible while a provider refresh is delayed. Expired prices, returns and signals are hidden with their original observation timestamps retained; no stale values regain a current label. Six-hour rows also use six-hour volume and transaction counts. Explicit Robinhood Token issuer names are excluded from primary coin cards, while a coin paired with one remains a coin.

## Empirical replay

The captured Solana $10M+ group contained 89 rows, including 11 primary xStock assets. Its unsorted first rows included cbBTC (-1% over six hours), STONK (-3.59%) and PUMP (+1.9%). Applying the new ranking to the identical observations puts PURR (+61.67%), CRED (+25.03%) and PUMPCADE (+15.52%) first. This is an as-of snapshot, not a current recommendation or realized trader P&L. Exact identities and before/after data are in `2026-09-09-participation-ranking-evidence.json`.

## Verification

188 focused unit checks passed before the additional stock-companion provider regression; the provider regression also passes. The 45 Chromium cases pass across the main run and the corrected restoration case. Five WebKit cases pass for mobile ranking, remembered restoration, slippage and impact. D1 session-renewal and compressed participation storage/recovery tests pass. Build, security validation and 38 public response leak checks pass.

No user funds were spent, no private keys were exported, and no production trade was submitted in verification. Fixture trade completion validates orchestration, not actual provider settlement. No schema migration is required. Existing wallet-parity work was preserved outside this release.

The signed-in production account retained its session across reload, renewed its remembered expiry to September 9, 2027, and restored its Raven wallet on chart load. Entering 0.001 SOL produced an actual live token estimate and the existing 0.004386722 SOL balance without Connect, Prepare or Buy. Additional navigation, stale-group and issuer-classification checks pass (48 unit checks and two WebKit cases). `scripts/verify-trading-workspaces.mjs` verifies the production host handoffs and immutable asset hashes without authentication or order submission. Legacy whole-site verification still lists retired chain-page routes; the preview verifier is specifically for an off-account preview host.

Base also restored the existing Raven EVM wallet and displayed Buy DINO / Ready without Connect. Its $10 read-only estimate returned insufficient funds; this was not an account-disabled or disconnected-wallet response. Solana ZEC/USDC likewise recovered its exact pool and displayed Buy ZEC / Ready. These observations do not establish a completed on-chain trade. Additional provider regression tests cover retryable failure and recovery on Solana, Base, Ethereum, BNB and Robinhood, successful empty responses, and rejection of substitute pools.

## Sources

0x's explanation of Swap v2 price-impact availability: https://help.0x.org/articles/3626232596-slippage-price-impact-and-prices-what-integrators-need-to-know

DexScreener chart documentation: https://docs.dexscreener.com/tradingview-charts . The current embedded chart retains its provider-rendered footer. No documented branding-off switch was found. Replacing the entire embed with native candle rendering is separate work; this release does not hide the footer.
