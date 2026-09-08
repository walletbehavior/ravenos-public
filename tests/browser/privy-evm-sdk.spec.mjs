import {test, expect} from '@playwright/test';
import {mockTerminalLiveApis} from './terminal-live-fixtures.mjs';
import {preparedSdkBuy} from './evm-sdk-fixtures.mjs';
import {EVM_CHAIN_PROFILES} from '../../lib/customer_trade/evm_chain_profiles.mjs';

const ADDRESS = '0x3333333333333333333333333333333333333333';
const SIGNED_FIXTURE = '0xdeadbeef';
const HASH = `0x${'a'.repeat(64)}`;

// Real shipped SDK and production CSP. Every wallet service and chain RPC
// response is intercepted; fixture signatures can never reach a live network.
for (const mode of ['on-device', 'user-controlled-server']) {
  for (const [chain, profile] of Object.entries(EVM_CHAIN_PROFILES)) {
    for (const feeModel of ['legacy', 'eip1559']) test(`real EVM SDK executes a fee-bound ${feeModel} ticket on ${chain} (${mode})`, async ({page}) => {
      const app = 'cmfirstusefixture123456';
      const token = [Buffer.from('{"alg":"ES256"}').toString('base64url'), Buffer.from(JSON.stringify({sub:'did:privy:evm-fixture',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'), 'fixture'].join('.');
      const account = {type:'wallet',chain_type:'ethereum',wallet_client_type:'privy',connector_type:'embedded',address:ADDRESS,wallet_index:0,recovery_method:mode === 'on-device' ? 'privy' : 'privy-v2',...(mode === 'on-device' ? {} : {id:'fixture-evm-wallet'})};
      const session = {user:{id:'did:privy:evm-fixture',linked_accounts:[account]},token,identity_token:token,refresh_token:token,session_update_action:'set'};
      const rpcCalls = [], unexpected = [], signatures = [], deviceSignatures = [];
      await page.exposeFunction('captureEvmFixtureSignature', message => deviceSignatures.push(message));
      await page.addInitScript(() => addEventListener('message', e => {if(e.origin!=='https://auth.privy.io')return;try{const m=JSON.parse(e.data);if(m.fixtureCapture)window.captureEvmFixtureSignature(m.fixtureCapture);}catch{}}));
      await mockTerminalLiveApis(page);
      await page.route('https://**/*', route => { unexpected.push(new URL(route.request().url()).origin); return route.abort(); });
      await page.route('https://auth.privy.io/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/embedded-wallets')) return route.fulfill({contentType:'text/html',body:`<!doctype html><script>addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.event==='privy:wallets:rpc')e.source.postMessage(JSON.stringify({fixtureCapture:m}),e.origin); const data=m.event==='privy:wallets:rpc'?{response:{data:'${SIGNED_FIXTURE}'}}:m.event==='privy:user-signer:sign'?{signature:'${Buffer.alloc(64,7).toString('base64')}'}:{};e.source.postMessage(JSON.stringify({id:m.id,event:m.event,data}),e.origin);});</script>`});
        if (path.includes('/custom') || path.endsWith('/sessions')) return route.fulfill({json:session});
        if (path.endsWith('/rpc')) { const input = route.request().postDataJSON(); signatures.push(input); return route.fulfill({json:{method:'eth_signTransaction',data:{signed_transaction:SIGNED_FIXTURE}}}); }
        if (route.request().method() === 'GET' && path.includes('/apps/')) return route.fulfill({json:{id:app,embedded_wallet_config:{mode:mode === 'on-device' ? 'user-controlled' : 'user-controlled-server-wallets-only'}}});
        if (path.includes('analytics')) return route.fulfill({json:{}});
        unexpected.push(path); return route.fulfill({status:400,json:{error:'unexpected fixture request'}});
      });
      const rpc = route => {
        const input = route.request().postDataJSON();
        const one = body => {
          rpcCalls.push({origin:new URL(route.request().url()).origin,...body});
          if(body.method === 'eth_fillTransaction') return {jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}};
          const approvalSent = rpcCalls.filter(c=>c.method==='eth_sendRawTransaction').length > 0;
          const values = {eth_chainId:profile.wallet_chain_id_hex,eth_getBalance:'0xde0b6b3a7640000',eth_getTransactionCount:'0x0',eth_gasPrice:'0x3b9aca00',eth_getBlockByNumber:{number:'0x1',hash:HASH,timestamp:'0x1',baseFeePerGas:feeModel === 'legacy' ? null : '0x1',gasLimit:'0x1c9c380',gasUsed:'0x0',transactions:[]},eth_sendRawTransaction:HASH,eth_estimateGas:'0x7530',eth_call:'0x'+(approvalSent?(10n**BigInt(profile.accounting_asset.decimals)).toString(16):'0').padStart(64,'0'),eth_getTransactionReceipt:{transactionHash:HASH,to:profile.accounting_asset.address,from:ADDRESS,status:'0x1',blockHash:HASH}};
          if (!(body.method in values)) unexpected.push(body.method);
          return {jsonrpc:'2.0',id:body.id,result:values[body.method] ?? null};
        };
        return route.fulfill({json:Array.isArray(input) ? input.map(one) : one(input)});
      };
      await page.route('https://*.rpc.privy.systems/**', rpc);
      await page.route('https://rpc.mainnet.chain.robinhood.com/**', rpc);
      await page.goto('/terminal/');
      const prepared = preparedSdkBuy(profile,{feeModel});
      const result = await page.evaluate(async ({app,address,chainId,chain,prepared,profile,feeModel}) => {
        localStorage.clear();
        const {createRavenPrivyWalletClient} = await import('/ravenos-privy-wallet.js');
        const client = createRavenPrivyWalletClient({appId:app,clientId:'evm-fixture'});
        await client.sync('fixture.raven.signature');
        const {evm} = await client.providers({ecosystem:'evm'});
        await evm.request({method:'wallet_switchEthereumChain',params:[{chainId}]});
        const currentChain = await evm.request({method:'eth_chainId'});
        const balance = await evm.request({method:'eth_getBalance',params:[address,'latest']});
        await import('/ravenos-wallet-execution.js');
        if(feeModel==='legacy') {
          const amount=(10n**BigInt(profile.accounting_asset.decimals)).toString();
          await window.RavenOSWalletExecution.approveEvmTradeToken({profile:chain,provider:evm,address,expectedToken:profile.accounting_asset.address,expectedAmount:amount,approval:{schema_version:'ravenos.exact_token_approval.v1',unlimited:false,profile_id:profile.profile_id,chain_id:profile.chain_id,wallet_address:address,token_address:profile.accounting_asset.address,spender:profile.allowance_holder,amount_base_units:amount,expires_at:prepared.ticket.expires_at}});
        }
        const sent = await window.RavenOSWalletExecution.executeEvmZeroXTicket({profile:chain,ticket:prepared.ticket,quote:prepared.quote,provider:evm,address});
        const transactionHash = sent.transaction_hash;
        return {currentChain,balance,transactionHash,globalBuffer:typeof window.Buffer};
      }, {app,address:ADDRESS,chainId:profile.wallet_chain_id_hex,chain,prepared,profile,feeModel});
      expect(result).toEqual({currentChain:profile.wallet_chain_id_hex,balance:'0xde0b6b3a7640000',transactionHash:HASH,globalBuffer:'undefined'});
      expect(unexpected).toEqual([]);
      expect(rpcCalls.filter(r => r.method === 'eth_sendRawTransaction')).toHaveLength(feeModel==='legacy'?2:1);
      expect(rpcCalls.find(r => r.method === 'eth_sendRawTransaction').params).toEqual([SIGNED_FIXTURE]);
      if (mode === 'user-controlled-server') {
        const tx = signatures.at(-1).params.transaction;
        expect(Number(tx.chain_id)).toBe(profile.chain_id);
        expect(Number(tx.type)).toBe(feeModel === 'legacy' ? 0 : 2);
        if (feeModel === 'legacy') expect(BigInt(tx.gas_price)).toBe(1000000000n);
        else { expect(BigInt(tx.max_fee_per_gas)).toBe(2000000000n); expect(BigInt(tx.max_priority_fee_per_gas)).toBe(1000000000n); }
      } else {
        expect(deviceSignatures).toHaveLength(feeModel==='legacy'?2:1);
      }
    });
  }
}
