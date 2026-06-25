import { createHash } from "node:crypto";

import {
  createDataProvenance,
  createPublicTerminalError,
  createQuoteResponse,
  normalizeBaseUnits,
} from "./contracts.mjs";
import { inspectSolanaTransactionSkeleton, SolanaInspectionPolicyV1 } from "./inspection.mjs";
import { normalizeJupiterBuildQuote } from "./quote_normalization.mjs";
import { runProviderOperation } from "./terminal_runtime.mjs";

const JUPITER_BUILD_ENDPOINT = "https://api.jup.ag/swap/v2/build";
const BUILD_TIMEOUT_MS = 4_000;
const PREVIEW_TAKER_PUBLIC_KEY = "4Nd1mY7drQZK4v5Q9vU5rPXN9kJ1s6H9mN3aU4mY9QpZ";

const JUPITER_ALLOWED_PROGRAMS = Object.freeze([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
]);

export const SolanaInspectionPolicyV2 = Object.freeze({
  ...SolanaInspectionPolicyV1,
  version: "solana_inspection_policy_v2",
  allowed_programs: Object.freeze(JUPITER_ALLOWED_PROGRAMS),
});

const FIXTURE_BUILD_RESPONSE = Object.freeze({
  requestId: "fixture_build_request_1",
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmount: "100000000",
  outAmount: "14850000",
  otherAmountThreshold: "14770000",
  swapMode: "ExactIn",
  slippageBps: 50,
  priceImpactPct: "0.15",
  routePlan: [
    {
      percent: 100,
      bps: 10000,
      swapInfo: {
        ammKey: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
        label: "Jupiter Router",
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "100000000",
        outAmount: "14850000",
      },
    },
  ],
  computeBudgetInstructions: [
    {
      programId: "ComputeBudget111111111111111111111111111111",
      accounts: [],
      data: "compute-budget",
    },
  ],
  setupInstructions: [
    {
      programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      accounts: [
        { pubkey: PREVIEW_TAKER_PUBLIC_KEY, isWritable: false, isSigner: true },
        { pubkey: "So11111111111111111111111111111111111111112", isWritable: true, isSigner: false },
      ],
      data: "create-ata",
    },
  ],
  swapInstruction: {
    programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
    accounts: [
      { pubkey: PREVIEW_TAKER_PUBLIC_KEY, isWritable: false, isSigner: true },
      { pubkey: "So11111111111111111111111111111111111111112", isWritable: true, isSigner: false },
      { pubkey: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", isWritable: true, isSigner: false },
    ],
    data: "swap-route",
  },
  cleanupInstruction: {
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    accounts: [
      { pubkey: PREVIEW_TAKER_PUBLIC_KEY, isWritable: false, isSigner: true },
    ],
    data: "cleanup-wrap-sol",
  },
  otherInstructions: [],
  tipInstruction: null,
  addressesByLookupTableAddress: {
    LUTPreview11111111111111111111111111111111: [
      PREVIEW_TAKER_PUBLIC_KEY,
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    ],
  },
  blockhashWithMetadata: {
    blockhash: [1, 2, 3, 4],
    lastValidBlockHeight: 314159265,
    fetchedAt: "2026-06-24T20:00:00Z",
  },
});

function quoteErrorPacket(code, message, { retryable = false, details = null } = {}) {
  const publicError = createPublicTerminalError({
    code,
    message,
    component: "transaction_construction",
    retryable,
    quote_blocking: true,
    details,
  });
  return {
    ok: false,
    error: publicError.code,
    public_error: publicError,
    quote_only: true,
    signing_disabled: true,
    submission_disabled: true,
    message,
  };
}

function dedupe(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value))));
}

function previewInstruction(kind, instruction = {}) {
  return {
    kind,
    programId: String(instruction.programId || ""),
    accountCount: Array.isArray(instruction.accounts) ? instruction.accounts.length : 0,
    writableAccountCount: Array.isArray(instruction.accounts)
      ? instruction.accounts.filter((account) => Boolean(account?.isWritable)).length
      : 0,
    signerCount: Array.isArray(instruction.accounts)
      ? instruction.accounts.filter((account) => Boolean(account?.isSigner)).length
      : 0,
    dataLength: instruction.data ? String(instruction.data).length : 0,
  };
}

