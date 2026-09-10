import { getPreference, setPreference } from './ravenos-preferences.js';
const labels={solana:'Solana',base:'Base',ethereum:'Ethereum',robinhood:'Robinhood',bsc:'BNB Chain'};
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
const amount=value=>value===null||value===undefined?'Unavailable':String(value).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');

// Own-account balances are deliberately separate from researched wallets and
// from browser market context. No balance is saved in localStorage.
export function mountWalletBalances(target,{compact=false,getContext=null}={}) {
  if(!target)return null;
  const root=node('section',null,'raven-wallet-balances');root.setAttribute('aria-label','Raven Wallet buying power');
  const head=node('header'),title=node('strong','Buying power'),controls=node('div');
  const select=node('select');select.setAttribute('aria-label','Balance network');
  for(const [key,label]of Object.entries(labels)){const option=node('option',label);option.value=key;select.append(option);}
  if(!getContext)select.value=getPreference('balanceNetwork','solana');
  const refresh=node('button','Refresh balances');refresh.type='button';
  controls.append(select,refresh);head.append(title,controls);
  const status=node('p','Loading your wallet balances…'),rows=node('div',null,'raven-wallet-balance-grid'),address=node('code'),note=node('p');
  status.setAttribute('role','status');
  const account=node('a','Fund or manage wallets →');account.href='https://app.ravenos.xyz/account/#accountPrivyPanel';
  root.append(head,status,rows,address,note,account);target.append(root);
  if(compact)root.classList.add('is-compact');
  let generation=0,lastCheck=0,inFlight=false,disposed=false,currentChain='solana',lastSnapshot=null,controller=null;
  function clear(){rows.replaceChildren();address.textContent='';note.textContent='';lastSnapshot=null;}
  async function load(force=false){
    const context=getContext?.();
    const wanted=context?.chain||select.value;
    if(!labels[wanted]){root.hidden=true;return;}
    root.hidden=false;select.disabled=Boolean(getContext);select.value=wanted;
    if(wanted!==currentChain){controller?.abort();currentChain=wanted;generation++;lastCheck=0;inFlight=false;clear();}
    if(inFlight||(!force&&Date.now()-lastCheck<30000))return;
    const version=++generation;controller=new AbortController();inFlight=true;lastCheck=Date.now();refresh.disabled=true;status.textContent=(rows.childElementCount?'Refreshing ':'Checking ')+labels[wanted]+' balances…';
    try{
      const response=await fetch('/api/v1/wallets/balances?chain='+encodeURIComponent(wanted),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
      const payload=await response.json();if(version!==generation||disposed)return;
      if(response.status===401||response.status===403||response.status===409){clear();status.textContent='Sign in to see your Raven Wallet funds.';account.textContent='Open your account →';return;}
      if(!response.ok||!payload.ok)throw Error('unavailable');
      const snapshot=payload.snapshot;
      if(!snapshot){clear();status.textContent='No Raven Wallet linked on '+labels[wanted]+'.';return;}
      if(snapshot.chain!==wanted||!snapshot.address||!Array.isArray(snapshot.assets))throw Error('invalid');
      clear();lastSnapshot=snapshot;
      address.textContent=snapshot.address;
      status.textContent=labels[wanted]+' · '+(snapshot.state==='available'?'Balance updated ':'Some balances unavailable · ')+new Date(snapshot.observed_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const active=getContext?.()?.address;
      const same=active&&(wanted==='solana'?active===snapshot.address:active.toLowerCase()===snapshot.address.toLowerCase());
      for(const asset of snapshot.assets){
        const row=node('div');row.append(node('span',asset.symbol),node('strong',amount(asset.amount)));
        if(asset.spendable_before_network_fees!==null&&asset.spendable_before_network_fees!==asset.amount)row.append(node('small','Usable: '+amount(asset.spendable_before_network_fees)));
        rows.append(row);
      }
      note.textContent='Wallet balances before fees. Keep '+snapshot.network_fee_asset+' for network costs. '+(compact?(active&&!same?'This is your Raven Wallet; the selected trading wallet differs.':'Trading checks wallet readiness and spendable funds automatically.'):'Funds stay on the selected network; they are not automatically bridged.');
    }catch{if(version===generation){
      const age=Date.now()-Date.parse(lastSnapshot?.observed_at);
      if(lastSnapshot&&lastSnapshot.chain===wanted&&age>=-30000&&age<=300000)status.textContent='Update delayed · last balance check '+new Date(lastSnapshot.observed_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'. Refresh before relying on these amounts.';
      else {clear();status.textContent='Balance check unavailable. Refresh to try again; this does not mean your wallet is empty.';}
    }}
    finally{if(version===generation){inFlight=false;refresh.disabled=false;}}
  }
  select.addEventListener('change',()=>{if(!getContext)setPreference('balanceNetwork',select.value);load(true);});refresh.addEventListener('click',()=>load(true));
  const visible=()=>{if(document.visibilityState==='visible')load();};
  document.addEventListener('visibilitychange',visible);
  window.addEventListener('focus',visible);
  const accountChanged=event=>{controller?.abort();generation++;lastCheck=0;inFlight=false;refresh.disabled=false;clear();if(event.detail?.authenticated===false){status.textContent='Sign in to see your Raven Wallet funds.';}else load(true);};
  window.addEventListener('ravenos:accountstate',accountChanged);
  const timer=setInterval(()=>{if(document.visibilityState==='visible'&&root.getClientRects().length)load();},30000);
  load();return {refresh:()=>load(true),sync:()=>load(),destroy:()=>{disposed=true;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);window.removeEventListener('ravenos:accountstate',accountChanged);root.remove();}};
}
