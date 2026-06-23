import assert from "node:assert/strict";
import {
  participantBreakdown,
  participantIntelligence,
  participantOverlayMarkers,
} from "../lib/ravenos_participants.mjs";

const row = {
  asset: "SOL-PERP",
  market: "Perpetual Futures",
  flowScore: 82,
  attentionVelocity: 18,
  liquidityPosture: "Stable depth",
  risk: "Watch",
  coverage: "indexed",
};

const breakdown = participantBreakdown(row);
assert.equal(breakdown.length, 4);
assert.equal(Math.round(breakdown.reduce((sum, item) => sum + item.contribution, 0)), 100);
assert.ok(breakdown.every((item) => item.label && item.direction && item.velocity >= 0));

const intel = participantIntelligence(row);
assert.match(intel.headline, /contribution/);
assert.ok(intel.participants.length === 4);
assert.ok(["aligned", "conflicted"].includes(intel.conflictState));
assert.ok(["contained", "moderate", "elevated"].includes(intel.distributionRisk));
assert.ok(intel.evidence.length >= 4);

const markers = participantOverlayMarkers(row, [
  { time: "2026-06-23", close: 1 },
  { time: "2026-06-24", close: 2 },
  { time: "2026-06-25", close: 3 },
  { time: "2026-06-26", close: 4 },
]);
assert.ok(markers.length >= 2);
assert.ok(markers.every((marker) => marker.type === "participant-shift"));
