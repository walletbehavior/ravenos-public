# Returning access and device preferences — September 8, 2026

## Result

- Account offers an unchecked “Remember this device for up to 30 days” choice. It is optional for both sign-in and account creation.
- The server binds the choice to one-time OAuth state, persists it on the opaque session and fixes its expiry. Existing sessions keep their original 30-minute idle / 12-hour absolute limits.
- Returning customers default to Sign in. An explicit Create account choice remains possible; new-account terms are never silently accepted.
- Discover chain, timeframe and sort; wallet-screener chain and performance period; and Account/Portfolio balance network restore on the same browser. Explicit wallet URLs and the trading ticket’s exact chain override defaults.
- Account’s collapsed Preferences & accepted terms section reads current legal receipts only when opened. It cannot write acceptance. A failed receipt lookup does not block access.
- Sign-in preserves supported workspace queries and anchors, including Portfolio’s Shielded Reserve section.

## Boundaries

Remembered access never refreshes `authenticated_at`, changes recent-auth requirements, adds trade authority or bypasses CSRF, sign-out or revocation. It remains a host-only Secure, HttpOnly, SameSite=Lax cookie backed by a server verifier. Rotated CSRF cookies cannot outlive the session.

The new presentation record is allowlisted, size-bounded and expires after 180 days. It contains no account identifier, email, wallet address, balance, token, signing material, legal assent or execution setting. Unavailable storage falls back safely. Account can reset only these device preferences; existing account-owned research and settings remain in their established systems.

Existing legal documents and version/hash receipts are unchanged. Functional storage already appears in the current Privacy Policy. The internal legal inventory now documents remembered sessions and the new preference record.

Migration `0043_remembered_devices.sql` adds default-off fields to auth state and sessions. Apply to preview and production D1 before promotion. It does not extend any existing session or alter financial tables.

## Verification

Coverage includes a real SQLite/D1-store authentication round trip, default and opted-in expiry, invalid opt-in values, fixed absolute limits, CSRF rotation, original authentication time, recent-auth checks, revocation, logout, server-stored assent, storage denial/corruption/expiry, display reset, workspace return paths, mobile access and exact-chain wallet context. Deployment receipt and final test totals are recorded in the workspace release report.

Validation: 1,515 Node regression tests and 51 distinct browser checks passed. Build, security and public no-leak checks passed. Mobile sign-in and desktop acceptance receipts were visually inspected.

## Next product work

The Solana wallet profile is the reference presentation for EVM profiles. Expand verified historical reconstruction and current valuation coverage without converting unknown values into zero. Keep shared cached discovery separate from bounded on-demand history enrichment. Broaden Solana’s provider history and supported transaction interpretation using the same profile and evidence model.

Shielded Reserve remains read-only provider research and planning. A real user-controlled Zcash wallet integration, live route lifecycle, settlement/refund accounting, review and controlled canaries are prerequisites to making it a live capital product. Remembered access does not change that boundary.
