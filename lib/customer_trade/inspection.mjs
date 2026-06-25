import { createTransactionInspection } from "./contracts.mjs";

export const SolanaInspectionPolicyV1 = Object.freeze({
  version: "solana_inspection_policy_v1",
  supports_legacy_transactions: true,
  supports_v0_transactions: true,
  requires_lookup_table_resolution: true,
  review_queue: "solana_program_policy_review",
  allowed_programs: Object.freeze([
    "11111111111111111111111111111111",
    "ComputeBudget111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  ]),
  fail_closed_unknown_program: true,
});

export function inspectSolanaTransactionSkeleton(transaction = {}, expectations = {}, policy = SolanaInspectionPolicyV1) {
  const blockers = [];
  const txVersion = transaction.version ?? transaction.transaction_version ?? "legacy";
  const versionLabel = txVersion === 0 || txVersion === "0" || txVersion === "v0" ? "v0" : "legacy";
  if (versionLabel === "legacy" && !policy.supports_legacy_transactions) blockers.push("unsupported_transaction_version");
  if (versionLabel === "v0" && !policy.supports_v0_transactions) blockers.push("unsupported_transaction_version");
  if (versionLabel === "v0" && policy.requires_lookup_table_resolution && transaction.lookup_tables_required && !transaction.lookup_tables_resolved) {
    blockers.push("lookup_table_unresolved");
  }
  if (expectations.accepted_message_hash && transaction.resolved_message_hash && transaction.resolved_message_hash !== expectations.accepted_message_hash) {
    blockers.push("message_changed_after_review");
  }
  const signer = String(transaction.expected_signer || transaction.fee_payer || "");
  if (expectations.expected_signer && signer !== expectations.expected_signer) blockers.push("wallet_mismatch");
  if (expectations.input_mint && transaction.input_mint !== expectations.input_mint) blockers.push("input_mint_mismatch");
  if (expectations.output_mint && transaction.output_mint !== expectations.output_mint) blockers.push("output_mint_mismatch");
  if (Number(transaction.maximum_input || 0) > Number(expectations.maximum_input || Number.POSITIVE_INFINITY)) blockers.push("amount_exceeds_intent");
  if (Number(transaction.minimum_output || 0) < Number(expectations.minimum_output || 0)) blockers.push("minimum_output_too_weak");
  if (transaction.quote_expiry && Date.parse(transaction.quote_expiry) <= Date.now()) blockers.push("quote_expired");

  const programs = Array.isArray(transaction.program_ids) ? transaction.program_ids.map(String) : [];
  const unknown = programs.filter((program) => !policy.allowed_programs.includes(program));
  if (unknown.length && policy.fail_closed_unknown_program) blockers.push("unknown_program");
  if (Array.isArray(transaction.authority_instructions) && transaction.authority_instructions.length) blockers.push("unexpected_authority_instruction");
  if (transaction.hidden_fee_recipient) blockers.push("hidden_fee_recipient");
  if (Array.isArray(transaction.unsupported_token_2022_extensions) && transaction.unsupported_token_2022_extensions.length) blockers.push("unsupported_token_extension");

  const legacy = {
    expected_signer: expectations.expected_signer || "",
    chain_network: expectations.network || "solana:mainnet-beta",
    transaction_version: versionLabel,
    lookup_tables_resolved: versionLabel === "v0" ? Boolean(transaction.lookup_tables_resolved) : null,
    resolved_message_hash: transaction.resolved_message_hash || null,
    expected_input_output_assets: {
      input_mint: expectations.input_mint || "",
      output_mint: expectations.output_mint || "",
    },
    maximum_input: expectations.maximum_input ?? null,
    minimum_output: expectations.minimum_output ?? null,
    fee_recipients: Array.isArray(transaction.fee_recipients) ? transaction.fee_recipients : [],
    program_addresses: programs,
    unknown_instruction_count: unknown.length,
    unsupported_token_extensions: Array.isArray(transaction.unsupported_token_2022_extensions) ? transaction.unsupported_token_2022_extensions.map(String) : [],
    provider_sponsored_gas: Boolean(transaction.provider_sponsored_gas),
    inspection_status: blockers.length ? "blocked" : "passed",
    blockers,
    policy_version: policy.version,
    policy_review_queue: policy.review_queue,
  };
  return {
    ...legacy,
    canonical_inspection: createTransactionInspection({
      chain: "solana",
      transaction_format: versionLabel,
      transaction_hash_or_preview_hash: transaction.resolved_message_hash || null,
      decoded_programs: programs,
      decoded_instructions: Array.isArray(transaction.instructions) ? transaction.instructions : [],
      input_asset_delta: {
        asset: transaction.input_mint || expectations.input_mint || null,
        maximum_input: expectations.maximum_input ?? null,
      },
      output_asset_delta: {
        asset: transaction.output_mint || expectations.output_mint || null,
        minimum_output: expectations.minimum_output ?? null,
      },
      fee_payer_effects: {
        fee_payer: transaction.fee_payer || null,
        provider_sponsored_gas: Boolean(transaction.provider_sponsored_gas),
      },
      token_approvals: Array.isArray(transaction.authority_instructions) ? transaction.authority_instructions : [],
      writable_accounts: Array.isArray(transaction.writable_accounts) ? transaction.writable_accounts : [],
      signer_requirements: [signer].filter(Boolean),
      compute_budget_or_gas_estimate: transaction.compute_budget || transaction.compute_budget_lamports || null,
      priority_fee_or_max_fee: transaction.priority_fee || transaction.max_fee || null,
      slippage_constraints: {
        accepted_message_hash: expectations.accepted_message_hash || null,
        minimum_output: expectations.minimum_output ?? null,
      },
      address_lookup_tables: Array.isArray(transaction.lookup_tables) ? transaction.lookup_tables : [],
      unknown_instructions: unknown.map((program) => ({ program, review_queue: policy.review_queue })),
      warnings: blockers,
      simulation_state: String(transaction.simulation_state || "not_requested"),
      simulation_source: transaction.simulation_source || null,
      quote_to_transaction_consistency_result: blockers.length ? "mismatch" : "matched",
    }),
  };
}
