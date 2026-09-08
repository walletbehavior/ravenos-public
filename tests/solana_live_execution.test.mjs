import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import bs58 from "bs58";
import { RAVEN_JUPITER_REFERRAL } from "../lib/customer_trade/jupiter_referral.mjs";
import nacl from "tweetnacl";

import {
  createD1SolanaLiveExecutionStore,
  createSolanaLiveTicket,
  executeJupiterSignedTransaction,
  reconcileSolanaExecution,
  verifySolanaSignedTransaction,
} from "../lib/customer_trade/solana_live_execution.mjs";
import { decodeSolanaTransaction } from "../lib/customer_trade/solana_transaction_decoder.mjs";
import {
  SOLANA_CUSTOMER_LIVE_PREFLIGHT_SCHEMA,
  SOLANA_USDC_MINT,
} from "../lib/customer_trade/operator_solana_canary.mjs";

function shortVec(value) {
  const out = [];
  let next = value;
  do {
    let byte = next & 0x7f;
    next >>>= 7;
    if (next) byte |= 0x80;
    out.push(byte);
  } while (next);
  return Buffer.from(out);
}

function key(seed) {
  return Buffer.alloc(32, seed);
}

function unsignedV0Transaction(walletBytes, feeAccount = RAVEN_JUPITER_REFERRAL.usdc_fee_account) {
  const message = Buffer.concat([
    Buffer.from([0x80, 1, 0, 0]),
    shortVec(2),
    walletBytes,
    bs58.decode(feeAccount),
    key(7),
    shortVec(0),
    shortVec(0),
  ]);
  return Buffer.concat([shortVec(1), Buffer.alloc(64), message]).toString("base64");
}

function fixture({ now = Date.now(), native = false } = {}) {
  const feeMint = native ? RAVEN_JUPITER_REFERRAL.sol_mint : SOLANA_USDC_MINT;
  const feeAccount = native ? RAVEN_JUPITER_REFERRAL.sol_fee_account : RAVEN_JUPITER_REFERRAL.usdc_fee_account;
  const wallet = nacl.sign.keyPair();
  const walletAddress = bs58.encode(wallet.publicKey);
  const poolAddress = bs58.encode(key(8));
  const tokenAddress = bs58.encode(key(9));
  const referralAccount = RAVEN_JUPITER_REFERRAL.account;
  const collectorAddress = bs58.encode(key(13));
  const transaction = unsignedV0Transaction(Buffer.from(wallet.publicKey), feeAccount);
  const decoded = decodeSolanaTransaction(transaction);
  const preflight = {
    ok: true,
    schema_version: SOLANA_CUSTOMER_LIVE_PREFLIGHT_SCHEMA,
    state: "customer_unsigned_transaction_reviewed",
    wallet: { address: walletAddress, role: "customer" },
    unsigned_transaction_base64: transaction,
    transaction_review: {
      message_hash: decoded.message_hash,
      transaction_hash: decoded.transaction_hash,
      fee_instruction_evidence: { fee_account: feeAccount, fee_bps: 100, positive_slippage_bps: 0 },
    },
    intent: {
      terminal_instrument_id: `solana:pool:${poolAddress}`,
      terminal_pool_address: poolAddress,
      selected_token_mint: tokenAddress,
      wallet_address: walletAddress,
      side: "buy",
      funding_kind: native ? "native_sol" : "canonical_usdc",
      settlement_kind: "selected_token",
      input_mint: feeMint,
      output_mint: tokenAddress,
      input_amount_base_units: "1000000",
      expected_output_amount_base_units: "420000",
      minimum_output_amount_base_units: "410000",
      slippage_bps: 50,
      provider_request_id: "jupiter_live_fixture_1",
      router: "metis",
      message_hash: decoded.message_hash,
      referral_account: referralAccount,
      referral_fee_bps: 100,
      fee_mint: feeMint,
      platform_fee_amount_base_units: "10000",
    },
    quote: {
      expires_at: new Date(now + 9_000).toISOString(),
      last_valid_block_height: "1000",
      total_estimated_fee_lamports: "6000",
      fee_bps: 100,
      platform_fee_bps: 100,
      platform_fee_amount_base_units: "10000",
      fee_mint: feeMint,
      referral_account: referralAccount,
      referral_fee_bps: 100,
    },
    simulation: {
      native_balance_evidence: { maximum_allowed_debit_lamports: native ? "1006000" : "6000" },
      referral_fee_balance_evidence: {
        independently_simulated: true,
        fee_account: feeAccount,
        referral_account: referralAccount,
        fee_mint: feeMint,
        fee_bps: 100,
        gross_fee_amount_base_units: "10000",
        minimum_collector_credit_base_units: "8000",
        observed_credit_base_units: "8000",
      },
    },
  };
  const exitProof = {
    verified: true,
    settlement_mint: SOLANA_USDC_MINT,
    expected_usdc_base_units: "990000",
    minimum_usdc_base_units: "980000",
    observed_at: new Date(now).toISOString(),
    expires_at: new Date(now + 8_000).toISOString(),
    provider: "jupiter",
  };
  const feePolicy = {
    enabled: true,
    provider: "jupiter",
    fee_kind: "integrator_fee",
    access_tier: "free",
    fee_bps: 100,
    fee_recipient: referralAccount,
  };
  const prepared = createSolanaLiveTicket({
    preflight,
    notional_usdc: 1,
    maximum_notional_usdc: 500,
    fee_policy: feePolicy,
    fee_collector_address: collectorAddress,
    exit_proof: exitProof,
  }, { now, ttl_ms: 8_000 });
  return {
    now,
    wallet,
    walletAddress,
    poolAddress,
    tokenAddress,
    referralAccount,
    collectorAddress,
    transaction,
    decoded,
    preflight,
    exitProof,
    feePolicy,
    prepared,
  };
}

