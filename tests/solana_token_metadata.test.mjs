import test from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import { createSolanaTokenMetadataLoader, markedSolanaToken, solanaHoldingsMarkSummary } from "../lib/customer_trade/solana_token_metadata.mjs";
const MINT = bs58.encode(Buffer.alloc(32, 29));
const OTHER = bs58.encode(Buffer.alloc(32, 30));
const asset = (overrides = {}) => ({ id: MINT, interface: "FungibleToken", content: { metadata: { name: "Example", symbol: "EX" } }, token_info: { decimals: 6, price_info: { currency: "USD", price_per_token: 2.5e-7 } }, ...overrides });

test("one bounded metadata batch is reused across wallet lookups and expires honestly", async () => {
  const calls = [];
  const load = createSolanaTokenMetadataLoader({ rpc: async (method, params) => { calls.push({method,params}); return [asset(), null]; } });
  const first = await load({ mints: [MINT, MINT, "native_sol", OTHER], now: 1000 });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], {method:"getAssetBatch",params:{ids:[MINT,OTHER],options:{showFungible:true}}});
  assert.equal(first.state, "partial"); assert.equal(first.rows[0].symbol, "EX");
  assert.equal(first.rows[0].provider_mark_price_usd, "0.00000025");
  const cached = await load({mints:[MINT,OTHER],now:1020});
  assert.equal(calls.length,1); assert.equal(cached.provider_request_performed,false);
  assert.equal(cached.rows[0].observed_at, first.rows[0].observed_at);
  await load({mints:[MINT,OTHER],now:1601}); assert.equal(calls.length,2);
});

test("marks preserve large integer holdings and round down only the final micro-USD value", async () => {
  const load = createSolanaTokenMetadataLoader({rpc:async()=>[asset()]});
  const meta = (await load({mints:[MINT]})).rows[0];
  const token = {mint:MINT,decimals:6,balance_base_units:"18014398509481986",balance_display:"18014398509.481986"};
  const marked = markedSolanaToken(token,meta);
  assert.equal(marked.provider_mark_value_usd,"4503.599627");
  assert.equal(marked.balance_base_units,token.balance_base_units);
  assert.equal(markedSolanaToken(token,{...meta,decimals:9}),token);
  assert.equal(markedSolanaToken(token,{...meta,mint:OTHER}),token);
  assert.deepEqual(solanaHoldingsMarkSummary([marked,{mint:OTHER}]),{visible_provider_mark_value_usd:"4503.599627",visible_priced_rows:1,visible_unpriced_rows:1,scope:"priced_tokens_only_excludes_native_balance",executable_valuation_available:false});
  assert.equal(solanaHoldingsMarkSummary([{mint:OTHER}]).visible_provider_mark_value_usd,null);
});

test("mismatched or duplicate IDs, non-fungible assets and provider failures never supply marks", async () => {
  for (const result of [[asset({id:OTHER})], [asset(),asset()]]) {
    const load=createSolanaTokenMetadataLoader({rpc:async()=>result});
    const response=await load({mints:[MINT,OTHER]});
    if(result.length===1) { // OTHER was requested but MINT was not resolved.
      assert.equal(response.rows.some(row=>row.mint===MINT),false);
    } else assert.equal(response.state,"unavailable");
  }
  const mismatched=createSolanaTokenMetadataLoader({rpc:async()=>[asset({id:OTHER})]});
  assert.equal((await mismatched({mints:[MINT]})).state,"unavailable");
  const failed=createSolanaTokenMetadataLoader({rpc:async()=>{throw new Error("secret-provider-url");}});
  assert.doesNotMatch(JSON.stringify(await failed({mints:[MINT]})),/secret-provider/);
  const nft=createSolanaTokenMetadataLoader({rpc:async()=>[asset({interface:"V1_NFT"})]});
  assert.deepEqual((await nft({mints:[MINT]})).rows,[]);
});

test("non-USD and invalid prices remain unknown; labels are bounded and do not confer trust", async () => {
  for(const price of [{currency:"EUR",price_per_token:1},{currency:"USD",price_per_token:-1},{currency:"USD",price_per_token:"1e99"},{currency:"USD",price_per_token:0}]) {
    const load=createSolanaTokenMetadataLoader({rpc:async()=>[asset({token_info:{decimals:6,symbol:"\u202eEX\u0000",price_info:price}})]});
    const row=(await load({mints:[MINT]})).rows[0];
    assert.equal(row.symbol,"EX");assert.equal(row.provider_mark_price_usd,null);
  }
  let count=0;
  const load=createSolanaTokenMetadataLoader({rpc:async(method,params)=>{count=params.ids.length;return [];}});
  const response=await load({mints:Array.from({length:100},(_,i)=>bs58.encode(Buffer.alloc(32,i+1)))});
  assert.equal(count,64);assert.equal(response.truncated,true);
});
