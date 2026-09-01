import {
  canonicalContractHash,
  canonicalContractValue,
} from "../customer_trade/contracts.mjs";

const NO_VOLATILE_KEYS = new Set();
const STRICT_CANONICAL_OPTIONS = Object.freeze({ volatileKeys: NO_VOLATILE_KEYS });

export function agenticContractValue(value) {
  return canonicalContractValue(value, STRICT_CANONICAL_OPTIONS);
}

export function agenticContractHash(value) {
  return canonicalContractHash(value, STRICT_CANONICAL_OPTIONS);
}

export function verifyAgenticContractHash(value, suppliedHash, hashField = "record_hash") {
  if (!value || typeof value !== "object") return false;
  const core = Object.fromEntries(Object.entries(value).filter(([key]) => key !== hashField));
  return typeof suppliedHash === "string" && suppliedHash.length > 0 && agenticContractHash(core) === suppliedHash;
}
