import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("financial clients run through native workerd fetch and never follow provider redirects", async t => {
  const source = `
    import {createAccountStripeClient} from './lib/customer_pro_billing.mjs';
    import {loadAlchemyWalletInputs} from './lib/customer_trade/alchemy_wallet_history.mjs';
    import {verifyCanonicalClaimTransfer} from './lib/customer_reward_payouts.mjs';
    import {createExecutionRecoveryRpc} from './lib/customer_trade/evm_execution_recovery.mjs';
    import {withEvmExecutionFinality} from './lib/customer_trade/evm_execution_finality.mjs';
    export default {async fetch(request) {
      const path=new URL(request.url).pathname;
      try {
        if(path==='/recovery') {
          const rpc=createExecutionRecoveryRpc('robinhood');
          await rpc.request('eth_chainId',[]);
          return Response.json(await withEvmExecutionFinality({state:'provider_confirmed',evidence:{economic_result_verified:true,block_number:'100',block_hash:'0x'+'bb'.repeat(32),l1_finality_observed:false}},rpc));
        }
        if(path==='/recovery-redirect') return Response.json(await createExecutionRecoveryRpc('base').request('eth_chainId',[]));
        if(path==='/alchemy') return Response.json(await loadAlchemyWalletInputs({RAVENOS_ALCHEMY_WALLET_HISTORY_ENABLED:'1',ALCHEMY_BASE_RPC_URL:'https://base-mainnet.g.alchemy.com/v2/fixture'},'base','0x1111111111111111111111111111111111111111'));
        if(path==='/claim') return Response.json(await verifyCanonicalClaimTransfer({RAVENOS_BASE_RPC_URL:'https://rpc.fixture.test'}, {chain:'base',token:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',from:'0x1111111111111111111111111111111111111111',to:'0x2222222222222222222222222222222222222222',transaction_hash:'0x'+'33'.repeat(32),amount_micros:'1000000'}));
        const stripe=createAccountStripeClient({RAVENOS_PRO_ACCOUNT_BILLING_ENABLED:'1',STRIPE_SECRET_KEY:'fixture_nonfinancial_key'});
        return Response.json(await stripe(path==='/redirect'?'/v1/prices/redirect':'/v1/prices/fixture'));
      } catch(e) {return Response.json({error:e.code||e.message},{status:503});}
    }};
  `;
  const bundled = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser", external: ["node:*"] });
  const requests = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: "2026-06-23", compatibilityFlags: ["nodejs_compat"],
    outboundService: async request => {
      const url = new URL(request.url); requests.push({ host: url.host, path: url.pathname });
      if(url.host==='mainnet.base.org') return new Response(null,{status:302,headers:{location:'https://untrusted.fixture.test/'}});
      if(url.host==='rpc.mainnet.chain.robinhood.com') {
        assert.equal(request.headers.has('authorization'),false);
        const {id,method}=await request.json();
        return Response.json({jsonrpc:'2.0',id,result:method==='eth_chainId'?'0x1237':{number:'0x64',hash:'0x'+'bb'.repeat(32)}});
      }
      if (url.host === "api.stripe.com") {
        if (url.pathname.endsWith("/redirect")) return new Response(null, { status: 302, headers: { location: "https://untrusted.fixture.test/" } });
        return Response.json({ id: "price_fixture", unit_amount: 14900 });
      }
      assert.ok(["base-mainnet.g.alchemy.com", "rpc.fixture.test"].includes(url.host));
      const { method, params } = await request.json();
      const result = method === "eth_chainId" ? "0x2105"
        : method === "alchemy_getAssetTransfers" ? { transfers: [] }
          : method === "alchemy_getTokenBalances" ? { address: params[0], tokenBalances: [] }
            : method === "eth_getBalance" ? "0x0" : null;
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    },
  }));
  t.after(() => mf.dispose());
  await t.test("Stripe read reaches its intended provider", async () => {
    const r = await mf.dispatchFetch("https://test.invalid/stripe"); assert.equal(r.status, 200); assert.equal((await r.json()).unit_amount, 14900);
  });
  await t.test("Alchemy chain and wallet requests work under the production runtime", async () => {
    const r = await mf.dispatchFetch("https://test.invalid/alchemy"); assert.equal(r.status, 200); const data = await r.json(); assert.equal(data.provider, "alchemy_wallet_history"); assert.equal(data.request_count, 5);
  });
  await t.test("claim verification can read the chain without treating an unresolved transfer as paid", async () => {
    const r = await mf.dispatchFetch("https://test.invalid/claim"); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { matched: false, finalized: false });
  });
  await t.test("redirects cannot forward provider credentials to another host", async () => {
    const before = requests.length; const r = await mf.dispatchFetch("https://test.invalid/redirect"); assert.equal(r.status, 503); assert.equal((await r.json()).error, "stripe_result_indeterminate"); assert.equal(requests.length, before + 1); assert.equal(requests.at(-1).host, "api.stripe.com");
  });
  await t.test('read-only recovery verifies finalized evidence under workerd without asserting independent L1 proof',async()=>{
    const before=requests.length, response=await mf.dispatchFetch('https://test.invalid/recovery');
    assert.equal(response.status,200); const data=await response.json();
    assert.equal(data.evidence.finalized,true); assert.equal(data.evidence.l1_finality_observed,false);
    assert.equal(requests.length,before+4);
  });
  await t.test('recovery public RPC redirects stop at the selected provider',async()=>{
    const before=requests.length, response=await mf.dispatchFetch('https://test.invalid/recovery-redirect');
    assert.equal(response.status,503); assert.equal(requests.length,before+1);
    assert.equal(requests.at(-1).host,'mainnet.base.org');
  });
});
