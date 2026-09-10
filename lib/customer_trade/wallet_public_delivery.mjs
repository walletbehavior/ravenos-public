import { publicWalletCard, PUBLIC_WALLET_GROUP_PAGE_SCHEMA } from './wallet_public_cards.mjs';
import { publicWalletPresets } from './wallet_public_presets.mjs';

// Explicit standard wallet-data contract, separate from the private research
// profile. Never spread a stored profile or recursively copy unknown fields.
const fields = names => Object.fromEntries(names.split(' ').map(name => [name,true]));
const basisKeys = ['usdc','sol','eth','weth','usdg','bnb','wbnb','usd'];
const basis = spec => Object.fromEntries(basisKeys.map(key => [key,spec]));
const cash = basis(true);
const size = fields('count total average median');
const period = { ...fields('state start_at end_at buy_count sell_count average_hold_seconds observations closed_observations closed_lots win_rate_pct roi_pct observed_network_fee_lamports observed_network_fee_usd'),
  distribution: [fields('label count')], realized_pnl: cash, buy_notional_by_basis: basis(size), sell_notional_by_basis: basis(size),
  matched_cost_by_basis: cash, matched_proceeds_by_basis: cash };
const periods = Object.fromEntries(['h24','d1','d7','d30','d90','all_available'].map(key => [key,period]));
const unrealized = fields('value_usd covered_tokens visible_holdings');
const recordToken = { ...fields('mint contract symbol decimals buy_count sell_count first_trade_at last_trade_at balance_reconciled remaining_cost_complete unrealized_pnl_usd unrealized_scope'),
  by_basis: basis(fields('matched_closes matched_cost matched_proceeds realized_pnl remaining_cost remaining_quantity')) };
const record = { ...fields('schema_version token_count tokens_truncated scope distribution_unit settlement_bases_combined first_observed_at wallet_creation_time_claimed network_fees_included source_history_complete'),
  basis_labels: basis(true), periods, tokens: [recordToken], unrealized_summary: unrealized,
  usd: { ...fields('state priced_trades eligible_trades'), periods, tokens: [recordToken], unrealized_summary: unrealized } };
const amount = fields('amount amount_base_units lamports observed_at state symbol');
const balanceSummary = fields('visible_provider_mark_value_usd visible_priced_rows visible_unpriced_rows visible_token_rows visible_token_count visible_token_balance_rows visible_provider_mark_symbol largest_visible_provider_mark_weight_pct largest_visible_provider_mark_symbol');
const token = { ...fields('mint contract symbol name decimals balance_raw balance_display balance_ui amount amount_raw amount_display token_account owner program_id token_standard provider_mark_value_usd provider_mark_price_usd price_usd value_usd mark_observed_at price_authority mark_source logo_uri logo_url image_url metadata_state'),
  mark_evidence: fields('liquidity_usd position_exceeds_ten_percent_of_pool'),
  metadata: fields('symbol name decimals image_url logo_uri') };
const missingMark = fields('mint contract reason');
const markCoverage = { ...fields('priced unpriced total priced_tokens unpriced_tokens state'), unavailable: [missingMark] };
const source = fields('chain network chain_id vm_family address source_wallet_id');
const behavior = { ...fields('active_days trade_count first_trade_at last_trade_at tokens_traded token_count token_assets_observed buy_count sell_count median_hold_seconds average_hold_seconds trade_rate_per_active_day'),
  average_buy: cash, median_buy: cash, buy_notional_by_basis: basis(size), sell_notional_by_basis: basis(size) };
const performance = { ...fields('state realized_pnl_usdc realized_pnl_sol roi_pct win_rate_pct profit_factor closed_lots closed_observations'),
  realized_pnl: { ...cash, combined:true, bases_combined:true }, realized_pnl_by_basis: cash, windows: periods };
