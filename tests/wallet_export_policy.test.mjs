import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedExportWallet } from '../client/wallet-export-policy.mjs';
const evm={ecosystem:'evm',address:'0x1234567890123456789012345678901234567890'};
const sol={ecosystem:'solana',address:'So11111111111111111111111111111111111111112'};
const user={linkedAccounts:[{type:'wallet',chainType:'ethereum',walletClientType:'privy',address:evm.address},{type:'wallet',chainType:'solana',walletClientType:'privy-v2',address:sol.address}]};
for(const wallet of [evm,sol])test(`secure export accepts only the owned embedded ${wallet.ecosystem} wallet`,()=>{
 assert.equal(verifiedExportWallet(user,wallet),true);
 assert.equal(verifiedExportWallet({linkedAccounts:[]},wallet),false);
 assert.equal(verifiedExportWallet({linkedAccounts:user.linkedAccounts.map(a=>({...a,walletClientType:'metamask'}))},wallet),false);
 assert.equal(verifiedExportWallet(user,{...wallet,address:wallet.address.replace(/.$/,'9')}),false);
 assert.equal(verifiedExportWallet(user,{...wallet,ecosystem:wallet.ecosystem==='evm'?'solana':'evm'}),false);
});
test('unknown wallet ecosystem, malformed address and missing identity never permit export',()=>{
 assert.equal(verifiedExportWallet(user,{ecosystem:'zec',address:sol.address}),false);
 assert.equal(verifiedExportWallet(user,{ecosystem:'evm',address:'not-an-address'}),false);
 assert.equal(verifiedExportWallet(null,evm),false);
});
