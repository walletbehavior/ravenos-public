import bs58 from 'bs58';
import { authorizeCustomerApiRequest } from '../customer_identity.mjs';
import { EVM_CHAIN_PROFILES, EVM_NATIVE_TOKEN_ADDRESS } from './evm_chain_profiles.mjs';

export const TRADE_JOURNAL_ROUTE = '/api/v1/portfolio/trades';
export const TRADE_JOURNAL_SCHEMA = 'ravenos.trade_journal.v1';
export const TRADE_JOURNAL_PAGE_SIZE = 25;
const ORIGIN = 'https://app.ravenos.xyz';
const ID = /^lex_[A-Za-z0-9_-]{8,90}$/;
const UNSIGNED = /^(0|[1-9][0-9]{0,77})$/;
const SIGNED = /^-?(0|[1-9][0-9]{0,77})$/;
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';
const EXPLORERS = Object.freeze({solana:'https://solscan.io/tx/',base:'https://basescan.org/tx/',
  ethereum:'https://etherscan.io/tx/',bsc:'https://bscscan.com/tx/',robinhood:'https://robinhoodchain.blockscout.com/tx/'});
const text = (value, size=180) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,size) : '';
const unsigned = value => typeof value === 'string' && UNSIGNED.test(value) ? value : null;
const signed = value => typeof value === 'string' && SIGNED.test(value) ? value : null;
const iso = value => Number.isSafeInteger(value) && value > 0 && value < 8640000000000 ? new Date(value*1000).toISOString() : null;
const object = value => { try { const result=JSON.parse(value); return result && typeof result==='object' && !Array.isArray(result) ? result : {}; } catch { return {}; } };
function reference(chain,value) {
  if(typeof value!=='string')return null;
  if(chain==='solana') { try { return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)&&bs58.decode(value).length===64 ? value : null; } catch { return null; } }
  return EVM_CHAIN_PROFILES[chain] && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null;
}
function asset(chain,address) {
  if(chain==='solana') {
    if(address==='native')return {asset_id:'solana:native',address:null,symbol:'SOL',decimals:9};
    if(typeof address!=='string')return null;
    try { if(bs58.decode(address).length!==32)return null; } catch { return null; }
    return {asset_id:'solana:mint:'+address,address,symbol:address===USDC?'USDC':address===WSOL?'WSOL':null,decimals:address===USDC?6:address===WSOL?9:null};
  }
  const profile=EVM_CHAIN_PROFILES[chain];
  if(!profile || !/^0x[0-9a-fA-F]{40}$/.test(address||''))return null;
  address=address.toLowerCase();
  const known=address===profile.accounting_asset.address ? profile.accounting_asset : null;
  return {asset_id:chain+':'+(address===EVM_NATIVE_TOKEN_ADDRESS?'native':'token:'+address),address,symbol:address===EVM_NATIVE_TOKEN_ADDRESS?profile.native_symbol:known?.symbol||null,
    decimals:address===EVM_NATIVE_TOKEN_ADDRESS?18:known?.decimals??null};
}
function movement(chain,address,amount,basis) {
  const identity=asset(chain,address), units=signed(amount);
  return identity && units!==null ? {...identity,amount_base_units:units,basis} : null;
}
function fee(chain,address,amount) {
  const identity=asset(chain,address),units=unsigned(amount);
  return identity && units!==null ? {...identity,amount_base_units:units} : null;
}
function privateJson(payload,authorization,status=200) {
  const headers=new Headers(authorization?.response_headers);
  headers.set('content-type','application/json; charset=utf-8');
  headers.set('cache-control','private, no-store, max-age=0');headers.set('pragma','no-cache');
  headers.set('vary','Cookie, Origin');headers.set('x-content-type-options','nosniff');headers.set('referrer-policy','no-referrer');
  const body=JSON.stringify(payload);
  if(new TextEncoder().encode(body).length>128*1024)return privateJson({ok:false,error:'trade_history_unavailable'},authorization,503);
  return new Response(body,{status,headers});
}
function decodeCursor(value) {
  if(value===null)return null;
  if(!/^[A-Za-z0-9_-]{1,256}$/.test(value))throw Error('invalid_cursor');
  const cursor=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
  if(cursor?.v!==1||Object.keys(cursor).sort().join(',')!=='id,t,v'||!ID.test(cursor.id)||!Number.isSafeInteger(cursor.t)||cursor.t<=0)throw Error('invalid_cursor');
  return cursor;
}
const encodeCursor = row => Buffer.from(JSON.stringify({v:1,t:row.created_at,id:row.execution_id})).toString('base64url');

