import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountSessionReader, readAccountSession, subscribeAccountSession, invalidateAccountSession } from '../ravenos-account-session.js';

const signedIn = () => Response.json({ ok: true, authenticated: true, csrf_token: 'fixture_csrf', account: { username: 'fixture' } });
test('concurrent surfaces share one retry, honor Retry-After, and recover without signing out',async()=>{
  let requests=0,release; const waiting=new Promise(r=>{release=r;}); const notices=[],delays=[];
  const reader=createAccountSessionReader({fetchImpl:async(url,init)=>{
    assert.equal(url,'/api/v1/auth/session');assert.equal(init.method,undefined);assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');
    return ++requests===1?Response.json({authenticated:false,error:'account_service_unavailable'},{status:503,headers:{'retry-after':'30'}}):signedIn();
  },now:()=>1000,wait:async ms=>{delays.push(ms);await waiting;}});
  const first=reader.read({onRetry:n=>notices.push(n)}),second=reader.read();
  await new Promise(r=>setImmediate(r));assert.equal(requests,1);assert.deepEqual(delays,[30000]);assert.deepEqual(notices,[{retryAt:31000}]);
  release();const results=await Promise.all([first,second]);assert.equal(requests,2);assert.ok(results.every(r=>r.state==='authenticated'));
});
test('finished account reads are not cached as authentication authority',async()=>{
  let requests=0;const reader=createAccountSessionReader({fetchImpl:async()=>++requests===1?signedIn():Response.json({ok:true,authenticated:false})});
  assert.equal((await reader.read()).state,'authenticated');assert.equal((await reader.read()).state,'signed_out');assert.equal(requests,2);
});
for(const kind of ['service','network','malformed','missing_csrf','invalid_signed_out'])test(`${kind} failure stops after two attempts and never becomes signed out`,async()=>{
  let requests=0;const reader=createAccountSessionReader({wait:async()=>{},fetchImpl:async()=>{
    requests++;if(kind==='network')throw new Error('private network details');
    if(kind==='malformed')return new Response('<html>temporary failure</html>');
    return kind==='service'?Response.json({authenticated:false},{status:503}):kind==='invalid_signed_out'?Response.json({ok:false,authenticated:false}):Response.json({ok:true,authenticated:true});
  }});
  const result=await reader.read();assert.equal(requests,2);assert.equal(result.state,'unavailable');assert.equal(result.payload,null);
  assert.deepEqual(Object.keys(result.diagnostic).sort(),['attempts','http_status','reason','retry_after_ms']);
  assert.equal(result.diagnostic.attempts,2);
  assert.equal(result.diagnostic.reason,kind==='network'?'network_error':kind==='service'?'service_error':'invalid_response');
  assert.doesNotMatch(JSON.stringify(result.diagnostic),/private|network details|html|csrf_token/);
});
for(const status of [200,401])test(`explicit ${status} authentication failure remains signed out without a retry`,async()=>{
  let requests=0;const reader=createAccountSessionReader({fetchImpl:async()=>{requests++;return Response.json(status===200?{ok:true,authenticated:false}:{error:'authentication_required'},{status});},wait:()=>assert.fail('Must not retry')});
  assert.equal((await reader.read()).state,'signed_out');assert.equal(requests,1);
});
test('long backoff is respected without an unbounded pending page',async()=>{
  let requests=0;const reader=createAccountSessionReader({fetchImpl:async()=>{requests++;return Response.json({error:'limited'},{status:429,headers:{'retry-after':'120'}});},wait:()=>assert.fail('Must not wait beyond the bounded retry')});
  assert.equal((await reader.read()).state,'unavailable');assert.equal(requests,1);
});
test('HTTP-date backoff is honored',async()=>{
  const at=Date.parse('2026-09-10T08:00:00Z'),delays=[];let requests=0;
  const reader=createAccountSessionReader({now:()=>at,wait:async ms=>{delays.push(ms);},fetchImpl:async()=>++requests===1?Response.json({error:'limited'},{status:429,headers:{'retry-after':new Date(at+10000).toUTCString()}}):signedIn()});
  assert.equal((await reader.read()).state,'authenticated');assert.deepEqual(delays,[10000]);
});
test('canceling one surface does not cancel another surface’s account check',async()=>{
  let release;const waiting=new Promise(r=>{release=r;}),controller=new AbortController();
  const reader=createAccountSessionReader({fetchImpl:async()=>{await waiting;return signedIn();}});
  const canceled=reader.read({signal:controller.signal}),kept=reader.read();controller.abort();await assert.rejects(canceled,{name:'AbortError'});
  release();assert.equal((await kept).state,'authenticated');
});
test('sign-out invalidation defeats a late authenticated response',async()=>{
  let release;const waiting=new Promise(r=>{release=r;});let requests=0;
  const reader=createAccountSessionReader({fetchImpl:async()=>{requests++;if(requests===1){await waiting;return signedIn();}return Response.json({ok:true,authenticated:false});}});
  const old=reader.read();reader.invalidate();const fresh=reader.read();release();
  await assert.rejects(old,{name:'AbortError'});assert.equal((await fresh).state,'signed_out');
});
test('a cancellation during synchronous fetch setup cannot leave a consumer unresolved',async()=>{
  const controller=new AbortController(),reader=createAccountSessionReader({fetchImpl:()=>{controller.abort();return Promise.resolve(signedIn());}});
  await assert.rejects(reader.read({signal:controller.signal}),{name:'AbortError'});
});
test('an already canceled request performs no account read',async()=>{
  const controller=new AbortController();controller.abort();const reader=createAccountSessionReader({fetchImpl:()=>assert.fail('Canceled read')});
  await assert.rejects(reader.read({signal:controller.signal}),{name:'AbortError'});
});

