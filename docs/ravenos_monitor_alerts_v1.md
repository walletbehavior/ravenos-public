# Raven Monitor and In-App Alerts v1

Status: local, operator-granted candidate; dormant by default; not deployed.

Raven Monitor v1 is customer-owned research continuity. It is not position monitoring, order monitoring, investment discretion, or execution. A customer first saves one canonical exact market through Saved Exact Market. A monitor rule then references that owned saved-market record and a bounded set of public event categories. A symbol, label, or customer-supplied provider identifier can never select the monitored market.

## Authority and activation

Access requires an authenticated `app.ravenos.xyz` host-only session, an active owner-matched `research.alerts` grant, and coordinated server controls. Entitlement resolution, customer rule routes, evaluation, notification history, and the capability flag are independent and default off. The evaluator requires all controls, so no isolated flag activates the complete system. There is no customer grant mutation route, checkout, billing path, public enrollment, Desk membership, or shared-domain cookie.

Every mutation requires RavenOS CSRF validation. Reads enforce exact origin and Fetch Metadata boundaries. Responses are `private, no-store`, owner-scoped, bounded, and unsuitable for shared caches. A customer cannot select an owner, entitlement, provider, source, cadence, arbitrary condition identifier, polling interval, plan price, or executable rule expression.

## Stored research state

`RavenMonitorRule` stores an opaque owner-bound rule ID, its owned Saved Exact Market ID, canonical instrument ID, chain/venue identity, allowlisted event types, active or paused state, fixed cadence class, bounded cooldown, last qualified source timestamp, the last normalized classification state, next eligible evaluation time, immutable schema version, optimistic revision, and timestamps. It stores neither symbol nor display label as an identity selector.

`NotificationEvent` is append-only except for `read_at`. It stores a bounded before/after classification transition, exact instrument lineage, qualified source and detection timestamps, deterministic dedupe key, plain-text explanation, evidence role, bounded limitations, allowlisted deep-link context, read state, retention expiry, and schema version. Database triggers reject historical rewrites and enforce account quotas. Owner and Saved Exact Market foreign keys cascade on deletion.

The active product never persists raw provider responses, Raven actor or cohort identities, chart-plan prices, entries, targets, invalidations, wallet information, positions, orders, signing material, submission state, or execution objects. Client output is built from narrow DTOs and rendered with DOM `textContent`.

## Evidence qualification and transitions

Only normalized, current, public-safe evidence with an exact instrument lineage may be compared. Stale, fallback, malformed, empty, out-of-order, or identity-mismatched evidence is skipped. Missing membership in a ranking is not treated as proof that a market disappeared. An unavailable or superseded exact market requires qualified exact-availability evidence.

Supported event categories are setup state, evidence strengthened or weakened, evidence invalid or unavailable, pressure/crowding regime, funding regime, liquidity quality, attention state, launch lifecycle, and exact-market availability. A category is offered for a rule only when the current exact evidence contains the necessary normalized classification. v1 production evidence is strongest for exact Hyperliquid perpetuals; unsupported spot or listed-market structures remain explicitly unavailable rather than inferred.

The evaluator compares classification changes, not ordinary numeric ticks. The same immutable inputs yield the same transition. Dedupe keys bind rule, exact instrument, event type, before state, after state, and qualified source timestamp. Older observations are ignored. Identical observations create no notification. Cooldowns suppress repeated event categories without replaying stale state.

## Batching and concurrency

A bounded scheduled evaluator contract exists, but no cron trigger is configured. It acquires a short database lease and cursor, selects at most 100 due active rules whose owners still possess current grants, deduplicates exact instrument IDs, and loads each qualified source snapshot once for the batch. Raven never makes one provider request per customer. Database uniqueness and optimistic source-timestamp commits provide a second dedupe boundary if execution overlaps.

Evaluator output contains only aggregate audit-safe totals: rules considered, qualified sources loaded, transitions, notifications created, and skip categories. It does not log customer identity, balances, market contents, or provider payloads.

## Quotas, retention, and deletion

Technical ceilings are 100 monitor rules, ten event categories per rule, 1,000 retained in-app notifications, 200 returned rows per history request, 90-day notification retention, 250 notifications per evaluator invocation, and bounded per-account/network route rates. These are ceilings, not an “unlimited” commercial promise.

Expired notification evidence is excluded from customer reads and read-state mutations immediately. The leased evaluator purges expired rows before counting quota or processing a batch, so retained-history limits cannot be consumed indefinitely by inaccessible evidence.

Customers can pause, resume, edit, or delete a rule with optimistic revisions. Notification read marking is idempotent. Notification history can be deleted without removing rules. “Delete all alert research state” deletes every rule and notification owned by the customer while leaving Saved Exact Markets intact. Deleting a Saved Exact Market removes its rules and notification history by cascade. Account deletion cascades through all alert state. Backups and security audit records remain governed by the broader account retention policy and cannot be used to repopulate active customer research state.

## Delivery and future gate

v1 delivery is in-app only. A delivery-adapter contract names future consented email and web-push channels but contains no credentials, provider integration, or send implementation. SMS, Telegram, Discord, web push, and email are not active. The next gate requires an independently reviewed consent, unsubscribe, destination-verification, retry, abuse, and credential model before any out-of-app message can be sent.

Raven notifications use research language such as “Pressure changed from balanced to crowded long” or “This exact market is no longer available.” They never claim that a customer owned a position, that an order executed, that a stop or target was hit, or that the customer should buy or sell.
