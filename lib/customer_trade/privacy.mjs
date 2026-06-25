export const TradeStorageNamespaces = Object.freeze({
  localDrafts: "raven_trade_local_drafts_v1",
  localSchemes: "raven_trade_local_schemes_v1",
  localJournal: "raven_trade_local_journal_v1",
});

export function isCustomerTradePrivateField(key = "") {
  const text = String(key).toLowerCase();
  return [
    "connected_wallet",
    "wallet_address",
    "wallet",
    "trade_intent",
    "trade_plan",
    "saved_scheme",
    "position",
    "position_size",
    "quote_request",
    "transaction_payload",
    "signed_transaction",
    "tp",
    "sl",
    "take_profit",
    "stop_loss",
  ].some((needle) => text.includes(needle));
}

export function assertPublicArtifactHasNoCustomerTradeState(payload) {
  const offenders = [];
  function walk(value, path = "") {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (isCustomerTradePrivateField(key)) offenders.push(next);
      walk(item, next);
    }
  }
  walk(payload);
  if (offenders.length) throw new Error(`customer_trade_state_in_public_artifact:${offenders.slice(0, 5).join(",")}`);
  return true;
}

export const SelectiveDisclosureExporterContract = Object.freeze({
  scope: "selected_records",
  date_range: { start: null, end: null },
  assets: [],
  fields: [],
  disclosure_purpose: "",
  expiry: null,
  integrity_proof: null,
  spending_authority: false,
});
