import test from "node:test";
import assert from "node:assert/strict";
import { inspectSolanaTransactionSkeleton } from "../lib/customer_trade/inspection.mjs";

test("unsupported Solana versions cannot inherit legacy inspection approval", () => {
  for (const version of [1, "1", "v1", 2, "unknown", -1, {}, false]) {
    const result = inspectSolanaTransactionSkeleton({ version });
    assert.equal(result.inspection_status, "blocked");
    assert.equal(result.transaction_version, "unsupported");
    assert.ok(result.blockers.includes("unsupported_transaction_version"));
    assert.equal(result.canonical_inspection.transaction_format, "unsupported");
    assert.equal(result.canonical_inspection.quote_to_transaction_consistency_result, "mismatch");
    assert.ok(result.canonical_inspection.warnings.includes("unsupported_transaction_version"));
  }
  assert.equal(inspectSolanaTransactionSkeleton({ transaction_version: "v1" }).inspection_status, "blocked");
});

test("supported legacy and v0 formats retain their existing inspection constraints", () => {
  assert.equal(inspectSolanaTransactionSkeleton({ version: "legacy" }).inspection_status, "passed");
  for (const version of [0, "0", "v0"]) {
    const resolved = inspectSolanaTransactionSkeleton({ version, lookup_tables_required: true, lookup_tables_resolved: true });
    assert.equal(resolved.inspection_status, "passed");
    assert.equal(resolved.transaction_version, "v0");
    const unresolved = inspectSolanaTransactionSkeleton({ version, lookup_tables_required: true, lookup_tables_resolved: false });
    assert.equal(unresolved.inspection_status, "blocked");
    assert.ok(unresolved.blockers.includes("lookup_table_unresolved"));
  }
});
