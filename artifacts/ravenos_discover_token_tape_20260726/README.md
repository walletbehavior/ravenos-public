# RavenOS Discover token tape — 2026-07-26

Visual QA captures for the compact token-discovery pass.

- `discover-mobile-full-v2.png`: full Discover route at 390 × 844.
- `discover-mobile-token-tape-v2.png`: complete token tape at 390 px.
- `discover-desktop-full-v2.png`: full Discover route at 1440 × 900.
- `discover-desktop-token-tape-v2.png`: complete token tape at 1440 px.

The captures use the current public-safe opportunity projection against the local release candidate.

Verified during capture:

- 16 current token rows rendered.
- No blank virtualized rows.
- No horizontal overflow.
- Token art uses a fixed-size slot with a deterministic monogram fallback.
- “Raven saw it earlier” appears only when the retained comparison proves earlier observation.
- Missing market metrics are omitted instead of rendered as fake zeroes.
- Token rows resolve directly to an exact chartable pool when one can be established.
- Signing and submission remain unavailable.
