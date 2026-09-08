import {decodeFunctionData,parseAbi,keccak256,toHex} from 'viem';

// Official immutable Uniswap V2 Router02 deployments. Arbitrary routers with
// matching selectors are excluded. This fallback is for a direct EOA call only.
export const WALLET_NATIVE_ROUTERS=Object.freeze({
 ethereum:'0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
 base:'0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
 bsc:'0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
 robinhood:'0x89e5db8b5aa49aa85ac63f691524311aeb649eba',
});
const abi=parseAbi([
 'function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable returns (uint256[])',
 'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable',
 'function swapExactTokensForETH(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[])',
 'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
]);
const topic=signature=>keccak256(toHex(signature));
const a=value=>/^0x[0-9a-f]{40}$/i.test(value||'')?value.toLowerCase():null;
const aw=value=>/^0x0{24}[0-9a-f]{40}$/i.test(value||'')?a('0x'+value.slice(-40)):null;
export async function verifiedDirectRouterNativeDelta({chain,wallet,transaction,receipt,route,wrapped,rpc}) {
 const router=WALLET_NATIVE_ROUTERS[chain];
 if(route.kind!=='v2'||!router||a(transaction.to)!==router||a(transaction.from)!==wallet)return null;
 try {
  const {functionName,args}=decodeFunctionData({abi,data:transaction.input});
  const buy=functionName.startsWith('swapExactETHForTokens'),path=args[buy?1:2].map(a),recipient=a(args[buy?2:3]);
  if(recipient!==wallet||path.length!==2||!path.every(token=>[route.token0,route.token1].includes(token))||path[0]===path[1]||path[buy?0:1]!==wrapped)return null;
  const [code,factory,weth]=await Promise.all([
   rpc('eth_getCode',[wallet,receipt.blockNumber]),
   rpc('eth_call',[{to:router,data:'0xc45a0155'},receipt.blockNumber]),
   rpc('eth_call',[{to:router,data:'0xad5c4648'},receipt.blockNumber]),
  ]);
  // EIP-7702/delegated or contract accounts may execute additional value flows.
  if(code!=='0x'||aw(factory)!==route.factory||aw(weth)!==wrapped)return null;
  const rows=receipt.logs.filter(log=>a(log.address)===wrapped&&log.topics?.[0]===topic(buy?'Deposit(address,uint256)':'Withdrawal(address,uint256)')&&aw(log.topics?.[1])===router);
  // Robinhood's canonical wrapper emits ERC20 mint/burn transfers instead of
  // WETH9 Deposit/Withdrawal events. The exact configured wrapper is required.
  const zero='0x'+'0'.repeat(40);
  const minted=chain==='robinhood'?receipt.logs.filter(log=>a(log.address)===wrapped&&log.topics?.[0]===topic('Transfer(address,address,uint256)')&&log.topics.length===3&&aw(log.topics[1])===(buy?zero:router)&&aw(log.topics[2])===(buy?router:zero)):[];
  if(rows.length>1||minted.length>1||rows.length+minted.length===0||rows.some(log=>log.topics.length!==2))return null;
  const evidence=[...rows,...minted];
  if(evidence.some(log=>!/^0x[0-9a-f]{64}$/i.test(log.data)))return null;
  const amount=BigInt(evidence[0].data),value=BigInt(transaction.value||'0x0');
  if(evidence.some(log=>BigInt(log.data)!==amount))return null;
  if(amount<=0n||(buy?value!==amount:value!==0n))return null;
  return buy?-amount:amount;
 }catch{return null;}
}