test('one shared result notifies presentation once, while later reads still check the server',async()=>{
  let requests=0;const results=[];
  const reader=createAccountSessionReader({fetchImpl:async()=>{requests++;return signedIn();},onResult:r=>results.push(r.state)});
  await Promise.all([reader.read(),reader.read()]);assert.equal(requests,1);assert.deepEqual(results,['authenticated']);
  await reader.read();assert.equal(requests,2);assert.deepEqual(results,['authenticated','authenticated']);
});
test('a failing presentation listener cannot break account recovery',async()=>{
  const reader=createAccountSessionReader({fetchImpl:async()=>signedIn(),onResult:()=>{throw new Error('broken presentation');}});
  assert.equal((await reader.read()).state,'authenticated');
});
test('sign-out invalidation suppresses presentation of the abandoned authenticated response',async()=>{
  let release;const waiting=new Promise(r=>{release=r;}),results=[];
  const reader=createAccountSessionReader({fetchImpl:async()=>{await waiting;return signedIn();},onResult:r=>results.push(r.state)});
  const pending=reader.read();reader.invalidate();release();await assert.rejects(pending,{name:'AbortError'});
  assert.deepEqual(results,[]);
});
test('subscribers receive no credentials, can unsubscribe, and never replay a cached account',async()=>{
  const originalFetch=globalThis.fetch,results=[];let requests=0;
  const unsubscribe=subscribeAccountSession(result=>results.push(result));
  try {
    globalThis.fetch=async()=>++requests===1?signedIn():Response.json({ok:true,authenticated:false});
    await readAccountSession();
    assert.deepEqual(results,[{state:'authenticated',username:'fixture'}]);
    const late=[];const stopLate=subscribeAccountSession(result=>late.push(result));assert.deepEqual(late,[]);
    await readAccountSession();assert.equal(requests,2);assert.deepEqual(late,[{state:'signed_out',username:''}]);
    stopLate();unsubscribe();await readAccountSession();assert.equal(results.length,2);assert.equal(late.length,1);
  } finally { unsubscribe();invalidateAccountSession();globalThis.fetch=originalFetch; }
});

test('unavailable diagnostics render as bounded JSON without the response or credentials',async()=>{
  const originalFetch=globalThis.fetch,originalWarn=console.warn,logs=[];
  try {
    globalThis.fetch=async()=>Response.json({ok:false,secret:'private response detail'},{status:503,headers:{'retry-after':'120'}});
    console.warn=(...args)=>logs.push(args);
    assert.equal((await readAccountSession()).state,'unavailable');
    assert.equal(logs.length,1);assert.equal(logs[0][0],'ravenos.account_check_unavailable');
    assert.equal(typeof logs[0][1],'string');
    assert.deepEqual(JSON.parse(logs[0][1]),{reason:'service_error',attempts:1,http_status:503,retry_after_ms:120000});
    assert.doesNotMatch(logs[0][1],/secret|private|csrf|token/);
  } finally { invalidateAccountSession();globalThis.fetch=originalFetch;console.warn=originalWarn; }
});
