import { createHash } from "node:crypto";

import bs58 from "bs58";

import { SOLANA_REVIEWED_SWAP_PROGRAM_IDS } from "./solana_program_registry.mjs";
import { buildWalletResearchThesis } from "./wallet_research_thesis.mjs";

export const SOLANA_WALLET_EVENT_SCHEMA = "ravenos.solana_wallet_event.v1";
export const SOLANA_WALLET_PROFILE_SCHEMA = "ravenos.solana_wallet_profile.v1";
export const SOLANA_WALLET_DECODE_VERSION = 1;

export const SOLANA_CANONICAL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_WRAPPED_NATIVE_MINT = "So11111111111111111111111111111111111111112";

export const SolanaWalletEventKinds = Object.freeze([
  "SWAP_BUY",
  "SWAP_SELL",
  "MULTIHOP_SWAP",
  "SPLIT_ROUTE_SWAP",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "AIRDROP",
  "TOKEN_CREATION",
  "MINT",
  "BURN",
  "LIQUIDITY_ADD",
  "LIQUIDITY_REMOVE",
  "STAKE",
  "UNSTAKE",
  "BORROW",
  "REPAY",
  "INTERNAL_ACCOUNT_MOVEMENT",
  "FAILED_TRANSACTION",
  "NON_TRADE",
  "AMBIGUOUS",
  "UNSUPPORTED",
]);

const EVENT_KINDS = new Set(SolanaWalletEventKinds);
const TRADE_KINDS = new Set(["SWAP_BUY", "SWAP_SELL", "MULTIHOP_SWAP", "SPLIT_ROUTE_SWAP"]);
const BASE_ASSETS = new Set([SOLANA_CANONICAL_USDC_MINT, SOLANA_WRAPPED_NATIVE_MINT, "native_sol"]);
const KNOWN_SWAP_PROGRAMS = new Set(SOLANA_REVIEWED_SWAP_PROGRAM_IDS);
const MAX_EVENTS = 2_000;

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function clean(value, field, maximum = 180, { optional = false } = {}) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if ((!optional && !text) || text.length > maximum) fail(`${field}_invalid`);
  return text;
}

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function bigint(value, field) {
  try {
    const parsed = BigInt(String(value ?? "0"));
    if (parsed < 0n) fail(`${field}_invalid`);
    return parsed;
  } catch {
    fail(`${field}_invalid`);
  }
}

function signedBigint(value, field) {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    fail(`${field}_invalid`);
  }
}

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

export function normalizeSolanaWalletAddress(value) {
  const address = clean(value, "wallet_address", 44);
  try {
    if (bs58.decode(address).length !== 32) fail("wallet_address_invalid");
  } catch {
    fail("wallet_address_invalid");
  }
  return address;
}

function accountAddress(row) {
  return typeof row === "string" ? row : String(row?.pubkey || "");
}

function accountSigner(row) {
  return typeof row === "object" && row?.signer === true;
}

function tokenBalanceMap(rows, walletAddress) {
  const output = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (String(row?.owner || "") !== walletAddress) continue;
    const mint = String(row?.mint || "");
    const amount = row?.uiTokenAmount?.amount;
    const decimals = Number(row?.uiTokenAmount?.decimals);
    if (!mint || !/^(0|[1-9]\d*)$/.test(String(amount ?? "")) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) continue;
    const prior = output.get(mint) || { amount: 0n, decimals };
    if (prior.decimals !== decimals) fail("token_decimals_conflict", { mint });
    prior.amount += BigInt(amount);
    output.set(mint, prior);
  }
  return output;
}

