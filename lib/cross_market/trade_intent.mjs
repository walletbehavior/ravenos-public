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
    requested_settlement_asset: text(input.requested_settlement_asset || instrument.settlement_asset.symbol).toUpperCase(),
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
  const available = intent.state === "preview_only" && Boolean(route.available);
  const isExit = intent.side === "sell";
  const isPerpetual = intent.instrument.instrument_type === "perpetual";
  const defaultInputAsset = isExit ? intent.instrument.base_asset.symbol : intent.amount.currency;
  const defaultOutputAsset = isExit
    ? intent.requested_settlement_asset
    : isPerpetual
      ? intent.instrument.symbol
      : intent.instrument.base_asset.symbol;
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
      input_asset: text(route.input_asset || defaultInputAsset).toUpperCase(),
      output_asset: text(route.output_asset || defaultOutputAsset).toUpperCase(),
      expected_output: finite(route.expected_output),
      fee_amount: finite(route.fee_amount),
      fee_currency: text(route.fee_currency || intent.amount.currency).toUpperCase(),
      gas_amount: finite(route.gas_amount),
      gas_currency: text(route.gas_currency).toUpperCase() || null,
      price_impact_pct: finite(route.price_impact_pct),
      slippage_bps: finite(route.slippage_bps),
      actual_settlement_asset: text(route.actual_settlement_asset || intent.instrument.settlement_asset.symbol).toUpperCase(),
      expires_at: text(route.expires_at) || null,
    } : null,
    unavailable_reason: available ? null : text(input.unavailable_reason || route.unavailable_reason, "route_unavailable"),
    confirmation_boundary: available ? confirmationBoundary : null,
    customer_confirmation_required: available,
    wallet_confirmation_required: available && confirmationBoundary === "wallet",
    account_confirmation_required: available && confirmationBoundary !== "wallet",
    signing_available: false,
    submission_available: false,
    transaction_payload_included: false,
  };
}