function signFixture(value) {
  const decoded = decodeSolanaTransaction(value.transaction);
  const signature = nacl.sign.detached(decoded.message_bytes, value.wallet.secretKey);
  const bytes = Buffer.from(decoded.raw_bytes);
  Buffer.from(signature).copy(bytes, decoded.signature_offset);
  return bytes.toString("base64");
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0024_customer_live_execution.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0027_customer_evm_live_execution.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0031_solana_jupiter_referral_fees.sql", "utf8"));
  sqlite.prepare(`
    INSERT INTO ravenos_users
      (user_id, state, primary_email, created_at, updated_at, last_authenticated_at)
    VALUES (?, 'active', ?, ?, ?, ?)
  `).run("usr_solana_live_fixture", "owner@example.invalid", 1, 1, 1);
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            async run() {
              const result = statement.run(...values);
              return { meta: { changes: Number(result.changes) } };
            },
            async first() {
              return statement.get(...values) || null;
            },
          };
        },
      };
    },
  };
}

test("ticket exposes the exact unsigned transaction once without persisting transaction material", () => {
  const value = fixture();
  assert.equal(value.prepared.ticket.schema_version, "ravenos.solana_live_ticket.v1");
  assert.equal(value.prepared.ticket.wallet_address, value.walletAddress);
  assert.equal(value.prepared.ticket.transaction.message_hash, value.decoded.message_hash);
  assert.equal(value.prepared.unsigned_transaction_base64, value.transaction);
  assert.equal(value.prepared.ticket.fee.raven_fee_enabled, true);
  assert.equal(value.prepared.ticket.fee.raven_fee_bps, 100);
  assert.equal(value.prepared.ticket.fee.expected_amount_base_units, "8000");
  assert.equal(value.prepared.ticket.fee.estimated_raven_fee_usdc, 0.01);
  assert.equal(value.prepared.ticket.fee.estimated_collector_receipt_usdc,0.008);
  assert.equal(value.prepared.ticket.fee.referral_account, value.referralAccount);
  assert.equal(value.prepared.ticket.fee.collection_method, "jupiter_referral_program");
  assert.equal(value.prepared.ticket.fee.collector_configured, true);
  assert.equal(value.prepared.ticket.execution_boundary.server_signing, false);
  assert.equal(value.prepared.ticket.execution_boundary.custody, false);
  assert.equal(JSON.stringify(value.prepared.ticket).includes(value.transaction), false);
  assert.equal(JSON.stringify(value.prepared.ticket).includes("unsigned_transaction_base64"), false);
});

