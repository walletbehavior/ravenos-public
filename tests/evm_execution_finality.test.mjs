import assert from 'node:assert/strict';
import test from 'node:test';
import { withEvmExecutionFinality } from '../lib/customer_trade/evm_execution_finality.mjs';
import { readEvmFinalityEvidence } from '../lib/customer_trade/evm_read_only_rpc.mjs';

const hash = digit => `0x${digit.repeat(64)}`;
const included = () => ({
  state: 'provider_confirmed', transaction_hash: hash('a'),
  evidence: { economic_result_verified: true, block_number: '100', block_hash: hash('b'),
    sell_debit_base_units: '1000000', buy_credit_base_units: '400000000000000000',
    fee_collection: { state: 'observed', observed_amount_base_units: '10000' },
    l1_finality_observed: false },
});
function rpc({ finalized = '0x64', canonicalHash = hash('b'), canonicalNumber = '0x64', headHash = hash('b') } = {}) {
  const calls = [];
  return { calls, async request(method, params) {
    calls.push({ method, params });
    assert.equal(method, 'eth_getBlockByNumber');
    assert.equal(params[1], false);
    return { provider_id: 'public_fixture', result: params[0] === 'latest'
      ? { number: '0x70', hash: hash('c') }
      : params[0] === 'finalized' ? { number: finalized, hash: headHash }
        : { number: canonicalNumber, hash: canonicalHash } };
  } };
}

test('Robinhood L2 inclusion becomes provider-finalized only after the canonical receipt recheck', async () => {
  const client = rpc();
  const input = included();
  const result = await withEvmExecutionFinality(input, client);
  assert.equal(result.state, 'provider_confirmed');
  assert.equal(result.evidence.finalized, true);
  assert.equal(result.evidence.finality_claim, 'provider_finalized_tag');
  assert.equal(result.evidence.l1_finality_observed, false);
  assert.equal(result.evidence.sell_debit_base_units, '1000000');
  assert.deepEqual(result.evidence.fee_collection, input.evidence.fee_collection);
  assert.equal(client.calls.at(-1).params[0], '0x64');
  assert.equal(input.evidence.finalized, undefined);
});

test('tokens remain included while finality and cashback wait', async () => {
  const client = rpc({ finalized: '0x63' });
  const result = await withEvmExecutionFinality(included(), client);
  assert.equal(result.state, 'indeterminate');
  assert.equal(result.evidence.economic_result_verified, true);
  assert.equal(result.evidence.finalized, false);
  assert.equal(result.evidence.reason, 'finality_pending');
  assert.equal(client.calls.length, 2);
});

for (const [name, options] of [
  ['receipt reorg during finalized-head lookup', { canonicalHash: hash('d') }],
  ['wrong canonical block number', { canonicalNumber: '0x65' }],
  ['finalized head contradicts its canonical block', { headHash: hash('e') }],
]) test(name, async () => {
  const result = await withEvmExecutionFinality(included(), rpc(options));
  assert.equal(result.state, 'indeterminate');
  assert.equal(result.evidence.finalized, false);
  assert.equal(result.evidence.reason, 'canonical_block_unresolved');
});

test('a finalized ancestor must still match the receipt hash', async () => {
  const result = await withEvmExecutionFinality(included(), rpc({ finalized: '0x68', headHash: hash('d') }));
  assert.equal(result.evidence.finalized, true);
});

for (const state of ['provider_rejected', 'indeterminate']) test(`${state} receipt never performs a finality lookup`, async () => {
  const input = { ...included(), state };
  const result = await withEvmExecutionFinality(input, { request() { throw new Error('unexpected lookup'); } });
  assert.equal(result, input);
});

test('an unverified economic result cannot gain settlement authority', async () => {
  const input = included(); input.evidence.economic_result_verified = false;
  assert.equal(await withEvmExecutionFinality(input, {}), input);
});

for (const value of [null, { number: '100', hash: hash('b') }, { number: '0x-1', hash: hash('b') },
  { number: '0x064', hash: hash('b') }, { number: '0x64', hash: 'not-a-hash' },
  { number: '0x80', hash: hash('b') }]) test(`invalid finalized header is rejected: ${JSON.stringify(value)}`, async () => {
  const client = { async request(_method, params) { return { result: params[0] === 'latest' ? { number: '0x70', hash: hash('c') } : value }; } };
  await assert.rejects(readEvmFinalityEvidence(client), /evm_rpc_finality/);
  const result = await withEvmExecutionFinality(included(), client);
  assert.equal(result.evidence.finalized, false);
  assert.equal(result.evidence.reason, 'provider_finality_unavailable');
});

test('provider failure retains the economic receipt without granting finalized status', async () => {
  const result = await withEvmExecutionFinality(included(), { async request() { throw new Error('provider unavailable'); } });
  assert.equal(result.evidence.reason, 'provider_finality_unavailable');
  assert.equal(result.evidence.buy_credit_base_units, '400000000000000000');
  assert.equal(result.state, 'indeterminate');
});
