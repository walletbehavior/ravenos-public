import { assertNoSecretBearingFields } from "../customer_trade/contracts.mjs";
import { createAppendOnlyAuditChain } from "./audit_chain.mjs";
import { createCapitalReservationBook } from "./capital_reservations.mjs";
import { createVenueAdapterRegistry } from "./adapter.mjs";
import { evaluateAgenticPlanPolicy, verifyAgenticPolicyDecision } from "./policy.mjs";
import { canTransitionPlanState } from "./state_machines.mjs";
import { agenticContractHash } from "./hashing.mjs";

export const AGENTIC_PAPER_SAGA_STORE_SCHEMA = "ravenos.agentic.paper_saga_store.v1";

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function required(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function timestamp(value, field) {
  const normalized = String(value ?? "").trim();
  const parsed = Date.parse(normalized);
  if (!normalized || !Number.isFinite(parsed)) throw new Error(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function withoutHash(value, hashField) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== hashField));
}

function validateStoreSnapshot(snapshot) {
  if (!snapshot) return null;
  if (snapshot.schema_version !== AGENTIC_PAPER_SAGA_STORE_SCHEMA) throw new Error("paper_saga_snapshot_schema_invalid");
  const expected = agenticContractHash(withoutHash(snapshot, "snapshot_hash"));
  if (!snapshot.snapshot_hash || snapshot.snapshot_hash !== expected) throw new Error("paper_saga_snapshot_integrity_invalid");
  return snapshot;
}

export function createAgenticSagaStore({ snapshot = null, initial_balances = [] } = {}) {
  const restored = validateStoreSnapshot(snapshot);
  const audit = createAppendOnlyAuditChain({ events: restored?.audit?.events || [] });
  const reservations = createCapitalReservationBook({
    initial_balances,
    snapshot: restored?.capital || null,
  });
  const plans = new Map((restored?.plans || []).map((row) => [row.plan_id, freeze(clone(row))]));
  const idempotency = new Map(restored?.idempotency || []);

  function appendStateEvent(planState, eventType, payload, occurredAt) {
    return audit.append({
      event_id: `${planState.plan_id}:${planState.version}:${eventType}`,
      aggregate_type: "trade_plan_saga",
      aggregate_id: planState.plan_id,
      event_type: eventType,
      occurred_at: occurredAt,
      environment: "paper",
      payload,
    }).event;
  }

  return Object.freeze({
    reservations,
    create(planState, { event_type = "plan_proposed", payload = {}, occurred_at } = {}) {
      assertNoSecretBearingFields(planState);
      const planId = required(planState.plan_id, "paper_saga_plan_id");
      const idempotencyKey = required(planState.idempotency_key, "paper_saga_idempotency_key");
      const existingId = idempotency.get(idempotencyKey);
      if (existingId) {
        const existing = plans.get(existingId);
        if (existing?.plan_hash !== planState.plan_hash) throw new Error(`paper_saga_idempotency_conflict:${idempotencyKey}`);
        return { state: clone(existing), idempotent: true };
      }
      if (plans.has(planId)) throw new Error(`paper_saga_plan_exists:${planId}`);
      const at = timestamp(occurred_at, "paper_saga_occurred_at");
      const state = freeze({ ...clone(planState), version: 0, updated_at: at });
      appendStateEvent(state, event_type, payload, at);
      plans.set(planId, state);
      idempotency.set(idempotencyKey, planId);
      return { state: clone(state), idempotent: false };
    },
    update(planId, updater, { event_type, payload = {}, occurred_at } = {}) {
      const id = required(planId, "paper_saga_plan_id");
      const current = plans.get(id);
      if (!current) throw new Error(`paper_saga_plan_not_found:${id}`);
      if (typeof updater !== "function") throw new Error("paper_saga_updater_required");
      const at = timestamp(occurred_at, "paper_saga_occurred_at");
      const candidate = updater(clone(current));
      assertNoSecretBearingFields(candidate);
      if (candidate.plan_id !== id || candidate.idempotency_key !== current.idempotency_key || candidate.plan_hash !== current.plan_hash) {
        throw new Error("paper_saga_immutable_binding_changed");
      }
      const next = freeze({ ...clone(candidate), version: current.version + 1, updated_at: at });
      appendStateEvent(next, required(event_type, "paper_saga_event_type"), payload, at);
      plans.set(id, next);
      return clone(next);
    },
    get(planId) {
      const row = plans.get(String(planId || ""));
      return row ? clone(row) : null;
    },
    list() {
      return [...plans.values()].map(clone);
    },
    audit(planId = null) {
      return planId ? audit.eventsFor("trade_plan_saga", String(planId)) : audit.all();
    },
    verify() {
      return audit.verify();
    },
    snapshot() {
      const payload = {
        schema_version: AGENTIC_PAPER_SAGA_STORE_SCHEMA,
        plans: [...plans.values()].map(clone),
        idempotency: [...idempotency.entries()],
        capital: reservations.snapshot(),
        audit: audit.snapshot(),
      };
      return freeze({ ...payload, snapshot_hash: agenticContractHash(payload) });
    },
  });
}

