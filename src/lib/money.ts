/**
 * Integer money arithmetic. All amounts are minor units (paise / cents); rates are basis
 * points (1 bps = 0.01%). Nothing here uses floating-point results for money.
 */

const BPS = 10_000;

function assertMinor(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer (got ${value})`);
  }
}

function assertBps(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > BPS) {
    throw new RangeError(`${name} must be an integer between 0 and ${BPS} bps (got ${value})`);
  }
}

/** `amount * bps / 10000`, rounded down (a discount never exceeds the advertised rate). */
export function percentOf(amountMinor: number, bps: number): number {
  assertMinor(amountMinor, "amountMinor");
  assertBps(bps, "bps");
  return Math.floor((amountMinor * bps) / BPS);
}

/**
 * Tax contained in a tax-inclusive amount: amount * rate / (1 + rate), half-up rounding.
 * Collab displays and charges GST-inclusive prices (Indian MRP rules for B2C).
 */
export function includedTax(grossMinor: number, rateBps: number): number {
  assertMinor(grossMinor, "grossMinor");
  assertBps(rateBps, "rateBps");
  if (rateBps === 0) {
    return 0;
  }
  return Math.round((grossMinor * rateBps) / (BPS + rateBps));
}

/**
 * Splits `totalMinor` across `weights` proportionally (largest-remainder method) so the parts
 * always sum exactly to the total.
 */
export function allocateProportionally(totalMinor: number, weights: readonly number[]): number[] {
  assertMinor(totalMinor, "totalMinor");
  if (weights.length === 0) {
    if (totalMinor !== 0) throw new RangeError("Cannot allocate a non-zero total across zero weights");
    return [];
  }
  weights.forEach((weight, index) => assertMinor(weight, `weights[${index}]`));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) {
    if (totalMinor !== 0) throw new RangeError("Cannot allocate a non-zero total across zero weights");
    return weights.map(() => 0);
  }

  const raw = weights.map((weight) => (totalMinor * weight) / weightSum);
  const parts = raw.map((value) => Math.floor(value));
  let remainder = totalMinor - parts.reduce((sum, part) => sum + part, 0);
  const byFraction = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of byFraction) {
    if (remainder === 0) break;
    parts[index]! += 1;
    remainder -= 1;
  }
  return parts;
}
