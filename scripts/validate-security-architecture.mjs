import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const configPath = join(root, "config/customer_security.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

assert.equal(config.schema_version, "ravenos.customer_security_architecture.v1");
assert.equal(config.verification_baseline.standard, "OWASP ASVS");
assert.equal(config.verification_baseline.version, "5.0.0");
assert.equal(config.verification_baseline.minimum_level, 2);
assert.equal(config.current_stage, "stage_a_accounts_active");
assert.equal(config.customer_capabilities_enabled, true);
assert.equal(config.identity_provider.kind, "managed_identity");
assert.equal(config.identity_provider.implementation, "workos_authkit");
assert.equal(config.identity_provider.production_tenant_configured, true);
assert.equal(config.identity_provider.provider_tokens_retained_by_ravenos, false);
assert.equal(config.identity_provider.google_oauth_tokens_returned_to_ravenos, false);
assert.equal(config.identity_provider.passkeys_enabled, false);
for (const method of ["GoogleOAuth", "Password", "MagicAuth"]) {
  assert(config.identity_provider.requested_methods.includes(method), `missing active authentication method: ${method}`);
}

const requiredActiveCapabilities = new Set([
  "account_creation",
  "customer_authentication",
  "customer_sessions",
]);
const activeCapabilities = new Set(config.active_capabilities || []);
for (const capability of requiredActiveCapabilities) {
  assert(activeCapabilities.has(capability), `missing active customer capability: ${capability}`);
}

const requiredBlockedCapabilities = new Set([
  "wallet_linking",
  "persistent_portfolio",
  "subscription_checkout",
  "subscription_entitlements",
  "broker_account_linking",
  "operator_canary_submission",
  "customer_signing",
  "transaction_submission",
  "customer_position_monitoring",
  "saved_monitor_production_activation",
]);
const blockedCapabilities = new Set(config.blocked_capabilities || []);
for (const capability of requiredBlockedCapabilities) {
  assert(blockedCapabilities.has(capability), `missing blocked customer capability: ${capability}`);
}
for (const capability of requiredActiveCapabilities) {
  assert(!blockedCapabilities.has(capability), `active capability remains blocked: ${capability}`);
}

assert.equal(config.session_policy.kind, "opaque_revocable_server_side");
assert.equal(config.session_policy.cookie_name, "__Host-ravenos_session");
assert.equal(config.session_policy.domain_attribute_permitted, false);
assert.equal(config.session_policy.browser_storage_tokens_permitted, false);
for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) {
  assert(config.session_policy.cookie_attributes.includes(attribute), `missing required session cookie attribute: ${attribute}`);
}
assert.equal(config.portfolio_preview.implementation_status, "feature_flagged_read_only_beta");
assert.equal(config.portfolio_preview.authenticated_origin_only, true);
assert.equal(config.portfolio_preview.csrf_required_for_analysis, true);
assert.equal(config.portfolio_preview.raw_address_input_allowed, false);
assert.equal(config.portfolio_preview.durable_wallet_link_active, false);
assert.equal(config.portfolio_preview.portfolio_history_persisted, false);
assert.equal(config.portfolio_preview.policy_storage_active, false);
assert.equal(config.portfolio_preview.maximum_provider_calls_per_analysis, 8);
assert.equal(config.portfolio_preview.signing_available, false);
assert.equal(config.portfolio_preview.submission_available, false);
assert.equal(config.portfolio_preview.custody_available, false);
assert.equal(config.saved_monitor.implementation_status, "local_candidate_not_deployed");
assert.equal(config.saved_monitor.authenticated_origin_only, true);
assert.equal(config.saved_monitor.csrf_required_for_mutations, true);
assert.equal(config.saved_monitor.exact_market_identity_only, true);
assert.equal(config.saved_monitor.raw_provider_payloads_persisted, false);
assert.equal(config.saved_monitor.wallet_data_persisted, false);
assert.equal(config.saved_monitor.alerts_available, false);
assert.equal(config.saved_monitor.execution_available, false);
assert.equal(config.saved_monitor.production_activation_completed, false);
assert.equal(config.raven_monitor.implementation_status, "local_dormant_candidate_not_deployed");
assert.equal(config.raven_monitor.authenticated_origin_only, true);
assert.equal(config.raven_monitor.csrf_required_for_mutations, true);
assert.equal(config.raven_monitor.exact_market_identity_only, true);
assert.equal(config.raven_monitor.all_activation_controls_default_off, true);
assert.equal(config.raven_monitor.maximum_rules_per_account, 100);
assert.equal(config.raven_monitor.maximum_notification_history_per_account, 1000);
assert.equal(config.raven_monitor.notification_retention_days, 90);
assert.equal(config.raven_monitor.raw_provider_payloads_persisted, false);
assert.equal(config.raven_monitor.plan_prices_persisted, false);
assert.equal(config.raven_monitor.wallet_or_execution_data_persisted, false);
assert.equal(config.raven_monitor.out_of_app_delivery_active, false);
assert.equal(config.raven_monitor.scheduler_trigger_configured, true);
assert.equal(config.raven_monitor.scheduler_activation_flags_default_off, true);
assert.equal(config.raven_monitor.production_activation_completed, false);
assert.equal(config.shadow_route_sampling.aggregate_public_output_only, true);
assert.equal(config.shadow_route_sampling.exact_market_identity_required, true);
assert.equal(config.shadow_route_sampling.customer_identity_persisted, false);
assert.equal(config.shadow_route_sampling.wallet_or_network_address_persisted, false);
assert.equal(config.shadow_route_sampling.raw_provider_payloads_persisted, false);
assert.equal(config.shadow_route_sampling.plan_prices_persisted, false);
assert.equal(config.shadow_route_sampling.transaction_material_persisted, false);
assert.equal(config.shadow_route_sampling.signing_available, false);
assert.equal(config.shadow_route_sampling.submission_available, false);
assert.equal(config.shadow_route_sampling.fee_charging_available, false);
assert.equal(config.entitlement_foundation.implementation_status, "local_dormant_foundation");
assert.equal(config.entitlement_foundation.surface, "https://app.ravenos.xyz/account/intelligence/");
assert.equal(config.entitlement_foundation.authenticated_origin_only, true);
assert.equal(config.entitlement_foundation.all_activation_controls_default_off, true);
assert.equal(config.entitlement_foundation.coordinated_projection_split_required, true);
assert.deepEqual(config.entitlement_foundation.free_projection_limits, { perps_markets: 6, participant_conditions: 6 });
assert.deepEqual(config.entitlement_foundation.pro_projection_limits, { perps_rows_per_table: 40, participant_conditions: 160 });
assert.equal(config.entitlement_foundation.direct_public_artifact_aliases_projected_when_active, true);
assert.equal(config.entitlement_foundation.public_behavior_unchanged_while_off, true);
assert.equal(config.entitlement_foundation.customer_mutation_available, false);
assert.equal(config.entitlement_foundation.checkout_available, false);
assert.equal(config.entitlement_foundation.billing_available, false);
assert.equal(config.entitlement_foundation.shared_cache_allowed, false);
assert.equal(config.entitlement_foundation.atlas_display_rights_override_available, false);
assert.equal(config.entitlement_foundation.production_activation_completed, false);
assert.equal(config.wallet_copy.implementation_status, "staging_dormant_shared_observer_candidate");
assert.equal(config.wallet_copy.surface, "https://app.ravenos.xyz/account/copy/");
assert.equal(config.wallet_copy.capability, "wallet.copy");
assert.equal(config.wallet_copy.authenticated_origin_only, true);
assert.equal(config.wallet_copy.csrf_required_for_mutations, true);
assert.equal(config.wallet_copy.server_owned_pro_entitlement_required, true);
assert.deepEqual(config.wallet_copy.supported_chains, ["solana"]);
assert.equal(config.wallet_copy.maximum_watches_per_account, 25);
assert.equal(config.wallet_copy.maximum_history_transactions_per_refresh, 24);
assert.equal(config.wallet_copy.maximum_new_signals_per_refresh, 3);
assert.equal(config.wallet_copy.shared_source_observation, true);
assert.equal(config.wallet_copy.shared_observer_queue_implemented, true);
assert.deepEqual(config.wallet_copy.shared_observer_transport_contracts, ["rpc_poll", "geyser_grpc", "shredstream", "replay"]);
assert.equal(config.wallet_copy.constant_k_nexus_adapter_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_live_probe_completed, true);
assert.equal(config.wallet_copy.constant_k_nexus_receiver_contract_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_receiver_restart_rotation_tested, true);
assert.equal(config.wallet_copy.constant_k_nexus_watch_manifest_contract_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_maximum_wallet_universe, 25_000);
assert.equal(config.wallet_copy.constant_k_nexus_watch_manifest_active, false);
assert.equal(config.wallet_copy.constant_k_nexus_persistent_receiver_active, false);
assert.equal(config.wallet_copy.constant_k_nexus_authenticated_ingress_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_authenticated_ingress_active, false);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_exact_host_required, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_hmac_required, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_hmac_rotation_supported, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_access_service_token_supported, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_maximum_clock_skew_seconds, 90);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_maximum_deliveries_per_batch, 50);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_manifest_cache_seconds, 5);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_append_only_receipts, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_raw_provider_payload_allowed, false);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_transaction_material_allowed, false);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_checkpoint_after_durable_ack, true);
assert.equal(config.wallet_copy.constant_k_nexus_ingress_exact_manifest_required, true);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_receiver_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_receiver_active, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_initial_position, "tail");
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_maximum_bytes_per_cycle, 16 * 1024 * 1024);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_maximum_lines_per_cycle, 10_000);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_checkpoint_after_durable_ack, true);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_coverage_manifest_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_coverage_filter_mode, "reviewed_swap_programs");
assert.equal(config.wallet_copy.constant_k_nexus_discovery_coverage_reviewed_program_count, 11);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_provider_ack_required, true);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_provider_ack_maximum_seconds, 900);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_receiver_reads_before_provider_ack, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_coverage_active, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_exact_watch_coverage_claimed, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_chain_wide_coverage_claimed, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_candidate_is_trade_claimed, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_independent_raven_hydration_required, true);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_raw_provider_payload_persisted, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_firehose_subscriber_identity_included, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_implemented, true);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_active, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_storage, "host_local_sqlite_0600");
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_minimum_observations, 5);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_minimum_distinct_mints, 2);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_minimum_span_seconds, 60);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_maximum_retained_evidence_per_candidate, 8);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_maximum_promotion_rounds_per_hour, 100);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_maximum_promotion_rounds_per_day, 1_000);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_maximum_outbound_observations, 50);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_cursor_after_durable_remote_ack, true);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_outcome_data_used, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_subscriber_data_used, false);
assert.equal(config.wallet_copy.constant_k_nexus_discovery_local_census_raw_provider_payload_persisted, false);
assert.equal(config.wallet_copy.deep_history_backfill_contract_implemented, true);
assert.equal(config.wallet_copy.deep_history_backfill_active, false);
assert.equal(config.wallet_copy.deep_history_shared_per_source_wallet, true);
assert.equal(config.wallet_copy.deep_history_provider_page_size, 100);
assert.equal(config.wallet_copy.deep_history_scheduled_wallets_per_run, 4);
assert.equal(config.wallet_copy.deep_history_maximum_signatures_per_wallet, 10_000);
assert.equal(config.wallet_copy.deep_history_profile_snapshot_event_limit, 2_000);
assert.equal(config.wallet_copy.deep_history_completion_requires_provider_exhaustion, true);
assert.equal(config.wallet_copy.deep_history_priority_lanes_implemented, true);
assert.equal(config.wallet_copy.deep_history_priority_lanes_active, false);
assert.equal(config.wallet_copy.deep_history_customer_watches_highest_priority, true);
assert.equal(config.wallet_copy.deep_history_priority_subscriber_identity_included, false);
assert.equal(config.wallet_copy.deep_history_priority_upgrade_preserves_cursor, true);
assert.equal(config.wallet_copy.deep_history_priority_upgrade_preserves_retry_cooldown, true);
assert.equal(config.wallet_copy.deep_history_priority_health_aggregated_by_lane, true);
assert.equal(config.wallet_copy.source_sell_mapping_contract_implemented, true);
assert.equal(config.wallet_copy.source_sell_mapping_active, false);
assert.equal(config.wallet_copy.source_sell_exact_balance_evidence_required, true);
assert.equal(config.wallet_copy.source_sell_maps_raven_created_lots_only, true);
assert.equal(config.wallet_copy.source_sell_partial_exits_proportional, true);
assert.equal(config.wallet_copy.pre_subscription_inventory_ignored, true);
assert.equal(config.wallet_copy.shadow_exit_evidence_append_only, true);
assert.equal(config.wallet_copy.shadow_exit_live_assets_held, false);
assert.equal(config.wallet_copy.maximum_mapped_positions_per_watch, 2_000);
assert.equal(config.wallet_copy.maximum_exit_history_per_position_view, 2_000);
assert.equal(config.wallet_copy.one_decode_per_source_transaction, true);
assert.equal(config.wallet_copy.subscriber_proportional_rpc_polling, false);
assert.equal(config.wallet_copy.provider_and_finality_deliveries_append_only, true);
assert.equal(config.wallet_copy.observer_queue_restart_safe, true);
assert.deepEqual(config.wallet_copy.observer_latency_percentiles_recorded, [50, 90, 95, 99]);
assert.equal(config.wallet_copy.subscriber_relationships_private, true);
assert.equal(config.wallet_copy.raw_provider_payloads_persisted, false);
assert.equal(config.wallet_copy.signer_material_persisted, false);
assert.equal(config.wallet_copy.transaction_material_persisted, false);
assert.equal(config.wallet_copy.source_and_follower_performance_separate, true);
assert.equal(config.wallet_copy.historical_and_prospective_evidence_separate, true);
assert.equal(config.wallet_copy.shared_prospective_copyability_screener_projection_implemented, true);
assert.equal(config.wallet_copy.shared_prospective_copyability_screener_projection_active, false);
assert.equal(config.wallet_copy.shared_prospective_copyability_superseded_policies_mixed, false);
assert.equal(config.wallet_copy.shared_prospective_copyability_screener_reference_size_usdc, 100);
assert.equal(config.wallet_copy.shared_prospective_follower_outcome_checkpoints_implemented, true);
assert.equal(config.wallet_copy.shared_prospective_follower_outcome_checkpoints_active, false);
assert.equal(config.wallet_copy.shared_prospective_follower_outcome_reference_size_usdc, 100);
assert.equal(config.wallet_copy.shared_prospective_follower_outcome_reference_horizon_seconds, 3_600);
assert.equal(config.wallet_copy.shared_prospective_follower_outcome_source_quote_shared_per_event_horizon, true);
assert.equal(config.wallet_copy.shared_prospective_follower_outcome_failures_recorded_as_zero_return, false);
assert.equal(config.wallet_copy.shared_prospective_follower_outcome_source_counterfactual_claimed_as_realized, false);
assert.equal(config.wallet_copy.shared_prospective_follower_outcome_expected_quote_claimed_as_fill, false);
assert.equal(config.wallet_copy.shared_prospective_follower_outcome_capture_ratio_capped, false);
assert.equal(config.wallet_copy.shared_prospective_detection_market_context_implemented, true);
assert.equal(config.wallet_copy.shared_prospective_detection_market_context_active, false);
assert.equal(config.wallet_copy.shared_prospective_detection_market_context_counted_once_per_source_signal, true);
assert.equal(config.wallet_copy.shared_prospective_detection_market_context_exact_source_pool_claimed, false);
assert.equal(config.wallet_copy.shared_prospective_detection_market_context_source_fill_claimed, false);
assert.equal(config.wallet_copy.shared_prospective_detection_market_context_pair_age_used_as_token_age, false);
assert.equal(config.wallet_copy.shared_prospective_detection_market_context_current_state_substituted_for_source_fill, false);
assert.equal(config.wallet_copy.nexus_research_cohort_implemented, true);
assert.equal(config.wallet_copy.nexus_research_cohort_active, false);
assert.equal(config.wallet_copy.nexus_research_cohort_maximum_wallets, 20_000);
assert.equal(config.wallet_copy.nexus_research_cohort_user_watches_prioritized, true);
assert.equal(config.wallet_copy.nexus_research_cohort_independent_trade_hydration_required, true);
assert.equal(config.wallet_copy.nexus_research_cohort_subscriber_identity_included, false);
assert.equal(config.wallet_copy.nexus_research_cohort_profitability_claimed, false);
assert.equal(config.wallet_copy.nexus_research_cohort_copyability_claimed, false);
assert.equal(config.wallet_copy.live_copy_source_level_disabled, true);
assert.equal(config.wallet_copy.signing_source_level_disabled, true);
assert.equal(config.wallet_copy.broadcasting_source_level_disabled, true);
assert.equal(config.wallet_copy.fee_collection_source_level_disabled, true);
assert.equal(config.wallet_copy.continuous_observer_active, false);
assert.equal(config.wallet_copy.scheduler_active, false);
assert.equal(config.wallet_copy.all_activation_controls_default_off, true);
assert.equal(config.wallet_copy.production_activation_completed, false);
assert.equal(config.public_holder_lists.implementation_status, "production_provider_validated");
assert.equal(config.public_holder_lists.free_tier_capability, true);
assert.equal(config.public_holder_lists.exact_pool_and_mint_identity_required, true);
assert.deepEqual(config.public_holder_lists.supported_chains, ["solana", "robinhood", "base", "bsc", "ethereum"]);
assert.equal(config.public_holder_lists.evm_implementation_status, "production_provider_validated_activation_pending");
assert.equal(config.public_holder_lists.evm_provider, "blockscout");
assert.equal(config.public_holder_lists.evm_complete_holder_census_claimed, false);
assert.equal(config.public_holder_lists.evm_maximum_public_owner_rows, 50);
assert.equal(config.public_holder_lists.evm_real_token_staging_validation_completed, true);
assert.equal(config.public_holder_lists.evm_candidate_ready_for_activation, true);
assert.equal(config.public_holder_lists.evm_release_activation_enabled, true);
assert.equal(config.public_holder_lists.evm_v4_pool_custody_exclusion_unresolved, true);
assert.equal(config.public_holder_lists.evm_production_activation_completed, false);
assert.equal(config.public_holder_lists.maximum_public_owner_rows, 100);
assert.equal(config.public_holder_lists.maximum_census_source_token_accounts, 25_000);
assert.equal(config.public_holder_lists.partial_scan_rankings_returned, false);
assert.equal(config.public_holder_lists.private_rpc_fallback_allowed, false);
assert.equal(config.public_holder_lists.paid_provider_endpoint_validated, true);
assert.equal(config.public_holder_lists.production_activation_completed, true);
assert.equal(config.operator_solana_canary.implementation_status, "operator_unsigned_mainnet_preflight");
assert.equal(config.operator_solana_canary.surface, "operator_cli_only");
assert.equal(config.operator_solana_canary.exact_terminal_identity_required, true);
assert.equal(config.operator_solana_canary.exact_pool_identity_revalidated_server_side, true);
assert.equal(config.operator_solana_canary.separate_low_balance_wallet_required, true);
assert.equal(config.operator_solana_canary.maximum_buy_lamports, 50_000_000);
assert.equal(config.operator_solana_canary.maximum_canary_wallet_lamports, 100_000_000);
assert.equal(config.operator_solana_canary.maximum_slippage_bps, 300);
assert.equal(config.operator_solana_canary.maximum_price_impact_bps, 500);
assert.equal(config.operator_solana_canary.maximum_priority_fee_lamports, 50_000);
assert.equal(config.operator_solana_canary.maximum_network_fee_lamports, 70_000);
assert.equal(config.operator_solana_canary.maximum_rent_fee_lamports, 5_000_000);
assert.equal(config.operator_solana_canary.maximum_total_fee_lamports, 5_100_000);
assert.equal(config.operator_solana_canary.maximum_total_native_debit_lamports, 56_000_000);
assert.equal(config.operator_solana_canary.maximum_route_legs, 8);
assert.equal(config.operator_solana_canary.maximum_resolved_writable_accounts, 48);
assert.equal(config.operator_solana_canary.maximum_compute_units, 1_400_000);
assert.equal(config.operator_solana_canary.mainnet_genesis_hash_required, true);
assert.equal(config.operator_solana_canary.selected_mint_resolved_by_rpc, true);
assert.equal(config.operator_solana_canary.versioned_transaction_decoded, true);
assert.equal(config.operator_solana_canary.lookup_tables_resolved, true);
assert.equal(config.operator_solana_canary.recent_blockhash_validated, true);
assert.equal(config.operator_solana_canary.writable_account_prestate_loaded, true);
assert.equal(config.operator_solana_canary.exact_selected_token_delta_verified, true);
assert.equal(config.operator_solana_canary.wrapped_sol_economic_reconciliation_required, true);
assert.equal(config.operator_solana_canary.monotonic_rpc_context_required, true);
assert.equal(config.operator_solana_canary.unknown_programs_fail_closed, true);
assert.equal(config.operator_solana_canary.unsigned_mainnet_simulation_required, true);
assert.equal(config.operator_solana_canary.signature_use, "unavailable_preflight_only");
assert.equal(config.operator_solana_canary.secret_material_accepted, false);
assert.equal(config.operator_solana_canary.raw_transaction_returned, false);
assert.equal(config.operator_solana_canary.secret_material_returned, false);
assert.equal(config.operator_solana_canary.browser_signing_available, false);
assert.equal(config.operator_solana_canary.customer_submission_available, false);
assert.equal(config.operator_solana_canary.operator_submission_available, false);
assert.equal(config.operator_solana_canary.production_activation_completed, false);
assert.equal(config.customer_live_execution_canary.implementation_status, "owner_canary_code_ready");
assert.equal(config.customer_live_execution_canary.authenticated_origin_only, true);
assert.equal(config.customer_live_execution_canary.csrf_required_for_mutations, true);
assert.equal(config.customer_live_execution_canary.explicit_user_allowlist_required, true);
assert.equal(config.customer_live_execution_canary.wildcard_allowlist_for_initial_canary, false);
assert.equal(config.customer_live_execution_canary.wildcard_allowlist_for_authenticated_public_release, true);
assert.equal(config.customer_live_execution_canary.hyperliquid_wallet_signing_available, true);
assert.equal(config.customer_live_execution_canary.hyperliquid_wallet_submission_available, true);
assert.equal(config.customer_live_execution_canary.solana_wallet_signing_available, true);
assert.equal(config.customer_live_execution_canary.solana_wallet_submission_available, true);
assert.equal(config.customer_live_execution_canary.solana_exact_transaction_review_required, true);
assert.equal(config.customer_live_execution_canary.solana_unsigned_simulation_required, true);
assert.equal(config.customer_live_execution_canary.solana_onchain_economic_reconciliation_required, true);
assert.equal(config.customer_live_execution_canary.solana_live_raven_fee_bps, 0);
assert.equal(config.customer_live_execution_canary.solana_fee_collection_available, false);
assert.equal(config.customer_live_execution_canary.evm_live_raven_fee_bps, 100);
assert.equal(config.customer_live_execution_canary.evm_pro_raven_fee_bps, 70);
assert.equal(config.customer_live_execution_canary.evm_fee_collection_available, true);
assert.equal(config.customer_live_execution_canary.evm_fee_accounting_chain_local, true);
assert.equal(config.customer_live_execution_canary.robinhood_chain_live_execution_candidate, true);
assert.equal(config.customer_live_execution_canary.robinhood_stock_tokens_live_execution_available, false);
assert.equal(config.customer_live_execution_canary.robinhood_reverse_exit_proof_required_for_buys, true);
assert.equal(config.customer_live_execution_canary.raven_signing_available, false);
assert.equal(config.customer_live_execution_canary.raven_private_keys_available, false);
assert.equal(config.customer_live_execution_canary.custody_available, false);
assert.equal(config.customer_live_execution_canary.arbitrary_submission_available, false);
assert.equal(config.customer_live_execution_canary.fee_policy_server_owned, true);
assert.equal(config.customer_live_execution_canary.fee_recipient_server_owned, true);
assert.equal(config.customer_live_execution_canary.hyperliquid_builder_fee_maximum_bps, 10);
assert.equal(config.customer_live_execution_canary.builder_fee_user_approval_required, true);
assert.equal(config.customer_live_execution_canary.builder_fee_approval_separate_from_order, true);
assert.equal(config.customer_live_execution_canary.private_keys_or_signatures_persisted, false);
assert.equal(config.customer_live_execution_canary.append_only_execution_evidence, true);
assert.equal(config.customer_live_execution_canary.all_activation_controls_default_off, true);
assert.equal(config.customer_live_execution_canary.production_activation_completed, false);

