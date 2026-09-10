# Raven Monitor and In-App Alerts v1

Status: in-app activation candidate. See `docs/research/2026-09-10-monitor-evidence-activation.md` for release evidence. Runtime controls default off unless explicitly enabled by the packaged release.

Raven Monitor v1 is customer-owned research continuity. It is not position monitoring, order monitoring, investment discretion, or execution. A customer first saves one canonical exact market through Saved Exact Market. A monitor rule then references that owned saved-market record and a bounded set of public event categories. A symbol, label, or customer-supplied provider identifier can never select the monitored market.

## Authority and activation

Access requires an authenticated `app.ravenos.xyz` host-only session, an active owner-matched `research.alerts` grant (including a current product trial or funded subscription), and coordinated server controls. Entitlement resolution, customer rule routes, evaluation, notification history, and the capability flag are independent and default off. The evaluator requires all controls, so no isolated flag activates the complete system. There is no customer grant mutation route, checkout, billing path, public enrollment, Desk membership, or shared-domain cookie.

Every mutation requires RavenOS CSRF validation. Reads enforce exact origin and Fetch Metadata boundaries. Responses are `no-store`, owner-scoped, bounded, and unsuitable for shared caches. A customer cannot select an owner, entitlement, provider, source, cadence, arbitrary condition identifier, polling interval, plan price, or executable rule expression.

## Stored research state

`RavenMonitorRule` stores an opaque owner-bound rule ID, its owned Saved Exact Market ID, canonical instrument ID, chain/venue identity, allowlisted event types, active or paused state, fixed cadence class, bounded cooldown, last qualified source timestamp, the last normalized classification state, next eligible evaluation time, immutable schema version, optimistic revision, and timestamps. It stores neither symbol nor display label as an identity selector.

`NotificationEvent` is append-only except for `read_at`. It stores a bounded before/after classification transition, exact instrument lineage, qualified source and detection timestamps, deterministic dedupe key, plain-text explanation, evidence role, bounded limitations, allowlisted deep-link context, read state, retention expiry, and schema version. Database triggers reject historical rewrites and enforce account quotas. Owner and Saved Exact Market foreign keys cascade on deletion.

The active product never persists raw provider responses, Raven actor or cohort identities, chart-plan prices, entries, targets, invalidations, wallet information, positions, orders, signing material, submission state, or execution objects. Client output is built from narrow DTOs and rendered with DOM `textContent`.

## Evidence qualification and transitions

Only normalized, current, public-safe evidence with an exact instrument lineage may be compared. Stale, fallback, malformed, empty, out-of-order, or identity-mismatched evidence is skipped. Missing membership in a ranking is not treated as proof that a market disappeared. An unavailable or superseded exact market requires qualified exact-availability evidence.

Supported event categories are setup state, evidence strengthened or weakened, evidence invalid or unavailable, pressure/crowding regime, funding regime, liquidity quality, attention state, launch lifecycle, and exact-market availability. A category is offered for a rule only when the current exact evidence contains the necessary normalized classification. Exact Hyperliquid perpetuals use qualified Raven/venue observations. Onchain pool availability and one-hour buy/sell transaction-count flow use only the existing fresh shared pool snapshot. At least ten transactions are needed for flow: buy share at least 60% is buy-led, at most 40% is sell-led, and the middle is balanced. This is not wallet profit, net dollar flow, execution readiness or a qualified Discovery classifier. The editor reads `/evidence/:watch_id` when opened and offers only categories supported by that owned market’s current evidence. Unmeasured lifecycle, attention and listed-market structures remain unavailable.

The evaluator compares classification changes, not ordinary numeric ticks. The same immutable inputs yield the same transition. Dedupe keys bind rule, exact instrument, event type, before state, after state, and qualified source timestamp. Older observations are ignored. Identical observations create no notification. Cooldowns suppress repeated event categories without replaying stale state.

## Batching and concurrency

The existing five-minute cron invokes a bounded evaluator when every activation control is enabled. It acquires a short database lease and cursor, selects at most 100 due active rules whose owners remain active and have current grants, trial access or funded paid access, deduplicates exact instrument IDs, and loads each qualified source snapshot once for the batch. Raven never makes one provider request per customer. Database uniqueness and optimistic source-timestamp/revision checks provide a second dedupe boundary. Notifications and the new baseline commit atomically; a failed write remains retryable. Pause, edit, account restrictions and expired/revoked access are rechecked at persistence. A classification-method change rebaselines measurements while separately qualified exact-availability facts remain comparable.

Evaluator output contains only aggregate audit-safe totals: rules considered, qualified sources loaded, transitions, notifications created, and skip categories. It does not log customer identity, balances, market contents, or provider payloads.

## Quotas, retention, and deletion

Technical ceilings are 100 monitor rules, ten event categories per rule, 1,000 retained in-app notifications, 200 returned rows per history request, 90-day notification retention, 250 notifications per evaluator invocation, and bounded per-account/network route rates. These are ceilings, not an “unlimited” commercial promise.

Expired notification evidence is excluded from customer reads and read-state mutations immediately. The leased evaluator purges expired rows before counting quota or processing a batch, so retained-history limits cannot be consumed indefinitely by inaccessible evidence.

Customers can pause, resume, edit, or delete a rule with optimistic revisions. Notification read marking is idempotent. Notification history can be deleted without removing rules. “Delete all alert research state” deletes every rule and notification owned by the customer while leaving Saved Exact Markets intact. Deleting a Saved Exact Market removes its rules and notification history by cascade. Account deletion cascades through all alert state. Backups and security audit records remain governed by the broader account retention policy and cannot be used to repopulate active customer research state.

## Delivery and future gate

v1 delivery is in-app only. A delivery-adapter contract names future consented email and web-push channels but contains no credentials, provider integration, or send implementation. SMS, Telegram, Discord, web push, and email are not active. The next gate requires an independently reviewed consent, unsubscribe, destination-verification, retry, abuse, and credential model before any out-of-app message can be sent.

Raven notifications use research language such as “Pressure changed from balanced to crowded long” or “This exact market is no longer available.” They never claim that a customer owned a position, that an order executed, that a stop or target was hit, or that the customer should buy or sell.
