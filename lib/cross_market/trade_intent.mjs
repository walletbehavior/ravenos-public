import { normalizeInstrument, validateInstrument } from "./instrument.mjs";

export const RAVENOS_TRADE_INTENT_SCHEMA = "ravenos.trade_intent.v1";
export const RAVENOS_SETTLEMENT_PREVIEW_SCHEMA = "ravenos.settlement_preview.v1";

const SIDES = new Set(["buy", "sell", "long", "short"]);

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createTradeIntent(input = {}) {
  const validation = validateInstrument(input.instrument || {});
  const instrument = validation.instrument;
  const side = text(input.side).toLowerCase();
  const amount = finite(input.amount?.value ?? input.amount);
  const amountCurrency = text(input.amount?.currency || input.amount_currency || instrument.economic_numeraire).toUpperCase();
  const errors = [...validation.errors];
  if (!SIDES.has(side)) errors.push("trade_side_invalid");
  if (!(amount > 0)) errors.push("trade_amount_invalid");
  const permittedSides = instrument.instrument_type === "perpetual" ? new Set(["long", "short"]) : new Set(["buy", "sell"]);
  if (SIDES.has(side) && !permittedSides.has(side)) errors.push("trade_side_incompatible");
  const spot = ["token", "exact_pool"].includes(instrument.instrument_type);
  const preferredCashAsset = text(
    input.preferred_cash_asset?.symbol || input.preferredCashAsset?.symbol || input.preferred_cash_asset || input.preferredCashAsset || instrument.preferred_cash_asset?.symbol,
    spot ? "USDC" : instrument.settlement_asset.symbol,
  ).toUpperCase();
  const requestedSettlementAsset = text(input.requested_settlement_asset, spot ? preferredCashAsset : instrument.settlement_asset.symbol).toUpperCase();
  const economicInputAsset = side === "sell" ? instrument.base_asset.symbol : amountCurrency;
  const economicOutputAsset = side === "sell"
    ? requestedSettlementAsset
    : instrument.instrument_type === "perpetual"
      ? instrument.symbol
      : instrument.base_asset.symbol;
  return {
    schema_version: RAVENOS_TRADE_INTENT_SCHEMA,
    intent_id: text(input.intent_id) || null,
    created_at: text(input.created_at) || new Date().toISOString(),
    instrument,
    side,
    amount: {
      value: amount,
      currency: amountCurrency,
      denomination: text(input.amount?.denomination || input.amount_denomination, "economic_numeraire"),
    },
    requested_settlement_asset: requestedSettlementAsset,
    economic_flow: {
      preferred_cash_asset: preferredCashAsset,
      input_asset: economicInputAsset,
      output_asset: economicOutputAsset,
      source_custody_domain: text(input.source_custody_domain) || null,
      destination_custody_domain: text(input.destination_custody_domain) || null,
      cross_domain_route_policy: "resolve_end_to_end_and_review",
      manual_bridge_status: "unresolved_until_route",
    },
    account_id: text(input.account_id) || null,
    route_preference: text(input.route_preference, "best_available"),
    execution_authorized: false,
    signing_authorized: false,
    state: errors.length ? "invalid" : "preview_only",
    errors: [...new Set(errors)],
  };
}

