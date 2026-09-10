import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {decodeSolanaTransaction,resolveSolanaTransactionAccounts} from '../lib/customer_trade/solana_transaction_decoder.mjs';
import {jupiterQuotedFeeAmount,verifyJupiterFeeInstruction} from '../lib/customer_trade/jupiter_fee_evidence.mjs';

for(const filename of ['jupiter_v2_fee_transaction.json','jupiter_direct_v2_fee_transaction.json']) {
  const fixture=JSON.parse(readFileSync(new URL(`./fixtures/${filename}`,import.meta.url)));
  // These recorded USDC -> BONK transactions predate the selected-mint
  // metadata argument. Supply their actual SPL mint context to the verifier.
  fixture.request.terminal={token_address:fixture.request.output_mint};
  const selectedMint={mint:fixture.request.output_mint,token_program:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'};
  const decoded=decodeSolanaTransaction(fixture.unsigned_transaction);
  const original=resolveSolanaTransactionAccounts(decoded,new Map(fixture.lookup_tables));
  test(`${filename}: actual unsigned transaction encodes exactly 100 bps`,()=>{
    assert(decoded.signatures.every(s=>!s.populated));
    const evidence=verifyJupiterFeeInstruction(original,fixture.request,fixture.quote,selectedMint);
    assert.equal(evidence.fee_bps,100);
    assert.equal(evidence.fee_mint,fixture.request.input_mint);
    assert.equal(evidence.fee_account,'AZvRGXzbBAJK5BoWMGp18wJUtJLFgc9LadY274gs6U17');
  });
  for(const field of ['bps','positive_slippage','input','output','slippage','count','wallet','input_mint','output_mint','token_program','fee_account','writable','signer','discriminator','duplicate']) {
    test(`${filename}: rejects changed ${field}`,()=>{
      const programs=structuredClone(original);const ix=programs.instructions.find(r=>r.program_id.startsWith('JUP6'));
      const data=Buffer.from(ix.data_base64,'base64');const shared=data[0]===0xd1,base=shared?9:8,fee=shared?12:10;
      if(field==='bps')data.writeUInt16LE(70,base+18);
      if(field==='positive_slippage')data.writeUInt16LE(5,base+20);
      if(field==='input')data.writeBigUInt64LE(1n,base);
      if(field==='output')data.writeBigUInt64LE(1n,base+8);
      if(field==='slippage')data.writeUInt16LE(500,base+16);
      if(field==='count')data.writeUInt32LE(99,base+22);
      if(field==='wallet')ix.accounts[shared?1:0].address='11111111111111111111111111111111';
      if(field==='input_mint')ix.accounts[shared?6:3].address=fixture.request.output_mint;
      if(field==='output_mint')ix.accounts[shared?7:4].address=fixture.request.input_mint;
      if(field==='token_program')ix.accounts[shared?8:5].address='11111111111111111111111111111111';
      if(field==='fee_account')ix.accounts[fee].address=fixture.request.wallet_address;
      if(field==='writable')ix.accounts[fee].writable=false;
      if(field==='signer')ix.accounts[fee].signer=true;
      if(field==='discriminator')data[0]=0;
      if(field==='duplicate')programs.instructions.push(structuredClone(ix));
      ix.data_base64=data.toString('base64');
      assert.throws(()=>verifyJupiterFeeInstruction(programs,fixture.request,fixture.quote,selectedMint),/jupiter_/);
    });
  }
  test(`${filename}: missing or mismatched selected mint fails with a validation reason`,()=>{
    assert.throws(()=>verifyJupiterFeeInstruction(original,fixture.request,fixture.quote),/selected_mint_unverified/);
    assert.throws(()=>verifyJupiterFeeInstruction(original,fixture.request,fixture.quote,{...selectedMint,mint:fixture.request.input_mint}),/selected_mint_unverified/);
    assert.throws(()=>verifyJupiterFeeInstruction(original,{...fixture.request,terminal:undefined},fixture.quote,selectedMint),/selected_mint_unverified/);
  });
  test(`${filename}: fee amount omitted, exact integer rounding and mismatch rejection`,()=>{
    const request={...fixture.request,amount_base_units:'1000099'};
    assert.equal(jupiterQuotedFeeAmount({feeMint:request.input_mint,platformFee:{feeBps:100}},request),'10000');
    assert.throws(()=>jupiterQuotedFeeAmount({feeMint:request.input_mint,platformFee:{amount:'9999'}},request),/amount_mismatch/);
    assert.throws(()=>jupiterQuotedFeeAmount({feeMint:request.input_mint,platformFee:{amount:'1.25'}},request),/amount_invalid/);
    assert.equal(jupiterQuotedFeeAmount({feeMint:request.output_mint,platformFee:{}},request),null);
  });
}
