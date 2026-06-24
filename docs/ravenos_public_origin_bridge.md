# RavenOS Public Origin Bridge

Last updated: June 2026

RavenOS uses a public-safe origin bridge so trust artifacts can refresh without rebuilding the Cloudflare Pages site.

## Architecture

Raven runtime publishes public-safe artifacts.

The locked origin serves only fixed artifact paths on localhost.

Cloudflare Tunnel exposes the locked origin hostname.

The Worker fetches allowlisted artifacts with a bearer token, validates/redacts responses, and serves public API endpoints with cache headers and last-known-good fallback.

The frontend polls small JSON endpoints conservatively.

## Allowed Origin Paths

The origin server only serves:

- `/public/ravenos/brief.json`
- `/public/ravenos/replay.json`
- `/public/ravenos/outcomes.json`
- `/public/ravenos/memory.json`
- `/public/ravenos/behavior.json`
- `/public/ravenos/status.json`

There is no directory listing, no query-based artifact selection, and no arbitrary file path access.

## Security Locks

The bridge relies on three locks:

1. Fixed allowlisted paths only
2. Bearer token required
3. Leak guard plus last-known-good fallback

The origin remains bound to `127.0.0.1:8788`. It must not be exposed as plaintext `0.0.0.0:8788`.

## Worker Endpoints

Origin-backed trust artifacts:

- `/api/brief`
- `/api/replay`
- `/api/outcomes`
- `/api/memory`
- `/api/behavior`

Provider-driven public endpoints:

- `/api/terminal`
- `/api/opportunity`
- `/api/chains/solana`
- `/api/chains/base`
- `/api/chains/ethereum`
- `/api/status`

Terminal and Opportunity should remain provider-driven and should not switch to the slower trust artifact origin.

## Environment Variables

Worker:

- `RAVENOS_PUBLIC_ORIGIN_URL`
- `RAVENOS_PUBLIC_ORIGIN_TOKEN`

Origin:

- `RAVENOS_PUBLIC_ORIGIN_TOKEN`

Cloudflare Tunnel:

- tunnel token stored outside process arguments, for example `/etc/cloudflared/ravenos-public-origin.token`

## Runtime Services

Expected service names:

- `ravenos-public-origin.service`
- `ravenos-public-origin-publish.timer`
- `ravenos-public-origin-tunnel.service`

## Failure Behavior

If origin fetch fails, the Worker serves last-known-good or bundled fallback content and marks the endpoint degraded or stale.

If the origin returns 401, the Worker does not expose raw error content.

If leak guard fails, the artifact is rejected and last-known-good is preserved.

The page should never blank because a trust artifact is unavailable.