export function createSettlementPreview(input = {}) {
  const intent = input.intent?.schema_version === RAVENOS_TRADE_INTENT_SCHEMA ? input.intent : createTradeIntent(input.intent || input);
  const route = input.route && typeof input.route === "object" ? input.route : {};
  const routeErrors = [];
  const isExit = intent.side === "sell";
  const isPerpetual = intent.instrument.instrument_type === "perpetual";
  const defaultInputAsset = isExit ? intent.instrument.base_asset.symbol : intent.amount.currency;
  const defaultOutputAsset = isExit
    ? intent.requested_settlement_asset
    : isPerpetual
      ? intent.instrument.symbol
      : intent.instrument.base_asset.symbol;
  const routeInputAsset = text(route.input_asset || defaultInputAsset).toUpperCase();
  const routeOutputAsset = text(route.output_asset || defaultOutputAsset).toUpperCase();
  const expectedOutputAsset = text(intent.economic_flow?.output_asset || defaultOutputAsset).toUpperCase();
  const sourceCustodyDomain = text(route.source_custody_domain || intent.economic_flow?.source_custody_domain) || null;
  const destinationCustodyDomain = text(route.destination_custody_domain || intent.economic_flow?.destination_custody_domain) || null;
  const transferProvider = text(route.transfer_provider) || null;
  const custodyDomainsDiffer = Boolean(sourceCustodyDomain && destinationCustodyDomain && sourceCustodyDomain !== destinationCustodyDomain);
  const crossDomainTransferRequired = route.cross_domain_transfer_required === true || custodyDomainsDiffer;
  const declaresCrossDomainState = crossDomainTransferRequired || Boolean(transferProvider) || Boolean(sourceCustodyDomain) !== Boolean(destinationCustodyDomain);
  if (route.available && routeOutputAsset !== expectedOutputAsset) routeErrors.push("route_output_asset_mismatch");
  if (route.available && declaresCrossDomainState) {
    if (!sourceCustodyDomain || !destinationCustodyDomain || !transferProvider) routeErrors.push("cross_domain_route_incomplete");
    if (crossDomainTransferRequired && route.end_to_end !== true) routeErrors.push("cross_domain_route_not_end_to_end");
  }
  const available = intent.state === "preview_only" && Boolean(route.available) && routeErrors.length === 0;
  const confirmationBoundary = intent.instrument.asset_class === "crypto"
    ? (isPerpetual ? "venue_account" : "wallet")
    : "broker_account";
  return {
    schema_version: RAVENOS_SETTLEMENT_PREVIEW_SCHEMA,
    generated_at: new Date().toISOString(),
    intent,
    state: available ? "quote_preview_available" : "unavailable",
    route: available ? {
      provider: text(route.provider, "undisclosed_provider"),
      venue: text(route.venue || intent.instrument.venue),
      input_asset: routeInputAsset,
      output_asset: routeOutputAsset,
      expected_output: finite(route.expected_output),
      fee_amount: finite(route.fee_amount),
      fee_currency: text(route.fee_currency || intent.amount.currency).toUpperCase(),
      gas_amount: finite(route.gas_amount),
      gas_currency: text(route.gas_currency).toUpperCase() || null,
      price_impact_pct: finite(route.price_impact_pct),
      slippage_bps: finite(route.slippage_bps),
      actual_settlement_asset: text(route.actual_settlement_asset || intent.instrument.settlement_asset.symbol).toUpperCase(),
      source_custody_domain: sourceCustodyDomain,
      destination_custody_domain: destinationCustodyDomain,
      cross_domain_transfer: {
        required: crossDomainTransferRequired,
        provider: transferProvider,
        end_to_end: crossDomainTransferRequired ? true : null,
        manual_bridge_required: false,
        review_required: crossDomainTransferRequired,
      },
      expires_at: text(route.expires_at) || null,
    } : null,
    settlement_truth: {
      preferred_cash_asset: intent.economic_flow?.preferred_cash_asset || intent.requested_settlement_asset,
      venue_settlement_asset: intent.instrument.settlement_asset.symbol,
      economic_input_asset: intent.economic_flow?.input_asset || defaultInputAsset,
      economic_output_asset: intent.economic_flow?.output_asset || defaultOutputAsset,
      source_custody_domain: available ? sourceCustodyDomain : null,
      destination_custody_domain: available ? destinationCustodyDomain : null,
      cross_domain_transfer_required: available ? crossDomainTransferRequired : null,
      cross_domain_review_required: available && crossDomainTransferRequired,
      manual_bridge_required: available ? false : null,
    },
    unavailable_reason: available ? null : text(routeErrors[0] || input.unavailable_reason || route.unavailable_reason, "route_unavailable"),
    route_errors: routeErrors,
    confirmation_boundary: available ? confirmationBoundary : null,
    customer_confirmation_required: available,
    wallet_confirmation_required: available && confirmationBoundary === "wallet",
    account_confirmation_required: available && confirmationBoundary !== "wallet",
    signing_available: false,
    submission_available: false,
    transaction_payload_included: false,
  };
}
