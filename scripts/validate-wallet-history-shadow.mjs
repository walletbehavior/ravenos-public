// Read-only provider proof. No execution SDK, signer or broadcast method.
// Supply existing RPC bindings through environment variables (never CLI keys).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadEvmWalletBackfillPage } from '../lib/customer_trade/evm_wallet_backfill.mjs';
import { createSourceWalletBackfillJob, publicSourceWalletBackfillJob } from '../lib/customer_trade/source_wallet_backfill.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(arg=>arg.replace(/^--/,'').split('=')));
const pages=Math.max(1,Math.min(8,Number(args.pages)||2));
if(!args.wallet||!args.chain||!args.out)throw Error('wallet_chain_out_required');
const env={...process.env,RAVENOS_EVM_WALLET_BACKFILL_ENABLED:'1',RAVENOS_EVM_WALLET_RECONSTRUCTION_ENABLED:'1',RAVENOS_ALCHEMY_WALLET_HISTORY_ENABLED:'1'};
if(args.chain==='robinhood'&&env.ALCHEMY_API_KEY&&!env.ALCHEMY_ROBINHOOD_RPC_URL)env.ALCHEMY_ROBINHOOD_RPC_URL=`https://robinhood-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
let job=createSourceWalletBackfillJob({chain:args.chain,address:args.wallet,provider:'alchemy_wallet_history'}),events=[],runs=[];
if(existsSync(args.out)){
  const saved=JSON.parse(readFileSync(args.out,'utf8'));
  if(saved.job?.source_wallet_id!==job.source_wallet_id)throw Error('shadow_checkpoint_identity_mismatch');
  ({job,events,runs}=saved);
}
for(let i=0;i<pages&&job.state!=='complete';i++){
  const started=Date.now();
  try{
    const page=await loadEvmWalletBackfillPage(env,job,{existingTransaction:async(id,ref,blockHash)=>{
      const event=events.find(e=>e.source_wallet_id===id&&e.chain_evidence.transaction_reference===ref);
      if(event&&event.chain_evidence.block_hash!==blockHash)throw Error('shadow_block_mismatch');
      return event||null;
    }});
    const byId=new Map(events.map(e=>[e.event_id,e]));for(const event of page.events)byId.set(event.event_id,event);events=[...byId.values()];
    job={...job,provider_cursor:page.cursor,state:page.exhausted?'complete':'queued',page_count:job.page_count+1,signatures_seen:job.signatures_seen+page.reference_count,transactions_decoded:events.length,history_exhausted:page.exhausted,updated_at:new Date().toISOString()};
    runs.push({observed_at:new Date().toISOString(),request_count:page.request_count,elapsed_ms:Date.now()-started,new_events:page.events.length,state:job.state});
    writeFileSync(args.out,JSON.stringify({schema_version:'ravenos.wallet_history_shadow_proof.v1',job,events,runs,signing:false,broadcasting:false},null,2),{mode:0o600});
    console.log(JSON.stringify({page:job.page_count,...runs.at(-1)}));
  }catch(error){const code=/^[a-z][a-z0-9_]{2,100}$/.test(error.code||'')?error.code:'shadow_provider_check_failed';console.log(JSON.stringify({state:'unavailable',code}));process.exitCode=1;break;}
}
console.log(JSON.stringify({history:publicSourceWalletBackfillJob(job),retained_events:events.length,classifications:events.reduce((counts,e)=>(counts[e.classification.kind]=(counts[e.classification.kind]||0)+1,counts),{})}));
