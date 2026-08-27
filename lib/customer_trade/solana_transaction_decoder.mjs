import { createHash } from "node:crypto";

import bs58 from "bs58";

// Solana's network packet limit is 1,232 bytes. Accepting a larger serialized
// transaction here would validate material that cannot be the exact packet sent
// to mainnet.
const MAX_TRANSACTION_BYTES = 1_232;
const MAX_SIGNATURES = 16;
const MAX_STATIC_KEYS = 64;
const MAX_INSTRUCTIONS = 64;
const MAX_INSTRUCTION_ACCOUNTS = 128;
const MAX_LOOKUP_TABLES = 16;
const MAX_LOOKUP_INDEXES = 256;
const MAX_RESOLVED_ACCOUNT_KEYS = 64;
const LOOKUP_TABLE_META_BYTES = 56;
const LOOKUP_TABLE_STATE = 1;
const ACTIVE_DEACTIVATION_SLOT = (1n << 64n) - 1n;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function bytes(value, field = "bytes") {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value);
  fail(`${field}_invalid`);
}

function boundedBase64(value, field = "transaction") {
  const text = String(value || "").trim();
  if (!text || text.length > 4_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) fail(`${field}_base64_invalid`);
  const decoded = Buffer.from(text, "base64");
  if (!decoded.length || decoded.length > MAX_TRANSACTION_BYTES) fail(`${field}_size_invalid`);
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  if (canonical !== text.replace(/=+$/, "")) fail(`${field}_base64_invalid`);
  return decoded;
}

function take(buffer, cursor, length, field) {
  if (!Number.isSafeInteger(length) || length < 0 || cursor.offset + length > buffer.length) fail(`${field}_truncated`);
  const out = buffer.subarray(cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return out;
}

function u8(buffer, cursor, field) {
  return take(buffer, cursor, 1, field)[0];
}

function encodeShortVec(value) {
  const out = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    out.push(byte);
  } while (remaining);
  return Buffer.from(out);
}

function shortVec(buffer, cursor, field, maximum) {
  const start = cursor.offset;
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 3; index += 1) {
    const byte = u8(buffer, cursor, field);
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(`${field}_out_of_bounds`);
      const encoded = encodeShortVec(value);
      if (!buffer.subarray(start, cursor.offset).equals(encoded)) fail(`${field}_encoding_invalid`);
      return value;
    }
    shift += 7;
  }
  fail(`${field}_encoding_invalid`);
}

function publicKey(raw) {
  return bs58.encode(bytes(raw, "public_key"));
}

