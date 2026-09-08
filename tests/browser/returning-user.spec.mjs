import { expect, test } from "@playwright/test";

const documents = [
  {document_type:"terms",title:"Terms of Service",canonical_path:"/terms/",version:"2026-09-07.release-1",content_hash:"a".repeat(64),status:"effective"},
  {document_type:"privacy",title:"Privacy Policy",canonical_path:"/privacy/",version:"2026-09-07.release-1",content_hash:"b".repeat(64),status:"effective"},
];
async function accountApis(page, baseURL, state) {
  await page.route("**/api/v1/auth/config", r=>r.fulfill({json:{ok:true,available:true,on_authenticated_origin:true,canonical_origin:baseURL,
    session_policy:{remember_device_available:true,remember_device_default:false,remembered_device_days:30},
    legal:{account_creation_acceptance_required:true,documents_endpoint:"/api/v1/legal/documents"}}}));
  await page.route("**/api/v1/legal/documents", r=>r.fulfill({json:{ok:true,acceptance_enforced:true,documents}}));
  await page.route("**/api/v1/auth/session", r=>r.fulfill({json: state.signedIn
    ? {ok:true,authenticated:true,account:{username:"returning_fixture",email:"fixture@example.test"},session:{session_public_id:"sespub_fixture",current:true},csrf_token:"csrf_fixture"}
    : {ok:true,authenticated:false}}));
  await page.route("**/api/v1/sessions", r=>r.fulfill({json:{ok:true,sessions:[]}}));
  await page.route("**/api/v1/wallets/privy/config",r=>r.fulfill({json:{ok:true,available:false}}));
  await page.route("**/api/v1/legal/status?**", r=>r.fulfill({json:{ok:true,
    capabilities:[{capability:"account_creation",satisfied:state.accepted,required_documents:documents.map(document=>({document,accepted:state.accepted}))}],
    acceptances:state.accepted ? documents.map(doc=>({document_type:doc.document_type,document_version:doc.version,content_hash:doc.content_hash,accepted_at:"2026-09-08T12:00:00Z"})) : []}}));
}

test("returning users see Sign in, retained receipts, and a separately unchecked remember-device choice",async({page,baseURL})=>{
  const state={signedIn:true,accepted:true};await accountApis(page,baseURL,state);
  const legalWrites=[]; page.on("request", r=>{if(r.method()==="POST" && r.url().includes("/legal/"))legalWrites.push(r.url());});
  await page.goto("/account/");await expect(page.locator("#accountDashboard")).toBeVisible();
  await page.getByText("Preferences & accepted terms",{exact:true}).click();
  await expect(page.locator("#accountLegalReceiptStatus")).toContainText("current account terms are accepted");
  await expect(page.locator("#accountLegalReceiptList li")).toHaveCount(2);
  await expect(page.locator("#accountLegalReceiptList a").first()).toHaveAttribute("href","/terms/");
  if(process.env.RAVENOS_VISUAL_ARTIFACT_DIR) await page.locator('#accountContinuity').screenshot({path:process.env.RAVENOS_VISUAL_ARTIFACT_DIR+'/accepted-terms-desktop.png'});
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("ravenos:display-preferences:v1")));
  expect(saved.values.returning).toBe(true);expect(JSON.stringify(saved)).not.toMatch(/csrf_fixture|fixture@example|sespub_fixture|content_hash/);
  state.signedIn=false;await page.reload();
  await expect(page.getByRole("tab",{name:"Sign in",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(page.locator("#accountLegalAssent")).toBeHidden();
  await expect(page.locator("#accountRememberDevice")).not.toBeChecked();
  await expect(page.locator("#accountRememberDeviceLabel")).toContainText("30 days");
  await page.getByRole("tab",{name:"Create account",exact:true}).click();
  await expect(page.locator("#accountLegalAssentCheckbox")).not.toBeChecked();
  expect(legalWrites).toEqual([]);
});

test("remember-device opt-in and Portfolio anchor are bound to the actual sign-in start",async({page,baseURL})=>{
  await accountApis(page,baseURL,{signedIn:false,accepted:false});let body;
  await page.route("**/api/v1/auth/start",async r=>{body=r.request().postDataJSON();await r.fulfill({json:{ok:true,authorization_url:"https://api.workos.com/user_management/authorize?state=fixture"}});});
  await page.route("https://api.workos.com/**",r=>r.fulfill({contentType:"text/html",body:"<title>Sign in</title>"}));
  await page.goto("/account/?intent=sign_in&return_to="+encodeURIComponent("/portfolio/?tab=capital#shielded-reserve"));
  await expect(page.locator("#accountRememberDevice")).not.toBeChecked();await page.locator("#accountRememberDevice").check();
  await page.getByRole("button",{name:/Continue with Google/}).click();await expect(page).toHaveURL(/api\.workos\.com/);
  expect(body).toEqual({intent:"sign_in",provider:"google",return_to:"/portfolio/?tab=capital#shielded-reserve",remember_device:true});
});

test("changed or unavailable terms never look accepted, and display reset never writes legal records",async({page,baseURL})=>{
  const state={signedIn:true,accepted:false};await accountApis(page,baseURL,state);
  const posts=[];page.on("request",r=>{if(r.method()==="POST" && r.url().includes("/legal/"))posts.push(r.url());});
  await page.goto("/account/");await page.getByText("Preferences & accepted terms",{exact:true}).click();
  await expect(page.locator("#accountLegalReceiptList")).toContainText("Not accepted");
  await page.getByRole("button",{name:"Reset display preferences"}).click();
  await expect(page.locator("#accountPreferenceStatus")).toContainText("session and accepted terms are unchanged");
  await expect(page.locator("#accountDashboard")).toBeVisible();expect(posts).toEqual([]);
  await page.route("**/api/v1/legal/status?**",r=>r.fulfill({status:503,json:{ok:false}}));await page.reload();
  await page.getByText("Preferences & accepted terms",{exact:true}).click();
  await expect(page.locator("#accountLegalReceiptStatus")).toContainText("temporarily unavailable");
  await expect(page.locator("#accountDashboard")).toBeVisible();
});

test("mobile login and account access still work when browser storage is denied",async({page,baseURL})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>Object.defineProperty(window,"localStorage",{get(){throw new DOMException("Blocked","SecurityError");}}));
  const state={signedIn:false,accepted:false};await accountApis(page,baseURL,state);
  await page.goto("/account/?intent=sign_in");
  await expect(page.getByRole("button",{name:/Continue with Google/})).toBeVisible();
  await expect(page.locator("#accountRememberDevice")).not.toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  if(process.env.RAVENOS_VISUAL_ARTIFACT_DIR) await page.locator('#accountAuthWorkspace').screenshot({path:process.env.RAVENOS_VISUAL_ARTIFACT_DIR+'/sign-in-mobile.png'});
  state.signedIn=true;await page.reload();await expect(page.locator("#accountDashboard")).toBeVisible();
});
