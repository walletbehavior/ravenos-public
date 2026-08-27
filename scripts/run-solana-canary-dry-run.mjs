#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

import {
  OperatorSolanaCanaryLimits,
  runOperatorSolanaCanaryPreflight,
} from "../lib/customer_trade/operator_solana_canary.mjs";

const PROTECTED_ENV_NAMES = Object.freeze(new Set([
  "RAVENOS_SOLANA_RPC_URL",
  "SOLANA_ALCHEMY_RPC_URL",
  "JUPITER_API_KEY",
  "TURNKEY_SOLANA_SHADOW_WALLET",
]));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) throw new Error(`unknown_argument:${entry}`);
    const key = entry.slice(2).replace(/-/g, "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing_argument_value:${key}`);
    out[key] = value;
    index += 1;
  }
  return out;
}

function protectedEnvironment(baseEnv = process.env) {
  const values = { ...baseEnv };
  const path = String(baseEnv.RAVEN_APP_ENV_PATH || "").trim();
  if (!path || !existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const name = trimmed.slice(0, index).trim().replace(/^export\s+/, "");
    if (!PROTECTED_ENV_NAMES.has(name) || String(values[name] || "").trim()) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

function usage() {
  return [
    "RavenOS operator Solana canary preflight (unsigned; never submits)",
    "",
    "Required:",
    "  --terminal-url <exact ravenos.xyz Solana spot Terminal URL>",
    "  --side <buy|sell>",
    "  --amount-base-units <integer>",
    "",
    "Required wallet source (one):",
    "  --wallet-address <public Solana address used to assemble the transaction>",
    "  --reference-wallet-env <TURNKEY_SOLANA_SHADOW_WALLET> (reference_probe only)",
    "",
    "Optional:",
    "  --wallet-role <reference_probe|canary> (default reference_probe)",
    "  --confirm-separate-low-balance-wallet <true|false> (required for canary)",
    "  --slippage-bps <5-300> (default 50)",
    "  --summary <true|false> (omit wallet address, logs, and detailed instruction evidence)",
    "",
    `Buy amount bounds: ${OperatorSolanaCanaryLimits.minimum_buy_lamports}-${OperatorSolanaCanaryLimits.maximum_buy_lamports} lamports.`,
    `Canary native-balance cap: ${OperatorSolanaCanaryLimits.maximum_canary_wallet_lamports} lamports.`,
    "This command accepts no private key, performs an unsigned mainnet simulation,",
    "prints no raw transaction, and contains no signing or submission path.",
  ].join("\n");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const input = args(process.argv.slice(2));
  for (const key of ["terminal_url", "side", "amount_base_units"]) {
    if (!input[key]) throw new Error(`required_argument_missing:${key}`);
  }
  const protectedEnv = protectedEnvironment();
  const referenceWalletEnv = String(input.reference_wallet_env || "").trim();
  if (referenceWalletEnv && referenceWalletEnv !== "TURNKEY_SOLANA_SHADOW_WALLET") {
    throw new Error("reference_wallet_env_not_allowed");
  }
  if (referenceWalletEnv && (input.wallet_role || "reference_probe") !== "reference_probe") {
    throw new Error("reference_wallet_env_requires_reference_probe");
  }
  const walletAddress = String(input.wallet_address || protectedEnv[referenceWalletEnv] || "").trim();
  if (!walletAddress) throw new Error("required_argument_missing:wallet_address");
  const rpcUrl = String(protectedEnv.RAVENOS_SOLANA_RPC_URL || protectedEnv.SOLANA_ALCHEMY_RPC_URL || "").trim();
  const apiKey = String(protectedEnv.JUPITER_API_KEY || "").trim();
  if (!rpcUrl) throw new Error("RAVENOS_SOLANA_RPC_URL_or_SOLANA_ALCHEMY_RPC_URL_required");
  if (!apiKey) throw new Error("JUPITER_API_KEY_required");
  const result = await runOperatorSolanaCanaryPreflight({
    terminal_url: input.terminal_url,
    wallet_address: walletAddress,
    wallet_role: input.wallet_role || "reference_probe",
    separate_low_balance_wallet_confirmed: input.confirm_separate_low_balance_wallet === "true",
    side: input.side,
    amount_base_units: input.amount_base_units,
    slippage_bps: input.slippage_bps || 50,
  }, {
    rpc_url: rpcUrl,
    jupiter_api_key: apiKey,
  });
  const output = input.summary === "true" ? {
    ok: result.ok,
    schema_version: result.schema_version,
    state: result.state,
    generated_at: result.generated_at,
    network: result.network,
    exact_market: {
      instrument_id: result.exact_market.instrument_id,
      pool_address: result.exact_market.pool_address,
      selected_token_mint: result.exact_market.token_address,
      quote_mint: result.exact_market.quote_address,
    },
    exact_pool_verification: result.exact_pool_verification,
    selected_mint: result.selected_mint,
    wallet: {
      role: result.wallet.role,
      balance_lamports: result.wallet.balance_lamports,
      low_balance_cap_satisfied: result.wallet.low_balance_cap_satisfied,
      address_returned: false,
      secret_material_returned: false,
    },
    quote: {
      router: result.quote.router,
      input_mint: result.quote.input_mint,
      output_mint: result.quote.output_mint,
      input_amount_base_units: result.quote.input_amount_base_units,
      minimum_output_amount_base_units: result.quote.minimum_output_amount_base_units,
      price_impact_bps: result.quote.price_impact_bps,
      fee_bps: result.quote.fee_bps,
      network_fee_lamports: result.quote.network_fee_lamports,
      rent_fee_lamports: result.quote.rent_fee_lamports,
      blocks_remaining: result.quote.blocks_remaining,
      route_venues: result.quote.route_plan.map((leg) => leg.venue),
    },
    transaction_review: {
      version: result.transaction_review.version,
      serialized_bytes: result.transaction_review.serialized_bytes,
      message_hash: result.transaction_review.message_hash,
      transaction_hash: result.transaction_review.transaction_hash,
      instruction_count: result.transaction_review.instruction_count,
      writable_account_count: result.transaction_review.writable_account_count,
      program_ids: result.transaction_review.program_ids,
      unknown_top_level_programs: result.transaction_review.unknown_top_level_programs,
      blockhash_valid: result.transaction_review.blockhash_valid,
      lookup_table_count: result.transaction_review.lookup_tables.length,
      raw_transaction_returned: result.transaction_review.raw_transaction_returned,
    },
    simulation: {
      state: result.simulation.state,
      context_slot: result.simulation.context_slot,
      units_consumed: result.simulation.units_consumed,
      simulation_fee_lamports: result.simulation.simulation_fee_lamports,
      native_balance_evidence: result.simulation.native_balance_evidence,
      selected_token_balance_evidence: result.simulation.selected_token_balance_evidence,
      unknown_invoked_programs: result.simulation.unknown_invoked_programs,
      signature_verified: result.simulation.signature_verified,
      blockhash_replaced: result.simulation.blockhash_replaced,
      logs_returned: false,
    },
    intent_hash: result.intent_hash,
    safety_blocking_reasons: result.safety_blocking_reasons,
    boundary_blocking_reasons: result.boundary_blocking_reasons,
    canary_readiness: result.canary_readiness,
    execution_boundary: result.execution_boundary,
  } : result;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

main().catch((error) => {
  fail(JSON.stringify({
    ok: false,
    schema_version: "ravenos.operator_solana_canary_error.v2",
    error: String(error?.code || error?.message || error),
    details: error?.details && typeof error.details === "object" ? error.details : null,
    signing_available: false,
    submission_available: false,
  }));
});
