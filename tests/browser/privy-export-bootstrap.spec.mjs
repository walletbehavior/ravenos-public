import { expect, test } from '@playwright/test';

for (const ecosystem of ['evm','solana']) test(`the shipped Privy ${ecosystem} export SDK authenticates under production CSP without creating or exporting a wallet`, async ({page}) => {
  const address=ecosystem==='evm'?'0x1111111111111111111111111111111111111111':'Stake11111111111111111111111111111111111111';
  const userId='did:privy:export-fixture';
  const token=[Buffer.from('{"alg":"ES256"}').toString('base64url'),Buffer.from(JSON.stringify({sub:userId,aud:'cmtna91zp004m0cjss6lill1d',iss:'privy.io',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture'].join('.');
  const calls=[], errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.addInitScript(()=>{globalThis.__CSP_ERRORS__=[];document.addEventListener('securitypolicyviolation',e=>globalThis.__CSP_ERRORS__.push({directive:e.violatedDirective,blocked:e.blockedURI}));});
  await page.route('https://auth.privy.io/**',route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    calls.push({method:req.method(),path});
    if(path.endsWith('/embedded-wallets')) return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Isolated test wallet frame</title><script>addEventListener('message',event=>{if(event.data?.event==='privy:iframe:ready')event.source.postMessage({event:event.data.event,id:event.data.id,data:{}},event.origin);});</script>`});
    if(path.includes('/custom')||path.endsWith('/sessions'))return route.fulfill({json:{is_new_user:false,user:{id:userId,created_at:1788770000,mfa_methods:[],linked_accounts:[{type:'wallet',chain_type:ecosystem==='evm'?'ethereum':'solana',wallet_client_type:'privy',connector_type:'embedded',address,wallet_index:0,id:'wallet-export-fixture'}]},token,identity_token:token,refresh_token:token,session_update_action:'set'}});
    if(req.method()==='GET'&&path.includes('/apps/'))return route.fulfill({json:{id:'cmtna91zp004m0cjss6lill1d',name:'Raven export fixture',allowlist_config:{},embedded_wallet_config:{mode:'user-controlled-server-wallets-only',ethereum:{create_on_login:'off'},solana:{create_on_login:'off'}},custom_jwt_auth:true}});
    if(path.includes('analytics'))return route.fulfill({json:{}});
    return route.fulfill({status:401,json:{error:'Unexpected fixture endpoint'}});
  });
  const response=await page.goto('/account/');
  expect(response.headers()['content-security-policy']).toMatch(/style-src 'self' 'nonce-/);
  await page.evaluate(async ({address,ecosystem})=>{
    localStorage.clear();
    const {openSecureWalletExport}=await import('/ravenos-privy-export.js');
    openSecureWalletExport({appId:'cmtna91zp004m0cjss6lill1d',clientId:'first-use-fixture',wallet:{ecosystem,address},getExternalJwt:async()=>'fixture.raven.signature'});
  },{address,ecosystem});
  await expect(page.getByRole('dialog')).toContainText('Your selected wallet is verified.');
  const styles=await page.locator('style[data-styled]').evaluateAll(els=>els.map(el=>({nonce:el.nonce,rules:el.sheet?.cssRules.length||0})));
  expect(styles.length).toBeGreaterThan(0);
  expect(styles.every(style=>/^[a-f0-9]{32}$/.test(style.nonce))).toBe(true);
  expect(styles.some(style=>style.rules>0)).toBe(true);
  expect(await page.evaluate(()=>globalThis.__CSP_ERRORS__)).toEqual([]);
  expect(errors).toEqual([]);
  expect(calls.filter(call=>call.path.includes('/custom'))).toHaveLength(1);
  expect(calls.some(call=>/wallets\/(?:create|init|export)|\/rpc$/.test(call.path))).toBe(false);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