test("only the expected wallet signature over the unchanged reviewed message is admitted", () => {
  const value = fixture();
  const signed = signFixture(value);
  const verified = verifySolanaSignedTransaction({ signed_transaction_base64: signed }, value.prepared.ticket);
  assert.equal(verified.ticket_id, value.prepared.ticket.ticket_id);
  assert.equal(verified.wallet_address, value.walletAddress);
  assert.equal(verified.message_hash, value.decoded.message_hash);
  assert.match(verified.wallet_signature, /^[1-9A-HJ-NP-Za-km-z]+$/);

  const wrongWallet = nacl.sign.keyPair();
  const decoded = decodeSolanaTransaction(value.transaction);
  const bad = Buffer.from(decoded.raw_bytes);
  Buffer.from(nacl.sign.detached(decoded.message_bytes, wrongWallet.secretKey)).copy(bad, decoded.signature_offset);
  assert.throws(() => verifySolanaSignedTransaction({ signed_transaction_base64: bad.toString("base64") }, value.prepared.ticket), /wallet_signature_invalid/);

  const changed = Buffer.from(signed, "base64");
  changed[65 + 4 + 1 + 32] ^= 1;
  assert.throws(() => verifySolanaSignedTransaction({ signed_transaction_base64: changed.toString("base64") }, value.prepared.ticket), /signed_transaction_message_mismatch/);
});

test("Jupiter submission forwards only the wallet-signed reviewed transaction and sanitizes the provider result", async () => {
  const value = fixture();
  const verified = verifySolanaSignedTransaction({ signed_transaction_base64: signFixture(value) }, value.prepared.ticket);
  const signature = verified.wallet_signature;
  const observed = await executeJupiterSignedTransaction({ ticket: value.prepared.ticket, verified }, {
    jupiter_api_key: "fixture-key",
    fetch_impl: async (url, init) => {
      assert.equal(String(url), "https://api.jup.ag/swap/v2/execute");
      assert.equal(init.headers["x-api-key"], "fixture-key");
      const body = JSON.parse(init.body);
      assert.equal(body.signedTransaction, verified.signed_transaction_base64);
      assert.equal(body.requestId, "jupiter_live_fixture_1");
      assert.equal(body.lastValidBlockHeight, 1000);
      return response({ status: "success", signature, slot: 123, inputAmountResult: "1000000", outputAmountResult: "420000", ignored: { secret: true } });
    },
  });
  assert.equal(observed.state, "provider_submitted");
  assert.equal(observed.signature, signature);
  assert.equal(Object.hasOwn(observed, "signedTransaction"), false);
  assert.equal(JSON.stringify(observed).includes(verified.signed_transaction_base64), false);
});
test("Jupiter cannot replace the user's reviewed transaction with a different reported signature",async()=>{
 const value=fixture();
 const verified=verifySolanaSignedTransaction({signed_transaction_base64:signFixture(value)},value.prepared.ticket);
 await assert.rejects(executeJupiterSignedTransaction({ticket:value.prepared.ticket,verified},{jupiter_api_key:"fixture-key",fetch_impl:async()=>response({status:"success",signature:bs58.encode(Buffer.alloc(64,3))})}),/execute_signature_mismatch/);
});
test("settled balances cannot prove a fee when the actual transaction message differs from review",async()=>{
 const value=fixture(),other=fixture();
 const signed=signFixture(other),signature=decodeSolanaTransaction(signed).signatures[0].signature_base58;
 const result=await reconcileSolanaExecution({ticket:value.prepared.ticket,provider_observation:{state:"provider_submitted",signature}},{rpc_url:"https://rpc.example",fetch_impl:async(_url,init)=>{
   const request=JSON.parse(init.body);
   if(request.method==="getSignatureStatuses")return response({result:{value:[{err:null,confirmationStatus:"finalized"}]}});
   return response({result:{slot:1,transaction:request.params[1].encoding==="base64"?[signed,"base64"]:{signatures:[signature]}}});
 }});
 assert.equal(result.state,"indeterminate");
 assert.equal(result.evidence.reason,"settled_transaction_message_mismatch");
 assert.equal(result.evidence.economic_result_verified,false);
});

