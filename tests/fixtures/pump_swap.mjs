import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { PUMP_SWAP_REVIEW as pump } from "../../lib/customer_trade/pump_swap_review.mjs";
import { SOLANA_PROGRAM_IDS } from "../../lib/customer_trade/solana_program_registry.mjs";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM = "11111111111111111111111111111111";
const SOL = "So11111111111111111111111111111111111111112";
const key = seed => bs58.encode(Buffer.alloc(32, seed));
const bytes = key => Buffer.from(bs58.decode(key));
const pda = (program, seeds) => PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58();
const ata = (wallet, mint) => pda(ATA, [bytes(wallet), bytes(TOKEN), bytes(mint)]);

export function pumpSwapFixture(method = "buy_exact_quote_in") {
  const buy = method !== "sell";
  const wallet = key(11), mint = key(12), creator = key(13), coinCreator = key(14), protocol = key(15);
  const pool = pda(pump.amm_program, [Buffer.from("pool"), Buffer.alloc(2), bytes(creator), bytes(mint), bytes(SOL)]);
  const creatorVault = pda(pump.amm_program, [Buffer.from("creator_vault"), bytes(coinCreator)]);
  const swapAddresses = [pool, wallet, pump.global_config, mint, SOL, ata(wallet, mint), ata(wallet, SOL),
    ata(pool, mint), ata(pool, SOL), protocol, ata(protocol, SOL), TOKEN, TOKEN, SYSTEM, ATA,
    pump.event_authority, pump.amm_program, ata(creatorVault, SOL), creatorVault,
    ...(buy ? [pda(pump.amm_program, [Buffer.from("global_volume_accumulator")]),
      pda(pump.amm_program, [Buffer.from("user_volume_accumulator"), bytes(wallet)])] : []),
    pump.fee_config, pump.fee_program];
  const writable = new Set([0, 1, 5, 6, 7, 8, 10, 17, ...(buy ? [20] : [])].map(index => swapAddresses[index]));
  const keys = [...new Set([wallet, SOLANA_PROGRAM_IDS.jupiter_v6, ...swapAddresses])];
  const account_keys = keys.map((address, index) => ({ address, index, writable: writable.has(address), signer: address === wallet }));
  const index = address => keys.indexOf(address);
  const swapData = Buffer.alloc(buy ? 25 : 24);
  Buffer.from(method === "buy" ? "66063d1201daebea" : buy ? "c62e1552b4d9e870" : "33e685a4017f83ad", "hex").copy(swapData);
  swapData.writeBigUInt64LE(1_000_000n, 8);
  swapData.writeBigUInt64LE(410_000n, 16);
  const feeData = Buffer.alloc(34);
  Buffer.from("e7257e55cf5b3f34", "hex").copy(feeData);
  feeData[8] = 1;
  feeData.writeBigUInt64LE(1_000_000n, 25);
  const eventData = Buffer.alloc(192);
  Buffer.from("e445a52e51cb9a1d", "hex").copy(eventData);
  Buffer.from(buy ? "67f4521f2cf57777" : "3e2f370aa503dc2a", "hex").copy(eventData, 8);
  bytes(pool).copy(eventData, 128);
  bytes(wallet).copy(eventData, 160);
  const innerInstructions = [{ index: 0, instructions: [
    { programIdIndex: index(pump.amm_program), accounts: swapAddresses.map(index), data: bs58.encode(swapData), stackHeight: 2 },
    { programIdIndex: index(pump.fee_program), accounts: [index(pump.fee_config), index(pump.amm_program)], data: bs58.encode(feeData), stackHeight: 3 },
    { programIdIndex: index(pump.amm_program), accounts: [index(pump.event_authority)], data: bs58.encode(eventData), stackHeight: 3 },
  ] }];
  const poolData = Buffer.alloc(261);
  Buffer.from("f19a6d0411b16dbc", "hex").copy(poolData);
  for (const [offset, address] of [[11, creator], [43, mint], [75, SOL], [139, swapAddresses[7]], [171, swapAddresses[8]], [211, coinCreator]]) {
    bytes(address).copy(poolData, offset);
  }
  function token(address, mint, owner) {
    const data = Buffer.alloc(165);
    bytes(mint).copy(data); bytes(owner).copy(data, 32); data[108] = 1;
    return { address, owner: TOKEN, exists: true, executable: false, data };
  }
  const preAccounts = [{ address: pool, exists: true, owner: pump.amm_program, executable: false, data: poolData },
    token(swapAddresses[5], mint, wallet), token(swapAddresses[6], SOL, wallet),
    token(swapAddresses[7], mint, pool), token(swapAddresses[8], SOL, pool)];
  return {
    programs: { account_keys, program_ids: [SOLANA_PROGRAM_IDS.jupiter_v6],
      instructions: [{ instruction_index: 0, program_id: SOLANA_PROGRAM_IDS.jupiter_v6, accounts: account_keys }] },
    innerInstructions,
    logs: [`Program ${SOLANA_PROGRAM_IDS.jupiter_v6} invoke [1]`, `Program ${pump.amm_program} invoke [2]`,
      `Program ${pump.fee_program} invoke [3]`, `Program ${pump.fee_program} success`,
      `Program ${pump.amm_program} invoke [3]`, `Program ${pump.amm_program} success`,
      `Program ${pump.amm_program} success`, `Program ${SOLANA_PROGRAM_IDS.jupiter_v6} success`],
    request: { wallet_address: wallet, terminal: { token_address: mint } },
    quote: { route_plan: [{ leg_index: 0, venue: pump.venue, amm_key: pool,
      input_mint: buy ? SOL : mint, output_mint: buy ? mint : SOL }] },
    mint: { mint, token_program: TOKEN },
    preAccounts,
    postAccounts: preAccounts.map(row => ({ ...row, data: Buffer.from(row.data) })),
    feeInstruction: { instruction_index: 0 },
  };
}