function intentLegId(intent, index) {
  return required(intent?.leg_id || intent?.intent_id || `leg-${index + 1}`, "paper_saga_leg_id");
}

function intentVenueId(intent) {
  return required(intent?.venue_id || intent?.instrument?.venue_id || intent?.instrument?.venue?.venue_id, "paper_saga_venue_id");
}

function intentChainId(intent) {
  return required(intent?.chain_id || intent?.instrument?.chain_id, "paper_saga_chain_id");
}

function intentCapitalAssetId(intent) {
  return required(intent?.amount?.asset_id || intent?.settlement_asset_id || intent?.settlement_asset?.asset_id || intent?.instrument?.settlement_asset_id, "paper_saga_capital_asset_id");
}

function intentNotionalMicros(intent) {
  if (intent?.requested_notional_usdc_micros !== undefined) return String(intent.requested_notional_usdc_micros);
  const decimal = String(intent?.amount?.value || "");
  if (!/^(?:0|[1-9]\d*)(?:\.(\d+))?$/.test(decimal) || intent?.amount?.kind !== "notional") throw new Error("paper_saga_notional_required");
  const [whole, fraction = ""] = decimal.split(".");
  if (fraction.length > 6) throw new Error("paper_saga_notional_precision_exceeded");
  return `${whole}${fraction.padEnd(6, "0")}`.replace(/^0+(?=\d)/, "") || "0";
}

function planIntents(plan, supplied) {
  if (!Array.isArray(supplied) || !supplied.length) throw new Error("paper_saga_intents_required");
  const byLeg = new Map(supplied.map((intent, index) => [intentLegId(intent, index), intent]));
  if (byLeg.size !== supplied.length) throw new Error("paper_saga_duplicate_leg");
  const refs = Array.isArray(plan?.intents) ? plan.intents : [];
  if (refs.length) {
    if (refs.length !== supplied.length) throw new Error("paper_saga_intent_count_mismatch");
    for (const ref of refs) {
      const intent = supplied.find((row) => row.record_hash === ref.record_hash || row.intent_id === ref.record_id);
      if (!intent) throw new Error("paper_saga_intent_reference_missing");
    }
  }
  const order = Array.isArray(plan?.leg_order) && plan.leg_order.length ? plan.leg_order : [...byLeg.keys()];
  if (order.some((id) => !byLeg.has(id))) throw new Error("paper_saga_leg_order_invalid");
  return order.map((id) => byLeg.get(id));
}

function dependencySatisfied(plan, intent, receipts) {
  const dependencies = (Array.isArray(plan?.dependencies) ? plan.dependencies : []).filter((edge) => edge.to_leg_id === intent.leg_id && edge.required !== false);
  return dependencies.every((edge) => receipts.some((receipt) => receipt.leg_id === edge.from_leg_id && receipt.status === "filled"));
}

function quoteMapFor(intents, values) {
  const map = new Map();
  if (values instanceof Map) return new Map(values);
  if (Array.isArray(values)) values.forEach((quote) => map.set(String(quote.leg_id || ""), quote));
  else if (values && typeof values === "object") Object.entries(values).forEach(([key, value]) => map.set(key, value));
  for (const [index, intent] of intents.entries()) {
    const id = intentLegId(intent, index);
    if (map.has(id) && map.get(id)?.leg_id !== id) map.set(id, { ...map.get(id), leg_id: id });
  }
  return map;
}

