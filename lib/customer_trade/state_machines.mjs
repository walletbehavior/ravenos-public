export const QuoteStates = Object.freeze([
  "idle",
  "requesting",
  "ready",
  "stale",
  "superseded",
  "failed",
]);

export const TradeIntentStates = Object.freeze([
  "draft",
  "quoted",
  "inspected",
  "awaiting_user_signature",
  "signed",
  "submitted",
  "confirmed",
  "partially_filled",
  "filled",
  "failed",
  "expired",
  "cancelled",
]);

export const PlanStates = Object.freeze([
  "draft",
  "saved",
  "attached",
  "partially_applied",
  "completed",
  "cancelled",
  "expired",
]);

export const PositionStates = Object.freeze([
  "forming",
  "open",
  "partially_closed",
  "closed",
  "reconciliation_required",
]);

const transitions = Object.freeze({
  quote: {
    idle: ["requesting"],
    requesting: ["ready", "failed"],
    ready: ["stale", "superseded", "failed"],
    stale: ["requesting", "superseded", "failed"],
    superseded: ["requesting"],
    failed: ["requesting"],
  },
  trade_intent: {
    draft: ["quoted", "cancelled", "expired"],
    quoted: ["inspected", "superseded", "failed", "expired", "cancelled"],
    inspected: ["awaiting_user_signature", "failed", "expired", "cancelled"],
    awaiting_user_signature: ["signed", "failed", "expired", "cancelled"],
    signed: ["submitted", "failed", "expired"],
    submitted: ["confirmed", "partially_filled", "failed", "expired"],
    confirmed: ["partially_filled", "filled", "failed"],
    partially_filled: ["filled", "failed", "cancelled"],
    filled: [],
    failed: [],
    expired: [],
    cancelled: [],
  },
  plan: {
    draft: ["saved", "cancelled", "expired"],
    saved: ["attached", "cancelled", "expired"],
    attached: ["partially_applied", "completed", "cancelled", "expired"],
    partially_applied: ["completed", "cancelled", "expired"],
    completed: [],
    cancelled: [],
    expired: [],
  },
  position: {
    forming: ["open", "reconciliation_required"],
    open: ["partially_closed", "closed", "reconciliation_required"],
    partially_closed: ["closed", "reconciliation_required"],
    closed: ["reconciliation_required"],
    reconciliation_required: ["open", "closed"],
  },
});

export function validStates(machine) {
  return Object.freeze(Object.keys(transitions[machine] || {}));
}

export function canTransition(machine, from, to) {
  const allowed = transitions[machine]?.[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function assertTransition(machine, from, to) {
  if (!canTransition(machine, from, to)) {
    throw new Error(`invalid_${machine}_transition:${from}->${to}`);
  }
  return true;
}

export function transition(machine, record, to, at = new Date().toISOString()) {
  const from = String(record?.status || "");
  assertTransition(machine, from, to);
  return {
    ...record,
    status: to,
    updated_at: at,
    audit: [
      ...(Array.isArray(record?.audit) ? record.audit : []),
      { from, to, at },
    ],
  };
}