async function settledFixture(mutate = () => {}, { sell = false } = {}) {
  const value = fixture();
  if (sell) {
    const ticket = structuredClone(value.prepared.ticket);
    Object.assign(ticket.reviewed_order, { side: "sell", input_mint: value.tokenAddress, output_mint: SOLANA_USDC_MINT, input_amount_base_units: "1000000", minimum_output_amount_base_units: "900000" });
    value.prepared = { ticket };
  }
  value.prepared = { ticket: structuredClone(value.prepared.ticket) };
  const signed=signFixture(value);
  const signature=decodeSolanaTransaction(signed).signatures[0].signature_base58;
  const reconciled = await reconcileSolanaExecution({
    ticket: value.prepared.ticket,
    provider_observation: { state: "provider_submitted", signature },
  }, {
    rpc_url: "https://rpc.example",
    fetch_impl: async (_url, init) => {
      const request = JSON.parse(init.body);
      if (request.method === "getSignatureStatuses") {
        return response({ jsonrpc: "2.0", id: request.id, result: { value: [{ err: null, confirmationStatus: "confirmed", confirmations: 1 }] } });
      }
      if (request.method === "getTransaction") {
        if(request.params[1].encoding==="base64")return response({jsonrpc:"2.0",id:request.id,result:{slot:55,transaction:[signed,"base64"]}});
        const transaction = {
          slot: 55,
          blockTime: 1_788_278_400,
          transaction: { signatures:[signature],message: { accountKeys: [{ pubkey: value.walletAddress }, { pubkey: RAVEN_JUPITER_REFERRAL.usdc_fee_account }] } },
          meta: {
            err: null,
            fee: 6000,
            preBalances: [1_000_000],
            postBalances: [994_000],
            preTokenBalances: [
              { owner: value.walletAddress, mint: value.tokenAddress, uiTokenAmount: { amount: "0" } },
              { owner: value.walletAddress, mint: SOLANA_USDC_MINT, uiTokenAmount: { amount: "2000000" } },
              { accountIndex: 1, owner: value.referralAccount, mint: SOLANA_USDC_MINT, uiTokenAmount: { amount: "0" } },
            ],
            postTokenBalances: [
              { owner: value.walletAddress, mint: value.tokenAddress, uiTokenAmount: { amount: "420000" } },
              { owner: value.walletAddress, mint: SOLANA_USDC_MINT, uiTokenAmount: { amount: "1000000" } },
              { accountIndex: 1, owner: value.referralAccount, mint: SOLANA_USDC_MINT, uiTokenAmount: { amount: "8000" } },
            ],
          },
        };
        if (sell) {
          transaction.meta.preTokenBalances[0].uiTokenAmount.amount = "1000000";
          transaction.meta.postTokenBalances[0].uiTokenAmount.amount = "0";
          transaction.meta.postTokenBalances[1].uiTokenAmount.amount = "2990000";
          transaction.meta.postTokenBalances[2].uiTokenAmount.amount = "10000";
        }
        mutate(transaction, value.prepared.ticket);
        return response({ jsonrpc: "2.0", id: request.id, result: transaction });
      }
      throw new Error(`unexpected_rpc_method:${request.method}`);
    },
  });
  return { value, reconciled, signature };
}

