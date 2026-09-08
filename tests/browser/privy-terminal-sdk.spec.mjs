import {test,expect} from '@playwright/test';
import {mockTerminalLiveApis} from './terminal-live-fixtures.mjs';

// Keep the installed Privy SDK, secure-frame handshake and shipped CSP intact.
// Only the external service and fixture signature are simulated; no funds move.
for(const mode of ['on-device','user-controlled-server'])test(`Terminal's real SDK opens and signs a fixture Solana transaction (${mode})`,async({page})=>{
  const app='cmfirstusefixture123456',address='Stake11111111111111111111111111111111111111';
  const token=[Buffer.from('{"alg":"ES256"}').toString('base64url'),Buffer.from(JSON.stringify({sub:'did:privy:terminal-fixture',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture'].join('.');
  const signature=Buffer.alloc(64,7).toString('base64');const calls=[];
  const account={type:'wallet',chain_type:'solana',wallet_client_type:'privy',connector_type:'embedded',address,wallet_index:0,recovery_method:mode==='on-device'?'privy':'privy-v2',...(mode==='on-device'?{}:{id:'fixture-solana-wallet'})};
  const session={user:{id:'did:privy:terminal-fixture',linked_accounts:[account]},token,identity_token:token,refresh_token:token,session_update_action:'set'};
  await mockTerminalLiveApis(page);
  await page.route('https://auth.privy.io/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;calls.push(path);
    if(path.endsWith('/embedded-wallets'))return route.fulfill({contentType:'text/html',body:`<!doctype html><script>addEventListener('message',e=>{const m=JSON.parse(e.data);const data=m.event==='privy:wallets:rpc'?{response:{data:{signature:'${signature}'}}}:m.event==='privy:user-signer:sign'?{signature:'${signature}'}:{};e.source.postMessage(JSON.stringify({id:m.id,event:m.event,data}),e.origin);});</script>`});
    if(path.includes('/custom')||path.endsWith('/sessions'))return route.fulfill({json:session});
    if(path.endsWith('/rpc'))return route.fulfill({json:{method:'signMessage',data:{signature}}});
    if(request.method()==='GET'&&path.includes('/apps/'))return route.fulfill({json:{id:app,embedded_wallet_config:{mode:mode==='on-device'?'user-controlled':'user-controlled-server-wallets-only'}}});
    if(path.includes('analytics'))return route.fulfill({json:{}});
    return route.fulfill({status:400,json:{error:'unexpected fixture request'}});
  });
  const response=await page.goto('/terminal/');
  expect(response.headers()['content-security-policy']).toMatch(/frame-src[^;]*https:\/\/auth\.privy\.io/);
  expect(response.headers()['content-security-policy']).toMatch(/connect-src[^;]*https:\/\/auth\.privy\.io/);
  const result=await page.evaluate(async({app,address})=>{
    localStorage.clear();
    const {createRavenPrivyWalletClient}=await import('/ravenos-privy-wallet.js');
    const client=createRavenPrivyWalletClient({appId:app,clientId:'terminal-fixture'});
    await client.sync('fixture.raven.signature');
    const {solana}=await client.providers({ecosystem:'solana'});
    const received=[];const publicKey={toBase58:()=>address};
    const tx={version:0,message:{staticAccountKeys:[publicKey],serialize:()=>new Uint8Array([1,2,3])},addSignature:(key,bytes)=>received.push({address:key.toBase58(),length:bytes.length,first:bytes[0]})};
    const signed=await solana.signTransaction(tx);
    return {connected:String((await solana.connect()).publicKey),sameTransaction:signed===tx,received,globalBuffer:typeof window.Buffer};
  },{app,address});
  expect(result).toEqual({connected:address,sameTransaction:true,received:[{address,length:64,first:7}],globalBuffer:'undefined'});
  expect(calls.some(p=>p.endsWith('/embedded-wallets'))).toBe(true);
  expect(calls.some(p=>/sendTransaction|broadcast/.test(p))).toBe(false);
});
