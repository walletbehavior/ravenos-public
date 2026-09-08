import {evmWalletAddNetworkParameters} from '../lib/customer_trade/evm_wallet_networks.mjs';

function failure(code) { return Object.assign(new Error(code), {code}); }

// Called before the final quote, and rechecked by the fee-bound executor.
// Network changes are connection setup; this function never signs or sends.
export async function ensureEvmWalletNetwork({profile, provider, address, assertCurrent = () => {}}) {
  const network = evmWalletAddNetworkParameters(profile);
  if (!provider?.request || !/^0x[0-9a-f]{40}$/i.test(String(address || ''))) throw failure('evm_wallet_unavailable');
  const checkAccount = async () => {
    assertCurrent();
    const accounts = await provider.request({method:'eth_accounts'});
    assertCurrent();
    if (!Array.isArray(accounts) || String(accounts[0]).toLowerCase() !== address.toLowerCase()) throw failure('wallet_account_identity_mismatch');
  };
  await checkAccount();
  if (String(await provider.request({method:'eth_chainId'})).toLowerCase() !== network.chainId) {
    assertCurrent();
    try {
      await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:network.chainId}]});
    } catch (error) {
      const code = Number(error?.code ?? error?.data?.originalError?.code);
      if (code === 4001) throw failure('user_rejected_request');
      if (code !== 4902) throw failure('evm_chain_switch_failed');
      assertCurrent();
      try {
        await provider.request({method:'wallet_addEthereumChain',params:[network]});
        assertCurrent();
        await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:network.chainId}]});
      } catch (error) {
        if (Number(error?.code) === 4001) throw failure('user_rejected_request');
        if (error?.message === 'spot_trade_changed') throw error;
        throw failure('evm_chain_switch_failed');
      }
    }
  }
  await checkAccount();
  const actual = String(await provider.request({method:'eth_chainId'})).toLowerCase();
  assertCurrent();
  if (actual !== network.chainId) throw failure('evm_chain_identity_mismatch');
  return {chain_id:parseInt(network.chainId,16), wallet_address:address.toLowerCase()};
}