for (const documentPath of config.required_documents || []) {
  const absolute = join(root, documentPath);
  assert(existsSync(absolute), `missing customer security document: ${documentPath}`);
  assert(statSync(absolute).size > 1000, `customer security document is unexpectedly small: ${documentPath}`);
}

const requiredScenarios = [
  "SEC-SES-001", "SEC-SES-002", "SEC-SES-003", "SEC-CSRF-001",
  "SEC-AUTHZ-001", "SEC-AUTHZ-002", "SEC-WAL-001", "SEC-WAL-002",
  "SEC-RSCH-001", "SEC-RSCH-002",
  "SEC-ENT-001", "SEC-ENT-002",
  "SEC-ALT-001", "SEC-ALT-002",
  "SEC-WOBS-003", "SEC-COPY-001", "SEC-COPY-002",
  "SEC-WAL-003", "SEC-WAL-004", "SEC-WAL-005", "SEC-WAL-006",
  "SEC-BIL-001", "SEC-BIL-002", "SEC-BIL-003", "SEC-ENUM-001",
  "SEC-EDGE-001", "SEC-XSS-001", "SEC-CSP-001", "SEC-LEAK-001",
  "SEC-TX-001", "SEC-TX-002", "SEC-TX-003", "SEC-TX-004",
  "SEC-TX-005", "SEC-TX-006", "SEC-TX-007", "SEC-REL-001",
];
const scenarioRows = config.verification_scenarios || [];
const scenarioIds = new Set(scenarioRows.map((row) => row.id));
assert.equal(scenarioIds.size, scenarioRows.length, "security scenario IDs must be unique");
for (const id of requiredScenarios) assert(scenarioIds.has(id), `missing required security scenario: ${id}`);
for (const row of scenarioRows) {
  assert(["verified_current", "verified_local_candidate", "required_not_implemented", "blocked", "external_review_required", "not_applicable"].includes(row.status), `invalid status for ${row.id}`);
  if (["stage_b", "stage_c", "stage_d", "stage_e"].includes(row.gate)) assert.notEqual(row.status, "verified_current", `${row.id} cannot be verified before its customer system exists`);
  if (row.status === "verified_current") assert(row.evidence || row.gate === "current", `${row.id} requires current evidence`);
  if (row.status === "not_applicable") assert(row.rationale, `${row.id} requires a not-applicable rationale`);
}
const stageARows = scenarioRows.filter((row) => row.gate === "stage_a");
assert(stageARows.length > 0, "Stage A security scenarios are missing");
assert(stageARows.every((row) => !["blocked", "required_not_implemented"].includes(row.status)), "active Stage A controls cannot remain blocked or unimplemented");

