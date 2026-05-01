# RavenOS

RavenOS is a public crypto market-weather layer for Solana and cross-chain risk conditions.

This repository contains the public website only. It is safe for Cloudflare Pages and intentionally excludes:

- wallet lists
- raw logs
- private implementation names
- private databases
- API keys
- Telegram tokens
- execution logic

## Site structure

- `index.html`: public landing/dashboard
- `styles.css`: static presentation
- `app.js`: client-side loader for the public summary
- `public/data/ravenos_summary.json`: generated public-safe snapshot consumed by the site
- `scripts/sync_public_data.py`: local sync script run from the droplet

## Cloudflare Pages settings

- Build command: none
- Build output directory: `.` or root
- Framework preset: none
- Node version: not required

If your Pages project requires a build command field, leave it blank and point the output directory at the repo root.

## Public data sync

The site reads `public/data/ravenos_summary.json`.

Update it from the droplet with:

```bash
python3 /srv/raven/ravenos-public/scripts/sync_public_data.py --repo-root /srv/raven/ravenos-public --source-root /srv/raven/app
```

The script only reads public-safe artifacts from `/srv/raven/app/data/public` and `/srv/raven/app/data/ravenos`.
If those artifacts are missing, it writes a placeholder summary with explicit stale/awaiting-data semantics.

## Cron

Install a 15-minute sync job:

```cron
*/15 * * * * /usr/bin/python3 /srv/raven/ravenos-public/scripts/sync_public_data.py --repo-root /srv/raven/ravenos-public --source-root /srv/raven/app >/tmp/ravenos_public_sync.log 2>&1
```

## Deploy

After the sync updates the repo, commit and push the public site changes:

```bash
cd /srv/raven/ravenos-public
git add .
git commit -m "Update public RavenOS site"
git push origin main
```

## Notes

- The site is read-only and safe for public hosting.
- The summary file is intentionally sanitized and should remain the only live data dependency.