test("reconciliation proves selected-token credit, canonical-USDC debit, and bounded native fees", async () => {
  const { value, reconciled, signature } = await settledFixture();
  assert.equal(reconciled.state, "provider_confirmed");
  assert.equal(reconciled.signature, signature);
  assert.equal(reconciled.evidence.economic_result_verified, true);
  assert.equal(reconciled.evidence.selected_token_delta_base_units, "420000");
  assert.equal(reconciled.evidence.usdc_delta_base_units, "-1000000");
  assert.equal(reconciled.evidence.native_debit_lamports, "6000");
  assert.equal(reconciled.evidence.raven_fee.verified, true);
  assert.equal(reconciled.evidence.raven_fee.observed_collector_credit_base_units, "8000");
  assert.equal(reconciled.evidence.gross_raven_fee_verified,true);
  assert.equal(reconciled.evidence.settled_message_hash,value.prepared.ticket.transaction.message_hash);
});


for (const [name, mutate, reason] of [
  ["different token account owned by referral", tx => { tx.transaction.message.accountKeys[1].pubkey = bs58.encode(key(19)); }, "settled_referral_fee_account_missing"],
  ["wrong balance index", tx => { tx.meta.postTokenBalances[2].accountIndex = 2; }, "settled_referral_fee_account_mismatch"],
  ["wrong fee owner", tx => { tx.meta.postTokenBalances[2].owner = bs58.encode(key(19)); }, "settled_referral_fee_account_mismatch"],
  ["duplicate fee balance", tx => { tx.meta.postTokenBalances.push(tx.meta.postTokenBalances[2]); }, "settled_referral_fee_account_mismatch"],
  ["fee shortfall", tx => { tx.meta.postTokenBalances[2].uiTokenAmount.amount = "7999"; }, "settled_referral_fee_credit_mismatch"],
  ["legacy 70 bps ticket", (_tx, ticket) => { ticket.fee = { ...ticket.fee, fee_bps: 70 }; }, "settled_referral_fee_policy_invalid"],
]) {
  test(`settlement rejects ${name}`, async () => {
    const { reconciled } = await settledFixture(mutate);
    assert.equal(reconciled.state, "indeterminate");
    assert.equal(reconciled.evidence.reason, reason);
    assert.equal(reconciled.evidence.economic_result_verified, false);
  });
}

test("output fee uses actual settlement amount and recomputes collector minimum", async () => {
  const { reconciled } = await settledFixture(tx => {
    tx.meta.postTokenBalances[1].uiTokenAmount.amount = "3039500";
    tx.meta.postTokenBalances[2].uiTokenAmount.amount = "10500";
  }, { sell: true });
  assert.equal(reconciled.state, "provider_confirmed");
  assert.equal(reconciled.evidence.raven_fee.gross_fee_amount_base_units, "10500");
  assert.equal(reconciled.evidence.raven_fee.minimum_collector_credit_base_units, "8400");
});

test("an output fee without exactly 1% of observed gross output remains unresolved", async () => {
  const { reconciled } = await settledFixture(tx => { tx.meta.postTokenBalances[2].uiTokenAmount.amount = "7000"; }, { sell: true });
  assert.equal(reconciled.state, "indeterminate");
  assert.equal(reconciled.evidence.reason, "settled_output_referral_fee_mismatch");
});

test("missing or mismatched Solana fee evidence cannot create a signable ticket", () => {
  const value = fixture();
  assert.throws(() => createSolanaLiveTicket({
    preflight: value.preflight,
    notional_usdc: 1,
    maximum_notional_usdc: 500,
    exit_proof: value.exitProof,
  }), /solana_live_fee_policy_required/);

  const brokenPreflight = structuredClone(value.preflight);
  brokenPreflight.simulation.referral_fee_balance_evidence.observed_credit_base_units = "7999";
  assert.throws(() => createSolanaLiveTicket({
    preflight: brokenPreflight,
    notional_usdc: 1,
    maximum_notional_usdc: 500,
    fee_policy: value.feePolicy,
    fee_collector_address: value.collectorAddress,
    exit_proof: value.exitProof,
  }), /solana_live_fee_evidence_mismatch/);
});

