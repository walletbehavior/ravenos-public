# Account recovery across intelligence workspaces

The production check of source `03289b1180cc` found that Portfolio could recover its existing wallet through Refresh wallet while the account badge stayed pending. Source review also found that Pro, Monitor, Community and Agents still conflated failed session reads with sign-out or an unavailable product. Reopening a retained Wallet Intelligence overlay had the same failure-to-sign-out path.

All ten account-reader consumers now share the same in-flight GET, bounded retry and strict authenticated/signed-out/unavailable result. The shell subscribes to completed presentation state, so a successful account check in another workspace updates the badge without another request. The subscription does not store or replay completed credentials or grant authority to any mutation. Explicit invalidation still suppresses abandoned results. Diagnostic warnings contain only a fixed reason, attempt count, HTTP status and retry delay, never response bodies, cookies, tokens, addresses or raw network exceptions.

Pro, Monitor, Community and Agents offer an account-check retry on a sustained failure. Actual signed-out responses retain their normal login path. Community's public profile remains readable while account actions are unavailable; private settings and following require a fresh account check. Pro and Wallet Intelligence recheck on overlay reopen, hide the prior private rendering during recovery, and preserve the underlying Terminal URL and amount draft. A fresh successful wallet read is reused only within that same initialization instead of issuing an immediate duplicate GET. Repeated initialization does not rebind control handlers.

The browser checks exposed a Pro CSS rule that overrode the hidden attribute on login controls. The Pro workspace now respects hidden descendants, and its unavailable state uses one column with a readable retry button. The new recovery buttons follow their workspaces' existing appearance and have at least 44-pixel touch height.

## Qualification

- 41 Node reader/identity cases pass, including one notification per in-flight read, no cached replay, credential-free subscribers, invalidation, listener exceptions and sanitized diagnostic categories.
- 184 Chromium and 184 WebKit cases pass across Account, Pro, Wallet Intelligence, Monitor, Community, Agents, Portfolio, Reserve and Solana/EVM single-Buy flows.
- Ten final recovery-button checks pass across both engines. The 390-pixel WebKit screenshot was inspected for visible login controls, readable recovery and viewport containment.
- Build, security architecture and public no-leak/38 Worker-response checks pass. All ten generated importers use the same content-hashed account-reader module. The production verifier now covers eleven workspace entrypoints.
- No real transaction, wallet creation, signature, funding, public-profile publication or autonomous execution was performed. Mutations exercised in browser tests use controlled fixtures only.

The exact cause of the intermittent production account-read interruption remains unconfirmed. The diagnostic addition makes the next failed check distinguishable without logging account data; it is not proof that provider or transport availability is fixed. Actual settlement, the account-scoped receipt journal, native refund/output evidence, non-USDC fee valuation and the remaining roadmap gates stay open. The readable horizontally scrolling transaction tape remains in place.

## Production verification

Source `16e02d452b07` is live at 100% as `ravenos-16e02d452b07-632d72315539b98b`, Worker `d55197a7-2412-469a-bb6e-a11ed80a5c46`. Full staging and 53 production checks pass, including 34 asset hashes and eleven entrypoints. The first staging pass encountered an Atlas FRED history 503; an isolated request returned 116 observations and the complete unmodified checks then passed.

The signed-in audit verified automatic Portfolio recovery with the account badge updated, populated Pro views and Wallet Intelligence, private Community controls, and an empty paper Agents workspace. Monitor and Community still reproduced intermittent account service failures. Monitor's manual retry recovered without login; alerts remain unavailable, Monitor lacks the shared navigation shell, and Agent Radar is disabled. Community has no qualified public board rows. These are recorded gaps rather than readiness claims. No real trade occurred. Actual live browser width was 1525 pixels; mobile evidence comes from the controlled Chromium/WebKit checks. See [production proof](2026-09-10-intelligence-session-production-proof.json).

Next, serialize the fixed client diagnostic fields (the browser log rendered the object as `Object`) and add bounded operation/reason logging at the server session boundary. Trace the failing database/session operation without logging credentials or changing authentication semantics.
