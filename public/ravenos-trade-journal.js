import { readAccountSession } from './ravenos-account-session.js';

const labels={pending_receipt:'Checking receipt',confirmed:'Confirmed',finalized:'Finalized',failed:'Failed',rejected:'Rejected',venue_confirmed:'Venue confirmed'};
const chains={solana:'Solana',base:'Base',ethereum:'Ethereum',bsc:'BNB',robinhood:'Robinhood',hyperliquid:'Perps'};
const explorers={solana:'https://solscan.io/tx/',base:'https://basescan.org/tx/',ethereum:'https://etherscan.io/tx/',bsc:'https://bscscan.com/tx/',robinhood:'https://robinhoodchain.blockscout.com/tx/'};
const compact=value=>String(value||'').length>18?String(value).slice(0,7)+'…'+String(value).slice(-5):String(value||'');
const group=value=>value.replace(/\B(?=(\d{3})+(?!\d))/g,',');
export function journalAmount(value) {
  const amount=value?.amount_base_units;
  if(typeof amount!=='string'||! /^-?(0|[1-9][0-9]{0,77})$/.test(amount))return 'Unavailable';
  const negative=amount.startsWith('-'),digits=negative?amount.slice(1):amount,decimals=value.decimals;
  if(!Number.isSafeInteger(decimals)||decimals<0||decimals>30)return `${negative?'−':''}${group(digits)} base units`;
  const padded=digits.padStart(decimals+1,'0'),whole=decimals?padded.slice(0,-decimals):padded,fraction=decimals?padded.slice(-decimals).replace(/0+$/,''):'';
  return `${negative&&digits!=='0'?'−':''}${group(whole)}${fraction?'.'+fraction:''}${value.symbol?' '+value.symbol:''}`;
}
function element(tag,value,className) {const el=document.createElement(tag);if(value!==undefined)el.textContent=value;if(className)el.className=className;return el;}
function explorer(item) {
  const ref=item.transaction_reference;
  return explorers[item.chain]&&typeof ref==='string'&&(item.chain==='solana'?/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(ref):/^0x[0-9a-fA-F]{64}$/.test(ref))?explorers[item.chain]+ref:null;
}
function date(value) {const at=new Date(value);return value&&Number.isFinite(at.getTime())?at.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time unavailable';}

export function mountTradeJournal(root) {
  if(!root)return {setAccountSession(){}};
  const status=root.querySelector('#journalStatus'),table=root.querySelector('#journalTable'),rows=root.querySelector('#journalRows');
  const refresh=root.querySelector('#journalRefresh'),more=root.querySelector('#journalMore');
  let generation=0,controller=null,sessionId=null,cursor=null,items=[];
  const say=message=>{status.textContent=message;};
  function cancel() {generation++;controller?.abort();controller=new AbortController();return generation;}
  function clear() {items=[];cursor=null;rows.replaceChildren();table.hidden=true;more.hidden=true;}
  function signedOut() {cancel();clear();sessionId=null;refresh.disabled=false;say('Sign in to see your Raven trades.');}
  function render() {
    const rendered=[];
    for(const item of items) {
      const tr=element('tr');tr.dataset.executionId=item.execution_id;
      const marketName=item.symbol||compact(item.selected_token_address)||compact(item.instrument_id)||'Market';
      const market=element('td'),name=element('strong',marketName);market.append(name,element('small',chains[item.chain]||'Chain unavailable'));
      const side=element('td',item.side?item.side[0].toUpperCase()+item.side.slice(1):'—');side.dataset.side=item.side||'';
      const state=element('td',labels[item.state]||'Checking receipt');state.dataset.state=item.state;
      const feeCell=element('td',journalAmount(item.receipt?.trading_fee));
      const action=element('td'),actions=element('div',undefined,'journal-receipt-actions'),details=element('button','Details');details.type='button';details.setAttribute('aria-expanded','false');details.setAttribute('aria-label','Receipt details for '+marketName);
      actions.append(details);action.append(actions);const url=explorer(item);if(url){const link=element('a','↗');link.setAttribute('aria-label','View transaction');link.title='View transaction';link.href=url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}
      tr.append(element('td',date(item.created_at)),market,side,state,feeCell,action);
      const extra=element('tr');extra.hidden=true;extra.className='journal-detail-row';extra.id='journal-detail-'+item.execution_id;details.setAttribute('aria-controls',extra.id);
      const cell=element('td');cell.colSpan=6;
      const description=element('div',undefined,'journal-details');description.append(element('strong','Receipt details'));
      const ledger=element('dl');description.append(ledger);const add=(label,value)=>{const line=element('div');line.append(element('dt',label),element('dd',value));ledger.append(line);};
      add('Market',item.instrument_id||'Unavailable');add('Receipt checked',date(item.observed_at));add('Transaction',item.transaction_reference||'Awaiting transaction reference');
      if(item.selected_token_address)add('Traded token',item.selected_token_address);
      add('Network fee',journalAmount(item.receipt?.network_fee));
      for(const move of item.receipt?.movements||[]) {
        const label=move.symbol||compact(move.address)||'Asset';
        add(label+' balance change',journalAmount(move));
        if(!move.symbol&&move.address)add('Token address',move.address);
        if(move.basis==='net_native_balance_including_fees_and_rent')description.append(element('p','The SOL balance change includes network fees and token-account rent.'));
      }
      if(['failed','rejected'].includes(item.state))description.append(element('p','This trade did not complete. No filled amount is recorded.'));
      else if(item.state==='venue_confirmed')description.append(element('p','The venue acknowledged this order. Filled amounts are not recorded in this receipt.'));
      else if(!item.receipt?.economic_result_verified)description.append(element('p','Receipt verification is incomplete.'));
      else if(!(item.receipt.movements||[]).length)description.append(element('p','No net asset movements are available in this receipt.'));
      cell.append(description);extra.append(cell);
      details.addEventListener('click',()=>{extra.hidden=!extra.hidden;details.setAttribute('aria-expanded',String(!extra.hidden));if(!extra.hidden)table.scrollLeft=0;});
      rendered.push(tr,extra);
    }
    rows.replaceChildren(...rendered);table.hidden=!items.length;more.hidden=!cursor;
  }
  async function loadPage({append=false}={}) {
    const version=cancel(),expectedSession=sessionId,pageCursor=append?cursor:null;
    refresh.disabled=true;more.disabled=true;say(append?'Loading more trades…':'Updating trade history…');
    try {
      const response=await fetch('/api/v1/portfolio/trades'+(pageCursor?'?cursor='+encodeURIComponent(pageCursor):''),{
        credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
      const body=await response.json();if(version!==generation)return;
      if(response.status===401){signedOut();return;}
      if(!response.ok||body?.ok!==true||body.schema_version!=='ravenos.trade_journal.v1')throw Error('unavailable');
      if(body.account_session_id!==expectedSession){clear();sessionId=null;throw Error('account_changed');}
      if(!Array.isArray(body.items)||body.items.length>25||body.items.some(item=>!/^lex_[A-Za-z0-9_-]{8,90}$/.test(item?.execution_id||''))
        ||(body.next_cursor!==null&&!/^[A-Za-z0-9_-]{1,256}$/.test(body.next_cursor||'')))throw Error('invalid_history');
      const combined=new Map((append?items:[]).map(item=>[item.execution_id,item]));for(const item of body.items)combined.set(item.execution_id,item);
      items=[...combined.values()];cursor=body.next_cursor;render();
      say(items.length?`${items.length} Raven ${items.length===1?'trade':'trades'} shown. Receipt amounts update as confirmation completes.`:'No Raven trades yet. Your submitted trades and receipts will appear here.');
    } catch(error) {
      if(version!==generation)return;
      if(error.message==='account_changed')say('Your account changed. Refresh trade history.');
      else say(items.length?'Update delayed. Your previously loaded trade history is still shown.':'Trade history could not load. Refresh to try again.');
    } finally {if(version===generation){refresh.disabled=false;more.disabled=false;}}
  }
  async function setAccountSession(session,{append=false}={}) {
    if(session?.state==='signed_out'){signedOut();return;}
    const id=session?.payload?.session?.session_public_id;
    if(session?.state!=='authenticated'||!/^sespub_[A-Za-z0-9_-]{12,80}$/.test(id||'')) {
      cancel();clear();sessionId=null;refresh.disabled=false;say('Account check is temporarily unavailable. Refresh to try again.');return;
    }
    if(sessionId!==id){clear();sessionId=id;append=false;}
    await loadPage({append});
  }
  async function checkAccount(append=false) {
    const version=cancel();refresh.disabled=true;more.disabled=true;say('Checking account…');
    try {
      const session=await readAccountSession({signal:controller.signal,onRetry:()=>{if(version===generation)say('Account check delayed. Retrying automatically…');}});
      if(version===generation)await setAccountSession(session,{append});
    } catch {if(version===generation){clear();sessionId=null;say('Account check is temporarily unavailable. Refresh to try again.');refresh.disabled=false;more.disabled=false;}}
  }
  refresh.addEventListener('click',()=>checkAccount());more.addEventListener('click',()=>checkAccount(true));
  window.addEventListener('ravenos:accountstate',event=>{
    if(event.detail?.authenticated===false){signedOut();return;}
    cancel();clear();sessionId=null;say('Checking account…');
  });
  return {setAccountSession};
}