const coverage = fields('first_observed_at last_observed_at history_scope transactions_observed transactions_reported_by_provider token_transfers_observed trade_events provider_history_exhausted source_history_complete');
const cached = { ...fields('schema_version as_of'), age: fields('first_observed_at seconds_lower_bound basis creation_date_known'),
  transactions: fields('d1 d7 d30 last_observed_at scope window_complete'), pnl: fields('usdc sol as_of scope history_complete bases_combined') };
const profileSpec = { ...fields('schema_version generated_at balances_observed_at'), source_wallet: source, source_performance: performance,
  behavior, coverage, data_quality: fields('history_scope provider_history_exhausted history_complete'), trading_record: record,
  cached_summary: cached, durable_history: fields('unresolved_references history_complete'),
  capital_observations: { current_balance_claimed:true, native:amount, sol:amount, canonical_usdc:amount, provider_reported_token_count:true },
  holdings_snapshot: { ...fields('state observed_at chain address'), assets:[token], native:amount, tokens:[token], mark_coverage:markCoverage, provider_balance_summary:balanceSummary },
  holdings_page: fields('snapshot total offset returned has_more next_cursor observed_at scope'),
  positions: { ...fields('known_cost_open_position_count marked_values_available executable_values_available'),
    known_cost_open_positions:[fields('mint contract basis remaining_quantity remaining_cost lot_count')], provider_reported_token_balances:[token] },
  provider_balance_summary:balanceSummary, mark_coverage:markCoverage,
  provider_activity:fields('normal_transaction_rows erc20_transfer_rows native_transfer_rows internal_movement_rows transfer_in_count transfer_out_count inbound_transfer_rows outbound_transfer_rows most_recent_transfer_at'),
  token_metadata:{schema_version:true,rows:[{...fields('mint contract symbol name decimals observed_at image_url logo_uri provider_mark_price_usd')}]} };

export function selectPublicWalletFields(input, spec) {
  if (input === null || input === undefined) return null;
  if (spec === true) return ['string','boolean'].includes(typeof input) ? (typeof input === 'string' ? input.slice(0,2048) : input)
    : typeof input === 'number' && Number.isFinite(input) ? input : null;
  if (Array.isArray(spec)) return Array.isArray(input) ? input.slice(0,1000).map(row => selectPublicWalletFields(row,spec[0])) : [];
  if (typeof input !== 'object' || Array.isArray(input)) return {};
  const result = {};
  for (const [key,child] of Object.entries(spec)) if (Object.hasOwn(input,key)) result[key] = selectPublicWalletFields(input[key],child);
  return result;
}

export function publicWalletProfile(profile, options = {}) {
  const result = selectPublicWalletFields(profile, profileSpec);
  if (!result) return result;
  for (const key of ['behavior','coverage','source_performance','data_quality','capital_observations','positions']) result[key] ||= {};
  result.public_summary = publicWalletCard(profile,options);
  return result;
}
export function publicScreenerWallet(row, options = {}) {
  const result = selectPublicWalletFields(row, { schema_version:true, source_wallet_id:true, source_wallet:source,
    profile:fields('generated_at'), source_performance:performance, behavior, cached_summary:cached });
  result.public_summary = publicWalletCard(row,options);
  return result;
}
export function publicWalletTokenRows(rows) { return selectPublicWalletFields(rows,[token]); }
export function publicWalletEvent(event) {
  if (typeof event.classification === 'string') return selectPublicWalletFields(event, {
    ...fields('schema_version event_id observed_at action classification'), trader:source,
    token:fields('asset_id contract symbol decimals delta_base_units'), settlement_asset:fields('asset_id contract symbol decimals delta_base_units'),
    size:fields('token_delta_base_units settlement_delta_base_units usd'), chain_evidence:fields('transaction_reference block_number finality') });
  return selectPublicWalletFields(event, { schema_version:true, event_id:true, source_wallet:source, classification:fields('kind'),
    chain_evidence:fields('block_time chain_event_time signature transaction_reference evidence_reference finality slot block_number'),
    economic:{...fields('cost_basis_state transaction_fee_lamports'), source_asset:fields('mint contract asset_id symbol decimals amount_base_units delta_raw amount_raw amount_display amount'), destination_asset:fields('mint contract asset_id symbol decimals amount_base_units delta_raw amount_raw amount_display amount')} });
}