function hash(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function parseCompiledInstruction(buffer, cursor, instructionIndex) {
  const programIdIndex = u8(buffer, cursor, `instruction_${instructionIndex}_program`);
  const accountCount = shortVec(buffer, cursor, `instruction_${instructionIndex}_accounts`, MAX_INSTRUCTION_ACCOUNTS);
  const accountIndexes = [...take(buffer, cursor, accountCount, `instruction_${instructionIndex}_accounts`)];
  const dataLength = shortVec(buffer, cursor, `instruction_${instructionIndex}_data_length`, MAX_TRANSACTION_BYTES);
  const data = take(buffer, cursor, dataLength, `instruction_${instructionIndex}_data`);
  return Object.freeze({
    instruction_index: instructionIndex,
    program_id_index: programIdIndex,
    account_indexes: Object.freeze(accountIndexes),
    data_base64: data.toString("base64"),
    data_length: data.length,
  });
}

function parseLookup(buffer, cursor, lookupIndex) {
  const tableAddress = publicKey(take(buffer, cursor, 32, `lookup_${lookupIndex}_address`));
  const writableCount = shortVec(buffer, cursor, `lookup_${lookupIndex}_writable_count`, MAX_LOOKUP_INDEXES);
  const writableIndexes = [...take(buffer, cursor, writableCount, `lookup_${lookupIndex}_writable_indexes`)];
  const readonlyCount = shortVec(buffer, cursor, `lookup_${lookupIndex}_readonly_count`, MAX_LOOKUP_INDEXES);
  const readonlyIndexes = [...take(buffer, cursor, readonlyCount, `lookup_${lookupIndex}_readonly_indexes`)];
  return Object.freeze({
    lookup_index: lookupIndex,
    table_address: tableAddress,
    writable_indexes: Object.freeze(writableIndexes),
    readonly_indexes: Object.freeze(readonlyIndexes),
  });
}

export function decodeSolanaTransaction(value) {
  const raw = typeof value === "string" ? boundedBase64(value) : bytes(value, "transaction");
  if (!raw.length || raw.length > MAX_TRANSACTION_BYTES) fail("transaction_size_invalid");
  const cursor = { offset: 0 };
  const signatureCount = shortVec(raw, cursor, "signature_count", MAX_SIGNATURES);
  const signatureOffset = cursor.offset;
  const signatures = [];
  for (let index = 0; index < signatureCount; index += 1) {
    const signature = take(raw, cursor, 64, `signature_${index}`);
    signatures.push(Object.freeze({
      signer_index: index,
      signature_base58: bs58.encode(signature),
      populated: signature.some((byte) => byte !== 0),
    }));
  }
  const messageOffset = cursor.offset;
  const message = raw.subarray(messageOffset);
  if (!message.length) fail("transaction_message_missing");
  const messageCursor = { offset: 0 };
  const versionPrefix = u8(message, messageCursor, "message_version");
  if ((versionPrefix & 0x80) === 0) fail("legacy_transaction_not_supported");
  const version = versionPrefix & 0x7f;
  if (version !== 0) fail("transaction_version_not_supported");
  const header = Object.freeze({
    required_signatures: u8(message, messageCursor, "required_signatures"),
    readonly_signed_accounts: u8(message, messageCursor, "readonly_signed_accounts"),
    readonly_unsigned_accounts: u8(message, messageCursor, "readonly_unsigned_accounts"),
  });
  if (header.required_signatures !== signatureCount || header.required_signatures < 1) fail("signature_header_mismatch");
  if (header.readonly_signed_accounts > header.required_signatures) fail("signed_account_header_invalid");
  const staticCount = shortVec(message, messageCursor, "static_account_count", MAX_STATIC_KEYS);
  if (staticCount < header.required_signatures || header.readonly_unsigned_accounts > staticCount - header.required_signatures) {
    fail("static_account_header_invalid");
  }
  const staticAccountKeys = [];
  for (let index = 0; index < staticCount; index += 1) {
    staticAccountKeys.push(publicKey(take(message, messageCursor, 32, `static_account_${index}`)));
  }
  if (new Set(staticAccountKeys).size !== staticAccountKeys.length) fail("static_account_duplicated");
  const recentBlockhash = publicKey(take(message, messageCursor, 32, "recent_blockhash"));
  const instructionCount = shortVec(message, messageCursor, "instruction_count", MAX_INSTRUCTIONS);
  const compiledInstructions = [];
  for (let index = 0; index < instructionCount; index += 1) {
    compiledInstructions.push(parseCompiledInstruction(message, messageCursor, index));
  }
  const lookupCount = shortVec(message, messageCursor, "lookup_count", MAX_LOOKUP_TABLES);
  const addressTableLookups = [];
  for (let index = 0; index < lookupCount; index += 1) {
    addressTableLookups.push(parseLookup(message, messageCursor, index));
  }
  if (messageCursor.offset !== message.length) fail("transaction_trailing_bytes");
  return Object.freeze({
    version: "v0",
    raw_bytes: raw,
    raw_base64: raw.toString("base64"),
    transaction_hash: hash(raw),
    message_bytes: message,
    message_hash: hash(message),
    signature_offset: signatureOffset,
    signature_count: signatureCount,
    signatures: Object.freeze(signatures),
    header,
    static_account_keys: Object.freeze(staticAccountKeys),
    recent_blockhash: recentBlockhash,
    compiled_instructions: Object.freeze(compiledInstructions),
    address_table_lookups: Object.freeze(addressTableLookups),
  });
}

export function decodeAddressLookupTableAccountData(value) {
  return decodeAddressLookupTableAccount(value).addresses;
}

export function decodeAddressLookupTableAccount(value) {
  const raw = bytes(value, "lookup_table_data");
  if (raw.length < LOOKUP_TABLE_META_BYTES || (raw.length - LOOKUP_TABLE_META_BYTES) % 32 !== 0) {
    fail("lookup_table_data_invalid");
  }
  if (raw.readUInt32LE(0) !== LOOKUP_TABLE_STATE) fail("lookup_table_state_invalid");
  const deactivationSlot = raw.readBigUInt64LE(4);
  const lastExtendedSlot = raw.readBigUInt64LE(12);
  const lastExtendedSlotStartIndex = raw[20];
  const authorityOption = raw[21];
  if (![0, 1].includes(authorityOption)) fail("lookup_table_authority_option_invalid");
  const addresses = [];
  for (let offset = LOOKUP_TABLE_META_BYTES; offset < raw.length; offset += 32) {
    addresses.push(publicKey(raw.subarray(offset, offset + 32)));
  }
  if (addresses.length > 256) fail("lookup_table_address_count_invalid");
  if (lastExtendedSlotStartIndex > addresses.length) fail("lookup_table_extension_index_invalid");
  return Object.freeze({
    state: "lookup_table",
    active: deactivationSlot === ACTIVE_DEACTIVATION_SLOT,
    deactivation_slot: deactivationSlot.toString(),
    last_extended_slot: lastExtendedSlot.toString(),
    last_extended_slot_start_index: lastExtendedSlotStartIndex,
    authority: authorityOption === 1 ? publicKey(raw.subarray(22, 54)) : null,
    addresses: Object.freeze(addresses),
  });
}

function normalizeLookupTables(value) {
  if (value instanceof Map) return value;
  if (!value || typeof value !== "object") fail("lookup_tables_required");
  return new Map(Object.entries(value));
}

function staticMeta(index, decoded) {
  const signed = index < decoded.header.required_signatures;
  const writable = signed
    ? index < decoded.header.required_signatures - decoded.header.readonly_signed_accounts
    : index < decoded.static_account_keys.length - decoded.header.readonly_unsigned_accounts;
  return { signer: signed, writable };
}

export function resolveSolanaTransactionAccounts(decodedInput, lookupTablesInput = new Map()) {
  const decoded = decodedInput?.message_bytes ? decodedInput : decodeSolanaTransaction(decodedInput);
  const lookupTables = normalizeLookupTables(lookupTablesInput);
  const staticAccounts = decoded.static_account_keys.map((address, index) => Object.freeze({
    index,
    address,
    source: "static",
    ...staticMeta(index, decoded),
  }));
  const writableDynamic = [];
  const readonlyDynamic = [];
  const lookupSummaries = [];
  const seenTables = new Set();
  for (const lookup of decoded.address_table_lookups) {
    if (seenTables.has(lookup.table_address)) fail("lookup_table_duplicated");
    seenTables.add(lookup.table_address);
    if (new Set(lookup.writable_indexes).size !== lookup.writable_indexes.length
      || new Set(lookup.readonly_indexes).size !== lookup.readonly_indexes.length
      || lookup.writable_indexes.some((index) => lookup.readonly_indexes.includes(index))) {
      fail("lookup_table_index_duplicated");
    }
    const table = lookupTables.get(lookup.table_address);
    const rawAddresses = Array.isArray(table) ? table : table?.addresses;
    if (!Array.isArray(rawAddresses)) fail("lookup_table_unresolved");
    const addresses = rawAddresses.map((address) => String(address || ""));
    const select = (index, writable) => {
      const address = addresses[index];
      if (!address) fail("lookup_table_index_unresolved");
      return Object.freeze({ address, source: "lookup_table", lookup_table: lookup.table_address, lookup_index: index, signer: false, writable });
    };
    const writable = lookup.writable_indexes.map((index) => select(index, true));
    const readonly = lookup.readonly_indexes.map((index) => select(index, false));
    writableDynamic.push(...writable);
    readonlyDynamic.push(...readonly);
    lookupSummaries.push(Object.freeze({
      table_address: lookup.table_address,
      address_count: addresses.length,
      writable_count: writable.length,
      readonly_count: readonly.length,
      active: typeof table?.active === "boolean" ? table.active : null,
      deactivation_slot: table?.deactivation_slot ?? null,
      last_extended_slot: table?.last_extended_slot ?? null,
    }));
  }
  const all = [...staticAccounts, ...writableDynamic, ...readonlyDynamic].map((entry, index) => Object.freeze({ ...entry, index }));
  if (all.length > MAX_RESOLVED_ACCOUNT_KEYS) fail("account_key_count_out_of_bounds");
  if (new Set(all.map((entry) => entry.address)).size !== all.length) fail("resolved_account_duplicated");
  const instructions = decoded.compiled_instructions.map((instruction) => {
    const program = all[instruction.program_id_index];
    if (!program) fail("instruction_program_unresolved");
    if (program.signer || program.writable) fail("instruction_program_meta_invalid");
    const accounts = instruction.account_indexes.map((index) => {
      const account = all[index];
      if (!account) fail("instruction_account_unresolved");
      return account;
    });
    return Object.freeze({
      instruction_index: instruction.instruction_index,
      program_id: program.address,
      accounts: Object.freeze(accounts),
      data_base64: instruction.data_base64,
      data_length: instruction.data_length,
      data_hash: hash(Buffer.from(instruction.data_base64, "base64")),
      data_prefix_hex: Buffer.from(instruction.data_base64, "base64").subarray(0, 8).toString("hex"),
    });
  });
  return Object.freeze({
    account_keys: Object.freeze(all),
    instructions: Object.freeze(instructions),
    lookup_tables: Object.freeze(lookupSummaries),
    signer_addresses: Object.freeze(all.filter((entry) => entry.signer).map((entry) => entry.address)),
    writable_addresses: Object.freeze([...new Set(all.filter((entry) => entry.writable).map((entry) => entry.address))]),
    program_ids: Object.freeze([...new Set(instructions.map((instruction) => instruction.program_id))]),
  });
}

export const SolanaTransactionDecoderLimits = Object.freeze({
  maximum_transaction_bytes: MAX_TRANSACTION_BYTES,
  maximum_signatures: MAX_SIGNATURES,
  maximum_static_accounts: MAX_STATIC_KEYS,
  maximum_instructions: MAX_INSTRUCTIONS,
  maximum_lookup_tables: MAX_LOOKUP_TABLES,
  maximum_resolved_accounts: MAX_RESOLVED_ACCOUNT_KEYS,
});
