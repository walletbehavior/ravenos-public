// Read-only production check. No cookies, keys, signatures or order submission.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const bundle = resolve(process.argv[2] || '');
const release = JSON.parse(readFileSync(join(bundle, 'assets/ravenos_release.json')));
const manifest = JSON.parse(readFileSync(join(bundle, 'assets/ravenos_asset_manifest.json')));
const app = 'https://app.ravenos.xyz', publicOrigin = 'https://ravenos.xyz';
const assets = new Map(Object.values(manifest.assets).map(asset => [asset.url, asset]));
const checkedAssets = new Set(), checks = [];
async function read(url, status = 200) {
  const response = await fetch(url, { redirect: 'manual', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, status, url);
  assert.equal(response.headers.get('x-ravenos-release-id'), release.release_id, url);
  checks.push(new URL(url).host + new URL(url).pathname);
  return response;
}
for (const host of [publicOrigin, app]) {
  const body = await (await read(host + '/api/build')).json();
  assert.equal(body.cohesion.state, 'coherent');
  assert.equal(body.release.source_commit, release.source_commit);
}
for (const page of ['discover', 'terminal', 'perps', 'atlas']) {
  const query = '?market_scope=memecoins&chain=solana&instrument_id=solana%3Apool%3AExactCase';
  const redirected = await read(`${publicOrigin}/${page}/${query}`, 307);
  assert.equal(redirected.headers.get('location'), `${app}/${page}/${query}`);
}
for (const page of ['discover', 'terminal', 'perps', 'atlas', 'account', 'portfolio', 'account/copy']) {
  const html = await (await read(`${app}/${page}/`)).text();
  assert.ok(html.includes(`name="ravenos-release-id" content="${release.release_id}"`), page);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)) {
    const expected = assets.get(match[1]);
    assert.ok(expected, `Unmanifested asset ${match[1]}`);
    if (checkedAssets.has(expected.url)) continue;
    const response = await read(app + expected.url);
    const digest = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    assert.equal(digest, expected.sha256, expected.url);
    checkedAssets.add(expected.url);
  }
}
const config = await (await read(app + '/api/v1/auth/config')).json();
assert.equal(config.on_authenticated_origin, true);
assert.equal(config.available, true);
const flags = await (await read(app + '/api/trade/flags')).json();
const live = flags.live_execution;
assert.ok(live, 'Live-execution contract missing');
for (const chain of ['solana', 'robinhood', 'bsc', 'base', 'ethereum', 'hyperliquid']) assert.equal(live.chains[chain].enabled, true, chain);
console.log(JSON.stringify({ ok: true, release_id: release.release_id, checks: checks.length, verified_assets: checkedAssets.size, authenticated_workspaces: 7, transactions_submitted: 0 }, null, 2));
