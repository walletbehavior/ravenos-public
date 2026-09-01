import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import {
  CONSTANT_K_NEXUS_WALLET_BATCH_SCHEMA,
  ConstantKNexusWalletLimits,
  buildConstantKNexusWalletReferenceBatch,
  runConstantKNexusWalletStreamBatch,
} from "../lib/customer_trade/constant_k_nexus_wallet_transport.mjs";
import { normalizeSourceWalletTransportReference } from "../lib/customer_trade/source_wallet_transports.mjs";
import { runConstantKWalletObserverLiveValidation } from "../scripts/validate-constant-k-wallet-observer-live.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 81));
const OTHER_WALLET = bs58.encode(Buffer.alloc(32, 82));
const SECOND_WALLET = bs58.encode(Buffer.alloc(32, 83));
const NOW = "2026-09-01T05:00:00.000Z";
const TOKEN = bs58.encode(Buffer.alloc(32, 84));
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

function signature(value) {
  return bs58.encode(Buffer.alloc(64, value));
}

function transaction({
  wallet = WALLET,
  signers = [wallet],
  rowSignature = signature(1),
  slot = 443_336_400,
  ts = "2026-09-01T04:59:59.250Z",
  provider = "constant_k",
  extra = {},
} = {}) {
  return {
    event: "solana_grpc_transaction",
    provider,
    ts,
    slot: String(slot),
    signature: rowSignature,
    signer_accounts: signers,
    matched_identity_signers: [wallet],
    accounts: [wallet, OTHER_WALLET],
    programs: [JUPITER],
    token_balance_deltas: [{ owner: wallet, mint: OTHER_WALLET, delta_raw: "10" }],
    joint_entity_token_balance_deltas: [
      { owner: wallet, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", delta_raw: "-25000000" },
      { owner: wallet, mint: OTHER_WALLET, delta_raw: "10000000" },
    ],
    joint_entity_token_balance_deltas_complete: true,
    filter_names: ["identity_backed"],
    ...extra,
  };
}

test("Constant-K reducer emits one exact watched-signer reference and discards provider payload", () => {
  const row = transaction({ extra: { raw_provider_payload: { must_not_persist: true }, subscriber_id: "private" } });
  const batch = buildConstantKNexusWalletReferenceBatch({ watches: [WALLET], events: [row], now: () => NOW });
  assert.equal(batch.capture.schema_version, CONSTANT_K_NEXUS_WALLET_BATCH_SCHEMA);
  assert.equal(batch.capture.state, "current");
  assert.equal(batch.capture.counts.emitted_references, 1);
  assert.equal(batch.capture.provider_event_age.p50_ms, 750);
  assert.deepEqual(batch.capture.cursor, { slot: 443_336_400, signature: signature(1) });
  assert.deepEqual(batch.references[0], {
    wallet_address: WALLET,
    signature: signature(1),
    slot: 443_336_400,
    finality: "processed",
    provider_observed_at: "2026-09-01T04:59:59.250Z",
    raven_received_at: "2026-09-01T04:59:59.250Z",
    evidence_reference: `solana:signature:${signature(1)}`,
  });
  const serialized = JSON.stringify(batch);
  assert.equal(serialized.includes("must_not_persist"), false);
  assert.equal(serialized.includes('"subscriber_id":'), false);
  assert.equal(serialized.includes("token_balance_deltas"), false);
});

test("Constant-K matching requires the exact watched wallet to be a transaction signer", () => {
  const batch = buildConstantKNexusWalletReferenceBatch({
    watches: [WALLET],
    events: [transaction({ wallet: WALLET, signers: [OTHER_WALLET] })],
    now: () => NOW,
  });
  assert.equal(batch.references.length, 0);
  assert.equal(batch.capture.counts.off_universe_transactions, 1);
  assert.equal(batch.capture.counts.watched_transactions, 0);
});

test("one Constant-K transaction can produce separately attributable references for two watched signers", () => {
  const batch = buildConstantKNexusWalletReferenceBatch({
    watches: [WALLET, SECOND_WALLET],
    events: [transaction({ signers: [WALLET, SECOND_WALLET] })],
    now: () => NOW,
  });
  assert.equal(batch.references.length, 2);
  assert.deepEqual(batch.references.map((row) => row.wallet_address).sort(), [SECOND_WALLET, WALLET].sort());
  assert.equal(batch.capture.counts.watched_transactions, 1);
  assert.equal(batch.capture.counts.watched_signers, 2);
});

test("duplicate Constant-K deliveries are reduced before observer queue ingestion", () => {
  const row = transaction();
  const batch = buildConstantKNexusWalletReferenceBatch({ watches: [WALLET], events: [row, row], now: () => NOW });
  assert.equal(batch.references.length, 1);
  assert.equal(batch.capture.counts.duplicate_references, 1);
});

test("slot frames and unrelated stream messages do not become wallet deliveries", () => {
  const batch = buildConstantKNexusWalletReferenceBatch({
    watches: [WALLET],
    events: [
      { event: "solana_grpc_slot", provider: "constant_k", ts: NOW, slot: "443336401", status: 1 },
      { event: "solana_grpc_ping", provider: "constant_k", ts: NOW },
    ],
    now: () => NOW,
  });
  assert.equal(batch.references.length, 0);
  assert.equal(batch.capture.state, "idle");
  assert.equal(batch.capture.counts.slot_rows, 1);
  assert.equal(batch.capture.counts.ignored_rows, 1);
  assert.equal(batch.capture.cursor, null);
});

test("wrong-provider, malformed, future, and oversized rows remain explicit degraded evidence", () => {
  const batch = buildConstantKNexusWalletReferenceBatch({
    watches: [WALLET],
    events: [
      transaction({ provider: "unexpected_provider" }),
      transaction({ rowSignature: "not_base58" }),
      transaction({ rowSignature: signature(2), ts: "2026-09-01T05:06:00.000Z" }),
      transaction({ rowSignature: signature(3), extra: { oversized: "x".repeat(ConstantKNexusWalletLimits.maximum_event_bytes) } }),
      transaction({ rowSignature: signature(4) }),
    ],
    now: () => NOW,
  });
  assert.equal(batch.capture.state, "degraded");
  assert.equal(batch.capture.counts.provider_mismatch_rows, 1);
  assert.equal(batch.capture.counts.invalid_rows, 3);
  assert.equal(batch.references.length, 1);
});

test("Constant-K stream batch preserves sidecar first-receipt time in the bounded delivery", async () => {
  const deliveries = [];
  const run = await runConstantKNexusWalletStreamBatch({
    watches: [WALLET],
    events: [transaction()],
    now: () => NOW,
    async ingest_delivery(delivery) { deliveries.push(delivery); },
  });
  assert.equal(run.schema_version, CONSTANT_K_NEXUS_WALLET_BATCH_SCHEMA);
  assert.equal(run.mode, "constant_k_nexus_private_stream_batch");
  assert.equal(run.state, "current");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].provider, "constant_k_nexus");
  assert.equal(deliveries[0].transport, "geyser_grpc");
  assert.equal(deliveries[0].provider_observed_at, "2026-09-01T04:59:59.250Z");
  assert.equal(deliveries[0].raven_received_at, "2026-09-01T04:59:59.250Z");
  assert.equal(run.execution_boundary.live_copy, false);
  assert.equal(run.execution_boundary.broadcasting, false);
});

