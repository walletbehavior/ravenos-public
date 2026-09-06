import test from "node:test";
import assert from "node:assert/strict";
import { earn, USER, OTHER, NOW } from "./customer_rewards_ledger.test.mjs";
import { routeCustomerProduct } from "../lib/customer_product_routes.mjs";

const request=(path,body)=>new Request(`https://app.ravenos.xyz/api/v1/pro${path}`,body===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
function dependencies(user=USER) {
  return {
    authorizeRequest:async(_request,_env,_deps,options)=>{
      assert.equal(options.require_csrf,_request.method!=="GET");
      return {principal:{user_id:user,session_public_id:"fixture_session",authenticated_at:NOW},now:NOW,response_headers:new Headers()};
    },
    rateLimit:async()=>({allowed:true}),
  };
}
test("product policy remains available without authentication or rewards database",async()=>{
 const response=await routeCustomerProduct(request("/product"),{});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.policy.pro_execution_fee_bps,100);
 assert.equal(body.policy.trial_card_required,false);
 assert.equal(body.flags.claims,false);
});
test("account rewards are scoped to the authenticated account and never expose treasury addresses",async()=>{
 const f=await earn();
 const owner=await (await routeCustomerProduct(request(""),f.env,dependencies())).json();
 const other=await (await routeCustomerProduct(request(""),f.env,dependencies(OTHER))).json();
 assert.equal(owner.rewards.available_micros,"3000000");
 assert.equal(other.rewards.available_micros,"0");
 assert.deepEqual(other.rewards.history,[]);
 assert.equal(JSON.stringify(owner).includes("treasury_wallet"),false);
});
test("unauthenticated mutations stop before ledger or billing work",async()=>{
 const f=await earn();
 const response=await routeCustomerProduct(request("/rewards/claim",{}),f.env,{authorizeRequest:async()=>({response:new Response(null,{status:401})})});
 assert.equal(response.status,401);
 assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_reward_operations").get().n,0);
});
test("client-selected reward owner is rejected even on an authenticated request",async()=>{
 const f=await earn();
 const response=await routeCustomerProduct(request("/rewards/preference",{user_id:OTHER,auto_apply:false}),f.env,dependencies());
 assert.equal(response.status,400);
 assert.equal((await response.json()).error,"product_request_invalid");
});
test("enabling auto-apply requires legal assent while opting out never blocks on it",async()=>{
 const f=await earn();let legalCalls=0;
 const deps={...dependencies(),requireLegal:async()=>{legalCalls++;return {allowed:false,response:new Response(null,{status:428})};}};
 assert.equal((await routeCustomerProduct(request("/rewards/preference",{auto_apply:true}),f.env,deps)).status,428);
 assert.equal((await routeCustomerProduct(request("/rewards/preference",{auto_apply:false}),f.env,deps)).status,200);
 assert.equal(legalCalls,1);
});
test("ordinary accounts cannot read internal finance reporting",async()=>{
 const f=await earn();
 assert.equal((await routeCustomerProduct(request("/operations/report"),f.env,dependencies())).status,403);
});
test("unsigned and oversized streaming webhooks cannot reach billing reconciliation",async()=>{
 const env={RAVENOS_PRO_ACCOUNT_BILLING_ENABLED:"1"};
 assert.equal((await routeCustomerProduct(request("/stripe/webhook",{id:"evt_forged"}),env)).status,400);
 let cancelled=false;
 const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;}});
 const input=new Request("https://app.ravenos.xyz/api/v1/pro/stripe/webhook",{method:"POST",body:stream,duplex:"half"});
 assert.equal((await routeCustomerProduct(input,env)).status,413);
 assert.equal(cancelled,true);
});
