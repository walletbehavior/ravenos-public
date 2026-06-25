export class WalletConnector {
  constructor({ chain, name }) {
    this.chain = chain;
    this.name = name;
  }
  async connect() {
    throw new Error("wallet_connector_not_implemented");
  }
  async disconnect() {
    throw new Error("wallet_connector_not_implemented");
  }
}

export class AssetResolver {
  async resolve(_query, _chain) {
    throw new Error("asset_resolver_not_implemented");
  }
}

export class BalanceProvider {
  async balances(_wallet, _chain) {
    throw new Error("balance_provider_not_implemented");
  }
}

export class QuoteProvider {
  async quote(_request) {
    throw new Error("quote_provider_not_implemented");
  }
}

export class SwapProvider {
  async buildUnsignedTransaction(_intent, _quote) {
    throw new Error("swap_provider_not_implemented");
  }
}

export class ConditionalOrderProvider {
  async create(_plan) {
    throw new Error("conditional_order_provider_not_implemented");
  }
  async cancel(_orderId) {
    throw new Error("conditional_order_provider_not_implemented");
  }
}

export class TransactionSimulator {
  async simulate(_unsignedTransaction) {
    throw new Error("transaction_simulator_not_implemented");
  }
}

export class TransactionInspector {
  inspect(_unsignedTransaction, _expectations) {
    throw new Error("transaction_inspector_not_implemented");
  }
}

export class TransactionSubmitter {
  async submit(_signedTransaction) {
    throw new Error("transaction_submitter_not_implemented");
  }
}

export class TransactionStatusProvider {
  async status(_signatureOrHash) {
    throw new Error("transaction_status_provider_not_implemented");
  }
}

export class PositionTracker {
  async reconcile(_wallet, _chain) {
    throw new Error("position_tracker_not_implemented");
  }
}

export class TradePlanEngine {
  suggest(_context) {
    throw new Error("trade_plan_engine_not_implemented");
  }
}

export class TradeAuditStore {
  async append(_event) {
    throw new Error("trade_audit_store_not_implemented");
  }
}

export class JupiterSwapProvider extends QuoteProvider {
  constructor({ quoteEndpoint = "https://api.jup.ag/swap/v2/order" } = {}) {
    super();
    this.provider = "JupiterSwapProvider";
    this.chain = "solana";
    this.quoteEndpoint = quoteEndpoint;
  }
}

export class JupiterTriggerProvider extends ConditionalOrderProvider {
  constructor() {
    super();
    this.provider = "JupiterTriggerProvider";
    this.chain = "solana";
    this.status = "scaffold_only";
  }
}

export class ZeroXSwapProvider extends QuoteProvider {
  constructor({ quoteEndpoint = "https://api.0x.org/swap/allowance-holder/quote" } = {}) {
    super();
    this.provider = "ZeroXSwapProvider";
    this.chain = "base";
    this.quoteEndpoint = quoteEndpoint;
    this.status = "scaffold_only";
  }
}

export class BaseConditionalOrderProvider extends ConditionalOrderProvider {
  constructor() {
    super();
    this.provider = "BaseConditionalOrderProvider";
    this.chain = "base";
    this.status = "interface_only";
  }
}
