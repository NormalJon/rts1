/**
 * Q16.16 fixed-point arithmetic.
 *
 * Every number the simulation computes with is an integer in the signed 32-bit
 * range, where 65536 stands for 1.0. Integer arithmetic gives bit-identical
 * results on every machine and JavaScript engine, which is what lets players'
 * computers stay in sync by exchanging only commands.
 *
 * JavaScript numbers are 64-bit floats, but they represent every integer up to
 * 2^53 exactly. Each function below keeps its intermediate values inside that
 * exact range, so no rounding ever depends on the platform.
 *
 * Range: about -32768 to +32768, in steps of 1/65536. Results that leave the
 * range wrap around, as 32-bit integers do. All rounding is toward negative
 * infinity (floor).
 *
 * This file and units.ts are the only places in src/sim allowed to use
 * floating-point operations; test/determinism-lint.test.ts enforces that.
 */

/** A Q16.16 value. An alias, so it documents intent without changing types. */
export type Fixed = number;

export const FRAC_BITS = 16;
export const ONE: Fixed = 1 << FRAC_BITS;
export const HALF: Fixed = ONE >> 1;
export const FIXED_MAX: Fixed = 0x7fffffff;
export const FIXED_MIN: Fixed = -0x80000000;

const FRAC_MASK = ONE - 1;
/** Below this magnitude, the sum of two squares is still an exact integer. */
const EXACT_SQUARE_LIMIT = 1 << 26;

export function fromInt(n: number): Fixed {
  return (n * ONE) | 0;
}

/** Whole part, rounded down. */
export function floorToInt(a: Fixed): number {
  return a >> FRAC_BITS;
}

/**
 * For the display layer only (drawing, UI). Never feed the result back into
 * the simulation.
 */
export function toFloat(a: Fixed): number {
  return a / ONE;
}

export function mul(a: Fixed, b: Fixed): Fixed {
  // a*b can reach 2^62, past the exact range, so split b into its whole and
  // fractional halves. Each partial product stays below 2^47.
  return (a * (b >> FRAC_BITS) + Math.floor((a * (b & FRAC_MASK)) / ONE)) | 0;
}

export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0) throw new RangeError('fixed-point division by zero');
  // a * ONE stays below 2^47. For integers under 2^53 the float quotient can
  // never round across a whole number, so the floor is exact.
  return Math.floor((a * ONE) / b) | 0;
}

/** floor(a / b) for plain integers. */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('integer division by zero');
  return Math.floor(a / b);
}

/**
 * floor(a * b / c) without losing the precision that mul-then-div would.
 * Works on any integers (fixed or not) as long as a*b stays below 2^53.
 */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) throw new RangeError('mulDiv division by zero');
  const product = a * b;
  if (product > Number.MAX_SAFE_INTEGER || product < -Number.MAX_SAFE_INTEGER) {
    throw new RangeError('mulDiv intermediate product exceeds the exact integer range');
  }
  return Math.floor(product / c) | 0;
}

/** floor(sqrt(n)) for a non-negative integer below 2^53. */
export function isqrt(n: number): number {
  if (n < 0) throw new RangeError('square root of a negative number');
  // Math.sqrt gets within one of the answer on every engine; the two loops
  // settle it exactly, so the result never depends on the engine's rounding.
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

export function sqrt(a: Fixed): Fixed {
  return isqrt(a * ONE);
}

/** Length of the vector (x, y). */
export function length(x: Fixed, y: Fixed): Fixed {
  let ax = Math.abs(x);
  let ay = Math.abs(y);
  let scale = 1;
  // Vectors longer than 1024 units are halved until their squares are exact.
  // Nothing on a map is that far apart, so this is a safety net.
  while (ax >= EXACT_SQUARE_LIMIT || ay >= EXACT_SQUARE_LIMIT) {
    ax = Math.floor(ax / 2);
    ay = Math.floor(ay / 2);
    scale *= 2;
  }
  return Math.min(isqrt(ax * ax + ay * ay) * scale, FIXED_MAX);
}

export function abs(a: Fixed): Fixed {
  return a < 0 ? -a | 0 : a;
}

export function clamp(a: Fixed, lo: Fixed, hi: Fixed): Fixed {
  return a < lo ? lo : a > hi ? hi : a;
}

/** a + (b - a) * t, with t in fixed-point (0 to ONE). */
export function lerp(a: Fixed, b: Fixed, t: Fixed): Fixed {
  return (a + mul(b - a, t)) | 0;
}
