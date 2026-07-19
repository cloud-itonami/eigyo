/**
 * eigyo kotoba — tithe math (constitutional 10% Public-Fund split, ADR-2605192100).
 * USDC base units (micros) as bigint; integer-floored tithe, no rounding leak.
 */

export const TITHE_PERMILLE = 100n;

export interface TitheSplit {
  gross: bigint;
  tithe: bigint;
  net: bigint;
}

export function splitTithe(grossMicros: bigint): TitheSplit {
  if (grossMicros < 0n) throw new RangeError("[eigyo/tithe] gross must be non-negative");
  const tithe = (grossMicros * TITHE_PERMILLE) / 1000n;
  return { gross: grossMicros, tithe, net: grossMicros - tithe };
}

export function parseMicros(s: string): bigint {
  if (!/^\d+$/.test(s)) {
    throw new TypeError(`[eigyo/tithe] micros must be a non-negative integer string, got "${s}"`);
  }
  return BigInt(s);
}