function programEvidence(transaction) {
  const outer = transaction?.transaction?.message?.instructions;
  const inner = transaction?.meta?.innerInstructions;
  const programs = [];
  const parsedTypes = [];
  const inspectInstruction = (row) => {
    if (!row || typeof row !== "object") return;
    const program = String(row.program || row.programId || "").trim();
    if (program) programs.push(program);
    const type = String(row.parsed?.type || "").trim().toLowerCase();
    if (type) parsedTypes.push(type);
  };
  for (const row of Array.isArray(outer) ? outer : []) inspectInstruction(row);
  for (const group of Array.isArray(inner) ? inner : []) {
    for (const row of Array.isArray(group?.instructions) ? group.instructions : []) inspectInstruction(row);
  }
  const logs = (Array.isArray(transaction?.meta?.logMessages) ? transaction.meta.logMessages : [])
    .map((value) => String(value || "").slice(0, 300));
  const joined = `${parsedTypes.join(" ")} ${logs.join(" ")}`.toLowerCase();
  const hasSwapRoute = programs.some((value) => KNOWN_SWAP_PROGRAMS.has(value))
    || /instruction:\s*(?:swap|route|shared accounts route|exactoutroute)/i.test(joined);
  return {
    program_ids: [...new Set(programs)].slice(0, 32),
    parsed_types: [...new Set(parsedTypes)].slice(0, 32),
    has_mint: parsedTypes.some((value) => value.includes("mintto")) || /instruction: mint/.test(joined),
    has_burn: parsedTypes.some((value) => value.includes("burn")) || /instruction: burn/.test(joined),
    has_create: /initialize.?mint|create.?token/.test(joined),
    has_airdrop: /airdrop/.test(joined),
    has_liquidity_add: /add.?liquidity|deposit.?liquidity/.test(joined),
    has_liquidity_remove: /remove.?liquidity|withdraw.?liquidity/.test(joined),
    has_stake: /instruction: stake|stake account/.test(joined),
    has_unstake: /instruction: unstake|deactivate stake/.test(joined),
    has_borrow: /instruction: borrow/.test(joined),
    has_repay: /instruction: repay/.test(joined),
    swap_invocations: logs.filter((value) => /instruction: swap/i.test(value)).length,
    has_swap_route: hasSwapRoute,
    token_2022_observed: programs.some((value) => value === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
      || /spl-token-2022|token-2022/.test(joined),
  };
}

function economicDeltas(transaction, walletAddress, programs) {
  const meta = transaction?.meta || {};
  const message = transaction?.transaction?.message || {};
  const keys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const pre = tokenBalanceMap(meta.preTokenBalances, walletAddress);
  const post = tokenBalanceMap(meta.postTokenBalances, walletAddress);
  const deltas = [];
  for (const mint of new Set([...pre.keys(), ...post.keys()])) {
    const before = pre.get(mint) || post.get(mint);
    const after = post.get(mint) || pre.get(mint);
    const delta = (post.get(mint)?.amount || 0n) - (pre.get(mint)?.amount || 0n);
    if (delta !== 0n) deltas.push({
      asset_id: `solana:mainnet:spl:${mint}`,
      mint,
      standard: mint === SOLANA_WRAPPED_NATIVE_MINT
        ? "spl_wrapped_native"
        : mint === SOLANA_CANONICAL_USDC_MINT
          ? "spl"
          : programs?.token_2022_observed
            ? "spl_token_2022"
            : "spl_or_token_2022_unresolved",
      decimals: after?.decimals ?? before?.decimals,
      amount_base_units: delta.toString(),
      balance_before_base_units: (pre.get(mint)?.amount || 0n).toString(),
      balance_after_base_units: (post.get(mint)?.amount || 0n).toString(),
    });
  }
  const walletIndex = keys.findIndex((row) => accountAddress(row) === walletAddress);
  const preBalances = Array.isArray(meta.preBalances) ? meta.preBalances : [];
  const postBalances = Array.isArray(meta.postBalances) ? meta.postBalances : [];
  const feeLamports = integer(meta.fee ?? 0, "fee_lamports", { maximum: 10_000_000_000 });
  let walletPaidFee = false;
  let nativeBalanceAfterLamports = null;
  if (walletIndex >= 0 && walletIndex < preBalances.length && walletIndex < postBalances.length) {
    const rawDelta = signedBigint(postBalances[walletIndex], "post_lamports") - signedBigint(preBalances[walletIndex], "pre_lamports");
    walletPaidFee = walletIndex === 0 || accountSigner(keys[walletIndex]);
    nativeBalanceAfterLamports = bigint(postBalances[walletIndex], "post_lamports").toString();
    const economicDelta = rawDelta + (walletPaidFee ? BigInt(feeLamports) : 0n);
    if (economicDelta !== 0n) deltas.push({
      asset_id: "solana:mainnet:native:SOL",
      mint: "native_sol",
      standard: "native",
      decimals: 9,
      amount_base_units: economicDelta.toString(),
      balance_before_base_units: bigint(preBalances[walletIndex], "pre_lamports").toString(),
      balance_after_base_units: bigint(postBalances[walletIndex], "post_lamports").toString(),
    });
  }
  return {
    deltas,
    fee_lamports: feeLamports,
    wallet_paid_fee: walletPaidFee,
    native_balance_after_lamports: nativeBalanceAfterLamports,
    canonical_usdc_balance_after_base_units: post.get(SOLANA_CANONICAL_USDC_MINT)?.amount?.toString() || null,
  };
}

function isCanonicalSpend(asset) {
  return BASE_ASSETS.has(asset?.mint);
}

function classifyEvent({ transaction, deltas, programs }) {
  if (transaction?.meta?.err != null) return { kind: "FAILED_TRANSACTION", confidence: "observed", reasons: ["chain_transaction_failed"] };
  const positive = deltas.filter((row) => signedBigint(row.amount_base_units, "delta") > 0n);
  const negative = deltas.filter((row) => signedBigint(row.amount_base_units, "delta") < 0n);
  if (programs.has_liquidity_add) return { kind: "LIQUIDITY_ADD", confidence: "inferred", reasons: ["liquidity_instruction_observed"] };
  if (programs.has_liquidity_remove) return { kind: "LIQUIDITY_REMOVE", confidence: "inferred", reasons: ["liquidity_instruction_observed"] };
  if (programs.has_stake) return { kind: "STAKE", confidence: "inferred", reasons: ["stake_instruction_observed"] };
  if (programs.has_unstake) return { kind: "UNSTAKE", confidence: "inferred", reasons: ["unstake_instruction_observed"] };
  if (programs.has_borrow) return { kind: "BORROW", confidence: "inferred", reasons: ["borrow_instruction_observed"] };
  if (programs.has_repay) return { kind: "REPAY", confidence: "inferred", reasons: ["repay_instruction_observed"] };
  if (programs.has_create) return { kind: "TOKEN_CREATION", confidence: "inferred", reasons: ["token_creation_instruction_observed"] };
  if (programs.has_mint && positive.length) return { kind: "MINT", confidence: "observed", reasons: ["mint_instruction_and_balance_increase"] };
  if (programs.has_burn && negative.length) return { kind: "BURN", confidence: "observed", reasons: ["burn_instruction_and_balance_decrease"] };
  if (positive.length === 1 && negative.length === 1) {
    if (!programs.has_swap_route) return { kind: "AMBIGUOUS", confidence: "insufficient", reasons: ["opposing_balance_changes_without_swap_route_evidence"] };
    if (programs.swap_invocations > 1) return { kind: "SPLIT_ROUTE_SWAP", confidence: "inferred", reasons: ["economic_endpoints_observed", "multiple_swap_invocations"] };
    if (isCanonicalSpend(negative[0]) && !isCanonicalSpend(positive[0])) return { kind: "SWAP_BUY", confidence: "observed", reasons: ["canonical_spend_and_token_receipt"] };
    if (!isCanonicalSpend(negative[0]) && isCanonicalSpend(positive[0])) return { kind: "SWAP_SELL", confidence: "observed", reasons: ["token_spend_and_canonical_receipt"] };
    return { kind: "MULTIHOP_SWAP", confidence: "inferred", reasons: ["one_asset_spent_and_one_asset_received"] };
  }
  if (positive.length > 0 && negative.length > 0) return { kind: "AMBIGUOUS", confidence: "insufficient", reasons: ["multiple_economic_endpoints"] };
  if (positive.length === 1) {
    if (programs.has_airdrop) return { kind: "AIRDROP", confidence: "inferred", reasons: ["airdrop_instruction_and_balance_increase"] };
    return { kind: "TRANSFER_IN", confidence: "observed", reasons: ["asset_increase_without_observed_consideration"] };
  }
  if (negative.length === 1) return { kind: "TRANSFER_OUT", confidence: "observed", reasons: ["asset_decrease_without_observed_consideration"] };
  if (programs.parsed_types.some((value) => value.includes("transfer"))) return { kind: "INTERNAL_ACCOUNT_MOVEMENT", confidence: "inferred", reasons: ["transfer_instruction_without_wallet_economic_delta"] };
  return { kind: "NON_TRADE", confidence: "observed", reasons: ["no_wallet_economic_delta"] };
}

function endpoint(deltas, direction) {
  const candidates = deltas.filter((row) => direction === "in"
    ? signedBigint(row.amount_base_units, "delta") > 0n
    : signedBigint(row.amount_base_units, "delta") < 0n);
  if (candidates.length !== 1) return null;
  const row = candidates[0];
  const signed = signedBigint(row.amount_base_units, "delta");
  return {
    asset_id: row.asset_id,
    mint: row.mint,
    standard: row.standard,
    decimals: row.decimals,
    amount_base_units: (signed < 0n ? -signed : signed).toString(),
    balance_before_base_units: row.balance_before_base_units,
    balance_after_base_units: row.balance_after_base_units,
  };
}

export function normalizeSolanaWalletTransaction(input = {}) {
  const walletAddress = normalizeSolanaWalletAddress(input.wallet_address);
  const signatureRow = input.signature_record && typeof input.signature_record === "object" ? input.signature_record : {};
  const transaction = input.transaction && typeof input.transaction === "object" ? input.transaction : null;
  const signature = clean(input.signature || signatureRow.signature, "signature", 100);
  if (!transaction) fail("transaction_unavailable");
  const slot = integer(transaction.slot ?? signatureRow.slot, "slot");
  const blockTime = integer(transaction.blockTime ?? signatureRow.blockTime, "block_time", { optional: true });
  const observedAt = timestamp(input.observed_at, "observed_at");
  const providerObservedAt = input.provider_observed_at ? timestamp(input.provider_observed_at, "provider_observed_at") : null;
  const receivedAt = input.received_at ? timestamp(input.received_at, "received_at") : observedAt;
  const decodeStartedAt = input.decode_started_at ? timestamp(input.decode_started_at, "decode_started_at") : receivedAt;
  const decodedAt = input.decoded_at ? timestamp(input.decoded_at, "decoded_at") : observedAt;
  const observationMode = clean(input.observation_mode || "historical_backfill", "observation_mode", 32).toLowerCase();
  if (!new Set(["historical_backfill", "prospective"]).has(observationMode)) fail("observation_mode_invalid");
  if (Date.parse(decodedAt) < Date.parse(decodeStartedAt) || Date.parse(decodeStartedAt) < Date.parse(receivedAt)) fail("wallet_event_timing_invalid");
  const programs = programEvidence(transaction);
  const economic = economicDeltas(transaction, walletAddress, programs);
  const classification = classifyEvent({ transaction, deltas: economic.deltas, programs });
  if (!EVENT_KINDS.has(classification.kind)) fail("wallet_event_kind_invalid");
  const source = endpoint(economic.deltas, "out");
  const destination = endpoint(economic.deltas, "in");
  const eventId = `swe_${digest([walletAddress, signature, "0", String(SOLANA_WALLET_DECODE_VERSION)])}`;
  const event = {
    schema_version: SOLANA_WALLET_EVENT_SCHEMA,
    decode_version: SOLANA_WALLET_DECODE_VERSION,
    event_id: eventId,
    source_wallet: { chain: "solana", network: "mainnet", address: walletAddress },
    chain_evidence: {
      signature,
      slot,
      block_time: blockTime === null ? null : new Date(blockTime * 1_000).toISOString(),
      finality: clean(input.finality || signatureRow.confirmationStatus || "confirmed", "finality", 20).toLowerCase(),
      provider: clean(input.provider || "solana_rpc", "provider", 60),
      raw_evidence_reference: `solana:signature:${signature}`,
    },
    timing: {
      chain_event_at: blockTime === null ? null : new Date(blockTime * 1_000).toISOString(),
      provider_observed_at: providerObservedAt,
      raven_received_at: receivedAt,
      decode_started_at: decodeStartedAt,
      decode_completed_at: decodedAt,
      observation_mode: observationMode,
      detection_delay_ms: observationMode !== "prospective" || blockTime === null ? null : Math.max(0, Date.parse(receivedAt) - (blockTime * 1_000)),
      decode_latency_ms: Math.max(0, Date.parse(decodedAt) - Date.parse(decodeStartedAt)),
    },
    classification: {
      kind: classification.kind,
      confidence: classification.confidence,
      reasons: classification.reasons,
      observed: classification.confidence === "observed",
      reconstructed: classification.confidence !== "observed",
      ambiguous: classification.kind === "AMBIGUOUS" || classification.kind === "UNSUPPORTED",
    },
    economic: {
      source_asset: source,
      destination_asset: destination,
      deltas: economic.deltas,
      transaction_fee_lamports: economic.fee_lamports,
      wallet_paid_transaction_fee: economic.wallet_paid_fee,
      cost_basis_state: source?.mint === SOLANA_CANONICAL_USDC_MINT
        ? "known_canonical_usdc"
        : new Set([SOLANA_WRAPPED_NATIVE_MINT, "native_sol"]).has(source?.mint)
          ? "known_native_sol"
          : "unresolved_non_settlement_basis",
    },
    wallet_state: {
      observation_scope: "accounts_touched_by_exact_transaction",
      current_balance_claimed: false,
      native_sol_balance_lamports: economic.native_balance_after_lamports,
      canonical_usdc_balance_base_units: economic.canonical_usdc_balance_after_base_units,
      observed_at: blockTime === null ? observedAt : new Date(blockTime * 1_000).toISOString(),
    },
    route_evidence: {
      program_ids: programs.program_ids,
      swap_invocations: programs.swap_invocations,
      swap_route_observed: programs.has_swap_route,
      route_shape: classification.kind === "SPLIT_ROUTE_SWAP" ? "split" : classification.kind === "MULTIHOP_SWAP" ? "multi_hop_or_asset_exchange" : "not_proven",
    },
    copy_signal: {
      eligible_buy_signal: classification.kind === "SWAP_BUY" && Boolean(destination) && !isCanonicalSpend(destination),
      exact_destination_asset: classification.kind === "SWAP_BUY" ? destination : null,
      eligible_sell_signal: classification.kind === "SWAP_SELL" && Boolean(source) && !isCanonicalSpend(source),
      exact_source_asset: classification.kind === "SWAP_SELL" ? source : null,
      reason: classification.kind === "SWAP_BUY"
        ? "observed_source_wallet_buy"
        : classification.kind === "SWAP_SELL"
          ? "observed_source_wallet_sell"
          : "event_is_not_an_exact_copy_trade_signal",
    },
    evidence_hash: "",
    privacy: {
      source_wallet_is_public_chain_data: true,
      subscriber_identity_included: false,
      provider_payload_included: false,
      signer_material_included: false,
      transaction_material_included: false,
    },
  };
  event.evidence_hash = digest([
    event.event_id,
    JSON.stringify(event.economic.deltas),
    event.classification.kind,
    event.chain_evidence.finality,
  ]);
  return freeze(event);
}

function ratioPercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(4));
}

