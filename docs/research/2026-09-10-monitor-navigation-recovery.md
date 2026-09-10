# Monitor navigation and account recovery

Follows the live audit's missing shared header and unavailable-alert observations. This change improves Monitor's navigation, account boundaries and recovery without enabling alert delivery or creating personal alert rules.

## Changes

- Restores the shared Raven navigation and account header, removes the separate legacy topbar, and shortens the mobile header so saved markets appear sooner.
- Uses the page's declared workspace when choosing the active destination. Monitor highlights More; Portfolio highlights Portfolio. The market mode and chart context remain separate.
- Clears saved items, alert rules, notifications, CSRF state and open deletion dialogs on sign-out or account restoration. Account checks and API reads are canceled when the account changes; late responses cannot refill an old account view. A private endpoint's actual 401 also clears the shared account presentation.
- Bounds requests at eight seconds. A current-account request failure becomes a recoverable error; canceled operations do not produce unhandled page errors.
- Separates missing account permission, a disabled alert feature and a failed service check. Reload alerts remains available to recheck access.
- Preserves a partial-load failure when rules and notifications complete in different orders. A successful empty result from one request no longer hides the other's failure behind a zero count.
- Continues to store personal saved-market data on the server. Shared navigation may persist public display/context preferences; browser regression checks explicitly exclude session, CSRF, account and saved-watch identifiers from that storage.

## Validation

- **45 Monitor/Portfolio browser cases in Chromium and 45 in WebKit** passed, including 390/1440 Monitor layouts and the existing 360/390/1440 receipt layouts.
- **Eight targeted navigation/context cases per browser** passed. An old assertion still expected letter glyphs that the previously deployed SVG navigation no longer renders; it now checks the real destination labels.
- The 390px WebKit screenshot was inspected: shared header, compact title, saved market and its actions are readable; More is selected.
- Build, security checks and public-asset/**39 Worker-response** leak checks pass.
- No alert rule, notification delivery, trade, signature, wallet connection or account permission was activated by this work.

## Open alert work

The current `loadMonitorEvidenceBatch` supports Perps observations. It does not yet supply live onchain classifications even though the UI's event choices include onchain lifecycle/attention concepts. Alert activation and this coverage mismatch remain roadmap work; improved recovery and an honest unavailable state do not satisfy the population/delivery gate.

## Production qualification

Source `79e510745946` is live as `ravenos-79e510745946-ca344f04a253d62d`, Worker `8166088f-c59f-49a9-914e-838cacac3ae8`, at 100% on both origins. Complete staging and all **57 production checks / 36 assets / 11 workspace entrypoints** pass. The first immediate post-promotion probe reached the previous release during propagation; repeating only the read-only verifier passed. No second promotion was needed.

At 10:22 UTC, the actual signed-in Monitor retained its account after Reload alerts, displayed its real empty saved list and the specific “Raven alerts are not enabled yet.” state, and left Reload enabled. The shared navigation selected More. Portfolio on the same release restored its wallet view and real empty trade history automatically, with Portfolio selected. No personal alert rule, delivery, trade or signature was created.

This production check used the actual 1525px desktop viewport. The 390px mobile evidence comes from controlled Chromium/WebKit qualification; it is not a new production mobile claim. See [sanitized release and UI proof](2026-09-10-monitor-navigation-recovery-proof.json). Alert population/delivery and the full roadmap audit remain open.
