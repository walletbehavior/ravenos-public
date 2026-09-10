# Monitor evidence and in-app activation

The live audit found alerts disabled. Inspection also found that the editor offered every event type regardless of evidence, the loader returned early for every onchain market, and the evaluator ignored Pro access supplied by current trials/subscriptions. Six database cases reproduced access, pause/revision and notification-binding failures before correction.

## Changes

- Read-only, account-owned `/api/v1/monitor-alerts/evidence/:watch_id` exposes the exact market's supported changes and observation time. The editor loads these choices when opened; unavailable or mismatched evidence leaves creation disabled with a reload action. No personal rule is created by opening it.
- The onchain loader reads the existing shared participation snapshot once per batch. Fresh, exact DexScreener pool observations can establish snapshot availability and one-hour buy/sell transaction-count pressure. At least ten measured transactions are required; 60% buy share is buy-led, 40% or less is sell-led, and the middle is balanced. Missing counts never become zero, and retained/stale/missing rows never establish delisting. No new market-provider requests are introduced.
- Solana, Base, Ethereum, BNB and Robinhood identities remain separate. Token/quote/pool mismatches, unsupported chains, future observations and conflicting same-time evidence are rejected. This does not qualify the experimental Discovery classifier or infer lifecycle, wallet profit, net dollar flow, route liquidity or execution readiness.
- Evaluation matches current trial and funded subscription windows as well as manual grants. Account state, rule state/revision and access are checked again when persisting. Notifications and their comparison baseline commit atomically, so a database failure can retry the undelivered transition. Duplicate protection, quotas and cooldowns remain. Measurement-version changes start a new baseline; separately qualified exact availability changes remain usable.
- The existing package activation controls enable in-app alerts for entitled accounts; runtime defaults and independent overrides remain. No outbound delivery channel or personal alert rule is activated by this work. No plan, payment, trade or signature is created.
- Mobile editor choices use 14px text and at least 44px targets.

## Qualification

The 67 Monitor/evidence/entitlement/product/runtime cases and 29 security/release cases pass. Final browser qualification passes 21 cases in Chromium and 21 in WebKit, including the fresh-choice editor, failure/retry, exact identity, account clearing, pause/delete and mobile layout. The final 390px WebKit viewport screenshot is inspected: readable choices and both actions fit between the fixed navigation bars. The all-browser command also attempted Firefox, whose executable is absent; no Firefox coverage is claimed or counted. Build/security/public-response qualification includes 40 response checks; production observations follow below when complete.

The read-only `scripts/evaluate-monitor-evidence.mjs` measures current shared-source coverage and existing alert totals without returning customer or wallet identifiers, running evaluation or creating notifications. Production activation, real account reads and the scheduled cycle still require postflight. This milestone does not complete Package 8 or the full roadmap audit.
