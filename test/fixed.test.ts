import { describe, expect, it } from 'vitest';
import {
  abs,
  clamp,
  div,
  FIXED_MAX,
  FIXED_MIN,
  floorToInt,
  fromInt,
  HALF,
  idiv,
  isqrt,
  length,
  lerp,
  mul,
  mulDiv,
  ONE,
  sqrt,
  toFloat,
} from '../src/sim/fixed';
import { Rng } from '../src/sim/rng';
import { fromFloat, perSecondToPerTick, secondsToTicks } from '../src/sim/units';

// The reference answers use BigInt, which is exact at any size.
const wrap32 = (n: bigint): number => Number(BigInt.asIntN(32, n));
const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

const EDGES = [0, 1, -1, 2, -2, HALF, -HALF, ONE, -ONE, ONE + 1, ONE - 1, FIXED_MAX, FIXED_MIN];

/** A signed 32-bit value: sometimes full range, sometimes small, sometimes an edge. */
function int32(rng: Rng): number {
  const shape = rng.nextInt(4);
  if (shape === 0) return EDGES[rng.nextInt(EDGES.length)]!;
  if (shape === 1) return (rng.nextU32() | 0) >> rng.nextInt(31);
  return rng.nextU32() | 0;
}

describe('fixed-point arithmetic', () => {
  it('converts whole numbers both ways', () => {
    expect(fromInt(3)).toBe(3 * ONE);
    expect(fromInt(-7)).toBe(-7 * ONE);
    expect(floorToInt(fromInt(42))).toBe(42);
    expect(floorToInt(fromFloat(-0.5))).toBe(-1);
    expect(toFloat(fromFloat(1.25))).toBe(1.25);
  });

  it('multiplies exactly, matching a BigInt reference on 20,000 random pairs', () => {
    const rng = new Rng(101);
    for (let i = 0; i < 20_000; i++) {
      const a = int32(rng);
      const b = int32(rng);
      const expected = wrap32((BigInt(a) * BigInt(b)) >> 16n);
      expect(mul(a, b), `mul(${a}, ${b})`).toBe(expected);
    }
  });

  it('divides exactly, matching a BigInt reference on 20,000 random pairs', () => {
    const rng = new Rng(202);
    for (let i = 0; i < 20_000; i++) {
      const a = int32(rng);
      let b = int32(rng);
      if (b === 0) b = 1;
      const expected = wrap32(floorDiv(BigInt(a) << 16n, BigInt(b)));
      expect(div(a, b), `div(${a}, ${b})`).toBe(expected);
    }
  });

  it('handles everyday values the way a calculator would', () => {
    expect(mul(fromFloat(1.5), fromFloat(2.5))).toBe(fromFloat(3.75));
    expect(mul(fromInt(-3), fromFloat(0.5))).toBe(fromFloat(-1.5));
    expect(div(fromInt(1), fromInt(4))).toBe(fromFloat(0.25));
    expect(div(fromInt(-9), fromInt(3))).toBe(fromInt(-3));
    expect(sqrt(fromInt(9))).toBe(fromInt(3));
    expect(sqrt(fromFloat(2.25))).toBe(fromFloat(1.5));
    expect(length(fromInt(3), fromInt(4))).toBe(fromInt(5));
    expect(length(fromInt(-3), fromInt(-4))).toBe(fromInt(5));
    expect(lerp(fromInt(10), fromInt(20), HALF)).toBe(fromInt(15));
    expect(abs(fromInt(-2))).toBe(fromInt(2));
    expect(clamp(fromInt(5), 0, fromInt(3))).toBe(fromInt(3));
  });

  it('refuses to divide by zero', () => {
    expect(() => div(ONE, 0)).toThrow(RangeError);
    expect(() => idiv(1, 0)).toThrow(RangeError);
    expect(() => mulDiv(1, 1, 0)).toThrow(RangeError);
  });

  it('takes integer square roots exactly', () => {
    const rng = new Rng(303);
    const check = (n: number): void => {
      const r = BigInt(isqrt(n));
      expect(r * r <= BigInt(n) && (r + 1n) * (r + 1n) > BigInt(n), `isqrt(${n})`).toBe(true);
    };
    for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 2 ** 32, 2 ** 52, 2 ** 53 - 1]) check(n);
    for (let i = 0; i < 20_000; i++) {
      // Up to 52 random bits, with the top bits often zero.
      const n = (rng.nextU32() >>> rng.nextInt(32)) * 2 ** rng.nextInt(21) + rng.nextInt(1 << 20);
      check(n);
    }
    // Perfect squares and their neighbours are where an off-by-one would show.
    for (let i = 0; i < 2_000; i++) {
      const root = rng.nextInt(1 << 26);
      const square = root * root;
      expect(isqrt(square)).toBe(root);
      if (root > 0) expect(isqrt(square - 1)).toBe(root - 1);
    }
  });

  it('takes fixed-point square roots and vector lengths exactly', () => {
    const rng = new Rng(404);
    for (let i = 0; i < 10_000; i++) {
      const a = rng.nextU32() >>> (1 + rng.nextInt(20));
      const r = BigInt(sqrt(a));
      const scaled = BigInt(a) << 16n;
      expect(r * r <= scaled && (r + 1n) * (r + 1n) > scaled, `sqrt(${a})`).toBe(true);

      // Anything within 1024 tiles, which covers every distance on a map.
      const x = (rng.nextU32() | 0) >> 6;
      const y = (rng.nextU32() | 0) >> 6;
      const len = BigInt(length(x, y));
      const sumSq = BigInt(x) * BigInt(x) + BigInt(y) * BigInt(y);
      expect(len * len <= sumSq && (len + 1n) * (len + 1n) > sumSq, `length(${x}, ${y})`).toBe(true);
    }
  });

  it('keeps very long vectors finite and close', () => {
    expect(length(FIXED_MAX, 0)).toBeGreaterThan(FIXED_MAX - 64);
    expect(length(FIXED_MIN, FIXED_MIN)).toBe(FIXED_MAX);
  });

  it('computes mulDiv exactly and rejects products too large to be exact', () => {
    const rng = new Rng(505);
    for (let i = 0; i < 10_000; i++) {
      const a = (rng.nextU32() | 0) >> 6;
      const b = (rng.nextU32() | 0) >> 8;
      let c = (rng.nextU32() | 0) >> rng.nextInt(24);
      if (c === 0) c = 1;
      expect(mulDiv(a, b, c), `mulDiv(${a}, ${b}, ${c})`).toBe(
        wrap32(floorDiv(BigInt(a) * BigInt(b), BigInt(c))),
      );
    }
    expect(() => mulDiv(2 ** 40, 2 ** 20, 3)).toThrow(RangeError);
  });
});

describe('authored-unit conversion', () => {
  it('turns seconds into whole ticks', () => {
    expect(secondsToTicks(1, 30)).toBe(30);
    expect(secondsToTicks(2.5, 30)).toBe(75);
    expect(secondsToTicks(0.001, 30)).toBe(1);
    expect(secondsToTicks(1, 8)).toBe(8);
  });

  it('turns per-second rates into per-tick rates', () => {
    expect(perSecondToPerTick(fromInt(30), 30)).toBe(ONE);
    expect(perSecondToPerTick(fromInt(3), 30)).toBe(6553);
  });
});
