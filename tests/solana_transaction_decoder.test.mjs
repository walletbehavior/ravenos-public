import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import * as solanaDecoder from "../lib/customer_trade/solana_transaction_decoder.mjs";

import {
  decodeAddressLookupTableAccount,
  decodeAddressLookupTableAccountData,
  decodeSolanaTransaction,
  resolveSolanaTransactionAccounts,
} from "../lib/customer_trade/solana_transaction_decoder.mjs";

function shortVec(value) {
  const out = [];
  let next = value;
  do {
    let byte = next & 0x7f;
    next >>= 7;
    if (next) byte |= 0x80;
    out.push(byte);
  } while (next);
  return Buffer.from(out);
}

function key(seed) {
  return Buffer.alloc(32, seed);
}

function compiledInstruction(programIndex, accountIndexes, data) {
  return Buffer.concat([
    Buffer.from([programIndex]),
    shortVec(accountIndexes.length),
    Buffer.from(accountIndexes),
    shortVec(data.length),
    Buffer.from(data),
  ]);
}

function fixture() {
  const wallet = key(1);
  const compute = key(2);
  const router = key(3);
  const lookupAddress = key(4);
  const dynamicAccount = key(5);
  const message = Buffer.concat([
    Buffer.from([0x80, 1, 0, 2]),
    shortVec(3),
    wallet,
    compute,
    router,
    key(6),
    shortVec(2),
    compiledInstruction(1, [], [7, 8]),
    compiledInstruction(2, [0, 3], [9, 10, 11]),
    shortVec(1),
    lookupAddress,
    shortVec(1),
    Buffer.from([0]),
    shortVec(0),
  ]);
  const transaction = Buffer.concat([shortVec(1), Buffer.alloc(64), message]);
  const lookupMeta = Buffer.alloc(56);
  lookupMeta.writeUInt32LE(1, 0);
  lookupMeta.writeBigUInt64LE((1n << 64n) - 1n, 4);
  lookupMeta.writeBigUInt64LE(1n, 12);
  const lookupData = Buffer.concat([lookupMeta, dynamicAccount]);
  return {
    wallet: bs58.encode(wallet),
    compute: bs58.encode(compute),
    router: bs58.encode(router),
    lookupAddress: bs58.encode(lookupAddress),
    dynamicAccount: bs58.encode(dynamicAccount),
    transaction,
    lookupData,
  };
}

test("v0 decoder resolves exact programs, accounts, lookup tables, and signer metadata", () => {
  const row = fixture();
  const decoded = decodeSolanaTransaction(row.transaction.toString("base64"));
  assert.equal(decoded.version, "v0");
  assert.equal(decoded.signature_count, 1);
  assert.equal(decoded.signatures[0].populated, false);
  assert.equal(decoded.static_account_keys[0], row.wallet);
  assert.equal(decoded.address_table_lookups[0].table_address, row.lookupAddress);
  assert.equal(decoded.compiled_instructions.length, 2);

  const lookupAddresses = decodeAddressLookupTableAccountData(row.lookupData);
  assert.deepEqual(lookupAddresses, [row.dynamicAccount]);
  const lookup = decodeAddressLookupTableAccount(row.lookupData);
  assert.equal(lookup.active, true);
  assert.equal(lookup.last_extended_slot, "1");
  const resolved = resolveSolanaTransactionAccounts(decoded, new Map([[row.lookupAddress, lookupAddresses]]));
  assert.deepEqual(resolved.signer_addresses, [row.wallet]);
  assert.deepEqual(resolved.program_ids, [row.compute, row.router]);
  assert.equal(resolved.instructions[1].accounts[0].address, row.wallet);
  assert.equal(resolved.instructions[1].accounts[1].address, row.dynamicAccount);
  assert.equal(resolved.instructions[1].accounts[1].writable, true);
  assert.match(resolved.instructions[1].data_hash, /^[a-f0-9]{64}$/);
  assert.equal(resolved.instructions[1].data_prefix_hex, "090a0b");
  assert.equal(resolved.lookup_tables[0].address_count, 1);
});

test("decoder exposes no signature mutation helper", () => {
  assert.equal(Object.hasOwn(solanaDecoder, "attachSolanaSignature"), false);
  assert.equal(Object.keys(solanaDecoder).some((name) => /sign|submit|broadcast/i.test(name)), false);
});

test("decoder fails closed on unresolved tables and malformed encodings", () => {
  const row = fixture();
  const decoded = decodeSolanaTransaction(row.transaction);
  assert.throws(() => resolveSolanaTransactionAccounts(decoded, new Map()), /lookup_table_unresolved/);
  assert.throws(() => decodeAddressLookupTableAccountData(Buffer.alloc(57)), /lookup_table_data_invalid/);
  assert.throws(() => decodeSolanaTransaction("not base64"), /transaction_base64_invalid/);
  const wrongState = Buffer.from(row.lookupData);
  wrongState.writeUInt32LE(0, 0);
  assert.throws(() => decodeAddressLookupTableAccount(wrongState), /lookup_table_state_invalid/);
  const deactivated = Buffer.from(row.lookupData);
  deactivated.writeBigUInt64LE(10n, 4);
  assert.equal(decodeAddressLookupTableAccount(deactivated).active, false);
});

test("decoder rejects malformed headers, account indexes, duplicated keys, and duplicated lookup indexes", () => {
  const row = fixture();

  const badSignedHeader = Buffer.from(row.transaction);
  badSignedHeader[67] = 2;
  assert.throws(() => decodeSolanaTransaction(badSignedHeader), /signed_account_header_invalid/);

  const duplicateStaticKey = Buffer.from(row.transaction);
  duplicateStaticKey.subarray(70, 102).copy(duplicateStaticKey, 102);
  assert.throws(() => decodeSolanaTransaction(duplicateStaticKey), /static_account_duplicated/);

  const unresolvedProgram = Buffer.from(row.transaction);
  unresolvedProgram[204] = 63;
  const unresolvedDecoded = decodeSolanaTransaction(unresolvedProgram);
  assert.throws(
    () => resolveSolanaTransactionAccounts(unresolvedDecoded, new Map([[row.lookupAddress, [row.dynamicAccount]]])),
    /instruction_program_unresolved/,
  );

  const duplicateLookupIndex = Buffer.concat([
    row.transaction.subarray(0, row.transaction.length - 1),
    Buffer.from([1, 0]),
  ]);
  const duplicateLookupDecoded = decodeSolanaTransaction(duplicateLookupIndex);
  assert.throws(
    () => resolveSolanaTransactionAccounts(duplicateLookupDecoded, new Map([[row.lookupAddress, [row.dynamicAccount]]])),
    /lookup_table_index_duplicated/,
  );
});
