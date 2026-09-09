import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const paths = ['discover', 'terminal', 'perps', 'atlas'];
const env = { ASSETS: { fetch: async () => new Response('<html>Raven workspace</html>', { headers: { 'content-type': 'text/html' } }) } };
test('chart and Discovery navigation stay on the authenticated host and preserve exact context', async () => {
  for (const page of paths) for (const suffix of ['', '/', '/index.html']) for (const method of ['GET', 'HEAD']) {
    const path = `/${page}${suffix}?market_scope=memecoins&chain=solana&instrument_id=solana%3Apool%3AExactCase&token_address=ExactToken&amount=25`;
    const publicResponse = await worker.fetch(new Request(`https://ravenos.xyz${path}`, { method }), env);
    assert.equal(publicResponse.status, 307);
    assert.equal(publicResponse.headers.get('location'), `https://app.ravenos.xyz${path}`);
    const appResponse = await worker.fetch(new Request(`https://app.ravenos.xyz${path}`, { method }), env);
    assert.equal(appResponse.status, 200, `${method} ${path} must not bounce the remembered session to the public host`);
    assert.equal(appResponse.headers.has('location'), false);
    assert.match(appResponse.headers.get('content-security-policy'), /base-uri 'none'/);
  }
});
test('workspace routing neither redirects mutations nor opens unknown authenticated paths', async () => {
  const post = await worker.fetch(new Request('https://app.ravenos.xyz/discover/', { method: 'POST' }), env);
  assert.equal(post.status, 404);
  const unknown = await worker.fetch(new Request('https://app.ravenos.xyz/not-a-workspace/'), env);
  assert.equal(unknown.status, 404);
  const alias = await worker.fetch(new Request('https://app.ravenos.xyz/brief/?chain=base&token_address=exact'), env);
  assert.equal(alias.status, 308);
  assert.equal(alias.headers.get('location'), 'https://app.ravenos.xyz/terminal/?chain=base&token_address=exact');
});