// Whitelist presentation fields. Prepared tickets and raw provider evidence
// never leave this module. Monetary observations require a bound receipt.
export function projectTradeJournalRow(row) {
  const chain=Object.hasOwn(EXPLORERS,row.chain_namespace)?row.chain_namespace:row.chain_namespace==='hyperliquid'?'hyperliquid':'unknown';
  const prepared=object(row.prepared_json), report=object(row.evidence_json), submission=object(row.submission_json);
  const market=prepared.exact_market||{}, order=prepared.reviewed_order||{};
  const identityMatches=prepared.ticket_id===row.execution_id && market.instrument_id===row.exact_market_id
    && prepared.wallet_address===row.wallet_address;
  const persisted=chain==='solana'?reference(chain,submission.wallet_signature):reference(chain,row.transaction_hash);
  const reported=reference(chain,chain==='solana'?report.signature:report.transaction_hash);
  const bound=identityMatches && row.event_state===row.state && persisted!==null && reported===persisted
    && (chain!=='solana'||(/^[0-9a-f]{64}$/i.test(prepared.transaction?.message_hash||'')&&submission.message_hash===prepared.transaction.message_hash));
  const evidence=bound && report.evidence && typeof report.evidence==='object' ? report.evidence : {};
  const confirmed=bound && row.state==='provider_confirmed' && report.state==='provider_confirmed' && evidence.economic_result_verified===true
    && (chain!=='solana'||evidence.settled_message_hash===prepared.transaction.message_hash);
  const finalized=confirmed && (chain==='solana'?evidence.confirmation_status==='finalized':evidence.finalized===true);
  const movements=[];
  let tradingFee=null,networkFee=null;
  if(confirmed && chain==='solana') {
    const selected=unsigned(evidence.selected_token_delta_base_units);
    if(selected!==null && ['buy','sell'].includes(row.side))movements.push(movement(chain,market.selected_token_mint,row.side==='sell'&&selected!=='0'?'-'+selected:selected,'net_token_balance'));
    movements.push(movement(chain,USDC,evidence.usdc_delta_base_units,'net_token_balance'));
    const debit=unsigned(evidence.native_debit_lamports),credit=unsigned(evidence.native_credit_lamports);
    if(debit!==null&&credit!==null)movements.push(movement(chain,'native',(BigInt(credit)-BigInt(debit)).toString(),'net_native_balance_including_fees_and_rent'));
    if(evidence.raven_fee?.verified===true)tradingFee=fee(chain,evidence.raven_fee.fee_mint,evidence.raven_fee.gross_fee_amount_base_units);
    networkFee=fee(chain,'native',evidence.fee_lamports);
  } else if(confirmed && EVM_CHAIN_PROFILES[chain]) {
    const debit=unsigned(evidence.sell_debit_base_units),credit=unsigned(evidence.buy_credit_base_units);
    // Transaction.value is not proof of net spend after internal refunds.
    if(evidence.sell_debit_basis==='net_transfer_logs'&&debit!==null)movements.push(movement(chain,order.sell_token,debit==='0'?'0':'-'+debit,'net_transfer_logs'));
    if(evidence.buy_credit_basis==='net_transfer_logs'&&credit!==null)movements.push(movement(chain,order.buy_token,credit,'net_transfer_logs'));
    if(evidence.fee_collection?.state==='observed')tradingFee=fee(chain,evidence.fee_collection.token,evidence.fee_collection.observed_amount_base_units);
    networkFee=fee(chain,EVM_NATIVE_TOKEN_ADDRESS,evidence.network_fee_native_base_units);
  }
  const state=confirmed?(finalized?'finalized':'confirmed')
    :['provider_rejected','failed'].includes(row.state)?'failed':row.state==='rejected'?'rejected'
    :chain==='hyperliquid'&&row.state==='provider_confirmed'?'venue_confirmed':'pending_receipt';
  const observedMovements=movements.filter(Boolean);
  const uniqueMovements=observedMovements.filter((value,index,all)=>all.findIndex(other=>other.asset_id===value.asset_id)===index
    && all.every(other=>other.asset_id!==value.asset_id||other.amount_base_units===value.amount_base_units));
  const selectedAsset=identityMatches?asset(chain,chain==='solana'?market.selected_token_mint:market.token_address):null;
  return {
    execution_id:ID.test(row.execution_id||'')?row.execution_id:null,chain,
    instrument_id:text(row.exact_market_id),symbol:identityMatches?text(market.symbol,32)||null:null,
    selected_token_address:selectedAsset?.address||null,
    side:['buy','sell','long','short'].includes(row.side)?row.side:null,
    created_at:iso(row.created_at),observed_at:iso(row.observed_at),state,
    transaction_reference:persisted,explorer_url:persisted&&EXPLORERS[chain]?EXPLORERS[chain]+persisted:null,
    receipt:{economic_result_verified:confirmed,finalized,movements:uniqueMovements,trading_fee:tradingFee,network_fee:networkFee},
  };
}