test("the D1 ticket is one-shot and its append-only evidence contains no transaction bytes", async () => {
  const value = fixture();
  const verification = verifySolanaSignedTransaction({ signed_transaction_base64: signFixture(value) }, value.prepared.ticket);
  const db = sqliteD1();
  const store = createD1SolanaLiveExecutionStore(db);
  const nowSeconds = Math.floor(value.now / 1000);
  await store.createTicket({ ticket: value.prepared.ticket, user_id: "usr_solana_live_fixture", now_seconds: nowSeconds });
  const stored = await store.findTicket(value.prepared.ticket.ticket_id, "usr_solana_live_fixture");
  assert.equal(stored.prepared.transaction.message_hash, value.decoded.message_hash);
  assert.equal(stored.prepared_json.includes(value.transaction), false);
  await store.claimSubmission({
    execution_id: value.prepared.ticket.ticket_id,
    user_id: "usr_solana_live_fixture",
    verification,
    now_seconds: nowSeconds,
  });
  await assert.rejects(() => store.claimSubmission({
    execution_id: value.prepared.ticket.ticket_id,
    user_id: "usr_solana_live_fixture",
    verification,
    now_seconds: nowSeconds,
  }), /execution_ticket_not_claimable/);
  await store.finalize({
    execution_id: value.prepared.ticket.ticket_id,
    user_id: "usr_solana_live_fixture",
    reconciliation: { state: "indeterminate", signature: null, evidence: { reason: "fixture" } },
    now_seconds: nowSeconds,
  });
  const rows = db.sqlite.prepare("SELECT evidence_json FROM ravenos_customer_live_execution_events ORDER BY observed_at, event_id").all();
  assert.equal(rows.length, 3);
  assert.equal(rows.some((row) => row.evidence_json.includes(value.transaction)), false);
  assert.equal(rows.some((row) => row.evidence_json.includes(verification.signed_transaction_base64)), false);
  await store.finalize({execution_id:value.prepared.ticket.ticket_id,user_id:"usr_solana_live_fixture",reconciliation:{state:"provider_confirmed",evidence:{economic_result_verified:true}},now_seconds:nowSeconds+1});
  await assert.rejects(store.finalize({execution_id:value.prepared.ticket.ticket_id,user_id:"usr_solana_live_fixture",reconciliation:{state:"indeterminate"},now_seconds:nowSeconds+2}),/execution_ticket_not_reconcilable/);
  assert.equal(db.sqlite.prepare("SELECT state FROM ravenos_customer_live_execution_intents").get().state,"provider_confirmed");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM ravenos_customer_live_execution_events").get().n,4);
  db.sqlite.close();
});

test("SOL-funded tickets bind the reviewed SOL fee ATA and never value SOL as USDC",()=>{
  const value=fixture({native:true});
  assert.equal(value.prepared.ticket.fee.fee_token,RAVEN_JUPITER_REFERRAL.sol_mint);
  assert.equal(value.prepared.ticket.fee.fee_account,RAVEN_JUPITER_REFERRAL.sol_fee_account);
  assert.equal(value.prepared.ticket.fee.estimated_raven_fee_usdc,null);
  assert.equal(value.prepared.ticket.fee.fee_bps,100);
});

test("signing validity permits wallet interaction while respecting provider expiry and the hard cap",()=>{
  const value=fixture();
  const input={preflight:structuredClone(value.preflight),notional_usdc:1,maximum_notional_usdc:500,fee_policy:value.feePolicy,fee_collector_address:value.collectorAddress,exit_proof:value.exitProof};
  input.preflight.quote.expires_at=new Date(value.now+120000).toISOString();
  assert.equal(Date.parse(createSolanaLiveTicket(input,{now:value.now}).ticket.expires_at)-value.now,45000);
  assert.equal(Date.parse(createSolanaLiveTicket(input,{now:value.now,ttl_ms:120000}).ticket.expires_at)-value.now,60000);
  input.preflight.quote.expires_at=new Date(value.now+7000).toISOString();
  assert.equal(Date.parse(createSolanaLiveTicket(input,{now:value.now}).ticket.expires_at)-value.now,7000);
});
