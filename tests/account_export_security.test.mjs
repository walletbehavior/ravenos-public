import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAssetSecurityHeaders } from '../lib/customer_trade/terminal_runtime.mjs';

test('account export styles receive a fresh response-bound nonce without widening script permission', async () => {
  const html = '<!doctype html><html><head><title>Account</title></head><body></body></html>';
  const create = () => applyAssetSecurityHeaders(new Response(html, {headers:{'content-type':'text/html; charset=utf-8',etag:'old','content-length':String(html.length)}}), '/account/');
  const a=create(), b=create();
  const csp=a.headers.get('content-security-policy');
  const nonce=csp.match(/style-src 'self' 'nonce-([a-f0-9]{32})'/)?.[1];
  assert(nonce);
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(a.headers.get('cache-control'),'private, no-store');
  assert.equal(a.headers.has('etag'),false);
  assert.equal(a.headers.has('content-length'),false);
  assert.match(await a.text(), new RegExp(`<head><meta property="csp-nonce" content="${nonce}">`));
  assert.notEqual(b.headers.get('content-security-policy'),csp);
  await b.text();
  const other=applyAssetSecurityHeaders(new Response(html,{headers:{'content-type':'text/html'}}),'/community/');
  assert.doesNotMatch(other.headers.get('content-security-policy'),/nonce-/);
  assert.equal(await other.text(),html);
});