export async function readTradeJournal(db,userId,{cursor=null}={}) {
  if(typeof userId!=='string'||!/^usr_[A-Za-z0-9_-]{8,150}$/.test(userId))throw Error('account_required');
  const after=decodeCursor(cursor),params=[userId];
  if(after)params.push(after.t,after.t,after.id);
  params.push(TRADE_JOURNAL_PAGE_SIZE+1);
  const result=await db.prepare(`SELECT i.execution_id,i.chain_namespace,i.wallet_address,i.exact_market_id,i.side,i.state,
      i.prepared_json,i.transaction_hash,i.created_at,e.state AS event_state,e.evidence_json,e.observed_at,
      (SELECT s.evidence_json FROM ravenos_customer_live_execution_events s
        WHERE s.execution_id=i.execution_id AND s.state='submission_pending' ORDER BY s.observed_at DESC,s.rowid DESC LIMIT 1) AS submission_json
    FROM ravenos_customer_live_execution_intents i
    LEFT JOIN ravenos_customer_live_execution_events e ON e.rowid=(SELECT latest.rowid FROM ravenos_customer_live_execution_events latest
      WHERE latest.execution_id=i.execution_id ORDER BY latest.observed_at DESC,latest.rowid DESC LIMIT 1)
    WHERE i.user_id=? AND i.state IN ('submission_pending','client_reported','reconciliation_pending','provider_confirmed','provider_rejected','indeterminate','failed','rejected')
      AND (i.transaction_hash IS NOT NULL OR EXISTS(SELECT 1 FROM ravenos_customer_live_execution_events submitted
        WHERE submitted.execution_id=i.execution_id AND submitted.state IN ('submission_pending','client_reported','filled','resting','provider_confirmed','provider_rejected')))
      ${after?'AND (i.created_at<? OR (i.created_at=? AND i.execution_id>?))':''}
    ORDER BY i.created_at DESC,i.execution_id ASC LIMIT ?`).bind(...params).all();
  const rows=result.results||[],page=rows.slice(0,TRADE_JOURNAL_PAGE_SIZE);
  return {ok:true,schema_version:TRADE_JOURNAL_SCHEMA,items:page.map(projectTradeJournalRow),
    next_cursor:rows.length>TRADE_JOURNAL_PAGE_SIZE?encodeCursor(page.at(-1)):null};
}

export async function routeTradeJournal(request,env={},deps={}) {
  const url=new URL(request.url);
  if(url.pathname!==TRADE_JOURNAL_ROUTE)return null;
  const fail=(error,status=400)=>privateJson({ok:false,error},null,status);
  if(url.origin!==ORIGIN)return fail('authenticated_origin_required',409);
  if(request.method!=='GET')return fail('method_not_allowed',405);
  if(request.headers.get('sec-fetch-site')!=='same-origin'||(request.headers.has('origin')&&request.headers.get('origin')!==ORIGIN))return fail('request_not_allowed',403);
  if(request.url.length>2048||Number(request.headers.get('content-length')||0)!==0)return fail('request_too_large',413);
  if(url.hash||[...url.searchParams.keys()].some(key=>key!=='cursor')||url.searchParams.getAll('cursor').length>1)return fail('request_parameters_invalid');
  try {decodeCursor(url.searchParams.get('cursor'));}catch{return fail('invalid_cursor');}
  const authorization=await (deps.authorizeRequest||authorizeCustomerApiRequest)(request,env,deps);
  if(authorization.response)return authorization.response;
  try { return privateJson({...await readTradeJournal(env.RAVENOS_CUSTOMER_DB,authorization.principal.user_id,{cursor:url.searchParams.get('cursor')}),account_session_id:authorization.principal.session_public_id},authorization); }
  catch { return privateJson({ok:false,error:'trade_history_unavailable'},authorization,503); }
}
