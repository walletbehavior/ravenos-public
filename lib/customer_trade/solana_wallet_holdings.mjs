import { normalizeSolanaWalletAddress } from "./solana_wallet_intelligence.mjs";

export const WALLET_TOKEN_PROGRAMS = Object.freeze([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);
const decimalAmount = (amount, decimals) => {
  const digits = amount.toString().padStart(decimals + 1, "0");
  return decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
};

// One projection for Terminal, Account and Portfolio. Missing account-program
// evidence is unknown; frozen tokens are excluded from the usable amount.
export function solanaBuyingPowerAssets(holdings) {
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const usdc = holdings.tokens.find(row => row.mint === mint && row.token_program === WALLET_TOKEN_PROGRAMS[0]);
  const available = holdings.coverage.find(row => row.program === WALLET_TOKEN_PROGRAMS[0])?.state === 'available' && (!usdc || usdc.decimals === 6);
  const native = holdings.native?.amount_base_units ?? null;
  const units = available ? usdc?.balance_base_units || '0' : null;
  const spendable = available ? usdc?.spendable_base_units || '0' : null;
  return [
    {symbol:'SOL',asset_id:'native',decimals:9,amount_base_units:native,amount:native===null?null:decimalAmount(native,9),spendable_before_network_fees:native===null?null:decimalAmount(native,9),canonical_usdc:false},
    {symbol:'USDC',asset_id:mint,decimals:6,amount_base_units:units,amount:units===null?null:decimalAmount(units,6),spendable_before_network_fees:spendable===null?null:decimalAmount(spendable,6),canonical_usdc:true},
  ];
}

// Read-only, bounded observations. Each program is independently validated so a
// provider failure cannot be presented as a zero balance or a complete inventory.
export async function loadSolanaWalletHoldings({ address, rpc, now = new Date().toISOString() }) {
  const wallet = normalizeSolanaWalletAddress(address);
  const responses = await Promise.allSettled([
    rpc("getBalance", [wallet, { commitment: "confirmed" }]),
    ...WALLET_TOKEN_PROGRAMS.map((programId) => rpc("getTokenAccountsByOwner", [wallet, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }])),
  ]);
  const tokens = new Map();
  const coverage = [];
  let native = null;
  const nativeResponse = responses[0];
  if (nativeResponse.status === "fulfilled" && Number.isSafeInteger(nativeResponse.value?.value) && nativeResponse.value.value >= 0) {
    native = { amount: nativeResponse.value.value / 1e9, amount_base_units: String(nativeResponse.value.value), observed_at: now, symbol: "SOL", slot: nativeResponse.value.context?.slot ?? null };
  }
  for (let index = 0; index < WALLET_TOKEN_PROGRAMS.length; index++) {
    const program = WALLET_TOKEN_PROGRAMS[index];
    const result = responses[index + 1];
    try {
      if (result.status !== "fulfilled" || !Array.isArray(result.value?.value) || result.value.value.length > 1000) throw new Error("unavailable");
      const observed = new Map();
      for (const row of result.value.value) {
        const info = row?.account?.data?.parsed?.info;
        const token = info?.tokenAmount;
        if (row?.account?.owner !== program || info?.owner !== wallet || !token || !/^\d+$/.test(token.amount) || token.amount.length > 20 || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18) throw new Error("invalid");
        const mint = normalizeSolanaWalletAddress(info.mint);
        const previous = observed.get(mint);
        if (previous && previous.decimals !== token.decimals) throw new Error("invalid");
        observed.set(mint, { amount: (previous?.amount || 0n) + BigInt(token.amount), spendable: (previous?.spendable || 0n) + (info.state === 'initialized' ? BigInt(token.amount) : 0n), decimals: token.decimals });
      }
      for (const [mint, balance] of observed) {
        if (balance.amount === 0n) continue;
        if (tokens.has(mint)) throw new Error("invalid");
        tokens.set(mint, { mint, contract: mint, symbol: null, balance_base_units: balance.amount.toString(), spendable_base_units: balance.spendable.toString(), balance_display: decimalAmount(balance.amount, balance.decimals), decimals: balance.decimals, token_program: program, observed_at: now, slot: result.value.context?.slot ?? null, provider_mark_price_usd: null });
      }
      coverage.push({ program, state: "available" });
    } catch {
      coverage.push({ program, state: "unavailable" });
    }
  }
  const complete = native !== null && coverage.every((row) => row.state === "available");
  return { schema_version: "ravenos.wallet_holdings.v1", address: wallet, chain: "solana", observed_at: now, state: complete ? "available" : "partial", scope: "confirmed_rpc_observations_at_individual_slots", native, tokens: [...tokens.values()], coverage, executable_valuation_available: false };
}
