// Exact mainnet program identity is shared by wallet reconstruction, Nexus
// discovery, and execution review. A single reviewed registry prevents a
// copied or mistyped address from silently turning a swap into a transfer.
export const SOLANA_PROGRAM_IDS = Object.freeze({
  jupiter_v6: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  jupiter_v4: "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  raydium_amm_v4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  raydium_cpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  raydium_clmm: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  raydium_stable_amm: "5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h",
  raydium_route: "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS",
  orca_whirlpool: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  meteora_dlmm: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  pump_bonding_curve: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pump_amm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
});

export const SOLANA_SWAP_PROGRAM_REGISTRY = Object.freeze([
  Object.freeze({ key: "jupiter_v6", label: "Jupiter v6", program_id: SOLANA_PROGRAM_IDS.jupiter_v6, evidence: "reviewed_router" }),
  Object.freeze({ key: "jupiter_v4", label: "Jupiter v4", program_id: SOLANA_PROGRAM_IDS.jupiter_v4, evidence: "retained_legacy_router" }),
  Object.freeze({ key: "raydium_amm_v4", label: "Raydium AMM v4", program_id: SOLANA_PROGRAM_IDS.raydium_amm_v4, evidence: "official_program_registry" }),
  Object.freeze({ key: "raydium_cpmm", label: "Raydium CPMM", program_id: SOLANA_PROGRAM_IDS.raydium_cpmm, evidence: "official_program_registry" }),
  Object.freeze({ key: "raydium_clmm", label: "Raydium CLMM", program_id: SOLANA_PROGRAM_IDS.raydium_clmm, evidence: "official_program_registry" }),
  Object.freeze({ key: "raydium_stable_amm", label: "Raydium Stable AMM", program_id: SOLANA_PROGRAM_IDS.raydium_stable_amm, evidence: "official_program_registry" }),
  Object.freeze({ key: "raydium_route", label: "Raydium Router", program_id: SOLANA_PROGRAM_IDS.raydium_route, evidence: "official_program_registry" }),
  Object.freeze({ key: "orca_whirlpool", label: "Orca Whirlpool", program_id: SOLANA_PROGRAM_IDS.orca_whirlpool, evidence: "official_program_repository" }),
  Object.freeze({ key: "meteora_dlmm", label: "Meteora DLMM", program_id: SOLANA_PROGRAM_IDS.meteora_dlmm, evidence: "official_program_repository" }),
  Object.freeze({ key: "pump_bonding_curve", label: "Pump bonding curve", program_id: SOLANA_PROGRAM_IDS.pump_bonding_curve, evidence: "official_program_repository" }),
  Object.freeze({ key: "pump_amm", label: "Pump AMM", program_id: SOLANA_PROGRAM_IDS.pump_amm, evidence: "official_program_repository" }),
]);

export const SOLANA_REVIEWED_SWAP_PROGRAM_IDS = Object.freeze(
  SOLANA_SWAP_PROGRAM_REGISTRY.map((row) => row.program_id),
);

const swapProgramsById = new Map(SOLANA_SWAP_PROGRAM_REGISTRY.map((row) => [row.program_id, row]));

export function identifySolanaSwapPrograms(programIds = []) {
  if (!Array.isArray(programIds)) return Object.freeze([]);
  const seen = new Set();
  const matches = [];
  for (const value of programIds) {
    const row = swapProgramsById.get(String(value || ""));
    if (!row || seen.has(row.program_id)) continue;
    seen.add(row.program_id);
    matches.push(row);
  }
  return Object.freeze(matches.sort((left, right) => left.key.localeCompare(right.key)));
}

export function isReviewedSolanaSwapProgram(programId) {
  return swapProgramsById.has(String(programId || ""));
}
