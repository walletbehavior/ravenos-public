# RavenOS Release Cohesion v1

Status: implemented for isolated version staging; production promotion remains separately authorized.

Contract: `ravenos.release.v1`

## Release invariant

A RavenOS release is one immutable tuple:

- source commit;
- public release ID;
- Cloudflare Worker version and version tag;
- static asset manifest digest;
- deploy artifact digest;
- public-origin contract version.

The Worker, HTML, JavaScript, CSS, release controls, and public-origin contract must agree. A packaged Worker sets `RAVENOS_RELEASE_ENFORCE=1`; an identity mismatch then returns HTTP 503 before any API or static asset is served.

`GET /api/build` is public-safe and non-cacheable. It reports the release ID, source commit, Worker version ID, static manifest digest, deploy digest, public-origin contract, and cohesion state. It never reports secret values. Cloudflare's runtime version metadata may omit the Wrangler annotation tag; staging therefore verifies that tag independently through the Cloudflare Versions API and joins it to the runtime version ID.

## Static asset behavior

`scripts/prepare-deploy-assets.mjs` creates `.deploy-public` and:

- fingerprints every deployable JavaScript and CSS file from its content;
- rewrites HTML and local JavaScript imports to those fingerprinted paths;
- stamps every HTML route with the release identity;
- emits `ravenos_release.json`, `ravenos_asset_manifest.json`, `ravenos_build.json`, and `ravenos_deploy_manifest.json`;
- gives `/assets/*` one-year immutable caching;
- gives release control documents `no-store`;
- leaves HTML revalidating rather than immutable.

No unversioned JavaScript or CSS file may remain in the deploy surface.

## Build, package, and stage

1. Run the complete validation suite.
2. Commit the intended source and require a clean worktree.
3. Run `npm run release:package`.
4. The packager copies the exact Worker and static artifact into `.releases/<release-id>/`, records every hash, and creates a tar archive.
5. Run `npm run release:stage -- .releases/<release-id>`.
6. Staging verifies package checksums and the names of required server-only secret bindings, uploads one Cloudflare Worker Version with the release ID as its version tag, and does not shift production traffic.
7. The version-specific preview verifies `/api/build`, every public HTML route, every referenced asset hash and cache policy, health, and current-origin opportunity delivery.

The production Worker's main `workers.dev` route remains disabled. Staging enables only Cloudflare version previews when necessary and records that state in the stage receipt. Preview URLs contain the same public-safe surface intended for `ravenos.xyz`; private Raven routes and origin credentials remain inaccessible.

The parent `.env` is read only for Cloudflare credentials. It is never copied, printed, or modified. Existing remote variables and secrets are retained with Wrangler's keep-vars behavior.

## Promotion

Promotion uses the already-staged Worker version ID; it never rebuilds.

`scripts/promote-release.mjs` requires:

- a verified stage receipt;
- matching package and receipt identities;
- the production-equivalent preview report for the same release;
- an explicitly commercially qualified, non-Demo chart provider;
- a qualified one-minute contract and no sub-minute requirement;
- `RAVENOS_PRODUCTION_PROMOTION_AUTHORIZATION` equal to the exact release ID.

Without every condition, it stops before calling Cloudflare. A Demo-backed version remains available only through its isolated Cloudflare preview URL and is ineligible for `ravenos.xyz` traffic.

## Rollback

Every successfully staged release bundle and receipt is a rollback candidate. `scripts/rollback-release.mjs` promotes that exact previously verified Worker version and asset tuple. It requires `RAVENOS_PRODUCTION_ROLLBACK_AUTHORIZATION` equal to the target release ID.

Rollback does not rebuild, cherry-pick, purge caches, or reconstruct assets. Content-addressed assets remain safe to cache, while HTML revalidates onto the selected tuple.

The pre-cohesion production Worker remains governed by its existing preserved checkpoint until the first cohesive release is explicitly promoted.

## Gates

`scripts/cloudflare-build-check.mjs` validates:

- release identity agreement;
- content hashes and file sets;
- route-to-asset mappings;
- cache policy;
- Worker-first asset routing;
- version metadata binding;
- fail-closed and non-signing declarations;
- bounded deploy contents;
- the absence of unversioned JS/CSS.

Contract tests cover exact tuple acceptance, mixed-asset rejection, wrong Worker tags, `/api/build`, fail-closed behavior, and cache semantics. Preview verification is the production-equivalent gate for a real Cloudflare runtime and network path.
