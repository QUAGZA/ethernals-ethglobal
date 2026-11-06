/**
 * Score and price math. This mirrors HireLedger.sol exactly (integer math, rounding down),
 * so the UI and tests can predict what the contract will compute.
 *
 *   score = (3*3 + sumVotes) / (3 + votes)          (a prior of three neutral 3-star votes)
 *   price = basePrice * (9 + sumVotes) / (3 * (3 + votes))
 */

export const PRIOR_COUNT = 3n;
export const PRIOR_MEAN = 3n;
export const PRIOR_SUM = PRIOR_COUNT * PRIOR_MEAN; // 9
export const USDC_DECIMALS = 6;
export const SCORE_SCALE = 1_000_000n;

export function scoreX1e6(votes: number | bigint, sumVotes: number | bigint): bigint {
  const n = BigInt(votes);
  const s = BigInt(sumVotes);
  return ((PRIOR_SUM + s) * SCORE_SCALE) / (PRIOR_COUNT + n);
}

export function priceOf(basePrice: bigint, votes: number | bigint, sumVotes: number | bigint): bigint {
  const n = BigInt(votes);
  const s = BigInt(sumVotes);
  return (basePrice * (PRIOR_SUM + s)) / (PRIOR_MEAN * (PRIOR_COUNT + n));
}

/** "3.50" style display of a score scaled by 1e6. */
export function formatScore(scaled: bigint): string {
  const hundredths = (scaled + 5_000n) / 10_000n; // round half up to 2 decimals
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}

/** Atomic units (6 decimals) -> "0.116666". */
export function formatUnits6(amount: bigint): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** "0.10" -> 100000n (6 decimals). Throws on bad input or more than 6 decimals. */
export function parseUnits6(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error(`Invalid amount "${value}": use a number with at most 6 decimals, e.g. 0.10`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
}

/** Short display: "0.116666" -> "0.117" */
export function formatPriceShort(amount: bigint): string {
  const thousandths = (amount + 500n) / 1_000n;
  return `${thousandths / 1000n}.${(thousandths % 1000n).toString().padStart(3, "0")}`;
}
