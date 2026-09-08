import assert from 'node:assert/strict';
import test from 'node:test';
import {ravenSolanaSigningProvider} from '../client/ravenos-privy-wallet-entry.js';
const address='So11111111111111111111111111111111111111112';
test('Privy Solana adapter connects without signing; one explicit sign returns the SDK transaction', async()=>{
  const calls=[];
  const tx={version:0};const signed={version:0,signed:true};
  const adapter=ravenSolanaSigningProvider({request:async call=>{calls.push(call);return {signedTransaction:signed};}},{address});
  assert.equal(String(adapter.publicKey),address);
  assert.equal(String((await adapter.connect()).publicKey),address);
  assert.equal(calls.length,0);
  assert.equal(await adapter.signTransaction(tx),signed);
  assert.deepEqual(calls,[{method:'signTransaction',params:{transaction:tx}}]);
  assert.equal(adapter.signAndSendTransaction,undefined);
  assert.equal(adapter.request,undefined);
});
test('Privy Solana adapter fails closed on missing signature, bad address, or no provider',async()=>{
  assert.throws(()=>ravenSolanaSigningProvider({}, {address}));
  assert.throws(()=>ravenSolanaSigningProvider({request:()=>{}},{address:'wrong'}));
  const adapter=ravenSolanaSigningProvider({request:async()=>({})},{address});
  await assert.rejects(adapter.signTransaction({}),/signature_missing/);
});