test("observer reference normalizer honors an earlier private receiver timestamp only when explicitly trusted", () => {
  const input = {
    wallet_address: WALLET,
    signature: signature(5),
    slot: 443_336_405,
    finality: "processed",
    provider_observed_at: "2026-09-01T04:59:58.900Z",
    raven_received_at: "2026-09-01T04:59:59.000Z",
  };
  const untrusted = normalizeSourceWalletTransportReference(input, {
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    received_at: NOW,
  });
  assert.equal(untrusted.raven_received_at, NOW);
  const delivery = normalizeSourceWalletTransportReference({
    ...input,
  }, {
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    received_at: NOW,
    preserve_reference_received_at: true,
  });
  assert.equal(delivery.provider_observed_at, "2026-09-01T04:59:58.900Z");
  assert.equal(delivery.raven_received_at, "2026-09-01T04:59:59.000Z");
});

test("Constant-K input bounds fail closed", () => {
  assert.throws(
    () => buildConstantKNexusWalletReferenceBatch({ watches: [WALLET], events: {} }),
    /constant_k_events_invalid/,
  );
  const tooMany = Array.from({ length: ConstantKNexusWalletLimits.maximum_event_rows_per_batch + 1 }, () => ({}));
  assert.throws(
    () => buildConstantKNexusWalletReferenceBatch({ watches: [WALLET], events: tooMany }),
    /constant_k_event_batch_too_large/,
  );
});

test("live Constant-K validator joins stream receipt to confirmed economic decode without leaking identities", async () => {
  const blockTime = Math.floor(Date.parse("2026-09-01T04:59:58.000Z") / 1_000);
  const rpcTransaction = {
    slot: 443_336_400,
    blockTime,
    transaction: {
      message: {
        accountKeys: [{ pubkey: WALLET, signer: true }],
        instructions: [{ programId: JUPITER }],
      },
    },
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [1_000_000_000],
      postBalances: [999_995_000],
      preTokenBalances: [
        { owner: WALLET, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", uiTokenAmount: { amount: "100000000", decimals: 6 } },
        { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: "0", decimals: 6 } },
      ],
      postTokenBalances: [
        { owner: WALLET, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", uiTokenAmount: { amount: "75000000", decimals: 6 } },
        { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: "10000000", decimals: 6 } },
      ],
      innerInstructions: [],
      logMessages: ["Program log: Instruction: Route"],
    },
  };
  let calls = 0;
  const report = await runConstantKWalletObserverLiveValidation({
    events: [transaction()],
    wallets: [WALLET],
    hydrate: 1,
  }, {
    env: { RAVENOS_SOLANA_RPC_URL: "https://rpc.invalid.test" },
    now: () => NOW,
    async fetch_impl(_url, init) {
      calls += 1;
      const request = JSON.parse(init.body);
      assert.equal(request.method, "getTransaction");
      assert.equal(request.params[0], signature(1));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: rpcTransaction }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.schema_version, "ravenos.constant_k_wallet_observer_live_validation.v1");
  assert.equal(report.observation.transactions_hydrated, 1);
  assert.equal(report.observation.eligible_buy_signals, 1);
  assert.equal(report.observation.classifications.SWAP_BUY, 1);
  assert.equal(report.latency.chain_to_raven_receipt_second_resolution.p50_ms, 1_250);
  assert.equal(report.latency.economic_normalization.available, true);
  assert.equal(report.latency.economic_normalization.samples, 1);
  assert.equal(report.interpretation.speed_claim_supported, false);
  assert.equal(report.execution_boundary.broadcasting_available, false);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(WALLET), false);
  assert.equal(serialized.includes(signature(1)), false);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes("rpc.invalid.test"), false);
});