function allInstructions(payload = {}) {
  const list = [];
  for (const entry of payload.computeBudgetInstructions || []) list.push({ kind: "compute_budget", ...entry });
  for (const entry of payload.setupInstructions || []) list.push({ kind: "setup", ...entry });
  if (payload.swapInstruction) list.push({ kind: "swap", ...payload.swapInstruction });
  if (payload.cleanupInstruction) list.push({ kind: "cleanup", ...payload.cleanupInstruction });
  for (const entry of payload.otherInstructions || []) list.push({ kind: "other", ...entry });
  if (payload.tipInstruction) list.push({ kind: "tip", ...payload.tipInstruction });
  return list;
}

function buildPreviewHash(payload = {}) {
  return createHash("sha256").update(JSON.stringify({
    requestId: payload.requestId || "",
    inputMint: payload.inputMint || "",
    outputMint: payload.outputMint || "",
    inAmount: payload.inAmount || "",
    outAmount: payload.outAmount || "",
    otherAmountThreshold: payload.otherAmountThreshold || "",
    routePlan: payload.routePlan || [],
    computeBudgetInstructions: payload.computeBudgetInstructions || [],
    setupInstructions: payload.setupInstructions || [],
    swapInstruction: payload.swapInstruction || null,
    cleanupInstruction: payload.cleanupInstruction || null,
    otherInstructions: payload.otherInstructions || [],
    tipInstruction: payload.tipInstruction || null,
    addressesByLookupTableAddress: payload.addressesByLookupTableAddress || {},
    blockhashWithMetadata: payload.blockhashWithMetadata || null,
  })).digest("hex");
}

function normalizeInspectionQuote(quote, payload, { buildId, nowMs }) {
  return normalizeJupiterBuildQuote(payload, {
    build_id: buildId,
    source_timestamp: payload.blockhashWithMetadata?.fetchedAt || quote.quote_timestamp || new Date(nowMs).toISOString(),
    received_at: new Date(nowMs).toISOString(),
    quote_expiry: quote.quote_expiry || null,
    freshness_state: "fresh",
    age_seconds: 0,
    warnings: [],
    transaction_material_available: true,
    inspection_state: "ready",
    review_blocked_state: false,
    blocked_reasons: [],
  });
}

function buildSkeletonFromPayload(payload, { quote, taker }) {
  const instructions = allInstructions(payload);
  const lookupTables = Object.entries(payload.addressesByLookupTableAddress || {}).map(([address, addresses]) => ({
    address,
    resolved_addresses: Array.isArray(addresses) ? addresses.map(String) : [],
  }));
  const writableAccounts = dedupe(instructions.flatMap((instruction) =>
    Array.isArray(instruction.accounts)
      ? instruction.accounts.filter((account) => Boolean(account?.isWritable)).map((account) => account.pubkey)
      : []
  ));
  const signers = dedupe(instructions.flatMap((instruction) =>
    Array.isArray(instruction.accounts)
      ? instruction.accounts.filter((account) => Boolean(account?.isSigner)).map((account) => account.pubkey)
      : []
  ));
  const programIds = dedupe(instructions.map((instruction) => instruction.programId));
  const normalizedMinimumOutput = normalizeBaseUnits(payload.otherAmountThreshold || quote.minimum_output_amount_base_units, "minimum_output_amount_base_units");
  return {
    version: lookupTables.length ? "v0" : "legacy",
    lookup_tables_required: lookupTables.length > 0,
    lookup_tables_resolved: lookupTables.every((entry) => Array.isArray(entry.resolved_addresses) && entry.resolved_addresses.length > 0),
    lookup_tables: lookupTables,
    resolved_message_hash: buildPreviewHash(payload),
    expected_signer: taker,
    fee_payer: taker,
    input_mint: payload.inputMint || quote.route_legs?.[0]?.input_asset?.address || "",
    output_mint: payload.outputMint || quote.route_legs?.at?.(-1)?.output_asset?.address || "",
    maximum_input: normalizeBaseUnits(payload.inAmount || quote.input_amount_base_units, "input_amount_base_units"),
    minimum_output: normalizedMinimumOutput,
    quote_expiry: quote.quote_expiry || null,
    program_ids: programIds,
    instructions: instructions.map((instruction) => previewInstruction(instruction.kind, instruction)),
    writable_accounts: writableAccounts,
    authority_instructions: [],
    hidden_fee_recipient: false,
    unsupported_token_2022_extensions: [],
    provider_sponsored_gas: false,
    compute_budget: payload.computeBudgetInstructions?.length
      ? { instruction_count: payload.computeBudgetInstructions.length }
      : null,
    priority_fee: payload.tipInstruction
      ? { tip_instruction_present: true }
      : (payload.computeBudgetInstructions?.length ? { compute_budget_instruction_count: payload.computeBudgetInstructions.length } : null),
    fee_recipients: [],
    simulation_state: "not_requested",
    simulation_source: null,
    blockhash_with_metadata: payload.blockhashWithMetadata || null,
    wrap_and_unwrap_sol: true,
    has_cleanup_instruction: Boolean(payload.cleanupInstruction),
    has_setup_instructions: Array.isArray(payload.setupInstructions) && payload.setupInstructions.length > 0,
  };
}