function bigintPercent(numerator, denominator) {
  if (typeof numerator !== "bigint" || typeof denominator !== "bigint" || denominator <= 0n) return null;
  const scaled = (numerator * 1_000_000n) / denominator;
  const safeLimit = BigInt(Number.MAX_SAFE_INTEGER);
  if (scaled > safeLimit || scaled < -safeLimit) return null;
  return Number(scaled) / 10_000;
}

function bigintRatio(numerator, denominator) {
  if (typeof numerator !== "bigint" || typeof denominator !== "bigint" || denominator <= 0n) return null;
  const scaled = (numerator * 10_000n) / denominator;
  const safeLimit = BigInt(Number.MAX_SAFE_INTEGER);
  if (scaled > safeLimit || scaled < -safeLimit) return null;
  return Number(scaled) / 10_000;
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function rounded(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function minimum(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.min(...usable) : null;
}

function maximum(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.max(...usable) : null;
}

function safeObservedTime(row) {
  const parsed = Date.parse(row?.chain_evidence?.block_time || row?.timing?.raven_received_at || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function periodKey(milliseconds, mode) {
  const value = new Date(milliseconds);
  if (mode === "month") return value.toISOString().slice(0, 7);
  const day = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  const monday = day - (((value.getUTCDay() + 6) % 7) * 86_400_000);
  return new Date(monday).toISOString().slice(0, 10);
}

function displayAmount(baseUnits, decimals) {
  const amount = bigint(baseUnits, "profile_amount");
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return Number(`${whole}${fraction ? `.${fraction}` : ""}`);
}

function displaySignedAmount(baseUnits, decimals) {
  const signed = signedBigint(baseUnits, "profile_signed_amount");
  const sign = signed < 0n ? "-" : "";
  const amount = signed < 0n ? -signed : signed;
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return Number(`${sign}${whole}${fraction ? `.${fraction}` : ""}`);
}

function settlementBasis(asset) {
  if (asset?.mint === SOLANA_CANONICAL_USDC_MINT && Number(asset.decimals) === 6) return { key: "usdc", decimals: 6 };
  if (new Set([SOLANA_WRAPPED_NATIVE_MINT, "native_sol"]).has(asset?.mint) && Number(asset.decimals) === 9) return { key: "sol", decimals: 9 };
  return null;
}

function realizedDrawdown(rows) {
  let cumulative = 0n;
  let peak = 0n;
  let maximumDrawdown = 0n;
  for (const row of [...rows].sort((left, right) => left.closed_at - right.closed_at)) {
    cumulative += row.pnl_units;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maximumDrawdown) maximumDrawdown = drawdown;
  }
  return { maximum: maximumDrawdown, current: peak - cumulative };
}

function outcomeStreaks(rows) {
  let currentKind = null;
  let currentLength = 0;
  let winning = 0;
  let losing = 0;
  for (const row of [...rows].sort((left, right) => left.closed_at - right.closed_at)) {
    const kind = row.pnl_units > 0n ? "win" : row.pnl_units < 0n ? "loss" : "flat";
    if (kind === currentKind) currentLength += 1;
    else {
      currentKind = kind;
      currentLength = 1;
    }
    if (kind === "win") winning = Math.max(winning, currentLength);
    if (kind === "loss") losing = Math.max(losing, currentLength);
  }
  return { longest_winning_streak: winning, longest_losing_streak: losing };
}

function periodConsistency(rows, mode) {
  const periods = new Map();
  for (const row of rows) {
    const key = periodKey(row.closed_at, mode);
    periods.set(key, (periods.get(key) || 0n) + row.pnl_units);
  }
  const values = [...periods.values()];
  const profitable = values.filter((value) => value > 0n).length;
  return {
    active_periods: values.length,
    profitable_periods: profitable,
    profitable_period_pct: ratioPercent(profitable, values.length),
  };
}

function tokenProfitConcentration(rows, basis, decimals) {
  const byToken = new Map();
  for (const row of rows.filter((candidate) => candidate.basis === basis && candidate.pnl_units > 0n)) {
    byToken.set(row.mint, (byToken.get(row.mint) || 0n) + row.pnl_units);
  }
  const ranked = [...byToken.entries()].sort((left, right) => left[1] === right[1] ? left[0].localeCompare(right[0]) : left[1] > right[1] ? -1 : 1);
  const grossProfit = ranked.reduce((sum, [, value]) => sum + value, 0n);
  const concentration = (count) => grossProfit > 0n
    ? bigintPercent(ranked.slice(0, count).reduce((sum, [, value]) => sum + value, 0n), grossProfit)
    : null;
  return {
    top_1_profit_concentration_pct: concentration(1),
    top_3_profit_concentration_pct: concentration(3),
    top_5_profit_concentration_pct: concentration(5),
    top_contributors: ranked.slice(0, 5).map(([mint, value]) => ({
      mint,
      basis,
      gross_profit: displayAmount(value.toString(), decimals),
      gross_profit_share_pct: grossProfit > 0n ? bigintPercent(value, grossProfit) : null,
    })),
  };
}

function basisAggregate(rows, basis) {
  const selected = rows.filter((row) => row.basis === basis);
  const pnl = selected.reduce((sum, row) => sum + row.pnl_units, 0n);
  const cost = selected.reduce((sum, row) => sum + row.cost_units, 0n);
  const gains = selected.filter((row) => row.pnl_units > 0n).reduce((sum, row) => sum + row.pnl_units, 0n);
  const losses = selected.filter((row) => row.pnl_units < 0n).reduce((sum, row) => sum + row.pnl_units, 0n);
  const decimals = basis === "usdc" ? 6 : 9;
  const pnlValues = selected.map((row) => displaySignedAmount(row.pnl_units.toString(), decimals));
  const winnerValues = selected.filter((row) => row.pnl_units > 0n).map((row) => displayAmount(row.pnl_units.toString(), decimals));
  const loserValues = selected.filter((row) => row.pnl_units < 0n).map((row) => displaySignedAmount(row.pnl_units.toString(), decimals));
  const roiValues = selected.map((row) => row.roi_pct).filter(Number.isFinite);
  const winnerRoi = selected.filter((row) => row.pnl_units > 0n).map((row) => row.roi_pct).filter(Number.isFinite);
  const loserRoi = selected.filter((row) => row.pnl_units < 0n).map((row) => row.roi_pct).filter(Number.isFinite);
  const drawdown = realizedDrawdown(selected);
  const concentration = tokenProfitConcentration(selected, basis, decimals);
  return {
    count: selected.length,
    pnl: selected.length ? displaySignedAmount(pnl.toString(), decimals) : null,
    cost: selected.length ? displayAmount(cost.toString(), decimals) : null,
    gross_profit: selected.length ? displayAmount(gains.toString(), decimals) : null,
    gross_loss: selected.length ? displaySignedAmount(losses.toString(), decimals) : null,
    roi_pct: cost > 0n ? bigintPercent(pnl, cost) : null,
    profit_factor: losses < 0n ? bigintRatio(gains, -losses) : null,
    winning_observations: winnerValues.length,
    losing_observations: loserValues.length,
    flat_observations: selected.length - winnerValues.length - loserValues.length,
    win_rate_pct: ratioPercent(winnerValues.length, selected.length),
    average_result: rounded(average(pnlValues), decimals),
    median_result: rounded(median(pnlValues), decimals),
    average_winner: rounded(average(winnerValues), decimals),
    median_winner: rounded(median(winnerValues), decimals),
    average_loser: rounded(average(loserValues), decimals),
    median_loser: rounded(median(loserValues), decimals),
    largest_winner: rounded(maximum(winnerValues), decimals),
    largest_loser: rounded(minimum(loserValues), decimals),
    average_trade_roi_pct: rounded(average(roiValues)),
    median_trade_roi_pct: rounded(median(roiValues)),
    average_winner_roi_pct: rounded(average(winnerRoi)),
    median_winner_roi_pct: rounded(median(winnerRoi)),
    average_loser_roi_pct: rounded(average(loserRoi)),
    median_loser_roi_pct: rounded(median(loserRoi)),
    maximum_winner_roi_pct: rounded(maximum(winnerRoi)),
    maximum_loser_roi_pct: rounded(minimum(loserRoi)),
    maximum_realized_drawdown: displayAmount(drawdown.maximum.toString(), decimals),
    current_realized_drawdown: displayAmount(drawdown.current.toString(), decimals),
    ...outcomeStreaks(selected),
    weekly_consistency: periodConsistency(selected, "week"),
    monthly_consistency: periodConsistency(selected, "month"),
    ...concentration,
  };
}

function buyNotionalAggregate(rows, basis) {
  const decimals = basis === "usdc" ? 6 : 9;
  const values = rows
    .filter((row) => settlementBasis(row.economic.source_asset)?.key === basis)
    .map((row) => displayAmount(row.economic.source_asset.amount_base_units, decimals));
  if (!values.length) {
    return {
      count: 0,
      total: null,
      average: null,
      median: null,
    };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    total: Number(total.toFixed(decimals)),
    average: Number((total / values.length).toFixed(decimals)),
    median: Number(median(values).toFixed(decimals)),
  };
}

function sellNotionalAggregate(rows, basis) {
  const decimals = basis === "usdc" ? 6 : 9;
  const values = rows
    .filter((row) => settlementBasis(row.economic.destination_asset)?.key === basis)
    .map((row) => displayAmount(row.economic.destination_asset.amount_base_units, decimals));
  if (!values.length) return { count: 0, total: null, average: null, median: null };
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    total: rounded(total, decimals),
    average: rounded(total / values.length, decimals),
    median: rounded(median(values), decimals),
  };
}

function performanceWindow(rows, cutoffMilliseconds = null) {
  const selected = cutoffMilliseconds === null ? rows : rows.filter((row) => row.closed_at >= cutoffMilliseconds);
  const usdc = basisAggregate(selected, "usdc");
  const sol = basisAggregate(selected, "sol");
  const bases = [usdc.count, sol.count].filter((count) => count > 0).length;
  return {
    state: selected.length ? "available" : "insufficient_evidence",
    observations: selected.length,
    realized_pnl: { usdc: usdc.pnl, sol: sol.pnl, combined: null, bases_combined: false },
    roi_pct: bases === 1 ? (usdc.roi_pct ?? sol.roi_pct) : null,
    win_rate_pct: selected.length ? ratioPercent(selected.filter((row) => row.pnl_units > 0n).length, selected.length) : null,
    by_basis: { usdc, sol },
  };
}

function holdDistribution(holds) {
  const seconds = holds.map((value) => value / 1_000).filter((value) => Number.isFinite(value) && value >= 0);
  const under = (limit) => ratioPercent(seconds.filter((value) => value < limit).length, seconds.length);
  return {
    observations: seconds.length,
    minimum_seconds: rounded(minimum(seconds), 0),
    median_seconds: rounded(median(seconds), 0),
    average_seconds: rounded(average(seconds), 0),
    maximum_seconds: rounded(maximum(seconds), 0),
    under_30_seconds_pct: under(30),
    under_1_minute_pct: under(60),
    under_5_minutes_pct: under(300),
    under_1_hour_pct: under(3_600),
    over_24_hours_pct: ratioPercent(seconds.filter((value) => value > 86_400).length, seconds.length),
    over_7_days_pct: ratioPercent(seconds.filter((value) => value > 604_800).length, seconds.length),
  };
}

function mechanicalPatternEvidence(trades) {
  const timed = trades.map((row) => ({ row, at: safeObservedTime(row) })).filter((entry) => entry.at !== null).sort((left, right) => left.at - right.at);
  const intervals = timed.slice(1).map((entry, index) => Math.max(0, entry.at - timed[index].at));
  const settlementSizes = new Map();
  for (const trade of trades) {
    const endpointValue = settlementBasis(trade.economic.source_asset)
      ? trade.economic.source_asset
      : settlementBasis(trade.economic.destination_asset)
        ? trade.economic.destination_asset
        : null;
    if (!endpointValue) continue;
    const key = `${settlementBasis(endpointValue).key}:${endpointValue.amount_base_units}`;
    settlementSizes.set(key, (settlementSizes.get(key) || 0) + 1);
  }
  const sizedTrades = [...settlementSizes.values()].reduce((sum, count) => sum + count, 0);
  const repeatedTrades = [...settlementSizes.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  const rapidPct = ratioPercent(intervals.filter((value) => value < 30_000).length, intervals.length);
  const repeatedPct = ratioPercent(repeatedTrades, sizedTrades);
  let state = "insufficient_evidence";
  if (trades.length >= 12) {
    state = (rapidPct ?? 0) >= 60 && (repeatedPct ?? 0) >= 50
      ? "high"
      : (rapidPct ?? 0) >= 40 || (repeatedPct ?? 0) >= 40
        ? "moderate"
        : "low";
  }
  return {
    state,
    trade_sample_size: trades.length,
    interval_sample_size: intervals.length,
    rapid_under_30_seconds_pct: rapidPct,
    repeated_exact_settlement_size_pct: repeatedPct,
    conclusion_scope: "mechanical_timing_and_sizing_patterns_only",
    person_or_bot_identity_claimed: false,
  };
}

function latestBalanceObservation(rows, field, decimals) {
  const match = [...rows].reverse().find((row) => row?.wallet_state?.[field] !== null && row?.wallet_state?.[field] !== undefined);
  if (!match) return { amount: null, observed_at: null, state: "unavailable", current_balance_claimed: false };
  return {
    amount: displayAmount(match.wallet_state[field], decimals),
    observed_at: match.wallet_state.observed_at || match.chain_evidence.block_time || null,
    state: "last_observed_in_transaction",
    current_balance_claimed: false,
  };
}

function reconstructionQuality({ rows, knownBuys, costBasisObservationCount, history }) {
  const requested = Number(history?.signatures_requested);
  const decoded = Number(history?.transactions_decoded);
  const decodeCoverage = Number.isFinite(requested) && requested > 0 && Number.isFinite(decoded)
    ? ratioPercent(Math.min(decoded, requested), requested)
    : null;
  const classified = rows.filter((row) => !new Set(["AMBIGUOUS", "UNSUPPORTED"]).has(row.classification.kind)).length;
  const classificationCoverage = ratioPercent(classified, rows.length);
  const costBasisCoverage = ratioPercent(knownBuys.length, costBasisObservationCount);
  const available = [decodeCoverage, classificationCoverage, costBasisCoverage].filter(Number.isFinite);
  const providerHistoryExhausted = history?.history_exhausted === true
    || history?.provider_history_exhausted === true
    || history?.history_scope === "provider_window_exhausted";
  const analysisEvents = Number(history?.analysis_events);
  const analysisEventLimit = Number(history?.analysis_event_limit);
  const analysisTruncated = history?.analysis_truncated === true;
  const verifiedComplete = history?.source_history_verified_complete === true && !analysisTruncated;
  return {
    history_scope: providerHistoryExhausted ? "provider_window_exhausted" : "bounded_partial_history",
    history_complete: verifiedComplete,
    provider_history_exhausted: providerHistoryExhausted,
    history_limit: Number.isSafeInteger(Number(history?.history_limit)) ? Number(history.history_limit) : null,
    provider: typeof history?.provider === "string" ? history.provider : null,
    signatures_requested: Number.isSafeInteger(requested) ? requested : null,
    transactions_decoded: Number.isSafeInteger(decoded) ? decoded : null,
    analysis_events: Number.isSafeInteger(analysisEvents) ? analysisEvents : rows.length,
    analysis_event_limit: Number.isSafeInteger(analysisEventLimit) ? analysisEventLimit : null,
    analysis_truncated: analysisTruncated,
    analysis_scope: analysisTruncated ? "most_recent_normalized_events" : "all_retained_normalized_events",
    trade_decode_coverage_pct: decodeCoverage,
    classification_coverage_pct: classificationCoverage,
    cost_basis_coverage_pct: costBasisCoverage,
    historical_price_evidence_coverage_pct: null,
    entry_liquidity_evidence_coverage_pct: null,
    reconstruction_confidence_pct: available.length ? rounded(average(available)) : null,
    full_data_confidence_pct: null,
    full_data_confidence_state: "insufficient_historical_price_and_liquidity_evidence",
  };
}

export function buildSolanaWalletProfile(events = [], {
  generated_at: generatedAt = new Date().toISOString(),
  history = null,
} = {}) {
  const rows = (Array.isArray(events) ? events : []).filter((row) => row?.schema_version === SOLANA_WALLET_EVENT_SCHEMA).slice(0, MAX_EVENTS);
  if (!rows.length) fail("wallet_profile_events_required");
  const walletAddress = rows[0].source_wallet.address;
  if (rows.some((row) => row.source_wallet.address !== walletAddress)) fail("wallet_profile_owner_mismatch");
  const generatedAtIso = timestamp(generatedAt, "profile_generated_at");
  const generatedAtMs = Date.parse(generatedAtIso);
  const ordered = [...rows].sort((left, right) => (safeObservedTime(left) ?? 0) - (safeObservedTime(right) ?? 0));
  const trades = ordered.filter((row) => TRADE_KINDS.has(row.classification.kind));
  const buyTrades = trades.filter((row) => row.classification.kind === "SWAP_BUY");
  const sellTrades = trades.filter((row) => row.classification.kind === "SWAP_SELL");
  const knownBuys = buyTrades.filter((row) => settlementBasis(row.economic.source_asset) && row.economic.destination_asset);
  const knownUsdcBuys = knownBuys.filter((row) => settlementBasis(row.economic.source_asset)?.key === "usdc");
  const knownSolBuys = knownBuys.filter((row) => settlementBasis(row.economic.source_asset)?.key === "sol");
  const unknownBasisEvents = ordered.filter((row) => (
    new Set(["TRANSFER_IN", "AIRDROP"]).has(row.classification.kind)
      && row.economic.destination_asset
      && !isCanonicalSpend(row.economic.destination_asset)
  ) || (row.classification.kind === "SWAP_BUY" && !settlementBasis(row.economic.source_asset)));
  const lots = new Map();
  const realized = [];
  const holds = [];
  const entryCounts = new Map();
  const exitCounts = new Map();
  let unmatchedSellCount = 0;
  for (const event of ordered) {
    const source = event.economic.source_asset;
    const destination = event.economic.destination_asset;
    const at = Date.parse(event.chain_evidence.block_time || event.timing.raven_received_at);
    const buyBasis = settlementBasis(source);
    if (event.classification.kind === "SWAP_BUY" && buyBasis && destination) {
      const list = lots.get(destination.mint) || [];
      list.push({
        quantity: bigint(destination.amount_base_units, "lot_quantity"),
        cost_units: bigint(source.amount_base_units, "lot_cost"),
        basis: buyBasis.key,
        opened_at: at,
        decimals: destination.decimals,
        event_id: event.event_id,
      });
      lots.set(destination.mint, list);
      entryCounts.set(destination.mint, (entryCounts.get(destination.mint) || 0) + 1);
    }
    const saleBasis = settlementBasis(destination);
    if (event.classification.kind === "SWAP_SELL" && saleBasis && source) {
      let remaining = bigint(source.amount_base_units, "sale_quantity");
      let matchedCost = 0n;
      let matchedQuantity = 0n;
      const list = lots.get(source.mint) || [];
      exitCounts.set(source.mint, (exitCounts.get(source.mint) || 0) + 1);
      while (remaining > 0n) {
        const lotIndex = list.findIndex((lot) => lot.basis === saleBasis.key);
        if (lotIndex < 0) break;
        const lot = list[lotIndex];
        const take = remaining < lot.quantity ? remaining : lot.quantity;
        const cost = lot.quantity === take ? lot.cost_units : (lot.cost_units * take) / lot.quantity;
        matchedCost += cost;
        matchedQuantity += take;
        remaining -= take;
        lot.quantity -= take;
        lot.cost_units -= cost;
        holds.push(Math.max(0, at - lot.opened_at));
        if (lot.quantity === 0n) list.splice(lotIndex, 1);
      }
      lots.set(source.mint, list);
      if (remaining > 0n) unmatchedSellCount += 1;
      if (matchedQuantity > 0n) {
        const sold = bigint(source.amount_base_units, "sale_quantity");
        const gross = bigint(destination.amount_base_units, "sale_proceeds");
        const matchedProceeds = sold === matchedQuantity ? gross : (gross * matchedQuantity) / sold;
        const pnlUnits = matchedProceeds - matchedCost;
        realized.push({
          basis: saleBasis.key,
          mint: source.mint,
          closed_at: at,
          pnl_units: pnlUnits,
          proceeds_units: matchedProceeds,
          cost_units: matchedCost,
          roi_pct: bigintPercent(pnlUnits, matchedCost),
        });
      }
    }
  }
  const usdcPerformance = basisAggregate(realized, "usdc");
  const solPerformance = basisAggregate(realized, "sol");
  const wins = realized.filter((row) => row.pnl_units > 0n).length;
  const times = ordered.map((row) => Date.parse(row.chain_evidence.block_time || row.timing.raven_received_at)).filter(Number.isFinite);
  const tradeTimes = trades.map((row) => Date.parse(row.chain_evidence.block_time || row.timing.raven_received_at)).filter(Number.isFinite);
  const activeDays = new Set(tradeTimes.map((value) => new Date(value).toISOString().slice(0, 10))).size;
  const tokensTraded = new Set();
  for (const trade of trades) {
    for (const asset of [trade.economic.source_asset, trade.economic.destination_asset]) {
      if (asset?.mint && !BASE_ASSETS.has(asset.mint)) tokensTraded.add(asset.mint);
    }
  }
  const buyNotionalByBasis = {
    usdc: buyNotionalAggregate(knownBuys, "usdc"),
    sol: buyNotionalAggregate(knownBuys, "sol"),
  };
  const sellNotionalByBasis = {
    usdc: sellNotionalAggregate(sellTrades, "usdc"),
    sol: sellNotionalAggregate(sellTrades, "sol"),
  };
  const classificationCounts = Object.fromEntries(SolanaWalletEventKinds.map((kind) => [kind, ordered.filter((row) => row.classification.kind === kind).length]).filter(([, count]) => count));
  const costBasisObservationCount = knownBuys.length + unknownBasisEvents.length;
  const knownCostBasisPct = ratioPercent(knownBuys.length, costBasisObservationCount);
  const knownUsdcCostBasisPct = ratioPercent(knownUsdcBuys.length, costBasisObservationCount);
  const knownSolCostBasisPct = ratioPercent(knownSolBuys.length, costBasisObservationCount);
  const sourceState = realized.length ? (unknownBasisEvents.length ? "partial" : "available") : "insufficient_evidence";
  const realizedBasisCount = [usdcPerformance.count, solPerformance.count].filter((count) => count > 0).length;
  const singleBasisRoi = realizedBasisCount === 1 ? (usdcPerformance.roi_pct ?? solPerformance.roi_pct) : null;
  const singleBasisProfitFactor = realizedBasisCount === 1 ? (usdcPerformance.profit_factor ?? solPerformance.profit_factor) : null;
  const quality = reconstructionQuality({ rows: ordered, knownBuys, costBasisObservationCount, history });
  const openPositions = [...lots.entries()].flatMap(([mint, list]) => {
    const byBasis = new Map();
    for (const lot of list) {
      const key = lot.basis;
      const aggregate = byBasis.get(key) || {
        mint,
        basis: key,
        decimals: lot.decimals,
        quantity_base_units: 0n,
        remaining_cost_units: 0n,
        lot_count: 0,
        first_opened_at: lot.opened_at,
      };
      aggregate.quantity_base_units += lot.quantity;
      aggregate.remaining_cost_units += lot.cost_units;
      aggregate.lot_count += 1;
      aggregate.first_opened_at = Math.min(aggregate.first_opened_at, lot.opened_at);
      byBasis.set(key, aggregate);
    }
    return [...byBasis.values()].map((row) => ({
      mint: row.mint,
      basis: row.basis,
      quantity_base_units: row.quantity_base_units.toString(),
      token_decimals: row.decimals,
      remaining_cost: displayAmount(row.remaining_cost_units.toString(), row.basis === "usdc" ? 6 : 9),
      lot_count: row.lot_count,
      first_opened_at: new Date(row.first_opened_at).toISOString(),
      marked_value: null,
      executable_liquidation_value: null,
    }));
  }).sort((left, right) => left.mint.localeCompare(right.mint) || left.basis.localeCompare(right.basis));
  const distinctBoughtTokens = entryCounts.size;
  const tokensReentered = [...entryCounts.values()].filter((count) => count > 1).length;
  const tokensScaledOut = [...exitCounts.values()].filter((count) => count > 1).length;
  const holdStats = holdDistribution(holds);
  const windows = {
    h24: performanceWindow(realized, generatedAtMs - 86_400_000),
    d7: performanceWindow(realized, generatedAtMs - (7 * 86_400_000)),
    d30: performanceWindow(realized, generatedAtMs - (30 * 86_400_000)),
    d90: performanceWindow(realized, generatedAtMs - (90 * 86_400_000)),
    all_available: performanceWindow(realized),
  };
  const usdcBalance = latestBalanceObservation(ordered, "canonical_usdc_balance_base_units", 6);
  const solBalance = latestBalanceObservation(ordered, "native_sol_balance_lamports", 9);
  const thesisConcentrations = [usdcPerformance.top_1_profit_concentration_pct, solPerformance.top_1_profit_concentration_pct].filter(Number.isFinite);
  const thesisWeeklyRates = [usdcPerformance.weekly_consistency?.profitable_period_pct, solPerformance.weekly_consistency?.profitable_period_pct].filter(Number.isFinite);
  const researchThesis = buildWalletResearchThesis({
    performance: {
      realized_pnl_usdc: usdcPerformance.pnl,
      realized_pnl_sol: solPerformance.pnl,
      closed_observations: realized.length,
      profit_factor: singleBasisProfitFactor,
    },
    behavior: {
      trade_count: trades.length,
      active_days: activeDays,
      median_hold_seconds: holdStats.median_seconds,
    },
    profit_quality: {
      top_1_profit_concentration_pct: thesisConcentrations.length ? Math.max(...thesisConcentrations) : null,
      profitable_observations: usdcPerformance.winning_observations + solPerformance.winning_observations,
      weekly_profitable_pct: thesisWeeklyRates.length ? Math.min(...thesisWeeklyRates) : null,
    },
    quality: {
      known_cost_basis_pct: knownCostBasisPct,
      reconstruction_confidence_pct: quality.reconstruction_confidence_pct,
      source_history_complete: quality.history_complete,
    },
    follower_reality: { state: "not_sampled" },
    entry_quality_state: "unavailable",
  });
  return freeze({
    schema_version: SOLANA_WALLET_PROFILE_SCHEMA,
    profile_version: 5,
    source_wallet: { chain: "solana", network: "mainnet", address: walletAddress },
    generated_at: generatedAtIso,
    coverage: {
      first_observed_at: times.length ? new Date(Math.min(...times)).toISOString() : null,
      last_observed_at: times.length ? new Date(Math.max(...times)).toISOString() : null,
      transactions_observed: new Set(ordered.map((row) => row.chain_evidence.signature)).size,
      normalized_events: ordered.length,
      trade_events: trades.length,
      ambiguous_events: classificationCounts.AMBIGUOUS || 0,
      failed_transactions: classificationCounts.FAILED_TRANSACTION || 0,
      known_cost_basis_pct: knownCostBasisPct,
      known_usdc_cost_basis_pct: knownUsdcCostBasisPct,
      known_sol_cost_basis_pct: knownSolCostBasisPct,
      cost_basis_observations: costBasisObservationCount,
      known_cost_basis_observations: knownBuys.length,
      unresolved_cost_basis_observations: unknownBasisEvents.length,
      historical_reconstruction: true,
      prospective_observations: ordered.filter((row) => row.timing.observation_mode === "prospective").length,
      history_scope: quality.history_scope,
      source_history_complete: quality.history_complete,
      provider_history_exhausted: quality.provider_history_exhausted,
    },
    source_performance: {
      state: sourceState,
      realized_pnl_usdc: usdcPerformance.pnl,
      realized_pnl_sol: solPerformance.pnl,
      unrealized_pnl_usdc: null,
      unrealized_pnl_sol: null,
      net_trading_pnl_usdc: usdcPerformance.pnl,
      net_trading_pnl_sol: solPerformance.pnl,
      roi_pct: singleBasisRoi,
      roi_pct_by_basis: { usdc: usdcPerformance.roi_pct, sol: solPerformance.roi_pct },
      win_rate_pct: realized.length ? ratioPercent(wins, realized.length) : null,
      closed_lots: realized.length,
      closed_observations: realized.length,
      open_known_cost_lots: [...lots.values()].reduce((sum, list) => sum + list.length, 0),
      profit_factor: singleBasisProfitFactor,
      profit_factor_by_basis: { usdc: usdcPerformance.profit_factor, sol: solPerformance.profit_factor },
      by_basis: { usdc: usdcPerformance, sol: solPerformance },
      windows,
      marked_value_usdc: null,
      executable_liquidation_value_usdc: null,
      limitations: [
        ...(unknownBasisEvents.length ? ["Some positions have unresolved cost basis and are excluded from realized performance."] : []),
        ...(solPerformance.count ? ["SOL-denominated realized performance is kept in SOL and is not converted with current or reconstructed USD prices."] : []),
        ...(realizedBasisCount > 1 ? ["Returns across USDC and SOL settlement bases are not combined into one ROI or profit factor."] : []),
        "Unrealized performance requires current executable liquidation evidence and is not inferred from marks.",
      ],
    },
    behavior: {
      active_days: activeDays,
      trade_count: trades.length,
      first_trade_at: tradeTimes.length ? new Date(Math.min(...tradeTimes)).toISOString() : null,
      last_trade_at: tradeTimes.length ? new Date(Math.max(...tradeTimes)).toISOString() : null,
      tokens_traded: tokensTraded.size,
      trade_rate_per_active_day: activeDays ? Number((trades.length / activeDays).toFixed(4)) : null,
      buy_count: classificationCounts.SWAP_BUY || 0,
      sell_count: classificationCounts.SWAP_SELL || 0,
      transfer_in_count: classificationCounts.TRANSFER_IN || 0,
      transfer_out_count: classificationCounts.TRANSFER_OUT || 0,
      airdrop_count: classificationCounts.AIRDROP || 0,
      median_hold_seconds: holdStats.median_seconds,
      average_hold_seconds: holdStats.average_seconds,
      hold_time_distribution: holdStats,
      buy_notional_by_basis: buyNotionalByBasis,
      sell_notional_by_basis: sellNotionalByBasis,
      unique_tokens_bought: distinctBoughtTokens,
      repeat_token_rate_pct: ratioPercent(tokensReentered, distinctBoughtTokens),
      average_entries_per_bought_token: distinctBoughtTokens ? rounded(buyTrades.length / distinctBoughtTokens) : null,
      average_exits_per_sold_token: exitCounts.size ? rounded(sellTrades.length / exitCounts.size) : null,
      scaled_into_token_pct: ratioPercent(tokensReentered, distinctBoughtTokens),
      scaled_out_token_pct: ratioPercent(tokensScaledOut, exitCounts.size),
      observed_token_exit_coverage_pct: ratioPercent([...entryCounts.keys()].filter((mint) => exitCounts.has(mint)).length, distinctBoughtTokens),
      observed_trade_completion_pct: ratioPercent([...entryCounts.keys()].filter((mint) => exitCounts.has(mint)).length, distinctBoughtTokens),
      observed_trade_completion_scope: "bought_token_with_any_observed_sell",
      unmatched_sell_observations: unmatchedSellCount,
      mechanical_pattern_evidence: mechanicalPatternEvidence(trades),
      classifications: classificationCounts,
    },
    profit_quality: {
      state: realized.length ? "available" : "insufficient_evidence",
      concentration_basis: "share_of_gross_positive_realized_pnl",
      bases_combined: false,
      by_basis: {
        usdc: {
          top_1_profit_concentration_pct: usdcPerformance.top_1_profit_concentration_pct,
          top_3_profit_concentration_pct: usdcPerformance.top_3_profit_concentration_pct,
          top_5_profit_concentration_pct: usdcPerformance.top_5_profit_concentration_pct,
          profitable_observations: usdcPerformance.winning_observations,
          weekly_consistency: usdcPerformance.weekly_consistency,
          monthly_consistency: usdcPerformance.monthly_consistency,
          top_contributors: usdcPerformance.top_contributors,
        },
        sol: {
          top_1_profit_concentration_pct: solPerformance.top_1_profit_concentration_pct,
          top_3_profit_concentration_pct: solPerformance.top_3_profit_concentration_pct,
          top_5_profit_concentration_pct: solPerformance.top_5_profit_concentration_pct,
          profitable_observations: solPerformance.winning_observations,
          weekly_consistency: solPerformance.weekly_consistency,
          monthly_consistency: solPerformance.monthly_consistency,
          top_contributors: solPerformance.top_contributors,
        },
      },
    },
    research_thesis: researchThesis,
    positions: {
      known_cost_open_positions: openPositions,
      known_cost_open_position_count: openPositions.length,
      unresolved_cost_basis_event_count: unknownBasisEvents.length,
      marked_values_available: false,
      executable_values_available: false,
    },
    capital_observations: {
      scope: "last_transaction_touch_only",
      current_balance_claimed: false,
      sol: solBalance,
      canonical_usdc: usdcBalance,
      stablecoin_balance_combined: null,
      portfolio_value_usdc: null,
      executable_portfolio_value_usdc: null,
    },
    entry_quality: {
      state: "unavailable",
      historical_market_cap_at_entry: null,
      historical_liquidity_at_entry: null,
      token_age_at_entry: null,
      reason: "contemporaneous_historical_market_evidence_not_retained",
    },
    exit_behavior: {
      state: holds.length ? "partial" : "insufficient_evidence",
      hold_time_distribution: holdStats,
      partial_exit_token_pct: null,
      multi_exit_token_pct: ratioPercent(tokensScaledOut, exitCounts.size),
      fully_exited_token_pct: null,
      known_cost_fully_exited_token_pct: ratioPercent([...entryCounts.keys()].filter((mint) => !lots.get(mint)?.length && exitCounts.has(mint)).length, distinctBoughtTokens),
      scope: "bounded_observed_history_and_known_cost_fifo_inventory",
      limitation: "Multiple observed exits do not by themselves prove a partial-exit strategy, and unresolved starting inventory prevents a universal fully-exited claim.",
      source_peak_to_exit_time: null,
    },
    data_quality: quality,
    copy_readiness: {
      state: "insufficient_evidence",
      prospective_signals_observed: null,
      executable_copy_pct: null,
      policy_pass_pct: null,
      follower_capture_ratio_pct: null,
      copyability_by_order_size: [],
      source_performance_substituted: false,
    },
    evidence: {
      accounting_method: "fifo_exact_usdc_or_sol_settlement_lots",
      value_method: "economic_balance_deltas",
      sol_and_wrapped_sol_share_native_settlement_basis: true,
      cross_basis_conversion_performed: false,
      unknown_cost_basis_is_zero: false,
      transfers_treated_as_trades: false,
      airdrops_treated_as_profit: false,
      current_marks_used_as_historical_fills: false,
      full_history_claimed: quality.history_complete,
      historical_market_cap_inferred_from_current: false,
      historical_liquidity_inferred_from_current: false,
      source_performance_used_as_copyability: false,
    },
  });
}

export function walletEventDisplayAmount(endpointValue) {
  if (!endpointValue) return null;
  return displayAmount(endpointValue.amount_base_units, endpointValue.decimals);
}
