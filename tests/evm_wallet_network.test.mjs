import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureEvmWalletNetwork} from '../client/evm-wallet-network.js';
import {evmWalletAddNetworkParameters} from '../lib/customer_trade/evm_wallet_networks.mjs';
const wallet = '0x3333333333333333333333333333333333333333';

function provider({chain='0x1',switchError=null,addedError=null,changeAccount=false,ignoreSwitch=false}={}) {
  const calls=[]; let added=false, switched=false;
  return {calls,request:async input=>{
    calls.push(input);
    if(input.method==='eth_accounts') return [changeAccount&&switched?'0x4444444444444444444444444444444444444444':wallet];
    if(input.method==='eth_chainId') return chain;
    if(input.method==='wallet_switchEthereumChain') {
      if(switchError&&!added)throw switchError;
      if(!ignoreSwitch)chain=input.params[0].chainId; switched=true;return null;
    }
    if(input.method==='wallet_addEthereumChain') {if(addedError)throw addedError;added=true;return null;}
    throw Error('Network setup must not sign or send: '+input.method);
  }};
}

for(const chain of ['robinhood','base','bsc','ethereum'])test(`network setup verifies exact ${chain} account and chain`,async()=>{
  const p=provider();const expected=evmWalletAddNetworkParameters(chain);
  const result=await ensureEvmWalletNetwork({profile:chain,provider:p,address:wallet});
  assert.equal(result.chain_id,parseInt(expected.chainId,16));
  assert.equal(result.wallet_address,wallet);
  assert.equal(p.calls.some(c=>c.method==='wallet_addEthereumChain'),false);
});

test('external wallet adds only the configured Robinhood network after 4902',async()=>{
  const p=provider({switchError:{code:4902}});
  await ensureEvmWalletNetwork({profile:'robinhood',provider:p,address:wallet});
  assert.deepEqual(p.calls.find(c=>c.method==='wallet_addEthereumChain').params,[{
    chainId:'0x1237',chainName:'Robinhood Chain',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},
    rpcUrls:['https://rpc.mainnet.chain.robinhood.com'],blockExplorerUrls:['https://robinhoodchain.blockscout.com'],
  }]);
  assert.equal(p.calls.filter(c=>c.method==='wallet_switchEthereumChain').length,2);
});
for(const code of [4001,4901,-32603])test(`network error ${code} never triggers add-network`,async()=>{
  const p=provider({switchError:{code}});
  await assert.rejects(ensureEvmWalletNetwork({profile:'base',provider:p,address:wallet}),code===4001?/user_rejected_request/:/evm_chain_switch_failed/);
  assert.equal(p.calls.some(c=>c.method==='wallet_addEthereumChain'),false);
});
test('account changes during network selection cancel the handoff',async()=>{
  await assert.rejects(ensureEvmWalletNetwork({profile:'base',provider:provider({changeAccount:true}),address:wallet}),/wallet_account_identity_mismatch/);
});
test('a wallet reporting a successful switch on the wrong chain is rejected',async()=>{
  await assert.rejects(ensureEvmWalletNetwork({profile:'base',provider:provider({ignoreSwitch:true}),address:wallet}),/evm_chain_identity_mismatch/);
});
test('changing the trading intent during add-network prevents continuing',async()=>{
  const p=provider({switchError:{code:4902}});
  await assert.rejects(ensureEvmWalletNetwork({profile:'base',provider:p,address:wallet,assertCurrent:()=>{
    if(p.calls.some(c=>c.method==='wallet_addEthereumChain'))throw Object.assign(Error('spot_trade_changed'),{code:'spot_trade_changed'});
  }}),/spot_trade_changed/);
  assert.equal(p.calls.filter(c=>c.method==='wallet_switchEthereumChain').length,1);
});
test('unsupported chains are rejected before touching a wallet',async()=>{
  const p=provider();await assert.rejects(ensureEvmWalletNetwork({profile:'unsupported',provider:p,address:wallet}),/evm_chain_profile_not_supported/);assert.equal(p.calls.length,0);
});
