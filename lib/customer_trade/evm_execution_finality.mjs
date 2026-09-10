import { readEvmFinalityEvidence } from './evm_read_only_rpc.mjs';

const HASH = /^0x[0-9a-f]{64}$/i;
const BLOCK = /^(?:0|[1-9][0-9]{0,77})$/;

// Receipt inclusion makes the fill inspectable. Only a matching canonical
// receipt below the provider's finalized head can release settlement rewards.
export async function withEvmExecutionFinality(reconciliation, rpcClient, {
  readFinality = () => readEvmFinalityEvidence(rpcClient),
} = {}) {
  if (reconciliation?.state !== 'provider_confirmed'
    || reconciliation.evidence?.economic_result_verified !== true) return reconciliation;
  const pending = (reason, finality = null) => Object.freeze({
    ...reconciliation,
    state: 'indeterminate',
    evidence: Object.freeze({
      ...reconciliation.evidence,
      reason,
      finalized: false,
      finality_state: reason === 'finality_pending' ? 'included_not_finalized' : 'unresolved',
      finality_claim: finality ? 'provider_finalized_tag' : 'unavailable',
      finality,
    }),
  });
  try {
    const receipt = reconciliation.evidence;
    if (!BLOCK.test(String(receipt.block_number)) || !HASH.test(String(receipt.block_hash))) {
      return pending('provider_finality_unavailable');
    }
    const finality = await readFinality();
    if (!BLOCK.test(String(finality?.finalized_block)) || !BLOCK.test(String(finality?.latest_block))
      || !HASH.test(String(finality?.finalized_block_hash)) || !HASH.test(String(finality?.latest_block_hash))
      || BigInt(finality.finalized_block) > BigInt(finality.latest_block)) return pending('provider_finality_unavailable');
    const receiptBlock = BigInt(receipt.block_number);
    if (receiptBlock > BigInt(finality.finalized_block)) return pending('finality_pending', finality);

    // Recheck after reading the finalized head; an earlier canonical lookup
    // can become obsolete while those requests are in flight.
    const canonical = (await rpcClient.request('eth_getBlockByNumber', [`0x${receiptBlock.toString(16)}`, false])).result;
    if (!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(String(canonical?.number))
      || BigInt(canonical.number) !== receiptBlock
      || !HASH.test(String(canonical?.hash))
      || canonical.hash.toLowerCase() !== receipt.block_hash.toLowerCase()
      || (receiptBlock === BigInt(finality.finalized_block)
        && canonical.hash.toLowerCase() !== finality.finalized_block_hash.toLowerCase())) {
      return pending('canonical_block_unresolved', finality);
    }
    return Object.freeze({
      ...reconciliation,
      evidence: Object.freeze({
        ...receipt,
        reason: null,
        finalized: true,
        finality_state: 'provider_finalized',
        finality_claim: 'provider_finalized_tag',
        finality,
      }),
    });
  } catch {
    return pending('provider_finality_unavailable');
  }
}