const worker = readFileSync(join(root, "worker.mjs"), "utf8");
assert(worker.includes('from "./lib/customer_identity.mjs"'), "Stage A managed identity router is missing from the Worker graph");
assert(worker.includes('from "./lib/customer_research_state.mjs"'), "Saved Monitor research-state router is missing from the Worker graph");
assert(worker.includes('from "./lib/customer_entitlements.mjs"'), "server-owned entitlement router is missing from the Worker graph");
assert(worker.includes('from "./lib/customer_monitor_alerts.mjs"'), "Raven Monitor router and evaluator are missing from the Worker graph");
assert(worker.includes('from "./lib/customer_wallet_copy.mjs"'), "Raven Copy authenticated router is missing from the Worker graph");
assert(worker.includes('const AUTHENTICATED_APP_HOST = "app.ravenos.xyz"'), "authenticated application origin boundary is missing");
assert(worker.includes("authenticatedAppBoundary(request)"), "authenticated application origin is not enforced in the Worker");
assert(worker.includes("routeCustomerResearchState(request, env"), "Saved Monitor route is not wired through the authenticated Worker boundary");
assert(worker.includes("routeCustomerEntitlements(request, env"), "entitlement routes are not wired through the authenticated Worker boundary");
assert(worker.includes("routeCustomerMonitorAlerts(request, env"), "Raven Monitor routes are not wired through the authenticated Worker boundary");
assert(worker.includes("routeCustomerWalletCopy(request, env"), "Raven Copy routes are not wired through the authenticated Worker boundary");
assert(worker.includes("runCustomerMonitorEvaluator(env"), "Raven Monitor evaluator is not wired through the dormant scheduled boundary");
for (const importName of ["ravenos_access.mjs", "ravenos_subscriptions.mjs", "ravenos_stripe_webhooks.mjs", "solana_wallet_auth.mjs"]) {
  assert(!worker.includes(`from \"./lib/${importName}\"`), `legacy customer module remains in the Worker graph: ${importName}`);
}
for (const reason of ["legacy_customer_access_quarantined", "legacy_billing_quarantined"]) {
  assert(worker.includes(reason), `Worker is missing legacy quarantine response: ${reason}`);
}
const operatorCanary = readFileSync(join(root, "lib/customer_trade/operator_solana_canary.mjs"), "utf8");
const operatorCanaryCli = readFileSync(join(root, "scripts/run-solana-canary-dry-run.mjs"), "utf8");
const customerLiveGate = readFileSync(join(root, "lib/customer_trade/live_execution_gate.mjs"), "utf8");
const hyperliquidLiveExecution = readFileSync(join(root, "lib/customer_trade/hyperliquid_live_execution.mjs"), "utf8");
const solanaLiveExecution = readFileSync(join(root, "lib/customer_trade/solana_live_execution.mjs"), "utf8");
const walletExecutionEntry = readFileSync(join(root, "client/ravenos-wallet-execution-entry.js"), "utf8");
const customerLiveMigration = readFileSync(join(root, "customer-migrations/0024_customer_live_execution.sql"), "utf8");
assert.match(operatorCanary, /submission:\s*false/);
assert.match(operatorCanary, /signing_for_simulation:\s*false/);
assert.match(operatorCanary, /signing_material_not_accepted_by_preflight/);
assert.match(operatorCanary, /sigVerify:\s*false/);
assert.match(operatorCanary, /SOLANA_MAINNET_GENESIS_HASH/);
assert.doesNotMatch(operatorCanary, /\/swap\/v2\/execute|sendRawTransaction|sendTransaction|broadcastTransaction/);
assert.doesNotMatch(operatorCanaryCli, /\/swap\/v2\/execute|sendRawTransaction|sendTransaction|broadcastTransaction/);
assert.match(customerLiveGate, /RAVENOS_CUSTOMER_TRADE_LIVE_USERS/);
assert.match(customerLiveGate, /RAVENOS_CUSTOMER_TRADE_KILL_SWITCH/);
assert.match(customerLiveGate, /hyperliquid_wallet_submission:\s*true/);
assert.match(customerLiveGate, /solana_signed_transaction_submission:\s*true/);
assert.match(customerLiveGate, /raven_private_key_access:\s*false/);
assert.match(hyperliquidLiveExecution, /builder_fee_parameter_mismatch/);
assert.match(hyperliquidLiveExecution, /fee_recipient: recipient/);
assert.match(hyperliquidLiveExecution, /action_hash: hash\(action\)/);
assert.match(solanaLiveExecution, /exact_reviewed_transaction_only:\s*true/);
assert.match(solanaLiveExecution, /nacl\.sign\.detached\.verify/);
assert.match(solanaLiveExecution, /raven_fee_bps:\s*0/);
assert.match(solanaLiveExecution, /economicTransactionEvidence/);
assert.doesNotMatch(solanaLiveExecution, /privateKey|seedPhrase|mnemonic/);
assert.match(walletExecutionEntry, /approveHyperliquidBuilderFee/);
assert.match(walletExecutionEntry, /executeHyperliquidTicket/);
assert.match(walletExecutionEntry, /signSolanaTicket/);
assert.doesNotMatch(walletExecutionEntry, /privateKey|seedPhrase|mnemonic/);
assert.match(customerLiveMigration, /ravenos_customer_live_execution_events_append_only/);
assert.match(customerLiveMigration, /observed_raven_fee_usdc/);
assert.doesNotMatch(customerLiveMigration, /private_key|seed_phrase|signature\s+TEXT/i);
assert.match(worker, /function customerAccountsEnabled\(\)\s*{\s*return false;\s*}/);
assert.match(worker, /function customerBillingEnabled\(\)\s*{\s*return false;\s*}/);
const identity = readFileSync(join(root, "lib/customer_identity.mjs"), "utf8");
assert.match(identity, /passkey:\s*false/);
assert.match(identity, /magic_auth:\s*available/);

