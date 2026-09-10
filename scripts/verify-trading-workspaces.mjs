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
async function read(url, status = 200, headers = {}) {
  const response = await fetch(url, { redirect: 'manual', headers: { 'cache-control': 'no-cache', ...headers }, signal: AbortSignal.timeout(15_000) });
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
  assert.equal(redirected.headers.get('location'), `${app}/${page}/${query}&raven_app=1`);
  assert.match(redirected.headers.get('cache-control'), /\bno-store\b/);
}
const workspacePages = ['discover', 'terminal', 'perps', 'atlas', 'account', 'portfolio', 'account/copy', 'account/intelligence', 'monitor', 'community', 'agents'];
for (const page of workspacePages) {
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
// Imported workspace modules also have to match the deployed release.
for (const name of ['ravenos-account-session.js', 'ravenos-trade-journal.js']) {
  const asset = manifest.assets[name];
  assert.ok(asset, `Workspace module ${name} missing from the release manifest`);
  const response = await read(app + asset.url);
  assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), asset.sha256);
  checkedAssets.add(asset.url);
}
const config = await (await read(app + '/api/v1/auth/config')).json();
const privateHistory = await read(app + '/api/v1/portfolio/trades', 401, { 'sec-fetch-site': 'same-origin' });
assert.match(privateHistory.headers.get('cache-control'), /no-store/);
assert.equal((await privateHistory.json()).error, 'authentication_required');
const publicHistory = await read(publicOrigin + '/api/v1/portfolio/trades', 409);
assert.match(publicHistory.headers.get('cache-control'), /private.*no-store/);
assert.equal((await publicHistory.json()).error, 'authenticated_origin_required');
const evidencePath = '/api/v1/monitor-alerts/evidence/wat_verification000001';
// Real account-page GETs use no-referrer and do not send an Origin header.
const privateEvidence = await read(app + evidencePath, 401, { 'sec-fetch-site': 'same-origin' });
assert.match(privateEvidence.headers.get('cache-control'), /no-store/);
assert.equal((await privateEvidence.json()).error, 'authentication_required');
const publicEvidence = await read(publicOrigin + evidencePath, 403);
assert.match(publicEvidence.headers.get('cache-control'), /\bno-store\b/);
assert.equal((await publicEvidence.json()).error, 'request_not_allowed');
for (const path of ['/api/v1/monitor-alerts', '/api/v1/monitor-alerts/rules', '/api/v1/monitor-alerts/notifications']) {
  const response = await read(app + path, 401, { 'sec-fetch-site': 'same-origin' });
  assert.match(response.headers.get('cache-control'), /\bno-store\b/);
  assert.equal((await response.json()).error, 'authentication_required');
}
assert.equal(config.on_authenticated_origin, true);
assert.equal(config.available, true);
const flags = await (await read(app + '/api/trade/flags')).json();
const live = flags.live_execution;
assert.ok(live, 'Live-execution contract missing');
for (const chain of ['solana', 'robinhood', 'bsc', 'base', 'ethereum', 'hyperliquid']) assert.equal(live.chains[chain].enabled, true, chain);
console.log(JSON.stringify({ ok: true, release_id: release.release_id, checks: checks.length, verified_assets: checkedAssets.size, authenticated_workspaces: workspacePages.length, transactions_submitted: 0 }, null, 2));
