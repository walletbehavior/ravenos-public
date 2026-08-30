import { createHash } from "node:crypto";

import bs58 from "bs58";

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
const KNOWN_SWAP_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  "675kPX9MHTjS2zt1qfr1NYHuzeKDq1Z4mYqPJ1L5S9LC",
  "CPMMoo8L3F4NbTegBCKVNnYhW3T6HhK7V9rD7NmQ1Fj",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUQpB4c4jUxQ3YMpiZ",
  "whirLbMiicVdio4qvUfM5KAg6CtR9bV11MZWdN5L8z1",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
]);
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
    });
  }
  const walletIndex = keys.findIndex((row) => accountAddress(row) === walletAddress);
  const preBalances = Array.isArray(meta.preBalances) ? meta.preBalances : [];
  const postBalances = Array.isArray(meta.postBalances) ? meta.postBalances : [];
  const feeLamports = integer(meta.fee ?? 0, "fee_lamports", { maximum: 10_000_000_000 });
  let walletPaidFee = false;
  if (walletIndex >= 0 && walletIndex < preBalances.length && walletIndex < postBalances.length) {
    const rawDelta = signedBigint(postBalances[walletIndex], "post_lamports") - signedBigint(preBalances[walletIndex], "pre_lamports");
    walletPaidFee = walletIndex === 0 || accountSigner(keys[walletIndex]);
    const economicDelta = rawDelta + (walletPaidFee ? BigInt(feeLamports) : 0n);
    if (economicDelta !== 0n) deltas.push({
      asset_id: "solana:mainnet:native:SOL",
      mint: "native_sol",
      standard: "native",
      decimals: 9,
      amount_base_units: economicDelta.toString(),
    });
  }
  return { deltas, fee_lamports: feeLamports, wallet_paid_fee: walletPaidFee };
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
    route_evidence: {
      program_ids: programs.program_ids,
      swap_invocations: programs.swap_invocations,
      swap_route_observed: programs.has_swap_route,
      route_shape: classification.kind === "SPLIT_ROUTE_SWAP" ? "split" : classification.kind === "MULTIHOP_SWAP" ? "multi_hop_or_asset_exchange" : "not_proven",
    },
    copy_signal: {
      eligible_buy_signal: classification.kind === "SWAP_BUY" && Boolean(destination) && !isCanonicalSpend(destination),
      exact_destination_asset: classification.kind === "SWAP_BUY" ? destination : null,
      reason: classification.kind === "SWAP_BUY" ? "observed_source_wallet_buy" : "event_is_not_an_exact_copy_buy_signal",
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

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
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

function basisAggregate(rows, basis) {
  const selected = rows.filter((row) => row.basis === basis);
  const pnl = selected.reduce((sum, row) => sum + row.pnl_units, 0n);
  const cost = selected.reduce((sum, row) => sum + row.cost_units, 0n);
  const gains = selected.filter((row) => row.pnl_units > 0n).reduce((sum, row) => sum + row.pnl_units, 0n);
  const losses = selected.filter((row) => row.pnl_units < 0n).reduce((sum, row) => sum - row.pnl_units, 0n);
  const decimals = basis === "usdc" ? 6 : 9;
  return {
    count: selected.length,
    pnl: selected.length ? displaySignedAmount(pnl.toString(), decimals) : null,
    roi_pct: cost > 0n ? Number(((Number(pnl) / Number(cost)) * 100).toFixed(4)) : null,
    profit_factor: losses > 0n ? Number((Number(gains) / Number(losses)).toFixed(4)) : null,
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

export function buildSolanaWalletProfile(events = [], { generated_at: generatedAt = new Date().toISOString() } = {}) {
  const rows = (Array.isArray(events) ? events : []).filter((row) => row?.schema_version === SOLANA_WALLET_EVENT_SCHEMA).slice(0, MAX_EVENTS);
  if (!rows.length) fail("wallet_profile_events_required");
  const walletAddress = rows[0].source_wallet.address;
  if (rows.some((row) => row.source_wallet.address !== walletAddress)) fail("wallet_profile_owner_mismatch");
  const ordered = [...rows].sort((left, right) => Date.parse(left.chain_evidence.block_time || left.timing.raven_received_at) - Date.parse(right.chain_evidence.block_time || right.timing.raven_received_at));
  const trades = ordered.filter((row) => TRADE_KINDS.has(row.classification.kind));
  const buyTrades = trades.filter((row) => row.classification.kind === "SWAP_BUY");
  const knownBuys = buyTrades.filter((row) => settlementBasis(row.economic.source_asset) && row.economic.destination_asset);
  const knownUsdcBuys = knownBuys.filter((row) => settlementBasis(row.economic.source_asset)?.key === "usdc");
  const knownSolBuys = knownBuys.filter((row) => settlementBasis(row.economic.source_asset)?.key === "sol");
  const unknownBasisEvents = ordered.filter((row) => row.classification.kind === "TRANSFER_IN" || (row.classification.kind === "SWAP_BUY" && !settlementBasis(row.economic.source_asset)));
  const lots = new Map();
  const realized = [];
  const holds = [];
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
      });
      lots.set(destination.mint, list);
    }
    const saleBasis = settlementBasis(destination);
    if (event.classification.kind === "SWAP_SELL" && saleBasis && source) {
      let remaining = bigint(source.amount_base_units, "sale_quantity");
      let matchedCost = 0n;
      let matchedQuantity = 0n;
      const list = lots.get(source.mint) || [];
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
      if (matchedQuantity > 0n) {
        const sold = bigint(source.amount_base_units, "sale_quantity");
        const gross = bigint(destination.amount_base_units, "sale_proceeds");
        const matchedProceeds = sold === matchedQuantity ? gross : (gross * matchedQuantity) / sold;
        realized.push({ basis: saleBasis.key, pnl_units: matchedProceeds - matchedCost, proceeds_units: matchedProceeds, cost_units: matchedCost });
      }
    }
  }
  const usdcPerformance = basisAggregate(realized, "usdc");
  const solPerformance = basisAggregate(realized, "sol");
  const wins = realized.filter((row) => row.pnl_units > 0n).length;
  const times = ordered.map((row) => Date.parse(row.chain_evidence.block_time || row.timing.raven_received_at)).filter(Number.isFinite);
  const tradeTimes = trades.map((row) => Date.parse(row.chain_evidence.block_time || row.timing.raven_received_at)).filter(Number.isFinite);
  const activeDays = new Set(times.map((value) => new Date(value).toISOString().slice(0, 10))).size;
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
  const classificationCounts = Object.fromEntries(SolanaWalletEventKinds.map((kind) => [kind, ordered.filter((row) => row.classification.kind === kind).length]).filter(([, count]) => count));
  const knownCostBasisPct = ratioPercent(knownBuys.length, buyTrades.length);
  const knownUsdcCostBasisPct = ratioPercent(knownUsdcBuys.length, buyTrades.length);
  const knownSolCostBasisPct = ratioPercent(knownSolBuys.length, buyTrades.length);
  const sourceState = realized.length ? (unknownBasisEvents.length ? "partial" : "available") : "insufficient_evidence";
  const realizedBasisCount = [usdcPerformance.count, solPerformance.count].filter((count) => count > 0).length;
  const singleBasisRoi = realizedBasisCount === 1 ? (usdcPerformance.roi_pct ?? solPerformance.roi_pct) : null;
  const singleBasisProfitFactor = realizedBasisCount === 1 ? (usdcPerformance.profit_factor ?? solPerformance.profit_factor) : null;
  return freeze({
    schema_version: SOLANA_WALLET_PROFILE_SCHEMA,
    profile_version: 3,
    source_wallet: { chain: "solana", network: "mainnet", address: walletAddress },
    generated_at: timestamp(generatedAt, "profile_generated_at"),
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
      historical_reconstruction: true,
      prospective_observations: ordered.filter((row) => row.timing.observation_mode === "prospective").length,
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
      open_known_cost_lots: [...lots.values()].reduce((sum, list) => sum + list.length, 0),
      profit_factor: singleBasisProfitFactor,
      profit_factor_by_basis: { usdc: usdcPerformance.profit_factor, sol: solPerformance.profit_factor },
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
      median_hold_seconds: holds.length ? Math.round(median(holds) / 1_000) : null,
      average_hold_seconds: holds.length ? Math.round(holds.reduce((sum, value) => sum + value, 0) / holds.length / 1_000) : null,
      buy_notional_by_basis: buyNotionalByBasis,
      classifications: classificationCounts,
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
    },
  });
}

export function walletEventDisplayAmount(endpointValue) {
  if (!endpointValue) return null;
  return displayAmount(endpointValue.amount_base_units, endpointValue.decimals);
}
