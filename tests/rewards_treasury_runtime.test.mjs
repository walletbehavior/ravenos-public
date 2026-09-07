import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {Keypair,Transaction} from '@solana/web3.js';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {claimTransaction} from '../services/rewards-treasury/solana.mjs';

test('treasury construction and isolated Privy signing run in workerd with no real provider traffic',async t=>{
  const key=Keypair.fromSeed(new Uint8Array(32).fill(61)), recipient=Keypair.fromSeed(new Uint8Array(32).fill(62)).publicKey.toBase58();
  const blockhash=Keypair.fromSeed(new Uint8Array(32).fill(63)).publicKey.toBase58();
  const tx=claimTransaction({treasury:key.publicKey.toBase58(),destination:recipient,amount:10000000n,blockhash,create_destination:true});
  const unsigned=tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const bundled=await build({stdin:{resolveDir:process.cwd(),contents:`
    import {claimTransaction,privySignClaim} from './services/rewards-treasury/solana.mjs';
    export default {async fetch(request,env){
      try {
        const tx=claimTransaction({treasury:env.TREASURY_WALLET,destination:env.DESTINATION,amount:10000000n,blockhash:env.BLOCKHASH,create_destination:true});
        const prepared={treasury_wallet:env.TREASURY_WALLET,unsigned_transaction:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')};
        const result=await privySignClaim(env,prepared);
        return Response.json({signature:result.transaction_hash});
      }catch(e){return Response.json({error:e.message},{status:503});}
    }};`},bundle:true,write:false,format:'esm',platform:'browser',external:['node:*']});
  let calls=0;
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],
    bindings:{TREASURY_LIVE_ENABLED:'1',TREASURY_WALLET:key.publicKey.toBase58(),DESTINATION:recipient,BLOCKHASH:blockhash,TREASURY_PRIVY_APP_ID:'fixtureapp123',TREASURY_PRIVY_WALLET_ID:'fixturewallet123',TREASURY_PRIVY_APP_SECRET:'fixture-not-a-real-secret',TREASURY_PRIVY_AUTHORIZATION_KEY:pair.privateKey.export({format:'pem',type:'pkcs8'})},
    outboundService:async request=>{
      calls++;assert.equal(request.url,'https://api.privy.io/v1/wallets/fixturewallet123/rpc');
      const body=await request.json();assert.equal(body.method,'signTransaction');assert.equal(body.params.transaction,unsigned);
      const signed=Transaction.from(Buffer.from(body.params.transaction,'base64'));signed.sign(key);
      return Response.json({method:'signTransaction',data:{signed_transaction:signed.serialize().toString('base64'),encoding:'base64'}});
    }}));
  t.after(()=>mf.dispose());
  const response=await mf.dispatchFetch('https://fixture.invalid/');const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.match(body.signature,/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);assert.equal(calls,1);
});