const deployScript = readFileSync(join(root, "scripts/prepare-deploy-assets.mjs"), "utf8");
const runtimeBlock = deployScript.match(/const runtimeAssets = \[([\s\S]*?)\n\];/)?.[1] || "";
for (const asset of config.legacy_quarantine.client_assets_excluded_from_release || []) {
  assert(!runtimeBlock.includes(`\"${asset}\"`), `legacy customer asset remains deployable: ${asset}`);
}

const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
for (const activationFlag of [
  "RAVENOS_CUSTOMER_ACCOUNTS_ENABLE",
  "RAVENOS_AUTH_ENABLE",
  "RAVENOS_BILLING_ENABLE",
  "RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE",
  "RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE",
  ...config.entitlement_foundation.activation_controls,
  ...config.raven_monitor.activation_controls,
  ...config.wallet_copy.activation_controls,
  ...config.customer_live_execution_canary.activation_controls,
]) {
  assert(!wrangler.includes(activationFlag), `customer activation flag must not be configured in Wrangler: ${activationFlag}`);
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.match(packageJson.scripts["validate:security"] || "", /validate-security-architecture\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_security_foundation\.test\.mjs/);
assert.match(packageJson.scripts["pretest:contracts"] || "", /test:agentic/);
assert.match(packageJson.scripts["test:agentic"] || "", /agentic_\*\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_entitlements\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_monitor_alerts\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /solana_wallet_intelligence\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_trade_wallet_copy\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /customer_wallet_copy\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /source_wallet_backfill\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /source_wallet_ingress\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /source_wallet_discovery_admission\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /constant_k_nexus_wallet_ingress_client\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /constant_k_nexus_wallet_discovery_receiver\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /constant_k_nexus_discovery_coverage\.test\.mjs/);
assert.match(packageJson.scripts["test:contracts"] || "", /constant_k_nexus_discovery_manifest_cli\.test\.mjs/);
assert.equal(packageJson.scripts["run:constant-k-wallet-discovery-receiver"], "node scripts/run-constant-k-wallet-discovery-receiver.mjs");
assert.equal(packageJson.scripts["generate:constant-k-wallet-discovery-manifest"], "node scripts/generate-constant-k-nexus-discovery-manifest.mjs");
assert.equal(packageJson.scripts["validate:wallet-copy-live"], "node scripts/validate-wallet-copy-live.mjs");
const walletCopyLiveValidator = readFileSync(join(root, "scripts", "validate-wallet-copy-live.mjs"), "utf8");
assert(walletCopyLiveValidator.includes('mode: "authorized_read_only_manual_probe"'), "wallet-copy live validator must identify its read-only authority");
assert(walletCopyLiveValidator.includes("transaction_material_returned"), "wallet-copy live validator must reject transaction material");
for (const forbiddenWalletCopyAuthority of ["sendRawTransaction", "sendTransaction", "signTransaction", "privateKey", "seedPhrase"]) {
  assert(!walletCopyLiveValidator.includes(forbiddenWalletCopyAuthority), `wallet-copy live validator contains forbidden authority: ${forbiddenWalletCopyAuthority}`);
}
assert.equal(packageJson.scripts["validate:wallet-observer-live"], "node scripts/validate-wallet-observer-live.mjs");
const walletObserverLiveValidator = readFileSync(join(root, "scripts", "validate-wallet-observer-live.mjs"), "utf8");
const walletObserverTransports = readFileSync(join(root, "lib", "customer_trade", "source_wallet_transports.mjs"), "utf8");
const walletObserverIngress = readFileSync(join(root, "lib", "customer_trade", "source_wallet_ingress.mjs"), "utf8");
const walletObserverIngressProtocol = readFileSync(join(root, "lib", "customer_trade", "source_wallet_ingress_protocol.mjs"), "utf8");
const walletObserverIngressClient = readFileSync(join(root, "lib", "customer_trade", "constant_k_nexus_wallet_ingress_client.mjs"), "utf8");
const walletObserverReceiverDaemon = readFileSync(join(root, "scripts", "run-constant-k-wallet-observer-receiver.mjs"), "utf8");
const walletDiscoveryReceiverDaemon = readFileSync(join(root, "scripts", "run-constant-k-wallet-discovery-receiver.mjs"), "utf8");
const walletDiscoveryCandidateCensus = readFileSync(join(root, "lib", "customer_trade", "constant_k_nexus_wallet_candidate_census.mjs"), "utf8");
const walletDiscoveryCoverage = readFileSync(join(root, "lib", "customer_trade", "constant_k_nexus_discovery_coverage.mjs"), "utf8");
const walletDiscoveryManifestGenerator = readFileSync(join(root, "scripts", "generate-constant-k-nexus-discovery-manifest.mjs"), "utf8");
const walletDiscoveryIngress = readFileSync(join(root, "lib", "customer_trade", "source_wallet_discovery_ingress.mjs"), "utf8");
const walletDiscoveryAdmission = readFileSync(join(root, "lib", "customer_trade", "source_wallet_discovery_admission.mjs"), "utf8");
const walletCopyability = readFileSync(join(root, "lib", "customer_trade", "source_wallet_copyability.mjs"), "utf8");
const walletCopyCrowding = readFileSync(join(root, "lib", "customer_trade", "source_wallet_copy_crowding.mjs"), "utf8");
const walletCopyCrowdingMigration = readFileSync(join(root, "customer-migrations", "0022_source_wallet_copy_crowding.sql"), "utf8");
const walletCopyabilityCheckpoints = readFileSync(join(root, "lib", "customer_trade", "source_wallet_copyability_checkpoints.mjs"), "utf8");
const walletCopyabilityCheckpointMigration = readFileSync(join(root, "customer-migrations", "0019_source_wallet_copyability_checkpoints.sql"), "utf8");
const walletDetectionMarketContextMigration = readFileSync(join(root, "customer-migrations", "0018_source_wallet_detection_market_context.sql"), "utf8");
const walletResearchCohort = readFileSync(join(root, "lib", "customer_trade", "source_wallet_research_cohort.mjs"), "utf8");
const walletBackfill = readFileSync(join(root, "lib", "customer_trade", "source_wallet_backfill.mjs"), "utf8");
const walletBackfillPriorityMigration = readFileSync(join(root, "customer-migrations", "0020_source_wallet_backfill_priority.sql"), "utf8");
const walletDiscoveryPriorityMigration = readFileSync(join(root, "customer-migrations", "0021_source_wallet_discovery_priority.sql"), "utf8");
assert(walletObserverLiveValidator.includes('mode: "authorized_read_only_manual_probe"'), "wallet-observer validator must identify its read-only authority");
assert(walletObserverLiveValidator.includes("prospective_detection_latency_measured: false"), "RPC catch-up must not be presented as prospective speed evidence");
assert(walletObserverTransports.includes('transport: "shredstream"') || walletObserverTransports.includes('"shredstream"'), "private shred adapter contract is missing");
assert(walletObserverTransports.includes("provider_catch_up_bound_exceeded"), "wallet observer must fail closed on a bounded catch-up gap");
assert(walletObserverIngress.includes("RAVENOS_WALLET_OBSERVER_INGRESS_ENABLED"), "wallet ingress must have an independent default-off activation gate");
assert(walletObserverIngress.includes("RAVENOS_WALLET_OBSERVER_INGRESS_HOST"), "wallet ingress must require an exact configured host");
assert(walletObserverIngressProtocol.includes("globalThis.crypto.subtle.verify"), "wallet ingress HMAC must use Web Crypto verification");
assert(walletObserverIngressProtocol.includes("observer_ingress_transaction_material_forbidden"), "wallet ingress must reject normalized transaction material");
assert(walletObserverReceiverDaemon.includes("RAVENOS_WALLET_OBSERVER_RECEIVER_ENABLED"), "receiver daemon must have a separate local activation gate");
assert(walletObserverReceiverDaemon.includes("activeAck = normalizeSourceWalletWatchManifestAck"), "receiver daemon must require exact provider manifest acknowledgement");
assert(walletObserverReceiverDaemon.indexOf("ingressSummary = await postConstantKNexusDeliveries") < walletObserverReceiverDaemon.indexOf("atomicJson(config.checkpoint_path"), "receiver must post durable ingress before checkpoint persistence");
assert(walletObserverReceiverDaemon.includes("process.argv.slice(2)"), "exact observer daemon must validate only user-supplied arguments");
assert(walletDiscoveryReceiverDaemon.includes("RAVENOS_WALLET_DISCOVERY_FIREHOSE_RECEIVER_ENABLED"), "broad Nexus discovery receiver must have its own default-off gate");
assert(walletDiscoveryReceiverDaemon.includes("normalizeConstantKNexusDiscoveryCoverageAcknowledgement"), "broad Nexus discovery receiver must require exact reviewed-program provider acknowledgement");
assert(walletDiscoveryReceiverDaemon.indexOf("const coverage = normalizeConstantKNexusDiscoveryCoverageAcknowledgement") < walletDiscoveryReceiverDaemon.indexOf("const batch = readBatch"), "broad Nexus discovery must verify provider coverage before reading the event journal");
assert(walletDiscoveryCoverage.includes('filter_mode: "reviewed_swap_programs"'), "broad Nexus discovery must use the reviewed swap-program filter contract");
assert(walletDiscoveryCoverage.includes("maximum_ack_validity_ms: 15 * 60 * 1_000"), "broad Nexus discovery provider acknowledgement must be short-lived");
assert(walletDiscoveryCoverage.includes("chain_wide_coverage_claimed: false"), "reviewed-program coverage must not become a chain-wide coverage claim");
assert(walletDiscoveryManifestGenerator.includes("provider_acknowledgement_created: false"), "RavenOS manifest generator must not fabricate the provider acknowledgement");
assert(walletDiscoveryReceiverDaemon.includes('initial_position: "tail"'), "broad Nexus discovery must start at the live tail");
assert(walletDiscoveryReceiverDaemon.includes("watched_wallets: []"), "broad Nexus discovery must stay independent from exact-watch coverage");
assert(walletDiscoveryReceiverDaemon.indexOf("const ingress = await postObservations") < walletDiscoveryReceiverDaemon.indexOf("atomicJson(config.checkpoint_path"), "broad Nexus discovery must receive a durable ingress acknowledgement before checkpoint persistence");
assert(walletDiscoveryReceiverDaemon.includes("createConstantKNexusCandidateCensus"), "broad Nexus discovery must stage candidates in a bounded local census");
assert(walletDiscoveryReceiverDaemon.indexOf("census.stageObservations") < walletDiscoveryReceiverDaemon.indexOf("const ingress = await postObservations"), "candidate evidence must become durable locally before remote ingress");
assert(walletDiscoveryReceiverDaemon.indexOf("census.markDelivered") < walletDiscoveryReceiverDaemon.indexOf("atomicJson(config.checkpoint_path"), "candidate delivery must be acknowledged locally before the source cursor advances");
assert(walletDiscoveryCandidateCensus.includes('from "node:sqlite"'), "candidate census must use durable host-local storage");
assert(walletDiscoveryCandidateCensus.includes("minimum_observations: 5"), "candidate census must require recurrence before initial promotion");
assert(walletDiscoveryCandidateCensus.includes("minimum_distinct_mints: 2"), "candidate census must require mint breadth before initial promotion");
assert(walletDiscoveryCandidateCensus.includes("minimum_observation_span_seconds: 60"), "candidate census must reject same-burst promotion by default");
assert(walletDiscoveryCandidateCensus.includes("maximum_promotion_rounds_per_hour: 100"), "candidate census must enforce an hourly research budget");
assert(walletDiscoveryCandidateCensus.includes("maximum_promotion_rounds_per_day: 1_000"), "candidate census must enforce a daily research budget");
assert(walletDiscoveryCandidateCensus.includes("outcome_data_used: false"), "candidate census ranking must remain outcome blind");
assert(walletDiscoveryCandidateCensus.includes("subscriber_data_used: false"), "candidate census ranking must remain subscriber blind");
for (const forbiddenCandidateCensusAuthority of ["sendRawTransaction", "sendTransaction", "signTransaction", "privateKey", "seedPhrase"]) {
  assert(!walletDiscoveryCandidateCensus.includes(forbiddenCandidateCensusAuthority), `candidate census contains forbidden authority: ${forbiddenCandidateCensusAuthority}`);
}
assert(walletDiscoveryReceiverDaemon.includes("exact_watch_coverage_claimed: false"), "broad discovery must not claim exact watched-wallet coverage");
assert(walletDiscoveryReceiverDaemon.includes("chain_wide_coverage_claimed: false"), "broad discovery must not claim every Solana wallet");
assert(walletDiscoveryReceiverDaemon.includes("raw_provider_payload_persisted: false"), "broad discovery must not persist raw Nexus rows");
assert(walletDiscoveryReceiverDaemon.includes("subscriber_identity_included: false"), "broad discovery must not include subscriber identity");
assert(walletDiscoveryReceiverDaemon.includes("signing: false") && walletDiscoveryReceiverDaemon.includes("broadcasting: false"), "broad discovery must not expose transaction authority");
assert(walletDiscoveryReceiverDaemon.includes("process.argv.slice(2)"), "broad discovery daemon must validate only user-supplied arguments");
assert(walletDiscoveryAdmission.includes("RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED"), "wallet discovery ingress must have an independent default-off gate");
assert(walletDiscoveryIngress.includes("RAVENOS_WALLET_DISCOVERY_INGRESS_HOST"), "wallet discovery ingress must require an exact configured host");
assert(walletDiscoveryAdmission.includes("RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED"), "wallet discovery evaluator must have an independent default-off gate");
assert(walletDiscoveryAdmission.includes("event.route_evidence?.swap_route_observed === true"), "wallet discovery admission must require Raven-confirmed route evidence");
assert(walletCopyability.includes("RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED"), "shared copyability probes must have an independent default-off gate");
assert(walletCopyability.includes("source_performance_substituted: false"), "shared copyability probes must not substitute source returns for follower evidence");
assert(walletCopyability.includes("subscriber_identity_included: false"), "shared copyability observations must exclude subscriber identity");
assert(walletCopyability.includes("shadow_position_created: false"), "shared copyability probes must not create customer positions");
assert(walletCopyability.includes("broadcasting: false"), "shared copyability probes must not expose broadcast authority");
assert(walletCopyability.includes("exact_source_pool_claimed: false"), "detection-time market context must not claim the source pool");
assert(walletCopyability.includes("pair_age_used_as_token_age: false"), "selected pair age must not become token age");
assert(walletCopyability.includes("current_market_context_substituted_for_source_fill: false"), "current market context must not become source fill evidence");
assert(walletCopyability.includes('schema_version: "ravenos.source_wallet_copyability_market_regimes.v1"'), "prospective copyability must expose market-regime evidence");
assert(walletCopyability.includes('schema_version: "ravenos.source_wallet_copyability_size_stress.v1"'), "prospective copyability must expose exact route-size stress");
assert(walletCopyability.includes("concurrent_follower_demand_measured: false"), "isolated route quotes must not be presented as follower crowding evidence");
assert.equal(config.wallet_copy.aggregate_copy_crowding_evidence_implemented, true, "aggregate copy-demand stress must remain registered");
assert.equal(config.wallet_copy.aggregate_copy_crowding_evidence_active, false, "aggregate copy-demand stress must remain dormant by default");
assert.equal(config.wallet_copy.aggregate_copy_crowding_privacy_cohort_minimum, 5, "aggregate public evidence requires the documented privacy cohort");
assert.equal(config.wallet_copy.aggregate_copy_crowding_public_follower_count_disclosed, false, "public copy profiles must not disclose follower counts");
assert.equal(config.wallet_copy.aggregate_copy_crowding_public_capital_disclosed, false, "public copy profiles must not disclose aggregate capital");
assert.equal(config.wallet_copy.aggregate_copy_crowding_isolated_size_quotes_substituted, false, "isolated size quotes must not become crowding evidence");
assert.equal(config.wallet_copy.aggregate_copy_crowding_allocation_or_fill_promised, false, "aggregate stress must not promise allocation or fills");
assert(walletCopyCrowding.includes("RAVENOS_WALLET_COPY_CROWDING_ENABLED"), "aggregate copy-demand stress needs an independent default-off gate");
assert(walletCopyCrowding.includes("public_follower_count_disclosed: false"), "aggregate stress must keep follower counts private");
assert(walletCopyCrowding.includes("public_aggregate_capital_disclosed: false"), "aggregate stress must keep pooled capital private");
assert(walletCopyCrowding.includes("isolated_size_ladder_substituted: false"), "aggregate stress must use one exact aggregate quote rather than the isolated ladder");
assert(walletCopyCrowding.includes("position_creation: false"), "aggregate stress must not create positions");
assert(walletCopyCrowding.includes("live_copy: false"), "aggregate stress must not enable live copy");
assert(walletCopyCrowding.includes("signing: false") && walletCopyCrowding.includes("broadcasting: false"), "aggregate stress must not expose transaction authority");
assert(walletCopyCrowdingMigration.includes("source_wallet_copy_demand_append_only"), "aggregate demand snapshots must be append-only");
assert(walletCopyCrowdingMigration.includes("source_wallet_copy_crowding_observation_append_only"), "aggregate route stress must be append-only");
assert(walletCopyCrowdingMigration.includes("'$.privacy.public_follower_count_disclosed') = 0"), "stored aggregate demand must preserve follower-count privacy");
assert(walletCopyCrowdingMigration.includes("'$.privacy.public_aggregate_capital_disclosed') = 0"), "stored aggregate demand must preserve pooled-capital privacy");
assert(!/private_key|seed_phrase|signer_key/i.test(walletCopyCrowdingMigration), "aggregate stress storage contains signer authority");
assert(!readFileSync(join(root, "wrangler.jsonc"), "utf8").includes("RAVENOS_WALLET_COPY_CROWDING_ENABLED"), "aggregate copy-demand stress must not be activated in release config");
assert(walletCopyability.includes("token_age_claimed: false"), "selected-pair age must not become a token-age claim in market regimes");
assert(walletCopyability.includes("historical_entry_context_claimed: false"), "prospective market regimes must not become historical-entry claims");
assert(walletCopyabilityCheckpoints.includes("RAVENOS_WALLET_COPYABILITY_CHECKPOINTS_ENABLED"), "follower outcome checkpoints must have an independent default-off gate");
assert(walletCopyabilityCheckpoints.includes("actual_source_exit_claimed: false"), "source opportunity checkpoints must not claim an actual source exit");
assert(walletCopyabilityCheckpoints.includes("realized_source_pnl_claimed: false"), "source opportunity checkpoints must not claim realized source P&L");
assert(walletCopyabilityCheckpoints.includes("expected_quote_not_fill: true"), "follower outcome checkpoints must distinguish expected quotes from fills");
assert(walletCopyabilityCheckpoints.includes("capture_ratio_capped: false"), "follower capture must retain negative and above-100 outcomes");
assert(walletCopyabilityCheckpoints.includes("actual_position_created: false"), "shared follower checkpoints must not create customer positions");
assert(walletCopyabilityCheckpoints.includes("broadcasting: false"), "shared follower checkpoints must not expose broadcast authority");
assert(walletCopyabilityCheckpointMigration.includes("source_wallet_opportunity_checkpoint_append_only"), "source opportunity checkpoints must be append-only");
assert(walletCopyabilityCheckpointMigration.includes("source_wallet_copyability_checkpoint_append_only"), "follower outcome checkpoints must be append-only");
assert(walletCopyabilityCheckpointMigration.includes("capture_ratio_capped') = 0"), "checkpoint storage must preserve uncapped follower capture");
assert(walletCopyabilityCheckpointMigration.includes("expected_quote_not_fill') = 1"), "checkpoint storage must preserve quote-versus-fill truth");
assert(!/\b(user_id|watch_id|private_key|seed_phrase|signer_key)\b/i.test(walletCopyabilityCheckpointMigration), "checkpoint ledgers contain subscriber identity or signer authority");
assert(walletDetectionMarketContextMigration.includes("median_detected_market_cap_usd"), "detected market-cap projection is missing");
assert(walletDetectionMarketContextMigration.includes("median_detected_liquidity_usd"), "detected liquidity projection is missing");
assert(walletDetectionMarketContextMigration.includes("source wallet's exact pool"), "market-context migration must preserve the source-pool claim boundary");
assert(!/private_key|seed_phrase|signer_key|transaction_hash|user_id/i.test(walletDetectionMarketContextMigration), "market-context projection contains prohibited authority or subscriber identity");
assert(walletResearchCohort.includes("RAVENOS_WALLET_RESEARCH_COHORT_ENABLED"), "research cohort must have an independent default-off gate");
assert(walletResearchCohort.includes("maximum_research_wallets: 20_000"), "research cohort must remain below the observer manifest ceiling");
assert(walletResearchCohort.includes("subscriber_identity_included: false"), "research cohort must not contain subscriber identity");
assert(walletResearchCohort.includes("copyable_wallet_claimed: false"), "cohort membership must not claim copyability");
assert(walletBackfill.includes('customer_watch: 500'), "customer watches must be the highest deep-history demand class");
assert(walletBackfill.includes('nexus_research: 200'), "Nexus research must have an explicit bounded deep-history lane");
assert(walletBackfill.includes("MAX(evidence_priority, ?)"), "deep-history demand upgrades must preserve stronger evidence priority");
assert(walletBackfill.includes("GROUP BY state, demand_class"), "deep-history health must expose aggregate pressure by demand lane");
assert(walletBackfill.includes("subscriber_identity_included: false"), "deep-history health must exclude subscriber identity");
assert(worker.includes('demand_class: "nexus_research"'), "independently hydrated Nexus wallets must enter the bounded research lane");
assert(worker.includes("evidence_priority: researchAdmission.priority_score"), "Nexus history order must retain transparent admission evidence");
assert(walletBackfillPriorityMigration.includes("source_wallet_backfill_demand_priority_mismatch"), "database must enforce the demand-class priority mapping");
assert(!/SET[\s\S]{0,300}cursor_before\s*=/.test(walletBackfillPriorityMigration), "priority migration must not reset a history cursor");
assert(!/SET[\s\S]{0,300}next_attempt_at\s*=/.test(walletBackfillPriorityMigration), "priority migration must preserve provider retry timing");
assert(!/\b(user_id|watch_id|private_key|seed_phrase|signer_key|transaction_hash)\b/i.test(walletBackfillPriorityMigration.replace(/--.*$/gm, "")), "priority queue contains subscriber identity or execution authority");
assert(walletDiscoveryAdmission.includes("research_priority_score DESC"), "Nexus candidate hydration must use evidence priority before raw activity volume");
assert(walletDiscoveryAdmission.includes("exact_opposing_delta_points"), "Nexus candidate priority must expose its strongest evidence component");
assert(walletDiscoveryAdmission.includes("copyability_claimed: false"), "Nexus candidate priority must not claim copyability");
assert(walletDiscoveryPriorityMigration.includes("exact_swap_shape_count * 400.0"), "Nexus candidate priority migration must reward exact economic evidence");
assert(walletDiscoveryPriorityMigration.includes("source_wallet_discovery_quality_due_idx"), "Nexus candidate priority migration must index the bounded hydration queue");
assert(!/\b(user_id|watch_id|subscriber_id|private_key|seed_phrase|signer_key|transaction_hash)\b/i.test(walletDiscoveryPriorityMigration.replace(/--.*$/gm, "")), "Nexus candidate priority contains subscriber identity or execution authority");
assert(walletObserverReceiverDaemon.indexOf("posted = await postConstantKNexusWalletDiscoveryObservations") < walletObserverReceiverDaemon.indexOf("atomicJson(config.checkpoint_path"), "receiver must durably post discovery evidence before checkpoint persistence");
for (const discoveryFlag of ["RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED", "RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED"]) {
  assert(!wrangler.includes(discoveryFlag), `wallet discovery activation flag must not be configured in Wrangler: ${discoveryFlag}`);
}
assert(!wrangler.includes("RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED"), "shared copyability activation flag must not be configured in Wrangler");
assert(!wrangler.includes("RAVENOS_WALLET_COPYABILITY_CHECKPOINTS_ENABLED"), "follower outcome checkpoint activation flag must not be configured in Wrangler");
assert(!wrangler.includes("RAVENOS_WALLET_RESEARCH_COHORT_ENABLED"), "research cohort activation flag must not be configured in Wrangler");
for (const forbiddenWalletObserverAuthority of ["sendRawTransaction", "sendTransaction", "signTransaction", "privateKey", "seedPhrase"]) {
  assert(!walletObserverLiveValidator.includes(forbiddenWalletObserverAuthority), `wallet-observer live validator contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverTransports.includes(forbiddenWalletObserverAuthority), `wallet-observer transport contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverIngress.includes(forbiddenWalletObserverAuthority), `wallet-observer ingress contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverIngressProtocol.includes(forbiddenWalletObserverAuthority), `wallet-observer ingress protocol contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverIngressClient.includes(forbiddenWalletObserverAuthority), `wallet-observer ingress client contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletObserverReceiverDaemon.includes(forbiddenWalletObserverAuthority), `wallet-observer receiver daemon contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletDiscoveryIngress.includes(forbiddenWalletObserverAuthority), `wallet-discovery ingress contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletDiscoveryAdmission.includes(forbiddenWalletObserverAuthority), `wallet-discovery admission contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletCopyability.includes(forbiddenWalletObserverAuthority), `wallet-copyability probe contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletCopyabilityCheckpoints.includes(forbiddenWalletObserverAuthority), `wallet-copyability checkpoints contain forbidden authority: ${forbiddenWalletObserverAuthority}`);
  assert(!walletResearchCohort.includes(forbiddenWalletObserverAuthority), `wallet research cohort contains forbidden authority: ${forbiddenWalletObserverAuthority}`);
}

console.log(JSON.stringify({
  ok: true,
  schema_version: config.schema_version,
  current_stage: config.current_stage,
  asvs: `v${config.verification_baseline.version}-L${config.verification_baseline.minimum_level}`,
  required_documents: config.required_documents.length,
  verification_scenarios: scenarioRows.length,
  current_verified_scenarios: scenarioRows.filter((row) => row.status === "verified_current").map((row) => row.id),
  future_required_scenarios: scenarioRows.filter((row) => row.status === "required_not_implemented").length,
  activation_blocked_scenarios: scenarioRows.filter((row) => row.status === "blocked").length,
  legacy_customer_routes: "quarantined",
  customer_capabilities_enabled: true
}, null, 2));
