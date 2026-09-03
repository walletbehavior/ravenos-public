import assert from "node:assert/strict";
import test from "node:test";

import {
  CustomerLiveExecutionAuthorization,
  customerLiveExecutionRefusal,
  publicCustomerLiveExecutionCapabilities,
  resolveCustomerLiveExecutionGate,
} from "../lib/customer_trade/live_execution_gate.mjs";

const NOW = 1_788_278_400;
const USER = "usr_live_canary_fixture";

function principal(overrides = {}) {
  return { user_id: USER, authenticated_at: NOW - 60, ...overrides };
}

function enabledEnv(overrides = {}) {
  return {
    RAVENOS_CUSTOMER_TRADE_LIVE_ENABLE: "1",
    RAVENOS_CUSTOMER_TRADE_KILL_SWITCH: "clear",
    RAVENOS_CUSTOMER_TRADE_LIVE_USERS: USER,
    RAVENOS_CUSTOMER_TRADE_HYPERLIQUID_LIVE_ENABLE: "1",
    ...overrides,
  };
}

test("source authority permits only implemented wallet-owned venue lanes", () => {
  const gate = resolveCustomerLiveExecutionGate({}, null, { nowSeconds: NOW });
  assert.equal(gate.source_ready, true);
  assert.equal(gate.chains.hyperliquid.source_ready, true);
  assert.equal(gate.chains.solana.source_ready, true);
  assert.equal(gate.chains.robinhood.source_ready, true);
  assert.equal(gate.chains.bsc.source_ready, true);
  assert.equal(gate.chains.base.source_ready, true);
  assert.equal(gate.chains.ethereum.source_ready, true);
  assert.equal(CustomerLiveExecutionAuthorization.solana_signed_transaction_submission, true);
  assert.equal(CustomerLiveExecutionAuthorization.evm_wallet_transaction_submission, true);
  assert.equal(CustomerLiveExecutionAuthorization.raven_signing, false);
  assert.equal(CustomerLiveExecutionAuthorization.raven_private_key_access, false);
  assert.equal(CustomerLiveExecutionAuthorization.custody, false);
  assert.equal(CustomerLiveExecutionAuthorization.arbitrary_transaction_submission, false);
});

test("allowlisted recently authenticated user can reach each explicitly enabled wallet canary", () => {
  const gate = resolveCustomerLiveExecutionGate(enabledEnv({
    RAVENOS_CUSTOMER_TRADE_SOLANA_LIVE_ENABLE: "1",
  }), principal(), { nowSeconds: NOW });
  assert.equal(gate.configured, true);
  assert.equal(gate.canary_only, true);
  assert.equal(gate.principal_allowed, true);
  assert.equal(gate.chains.hyperliquid.available_to_principal, true);
  assert.equal(gate.chains.solana.enabled, true);
  assert.equal(gate.chains.solana.available_to_principal, true);
  assert.equal(gate.chains.robinhood.enabled, false);
  assert.equal(gate.chains.robinhood.available_to_principal, false);
  assert.equal(gate.chains.bsc.available_to_principal, false);
  assert.equal(gate.chains.base.available_to_principal, false);
  assert.equal(gate.chains.ethereum.available_to_principal, false);
  assert.equal(customerLiveExecutionRefusal(gate, "hyperliquid"), null);
  assert.equal(customerLiveExecutionRefusal(gate, "solana"), null);
});

test("Robinhood Chain is independently gated behind the wallet-signed EVM lane", () => {
  const gate = resolveCustomerLiveExecutionGate(enabledEnv({
    RAVENOS_CUSTOMER_TRADE_ROBINHOOD_LIVE_ENABLE: "1",
  }), principal(), { nowSeconds: NOW });
  assert.equal(gate.chains.robinhood.enabled, true);
  assert.equal(gate.chains.robinhood.available_to_principal, true);
  assert.equal(customerLiveExecutionRefusal(gate, "robinhood"), null);
  assert.equal(gate.authority.raven_signing, false);
  assert.equal(gate.authority.custody, false);
});

test("BNB Chain is independently gated behind the wallet-signed EVM lane", () => {
  const gate = resolveCustomerLiveExecutionGate(enabledEnv({
    RAVENOS_CUSTOMER_TRADE_BSC_LIVE_ENABLE: "1",
  }), principal(), { nowSeconds: NOW });
  assert.equal(gate.chains.bsc.enabled, true);
  assert.equal(gate.chains.bsc.available_to_principal, true);
  assert.equal(gate.chains.robinhood.enabled, false);
  assert.equal(customerLiveExecutionRefusal(gate, "bsc"), null);
  assert.equal(gate.authority.raven_signing, false);
  assert.equal(gate.authority.custody, false);
});

for (const [chain, variable] of [
  ["base", "RAVENOS_CUSTOMER_TRADE_BASE_LIVE_ENABLE"],
  ["ethereum", "RAVENOS_CUSTOMER_TRADE_ETHEREUM_LIVE_ENABLE"],
]) {
  test(`${chain} is independently gated behind the wallet-signed EVM lane`, () => {
    const gate = resolveCustomerLiveExecutionGate(enabledEnv({ [variable]: "1" }), principal(), { nowSeconds: NOW });
    assert.equal(gate.chains[chain].enabled, true);
    assert.equal(gate.chains[chain].available_to_principal, true);
    assert.equal(customerLiveExecutionRefusal(gate, chain), null);
    assert.equal(gate.authority.raven_signing, false);
    assert.equal(gate.authority.custody, false);
  });
}

test("kill switch, allowlist, and recent authentication independently fail closed", () => {
  const killed = resolveCustomerLiveExecutionGate(enabledEnv({ RAVENOS_CUSTOMER_TRADE_KILL_SWITCH: "halt" }), principal(), { nowSeconds: NOW });
  assert.equal(customerLiveExecutionRefusal(killed, "hyperliquid"), "live_execution_kill_switch_active");

  const denied = resolveCustomerLiveExecutionGate(enabledEnv(), principal({ user_id: "usr_someone_else" }), { nowSeconds: NOW });
  assert.equal(customerLiveExecutionRefusal(denied, "hyperliquid"), "live_execution_user_not_allowlisted");

  const stale = resolveCustomerLiveExecutionGate(enabledEnv(), principal({ authenticated_at: NOW - (13 * 60 * 60) }), { nowSeconds: NOW });
  assert.equal(customerLiveExecutionRefusal(stale, "hyperliquid"), "recent_authentication_required");
});

test("public projection exposes capability state without exposing the canary user list", () => {
  const projection = publicCustomerLiveExecutionCapabilities(enabledEnv());
  assert.equal(projection.code_ready, true);
  assert.equal(projection.configured, true);
  assert.equal(projection.public_available, false);
  assert.equal(projection.chains.hyperliquid.source_ready, true);
  assert.equal(projection.chains.solana.source_ready, true);
  assert.equal(projection.chains.robinhood.source_ready, true);
  assert.equal(projection.chains.robinhood.enabled, false);
  assert.equal(projection.chains.bsc.source_ready, true);
  assert.equal(projection.chains.bsc.enabled, false);
  assert.equal(projection.chains.base.source_ready, true);
  assert.equal(projection.chains.base.enabled, false);
  assert.equal(projection.chains.ethereum.source_ready, true);
  assert.equal(projection.chains.ethereum.enabled, false);
  assert.equal(JSON.stringify(projection).includes(USER), false);
});
