const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

function fieldName(value) {
  return String(value || "value").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
}

export function normalizeAtomic(value, field = "amount", { allowZero = true } = {}) {
  const name = fieldName(field);
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) throw new Error(`${name}_invalid`);
  if (!allowZero && normalized === "0") throw new Error(`${name}_must_be_positive`);
  return normalized;
}

export function decimalToAtomic(value, decimals, field = "amount", { allowZero = true } = {}) {
  const name = fieldName(field);
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 30) throw new Error(`${name}_decimals_invalid`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${name}_invalid`);
  const normalized = String(value ?? "").trim();
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) throw new Error(`${name}_invalid`);
  const fraction = match[1] || "";
  if (fraction.length > decimals) throw new Error(`${name}_precision_exceeded`);
  const [whole] = normalized.split(".");
  const atomic = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "") || "0";
  return normalizeAtomic(atomic, name, { allowZero });
}

export function atomicToDecimal(value, decimals, field = "amount") {
  const atomic = normalizeAtomic(value, field);
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 30) throw new Error(`${fieldName(field)}_decimals_invalid`);
  if (decimals === 0) return atomic;
  const padded = atomic.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function sumAtomic(values, field = "amount") {
  return (Array.isArray(values) ? values : []).reduce(
    (sum, value) => sum + BigInt(normalizeAtomic(value, field)),
    0n,
  ).toString();
}

export function compareAtomic(left, right, field = "amount") {
  const a = BigInt(normalizeAtomic(left, field));
  const b = BigInt(normalizeAtomic(right, field));
  return a === b ? 0 : a > b ? 1 : -1;
}

export function subtractAtomic(left, right, field = "amount") {
  const a = BigInt(normalizeAtomic(left, field));
  const b = BigInt(normalizeAtomic(right, field));
  if (b > a) throw new Error(`${fieldName(field)}_underflow`);
  return (a - b).toString();
}

export function multiplyRatioAtomic(value, numerator, denominator, field = "amount", { rounding = "floor" } = {}) {
  const amount = BigInt(normalizeAtomic(value, field));
  const top = BigInt(normalizeAtomic(numerator, `${field}_ratio_numerator`));
  const bottom = BigInt(normalizeAtomic(denominator, `${field}_ratio_denominator`, { allowZero: false }));
  const product = amount * top;
  if (rounding === "ceil") return ((product + bottom - 1n) / bottom).toString();
  if (rounding !== "floor") throw new Error(`${fieldName(field)}_rounding_invalid`);
  return (product / bottom).toString();
}

export function basisPointsAmount(value, bps, field = "amount", { rounding = "ceil" } = {}) {
  const parsedBps = Number(bps);
  if (!Number.isSafeInteger(parsedBps) || parsedBps < 0 || parsedBps > 1_000_000) {
    throw new Error(`${fieldName(field)}_bps_invalid`);
  }
  return multiplyRatioAtomic(value, String(parsedBps), "10000", field, { rounding });
}

export function ratioBasisPoints(numerator, denominator, field = "ratio") {
  const top = BigInt(normalizeAtomic(numerator, `${field}_numerator`));
  const bottom = BigInt(normalizeAtomic(denominator, `${field}_denominator`, { allowZero: false }));
  return Number((top * 10_000_000n) / bottom) / 1_000;
}

export function assertBoundedBps(value, field = "bps", maximum = 10_000) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${fieldName(field)}_invalid`);
  }
  return parsed;
}