export function publicWalletResponse(payload, options = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const publicKeys = new Set(['ok','schema_version','state','error','message','created','deleted','source_wallet_id','profile','activation','product','access',
    'page','page_size','total','total_pages','pagination','scope','generated_at','rows','presets','view','profile_screen_performed','index_coverage','seen_wallets','limits','limitations',
    'cached','cached_summary','persistence','provider_request_performed','holdings_request_performed','cache','deep_history','activity','events','event_count','matching_event_count','has_more','next_cursor',
    'tokens','mark_unavailable','watch','watches','decisions','exit_decisions','positions','live_assets_held','saves','saved_wallets','lists','saved','save','research_save','copy_available',
    'history_complete_claimed','product_boundary','observed_at','count','window','coverage','profile_rebuilt','backfill_complete','history','cursor','economic_activity_claimed','copy_product','modes','live_mode','execution_boundary','retry_after_seconds','read_only','rows_returned','source_wallet','history_available','refresh_performed','freshness','refresh_state','recent_events','prospective_events_observed','prospective_signals_deferred','baseline_events_observed','retained_events_observed']);
  const result = Object.fromEntries(Object.entries(payload).filter(([key]) => publicKeys.has(key)));
  if (payload.schema_version === PUBLIC_WALLET_GROUP_PAGE_SCHEMA) {
    result.groups = selectPublicWalletFields(payload.groups,[fields('group_id title chain count')]);
    result.selected_group_id = selectPublicWalletFields(payload.selected_group_id,true);
    result.rows = (payload.rows || []).map(row=>publicScreenerWallet(row,{...options,coreCard:row.public_summary}));
  }
  if (payload.cached_summary) result.cached_summary = selectPublicWalletFields(payload.cached_summary, cached);
  if (payload.persistence) result.persistence = selectPublicWalletFields(payload.persistence, fields('state saved_to_raven_index copy_eligible'));
  if (payload.profile?.source_wallet) result.profile = publicWalletProfile(payload.profile,options);
  if (payload.schema_version === 'ravenos.wallet_screener.v1') {
    result.rows = (payload.rows || []).map(row => publicScreenerWallet(row,options));
    // Expanded predicates and rank explanations are private implementation.
    result.presets = publicWalletPresets(payload.presets);
    delete result.query; delete result.projection_exclusions;
    result.limitations = ['Results cover the available wallet history. Past performance does not establish future returns.'];
  }
  if (payload.seen_wallets) {
    result.seen_wallets = selectPublicWalletFields(payload.seen_wallets, {
      ...fields('state total page page_size total_pages has_previous has_next market_evidence_enabled'), pagination: fields('page page_size total total_pages has_previous has_next'),
      rows:[{...fields('source_wallet_id observation_state first_requested_at last_observed_at profile_state profile_available history_available'), source_wallet:source, cached_summary:cached}] });
  }
  if (Array.isArray(payload.events)) result.events = payload.events.map(publicWalletEvent);
  if (Array.isArray(payload.recent_events)) result.recent_events = payload.recent_events.map(publicWalletEvent);
  if (payload.activity?.events) result.activity = { ...payload.activity, events: payload.activity.events.map(publicWalletEvent) };
  if (Array.isArray(payload.tokens)) result.tokens = publicWalletTokenRows(payload.tokens);
  // Internal research belongs on Core or in private server stores. Customer
  // copy policies/decisions are separate user-owned records and stay intact.
  for (const key of ['prospective_copyability','copyability','research_thesis','lineage','funding_lineage','relationships','clusters','reference_policy','source_artifacts']) delete result[key];
  return result;
}
