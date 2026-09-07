// Browser-local what-if inputs never become Portfolio balances or execution authority.
import { decimalToAtomic, normalizeAtomic } from "../agentic_trading/decimal.mjs";
export function planShieldedCapital({ reserve_zec, working_usdc, target_usdc, zec_price_usd_micros, price_move_percent = 0 }) {
  for (const value of [reserve_zec, working_usdc, target_usdc]) if (typeof value !== "string" || value.length > 24) throw Error("scenario_amount_invalid");
  if (![-30, -10, 0, 10, 30].includes(price_move_percent)) throw Error("scenario_price_move_invalid");
  const reserve = BigInt(decimalToAtomic(reserve_zec, 8));
  const working = BigInt(decimalToAtomic(working_usdc, 6)), target = BigInt(decimalToAtomic(target_usdc, 6));
  const price = BigInt(normalizeAtomic(zec_price_usd_micros, "price", { allowZero: false }));
  const marked = reserve * price / 100000000n;
  return Object.freeze({ scenario_only: true, actual_wallet_connected: false, shielded_immediately_executable: false,
    reserve_usd_micros: marked.toString(), reserve_after_move_usd_micros: (reserve * price * BigInt(100 + price_move_percent) / 10000000000n).toString(),
    working_usdc_micros: working.toString(), shortfall_usdc_micros: (target > working ? target - working : 0n).toString(),
    excess_usdc_micros: (working > target ? working - target : 0n).toString(),
    copy_ready: working >= target, live_funding_authorized: false });
}