function resultExposure(receipts) {
  return receipts
    .filter((receipt) => BigInt(receipt.filled_notional_usdc_micros || "0") > 0n)
    .map((receipt) => ({
      leg_id: receipt.leg_id,
      chain_id: receipt.chain_id,
      venue_id: receipt.venue_id,
      instrument_id: receipt.instrument_id,
      filled_notional_usdc_micros: receipt.filled_notional_usdc_micros,
      status: receipt.status,
      hedge_confirmed: false,
    }));
}

function addAuditState(store, planId, state, eventType, payload, at, changes = {}) {
  return store.update(planId, (current) => {
    if (current.state !== state && !canTransitionPlanState(current.state, state)) {
      throw new Error(`invalid_plan_transition:${current.state}->${state}`);
    }
    return { ...current, ...changes, state };
  }, {
    event_type: eventType,
    payload: { state, ...payload },
    occurred_at: at,
  });
}

export function createPaperPlanOrchestrator({
  adapters = [],
  store = createAgenticSagaStore(),
  clock = () => Date.now(),
  policy_evaluator = evaluateAgenticPlanPolicy,
  portfolio_provider = null,
} = {}) {
  const registry = Array.isArray(adapters) ? createVenueAdapterRegistry(adapters) : adapters;
  if (!registry || typeof registry.require !== "function") throw new Error("paper_saga_adapter_registry_required");
  if (!store || typeof store.create !== "function" || typeof store.update !== "function") throw new Error("paper_saga_store_required");
  if (typeof clock !== "function" || typeof policy_evaluator !== "function") throw new Error("paper_saga_dependency_invalid");
  if (portfolio_provider !== null && typeof portfolio_provider !== "function") throw new Error("paper_saga_portfolio_provider_invalid");

  async function currentPortfolio(basePortfolio, state, stage) {
    if (!portfolio_provider) return clone(basePortfolio);
    return clone(await portfolio_provider({ base_portfolio: clone(basePortfolio), saga_state: clone(state), stage }));
  }

  async function reconcilePlan(planId) {
    let state = store.get(planId);
    if (!state) throw new Error(`paper_saga_plan_not_found:${planId}`);
    const at = new Date(clock()).toISOString();
    if (state.state === "executing" || state.state === "partially_executed") {
      state = addAuditState(store, planId, "reconciliation_required", "reconciliation_started", { prior_state: state.state }, at, {
        reconciliation_required: true,
      });
    }
    const reconciliations = [];
    for (const receipt of state.receipts) {
      const adapter = registry.require(receipt.chain_id, receipt.venue_id, "paper");
      reconciliations.push(await adapter.reconcile(receipt));
    }
    const unresolved = reconciliations.filter((row) => !row.ok || row.state === "indeterminate");
    const allRequiredFilled = state.receipts.length === state.intents.length && state.receipts.every((receipt) => receipt.status === "filled");
    const nextState = unresolved.length
      ? "reconciliation_required"
      : allRequiredFilled
        ? "completed"
        : state.receipts.some((receipt) => BigInt(receipt.filled_notional_usdc_micros || "0") > 0n)
          ? "compensation_required"
          : "failed";
    state = addAuditState(store, planId, nextState, "reconciliation_finished", {
      unresolved_receipts: unresolved.map((row) => row.receipt_id),
      automatic_retry_performed: false,
      automatic_unwind_performed: false,
    }, new Date(clock()).toISOString(), {
      reconciliations,
      reconciliation_required: unresolved.length > 0,
      requires_new_policy_decision: nextState === "compensation_required",
    });
    return freeze(state);
  }

  async function runPaperPlan({ plan, intents: suppliedIntents, policy, portfolio, evidence, quotes = null } = {}) {
    assertNoSecretBearingFields({ plan, intents: suppliedIntents, policy, portfolio, evidence, quotes });
    const planId = required(plan?.plan_id, "paper_saga_plan_id");
    const idempotencyKey = required(plan?.idempotency_key, "paper_saga_idempotency_key");
    const environment = String(plan?.environment || "paper").toLowerCase();
    if (environment !== "paper") throw new Error("paper_saga_environment_required");
    if (plan?.live_execution_enabled === true) throw new Error("paper_saga_live_execution_forbidden");
    const intents = planIntents(plan, suppliedIntents);
    if (intents.some((intent) => String(intent.environment || "paper").toLowerCase() !== "paper" || intent.execution_boundary?.live_placement_enabled === true)) {
      throw new Error("paper_saga_live_intent_forbidden");
    }
    const planHash = String(plan.record_hash || plan.plan_hash || agenticContractHash(plan));
    const existing = store.list().find((row) => row.idempotency_key === idempotencyKey);
    if (existing) {
      if (existing.plan_hash !== planHash) throw new Error(`paper_saga_idempotency_conflict:${idempotencyKey}`);
      return freeze({ ...existing, idempotent_replay: true });
    }
    const now = clock();
    if (!Number.isFinite(Date.parse(String(plan.expires_at || ""))) || Date.parse(plan.expires_at) <= now) throw new Error("paper_saga_plan_expired");
    let state = store.create({
      plan_id: planId,
      plan_hash: planHash,
      idempotency_key: idempotencyKey,
      state: "proposed",
      plan: clone(plan),
      intents: clone(intents),
      quotes: [],
      policy_decisions: [],
      previews: [],
      receipts: [],
      reconciliations: [],
      reservations: [],
      resulting_unhedged_exposure: [],
      reconciliation_required: false,
      requires_new_policy_decision: false,
      automatic_retry_performed: false,
      automatic_unwind_performed: false,
      created_at: new Date(now).toISOString(),
    }, {
      occurred_at: new Date(now).toISOString(),
      payload: { plan_hash: planHash, live_execution_enabled: false },
    }).state;
    state = addAuditState(store, planId, "validated", "plan_validated", { leg_count: intents.length }, new Date(clock()).toISOString());

    const quoteMap = quoteMapFor(intents, quotes);
    for (let index = 0; index < intents.length; index += 1) {
      const intent = intents[index];
      const id = intentLegId(intent, index);
      const adapter = registry.require(intentChainId(intent), intentVenueId(intent), "paper");
      const quote = quoteMap.get(id) || await adapter.quote(intent, { now: clock() });
      quoteMap.set(id, quote);
    }
    state = addAuditState(store, planId, "policy_pending", "quotes_collected", {
      quote_ids: [...quoteMap.values()].map((quote) => quote.quote_id),
    }, new Date(clock()).toISOString(), { quotes: [...quoteMap.values()].map(clone) });
    let portfolioSnapshot = await currentPortfolio(portfolio, state, "initial_policy");
    const initialDecision = policy_evaluator({ plan, intents, policy, portfolio: portfolioSnapshot, evidence, quotes: quoteMap, now: clock() });
    state = store.update(planId, (current) => ({ ...current, policy_decisions: [...current.policy_decisions, initialDecision] }), {
      event_type: "policy_evaluated",
      payload: { result: initialDecision.result, decision_hash: initialDecision.decision_hash },
      occurred_at: new Date(clock()).toISOString(),
    });
    if (initialDecision.result !== "allow") {
      const blockedState = initialDecision.result === "require_approval" ? "approval_required" : "failed";
      return freeze(addAuditState(store, planId, blockedState, "plan_not_authorized", {
        policy_result: initialDecision.result,
        live_execution_attempted: false,
      }, new Date(clock()).toISOString(), { requires_new_policy_decision: true }));
    }
    state = addAuditState(store, planId, "approved", "plan_approved_for_paper", { decision_hash: initialDecision.decision_hash }, new Date(clock()).toISOString());

    const reservedIds = [];
    for (let index = 0; index < intents.length; index += 1) {
      const intent = intents[index];
      const id = intentLegId(intent, index);
      const quote = quoteMap.get(id);
      const amount = String(quote.capital_reservation_amount_atomic || "");
      if (!/^[1-9]\d*$/.test(amount)) throw new Error(`paper_saga_capital_reservation_unresolved:${id}`);
      const reservationId = `reserve:${planId}:${id}`;
      const result = store.reservations.reserve({
        reservation_id: reservationId,
        plan_id: planId,
        leg_id: id,
        chain_id: intentChainId(intent),
        venue_id: intentVenueId(intent),
        asset_id: quote.capital_asset_id || intentCapitalAssetId(intent),
        amount_atomic: amount,
        gas_asset_id: quote.gas_asset_id || null,
        gas_amount_atomic: quote.gas_required_atomic || "0",
        created_at: new Date(clock()).toISOString(),
        updated_at: new Date(clock()).toISOString(),
      });
      if (!result.ok) {
        for (const reservedId of reservedIds) store.reservations.transition(reservedId, "released", new Date(clock()).toISOString());
        return freeze(addAuditState(store, planId, "failed", "capital_reservation_failed", {
          failed_leg_id: id,
          reason: result.reason,
          cross_chain_substitution_attempted: false,
        }, new Date(clock()).toISOString(), { reservations: store.reservations.forPlan(planId), requires_new_policy_decision: true }));
      }
      reservedIds.push(reservationId);
    }
    state = addAuditState(store, planId, "previewing", "capital_reserved", { reservation_ids: reservedIds }, new Date(clock()).toISOString(), {
      reservations: store.reservations.forPlan(planId),
    });
    const previews = [];
    for (let index = 0; index < intents.length; index += 1) {
      const intent = intents[index];
      const id = intentLegId(intent, index);
      const adapter = registry.require(intentChainId(intent), intentVenueId(intent), "paper");
      const preview = await adapter.preview({ intent, quote: quoteMap.get(id), now: clock() });
      previews.push(preview);
      if (preview.state !== "ready") {
        for (const reservedId of reservedIds) {
          if (store.reservations.get(reservedId)?.state === "reserved") store.reservations.transition(reservedId, "released", new Date(clock()).toISOString());
        }
        return freeze(addAuditState(store, planId, "failed", "paper_preview_blocked", {
          failed_leg_id: id,
          errors: preview.errors,
        }, new Date(clock()).toISOString(), { previews, reservations: store.reservations.forPlan(planId), requires_new_policy_decision: true }));
      }
    }
    state = addAuditState(store, planId, "ready", "all_legs_preview_ready", { preview_ids: previews.map((row) => row.preview_id) }, new Date(clock()).toISOString(), { previews });
    state = addAuditState(store, planId, "executing", "paper_execution_started", { live_execution_attempted: false }, new Date(clock()).toISOString());

    for (let index = 0; index < intents.length; index += 1) {
      const intent = intents[index];
      const id = intentLegId(intent, index);
      if (!dependencySatisfied(plan, intent, state.receipts)) {
        for (const reservedId of reservedIds) {
          if (store.reservations.get(reservedId)?.state === "reserved") store.reservations.transition(reservedId, "released", new Date(clock()).toISOString());
        }
        return freeze(addAuditState(store, planId, "partially_executed", "required_dependency_unresolved", {
          failed_leg_id: id,
          automatic_retry_performed: false,
          automatic_unwind_performed: false,
        }, new Date(clock()).toISOString(), {
          reservations: store.reservations.forPlan(planId),
          resulting_unhedged_exposure: resultExposure(state.receipts),
          reconciliation_required: true,
          requires_new_policy_decision: true,
        }));
      }
      portfolioSnapshot = await currentPortfolio(portfolio, state, `before_leg:${id}`);
      const recheck = policy_evaluator({ plan, intents, policy, portfolio: portfolioSnapshot, evidence, quotes: quoteMap, now: clock() });
      const verification = verifyAgenticPolicyDecision(recheck, { plan, intents, policy, portfolio: portfolioSnapshot, evidence, quotes: quoteMap, now: clock() });
      state = store.update(planId, (current) => ({ ...current, policy_decisions: [...current.policy_decisions, recheck] }), {
        event_type: "policy_rechecked_before_leg",
        payload: { leg_id: id, result: recheck.result, errors: verification.errors },
        occurred_at: new Date(clock()).toISOString(),
      });
      if (!verification.ok) {
        for (const reservedId of reservedIds) {
          if (store.reservations.get(reservedId)?.state === "reserved") store.reservations.transition(reservedId, "released", new Date(clock()).toISOString());
        }
        const partial = state.receipts.some((receipt) => BigInt(receipt.filled_notional_usdc_micros || "0") > 0n);
        return freeze(addAuditState(store, planId, partial ? "partially_executed" : "failed", "policy_recheck_blocked", {
          failed_leg_id: id,
          policy_result: recheck.result,
        }, new Date(clock()).toISOString(), {
          reservations: store.reservations.forPlan(planId),
          resulting_unhedged_exposure: resultExposure(state.receipts),
          reconciliation_required: partial,
          requires_new_policy_decision: true,
        }));
      }
      const adapter = registry.require(intentChainId(intent), intentVenueId(intent), "paper");
      const preview = previews.find((row) => row.leg_id === id);
      const reservation = store.reservations.get(`reserve:${planId}:${id}`);
      let receipt;
      try {
        receipt = await adapter.placePaper({ plan, intents, intent, quote: quoteMap.get(id), preview, policy_decision: recheck, reservation, now: clock() });
      } catch (error) {
        receipt = null;
        state = store.update(planId, (current) => current, {
          event_type: "paper_adapter_failed",
          payload: { leg_id: id, reason: String(error?.message || "paper_adapter_failure") },
          occurred_at: new Date(clock()).toISOString(),
        });
      }
      if (receipt) {
        state = store.update(planId, (current) => ({ ...current, receipts: [...current.receipts, receipt] }), {
          event_type: "paper_receipt_recorded",
          payload: { leg_id: id, receipt_id: receipt.receipt_id, status: receipt.status },
          occurred_at: new Date(clock()).toISOString(),
        });
      }
      if (receipt && new Set(["filled", "partially_filled"]).has(receipt.status)) store.reservations.transition(reservation.reservation_id, "consumed", new Date(clock()).toISOString());
      else if (reservation?.state === "reserved") store.reservations.transition(reservation.reservation_id, "released", new Date(clock()).toISOString());
      if (!receipt || receipt.status !== "filled") {
        for (const reservedId of reservedIds) {
          if (store.reservations.get(reservedId)?.state === "reserved") store.reservations.transition(reservedId, "released", new Date(clock()).toISOString());
        }
        const partial = state.receipts.some((row) => BigInt(row.filled_notional_usdc_micros || "0") > 0n);
        return freeze(addAuditState(store, planId, partial ? "partially_executed" : "failed", "required_leg_not_filled", {
          failed_leg_id: id,
          receipt_status: receipt?.status || "adapter_failure",
          automatic_retry_performed: false,
          automatic_unwind_performed: false,
        }, new Date(clock()).toISOString(), {
          reservations: store.reservations.forPlan(planId),
          resulting_unhedged_exposure: resultExposure(state.receipts),
          reconciliation_required: partial,
          requires_new_policy_decision: true,
        }));
      }
    }
    state = addAuditState(store, planId, "reconciliation_required", "all_required_legs_filled", { receipt_ids: state.receipts.map((row) => row.receipt_id) }, new Date(clock()).toISOString(), {
      reservations: store.reservations.forPlan(planId),
      reconciliation_required: true,
    });
    return reconcilePlan(planId);
  }

  async function resumePlan(planId) {
    const state = store.get(planId);
    if (!state) throw new Error(`paper_saga_plan_not_found:${planId}`);
    if (!new Set(["executing", "partially_executed", "reconciliation_required", "compensation_required"]).has(state.state)) {
      return freeze({ ...state, resume_action: "none", paper_execution_restarted: false });
    }
    const reconciled = await reconcilePlan(planId);
    return freeze({ ...reconciled, resume_action: "reconciliation_only", paper_execution_restarted: false });
  }

  function requestCompensation(planId, { replacement_plan = null, replacement_policy_decision = null } = {}) {
    const state = store.get(planId);
    if (!state) throw new Error(`paper_saga_plan_not_found:${planId}`);
    if (!new Set(["partially_executed", "reconciliation_required", "compensation_required"]).has(state.state)) {
      return { ok: false, reason: "compensation_not_applicable", execution_started: false };
    }
    if (!replacement_plan || !replacement_policy_decision || replacement_policy_decision.result !== "allow") {
      return { ok: false, reason: "new_policy_decision_required", execution_started: false, automatic_unwind_performed: false };
    }
    if (replacement_plan.plan_id === planId || replacement_policy_decision.plan_id !== replacement_plan.plan_id) {
      return { ok: false, reason: "replacement_plan_policy_binding_invalid", execution_started: false };
    }
    return {
      ok: true,
      state: "new_plan_required",
      replacement_plan_id: replacement_plan.plan_id,
      policy_decision_hash: replacement_policy_decision.decision_hash,
      execution_started: false,
      automatic_unwind_performed: false,
    };
  }

  return Object.freeze({
    runPaperPlan,
    reconcilePlan,
    resumePlan,
    requestCompensation,
    getPlan: (planId) => store.get(planId),
    audit: (planId) => store.audit(planId),
    snapshot: () => store.snapshot(),
    adapterCapabilities: () => registry.capabilities(),
  });
}
