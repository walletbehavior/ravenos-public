import { defaultTradingSettings, normalizeTradingSettings } from '../../ravenos-trading-strategy.js';
export async function mockTradingSettings(page,{initial=defaultTradingSettings(),revision=0}={}) {
  const state={settings:structuredClone(initial),revision,writes:[],signedIn:true};
  await page.route('**/api/v1/auth/session',route=>route.fulfill({json:state.signedIn?{ok:true,authenticated:true,csrf_token:'csrf_settings_fixture',account:{username:'settings_user',email:'settings@example.test'}}:{ok:true,authenticated:false}}));
  await page.route('**/api/v1/trading-settings',async route=>{
    if (!state.signedIn) return route.fulfill({status:401,json:{ok:false,error:'authentication_required'}});
    if (route.request().method()==='PUT') {
      const body=route.request().postDataJSON();state.writes.push(body);
      if (route.request().headers()['x-ravenos-csrf']!=='csrf_settings_fixture') return route.fulfill({status:403,json:{ok:false}});
      if (body.expected_revision!==state.revision) return route.fulfill({status:409,json:{ok:false,error:'trading_settings_revision_conflict'}});
      try {state.settings=normalizeTradingSettings(body.settings);state.revision++;}catch(error){return route.fulfill({status:400,json:{ok:false,error:error.message}});}
    }
    return route.fulfill({json:{ok:true,revision:state.revision,settings:state.settings,updated_at:new Date().toISOString(),order_activation:false}});
  });
  return state;
}
