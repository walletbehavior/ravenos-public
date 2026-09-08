import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { loadWalletHistoricalPrices,walletUsdTradingRecord } from '../lib/customer_trade/wallet_historical_prices.mjs';
import { applyEvmTradingRecord } from '../lib/customer_trade/evm_wallet_trading_record.mjs';
import { evmSettlementBases } from '../lib/customer_trade/evm_wallet_swaps.mjs';
const [historyFile,profileFile,outFile]=process.argv.slice(2);
if(!historyFile||!profileFile||!outFile)throw Error('history_profile_output_required');
const history=JSON.parse(readFileSync(historyFile,'utf8')),original=JSON.parse(readFileSync(profileFile,'utf8')).profile;
if(original.source_wallet.address!==history.job.source_wallet.address||original.source_wallet.chain!==history.job.source_wallet.chain)throw Error('profile_identity_mismatch');
const raw=new DatabaseSync(':memory:');
for(const name of readdirSync('customer-migrations').filter(n=>/^\d+.*\.sql$/.test(n)).sort())raw.exec(readFileSync(`customer-migrations/${name}`,'utf8'));
const db={
  prepare(sql){
    return {bind(...values){
      const statement=raw.prepare(sql);
      return {
        async run(){return {meta:{changes:statement.run(...values).changes}};},
        async all(){return {results:statement.all(...values)};},
      };
    }};
  },
  async batch(statements){return Promise.all(statements.map(statement=>statement.run()));},
};
const env={...process.env,RAVENOS_ALCHEMY_WALLET_HISTORY_ENABLED:'1',RAVENOS_WALLET_HISTORICAL_USD_ENABLED:'1'};
if(env.ALCHEMY_API_KEY&&!env.ALCHEMY_ROBINHOOD_RPC_URL)env.ALCHEMY_ROBINHOOD_RPC_URL=`https://robinhood-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
let requests=0;const fetchImpl=(url,options)=>{requests++;return fetch(url,options);};
let prices=[];
for(let attempt=0;attempt<5;attempt++)prices=await loadWalletHistoricalPrices(env,db,history.events,{fetchImpl});
const before=requests;await loadWalletHistoricalPrices(env,db,history.events,{fetchImpl});
const profile=applyEvmTradingRecord({...original,generated_at:new Date().toISOString()},history.events,{bases:evmSettlementBases(original.source_wallet.chain),openingBalances:history.job.provider_cursor.opening_balances});
const usd=walletUsdTradingRecord(profile,history.events,prices);
const report={schema_version:'ravenos.wallet_historical_usd_shadow.v1',observed_at:new Date().toISOString(),prices_retained:prices.length,provider_requests:before,repeated_read_requests:requests-before,usd,trading_record:profile.trading_record,signing:false,broadcasting:false};
writeFileSync(outFile,JSON.stringify(report,null,2));raw.close();
console.log(JSON.stringify({prices:prices.length,initial_requests:before,repeat_requests:requests-before,priced_trades:usd.priced_trades,eligible_trades:usd.eligible_trades,buy_usd:usd.periods.d30.buy_notional_by_basis.usd.total,realized_usd:usd.periods.d30.realized_pnl.usd}));
if(!prices.length||usd.priced_trades<usd.eligible_trades)process.exitCode=1;
