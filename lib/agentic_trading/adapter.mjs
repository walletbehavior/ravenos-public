import { agenticContractHash } from "./hashing.mjs";

export const AGENTIC_VENUE_CAPABILITY_SCHEMA = "ravenos.agentic.venue_capability.v1";

export const AgenticAdapterOperations = Object.freeze([
  "observe_account",
  "positions",
  "quote",
  "preview",
  "paper_place",
  "live_place",
  "cancel",
  "status",
  "reconcile",
  "estimate_fees",
  "estimate_gas",
  "health",
]);

const ENVIRONMENTS = new Set(["preview", "paper", "testnet", "mainnet_read_only"]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,255}$/;

function requiredIdentifier(value, field) {
  const normalized = String(value ?? "").trim();
  if (!IDENTIFIER.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function canonicalScopeIdentifier(value, field) {
  return requiredIdentifier(value, field).toLowerCase();
}

function uniqueIdentifiers(values, field) {
  const normalized = (Array.isArray(values) ? values : []).map((value) => requiredIdentifier(value, field));
  return [...new Set(normalized)].sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

export function createVenueCapability(input = {}) {
  const environment = String(input.environment || "paper").trim().toLowerCase();
  if (!ENVIRONMENTS.has(environment)) throw new Error("adapter_environment_invalid");
  const operations = Object.fromEntries(AgenticAdapterOperations.map((operation) => [operation, input.operations?.[operation] === true]));
  if (!operations.health) throw new Error("venue_adapter_health_capability_required");
  if (operations.live_place) throw new Error("live_place_capability_forbidden");
  const core = {
    schema_version: AGENTIC_VENUE_CAPABILITY_SCHEMA,
    adapter_id: canonicalScopeIdentifier(input.adapter_id, "adapter_id"),
    adapter_version: String(input.adapter_version || "1").trim(),
    chain_id: canonicalScopeIdentifier(input.chain_id, "chain_id"),
    venue_id: canonicalScopeIdentifier(input.venue_id, "venue_id"),
    environment,
    instrument_types: uniqueIdentifiers(input.instrument_types, "instrument_type"),
    settlement_asset_ids: uniqueIdentifiers(input.settlement_asset_ids, "settlement_asset_id"),
    native_gas_asset_id: input.native_gas_asset_id
      ? requiredIdentifier(input.native_gas_asset_id, "native_gas_asset_id")
      : null,
    operations,
    live_execution_enabled: false,
    autonomous_bridging_enabled: false,
    arbitrary_calldata_supported: false,
    arbitrary_destination_supported: false,
  };
  if (!core.adapter_version) throw new Error("adapter_version_required");
  if (!core.instrument_types.length) throw new Error("instrument_types_required");
  const capability_hash = agenticContractHash(core);
  return deepFreeze({ ...core, capability_hash });
}

export class AgenticVenueAdapter {
  constructor(capability) {
    this.capability = createVenueCapability(capability);
  }

  async discoverCapabilities() { return this.capability; }
  async observeAccount() { throw new Error("observe_account_not_implemented"); }
  async positions() { throw new Error("positions_not_implemented"); }
  async quote() { throw new Error("quote_not_implemented"); }
  async preview() { throw new Error("preview_not_implemented"); }
  async placePaper() { throw new Error("paper_place_not_implemented"); }
  async placeLive() { throw new Error("live_execution_disabled"); }
  async cancel() { throw new Error("cancel_not_implemented"); }
  async status() { throw new Error("status_not_implemented"); }
  async reconcile() { throw new Error("reconcile_not_implemented"); }
  async estimateFees() { throw new Error("fee_estimation_not_implemented"); }
  async estimateGas() { throw new Error("gas_estimation_not_implemented"); }
  async health() { throw new Error("health_not_implemented"); }
}

const METHOD_BY_OPERATION = Object.freeze({
  observe_account: "observeAccount",
  positions: "positions",
  quote: "quote",
  preview: "preview",
  paper_place: "placePaper",
  live_place: "placeLive",
  cancel: "cancel",
  status: "status",
  reconcile: "reconcile",
  estimate_fees: "estimateFees",
  estimate_gas: "estimateGas",
  health: "health",
});

export function assertVenueAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw new Error("venue_adapter_required");
  const capability = createVenueCapability(adapter.capability || {});
  for (const operation of AgenticAdapterOperations) {
    if (capability.operations[operation] && typeof adapter[METHOD_BY_OPERATION[operation]] !== "function") {
      throw new Error(`venue_adapter_method_missing:${METHOD_BY_OPERATION[operation]}`);
    }
  }
  if (typeof adapter.placeLive !== "function") throw new Error("venue_adapter_live_denial_missing");
  return true;
}

export function adapterRegistryKey(chainId, venueId, environment = "paper") {
  return [chainId, venueId, environment].map((value) => canonicalScopeIdentifier(value, "adapter_registry_key")).join("|");
}

export function createVenueAdapterRegistry(adapters = []) {
  const entries = new Map();
  for (const adapter of adapters) {
    assertVenueAdapter(adapter);
    const capability = adapter.capability;
    const key = adapterRegistryKey(capability.chain_id, capability.venue_id, capability.environment);
    if (entries.has(key)) throw new Error(`duplicate_venue_adapter:${key}`);
    entries.set(key, adapter);
  }
  return Object.freeze({
    get(chainId, venueId, environment = "paper") {
      return entries.get(adapterRegistryKey(chainId, venueId, environment)) || null;
    },
    require(chainId, venueId, environment = "paper") {
      const adapter = this.get(chainId, venueId, environment);
      if (!adapter) throw new Error(`venue_adapter_unavailable:${adapterRegistryKey(chainId, venueId, environment)}`);
      return adapter;
    },
    capabilities() {
      return [...entries.values()].map((adapter) => adapter.capability);
    },
  });
}