async function fetchJsonWithTimeout(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        ...(process.env.JUPITER_API_KEY ? { "x-api-key": String(process.env.JUPITER_API_KEY) } : {}),
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => {
      throw new Error("provider_invalid_json");
    });
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

function buildUrlFromQuote(quote, taker) {
  const url = new URL(JUPITER_BUILD_ENDPOINT);
  url.searchParams.set("inputMint", quote.route_legs?.[0]?.input_asset?.address || quote.route?.[0]?.input_asset?.address || quote.input_asset?.address || "");
  url.searchParams.set("outputMint", quote.route_legs?.at?.(-1)?.output_asset?.address || quote.route?.at?.(-1)?.output_asset?.address || quote.output_asset?.address || "");
  url.searchParams.set("amount", quote.input_amount_base_units);
  url.searchParams.set("slippageBps", String(quote.execution_cost_preview?.estimated_slippage?.slippage_bps || 50));
  url.searchParams.set("swapMode", "ExactIn");
  url.searchParams.set("taker", taker);
  url.searchParams.set("wrapAndUnwrapSol", "true");
  return url;
}

export async function buildSolanaTransactionInspection(rawInput = {}, {
  buildId = "",
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = BUILD_TIMEOUT_MS,
  fixtureMode = false,
} = {}) {
  let quote;
  try {
    quote = createQuoteResponse(rawInput.quote || {});
  } catch (error) {
    return quoteErrorPacket("invalid_quote_payload", "Quote payload unavailable for inspection.", {
      details: { reason: String(error?.message || error) },
    });
  }
  const nowMs = now();
  const quoteExpiryMs = quote.quote_expiry ? Date.parse(quote.quote_expiry) : null;
  if (quoteExpiryMs && quoteExpiryMs <= nowMs) {
    return quoteErrorPacket("quote_expired", "Quote expired before inspection.", {
      retryable: true,
    });
  }

  const walletSnapshot = rawInput.wallet_capability_snapshot || null;
  const taker = String(walletSnapshot?.public_address || rawInput.public_address || PREVIEW_TAKER_PUBLIC_KEY);
  const warnings = [];
  if (!walletSnapshot?.public_address) warnings.push("preview_taker_placeholder");

  try {
    const payload = await runProviderOperation({
      component: "transaction_construction",
      operation_key: `${quote.canonical_quote_id || quote.provider_request_identifier || "quote"}:${taker}`,
      fn: async () => (
        fixtureMode
          ? {
              ...FIXTURE_BUILD_RESPONSE,
              inputMint: quote.route_legs?.[0]?.input_asset?.address || FIXTURE_BUILD_RESPONSE.inputMint,
              outputMint: quote.route_legs?.at?.(-1)?.output_asset?.address || FIXTURE_BUILD_RESPONSE.outputMint,
              inAmount: quote.input_amount_base_units,
              otherAmountThreshold: quote.minimum_output_amount_base_units,
              outAmount: quote.expected_output_amount_base_units,
              slippageBps: Number(quote.execution_cost_preview?.estimated_slippage?.slippage_bps || 50),
              setupInstructions: (FIXTURE_BUILD_RESPONSE.setupInstructions || []).map((instruction) => ({
                ...instruction,
                accounts: (instruction.accounts || []).map((account) => ({
                  ...account,
                  pubkey: account.isSigner ? taker : account.pubkey,
                })),
              })),
              swapInstruction: {
                ...FIXTURE_BUILD_RESPONSE.swapInstruction,
                accounts: (FIXTURE_BUILD_RESPONSE.swapInstruction.accounts || []).map((account) => ({
                  ...account,
                  pubkey: account.isSigner ? taker : account.pubkey,
                })),
              },
              cleanupInstruction: FIXTURE_BUILD_RESPONSE.cleanupInstruction
                ? {
                    ...FIXTURE_BUILD_RESPONSE.cleanupInstruction,
                    accounts: (FIXTURE_BUILD_RESPONSE.cleanupInstruction.accounts || []).map((account) => ({
                      ...account,
                      pubkey: account.isSigner ? taker : account.pubkey,
                    })),
                  }
                : null,
              addressesByLookupTableAddress: {
                LUTPreview11111111111111111111111111111111: [
                  taker,
                  quote.route_legs?.[0]?.input_asset?.address || FIXTURE_BUILD_RESPONSE.inputMint,
                  quote.route_legs?.at?.(-1)?.output_asset?.address || FIXTURE_BUILD_RESPONSE.outputMint,
                ],
              },
            }
          : (await fetchJsonWithTimeout(buildUrlFromQuote(quote, taker), {
              fetchImpl,
              timeoutMs,
            })).payload
      ),
    });

    const normalizedQuote = normalizeInspectionQuote(quote, payload, { buildId, nowMs });
    const skeleton = buildSkeletonFromPayload(payload, { quote: normalizedQuote, taker });
    const expectations = {
      expected_signer: taker,
      network: "solana:mainnet-beta",
      input_mint: skeleton.input_mint,
      output_mint: skeleton.output_mint,
      maximum_input: skeleton.maximum_input,
      minimum_output: skeleton.minimum_output,
      accepted_message_hash: skeleton.resolved_message_hash,
    };
    const inspected = inspectSolanaTransactionSkeleton(skeleton, expectations, SolanaInspectionPolicyV2);
    const canonicalInspection = {
      ...inspected.canonical_inspection,
      warnings: dedupe([...(inspected.canonical_inspection?.warnings || []), ...warnings]),
    };
    const reviewBlocked = canonicalInspection.quote_to_transaction_consistency_result !== "matched"
      || canonicalInspection.unknown_instructions.length > 0;
    const blockedReasons = dedupe([
      ...(reviewBlocked ? canonicalInspection.warnings : []),
      ...(canonicalInspection.unknown_instructions.length ? ["unknown_blocking_instruction"] : []),
    ]);
    return {
      ok: true,
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      inspection: canonicalInspection,
      quote: {
        ...normalizedQuote,
        warnings: dedupe([...(normalizedQuote.warnings || []), ...warnings]),
        transaction_material_available: true,
        inspection_state: reviewBlocked ? "blocked" : "ready",
        review_blocked_state: reviewBlocked,
        blocked_reasons: blockedReasons,
      },
      transaction_material_preview: {
        request_id: String(payload.requestId || ""),
        transaction_format: skeleton.version,
        preview_hash: skeleton.resolved_message_hash,
        lookup_table_count: skeleton.lookup_tables.length,
        instruction_count: skeleton.instructions.length,
        build_provider: "Jupiter",
        build_component: "transaction_construction",
        wallet_optional: !walletSnapshot?.public_address,
      },
      provider_provenance: createDataProvenance({
        request_id: String(payload.requestId || quote.provider_request_identifier || ""),
        build_id: buildId,
        source: "Jupiter",
        source_component: "transaction_construction",
        chain: "solana",
        observed_at: payload.blockhashWithMetadata?.fetchedAt || quote.quote_timestamp,
        received_at: new Date(nowMs).toISOString(),
        expires_at: quote.quote_expiry || null,
        freshness_state: "fresh",
        age_seconds: 0,
        warnings,
      }),
    };
  } catch (error) {
    const reason = String(error?.message || error);
    const code = String(error?.code || "") === "provider_backpressure"
      ? "transaction_construction_unavailable"
      : reason.includes("timeout")
      ? "transaction_construction_timeout"
      : reason.includes("invalid_json")
        ? "transaction_construction_malformed"
        : "transaction_construction_unavailable";
    return quoteErrorPacket(code, "Transaction material unavailable for review.", {
      retryable: code !== "transaction_construction_malformed",
      details: { reason },
    });
  }
}
