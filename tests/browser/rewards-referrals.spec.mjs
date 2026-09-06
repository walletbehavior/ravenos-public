import {expect,test} from "@playwright/test";
async function mockAccount(page,baseURL,{enrolled=true}={}) {
 await page.route("**/api/v1/auth/config",route=>route.fulfill({json:{ok:true,available:true,state:"available",canonical_origin:baseURL,current_origin:baseURL,on_authenticated_origin:true,methods:{google:true,email:true},account_model:{principal:"ravenos_account",wallet_connection_is_sign_in:false}}}));
 await page.route("**/api/v1/auth/session",route=>route.fulfill({json:{ok:true,authenticated:true,account:{username:"northstar",username_required:false,member_since:"2026-09-06T00:00:00Z"},session:{session_public_id:"session_fixture",current:true},csrf_token:"csrf_fixture",wallet_links:[]}}));
 await page.route("**/api/v1/sessions",route=>route.fulfill({json:{ok:true,sessions:[],csrf_token:"csrf_fixture"}}));
 const now=Math.floor(Date.now()/1000);
 const policy={standard_execution_fee_bps:100,pro_execution_fee_bps:100,pro_cashback_percent:30,pro_monthly_price_usd:149,trial_days:30};
 const flags={billing:true,trials:true,cashback:true,subscription_credit:true,auto_apply:true,claims:false};
 const rewards={available_micros:"83420000",pending_micros:"4180000",reserved_micros:"0",earned_micros:"83420000",claimed_micros:"0",applied_micros:"0",adjustment_micros:"0",auto_apply:false,networks:[],wallets:[],claims_ready:false,history:[{status:"AVAILABLE",amount_micros:"83420000",created_at:now}],unvalued_fee_count:0};
 await page.route("**/api/v1/pro",route=>route.fulfill({json:{ok:true,policy,flags,access:{state:"PRO_TRIAL_ACTIVE",pro:true,trial:{trial_ends_at:now+12*86400,days_remaining:12}},rewards,invoices:[]}}));
 const referral={state:enrolled?"active":"not_enrolled",referral_code:enrolled?"RVN23456789ABCD":null,referral_url:enrolled?"https://ravenos.xyz/r/northstar":null,policy:{commission_percent:25,commission_months:12,attribution_days:60,flags:{referrals:true,enrollment:true,commissions:true,public_profile_cta:true}},disclosure:"I earn a commission if you subscribe to Raven Pro through my referral link.",enrollment:{public_profile_cta:0},balance:{pending_cents:"22350",available_cents:"145275",earned_cents:"819425",recoverable_cents:"0"},metrics:{clicks:1842,accounts_created:164,paid_conversions:47,active_trials:71,active_referred_pro:39},events:[],payout_state:"manual_review"};
 await page.route("**/api/v1/referrals/me",route=>route.fulfill({json:{ok:true,referral}}));
 return {policy,flags,rewards,referral};
}
for(const width of [390,1440])test(`rewards and referral balances remain readable at ${width}px`,async({page,baseURL})=>{
 await page.setViewportSize({width,height:900});await mockAccount(page,baseURL);await page.goto("/account/");
 await expect(page.locator("#accountRewardsAvailable")).toHaveText("83.42 USDC");await expect(page.locator("#accountRewardsPending")).toHaveText("4.18 USDC");await expect(page.locator("#accountTrialStatus")).toContainText("will not be charged automatically");
 await expect(page.locator("#accountAffiliateAvailable")).toHaveText("$1,452.75");await expect(page.locator("#accountAffiliateDisclosureText")).toContainText("I earn a commission");
 const share=new URL(await page.locator("#accountAffiliateShareX").getAttribute("href"));expect(share.searchParams.get("text")).toContain("I earn a commission");
 await expect(page.locator("#accountClaimCashback")).toBeDisabled();
 await page.locator("#accountApplyCashback").click();await expect(page.locator("#accountRewardCreditPreview")).toContainText("$65.58");
 await page.locator("#accountRewardsAmount").fill("149.00");await expect(page.locator("#accountRewardCreditPreview")).toContainText("$0.00");
 const dimensions=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client+1);
});
test("affiliate enrollment requires explicit unchecked acceptance",async({page,baseURL})=>{
 await mockAccount(page,baseURL,{enrolled:false});let joins=0;await page.route("**/api/v1/referrals/join",route=>{joins++;return route.fulfill({status:503,json:{ok:false,error:"affiliate_enrollment_unavailable"}});});await page.goto("/account/");
 await expect(page.locator("#accountAffiliateAccept")).not.toBeChecked();await page.locator("#accountReferralCreate").click();expect(joins).toBe(0);await expect(page.locator("#accountReferralStatus")).toContainText("accept the Affiliate Terms");await page.locator("#accountAffiliateAccept").check();await page.locator("#accountReferralCreate").click();expect(joins).toBe(1);
});
test("referral welcome explains the normal no-card trial without extra days",async({page})=>{
 await page.route("**/api/v1/pro/product",route=>route.fulfill({json:{ok:true,flags:{trials:true},policy:{trial_days:30}}}));await page.route("**/api/v1/pro",route=>route.fulfill({status:401,json:{ok:false}}));await page.route("**/api/v1/referrals/landing",route=>route.fulfill({json:{ok:true,referral:{invited_by:"northstar",disclosure:"@northstar may earn a commission if you later subscribe to Raven Pro."}}}));
 await page.goto("/?invited=1");await expect(page.locator("#landingTrialTitle")).toContainText("Invited by @northstar");await expect(page.locator("#landingTrialCopy")).toContainText("30 days. No card required.");await expect(page.locator("#landingTrialCopy")).not.toContainText("extra");
});
