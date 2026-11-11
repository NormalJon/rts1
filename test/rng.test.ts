import { describe, expect, it } from 'vitest';
import { fromInt, ONE } from '../src/sim/fixed';
import { Rng } from '../src/sim/rng';

describe('random number generator', () => {
  it('gives the same sequence for the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('gives different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.nextU32() === b.nextU32()) same++;
    expect(same).toBe(0);
  });

  it('matches the published xoshiro128** algorithm', () => {
    // Worked by hand from the reference C code with state {1, 2, 3, 4}:
    // the first output is rotl(2 * 5, 7) * 9 = 11520.
    const rng = new Rng(0);
    rng.setState([1, 2, 3, 4]);
    expect(rng.nextU32()).toBe(11520);
    expect(rng.getState()).toEqual([7, 0, 1026, 12288]);
    // Second output: s1 is 0, so the result is 0.
    expect(rng.nextU32()).toBe(0);
  });

  it('resumes exactly from a saved state', () => {
    const a = new Rng(99);
    for (let i = 0; i < 50; i++) a.nextU32();
    const b = new Rng(0);
    b.setState(a.getState());
    for (let i = 0; i < 200; i++) expect(b.nextU32()).toBe(a.nextU32());
  });

  it('keeps nextInt within bounds and roughly even', () => {
    const rng = new Rng(7);
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 60_000; i++) {
      const v = rng.nextInt(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      counts[v]!++;
    }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
    expect(rng.nextInt(1)).toBe(0);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(1.5)).toThrow(RangeError);
  });

  it('keeps fixed-point values inside their range', () => {
    const rng = new Rng(8);
    for (let i = 0; i < 10_000; i++) {
      const unit = rng.nextFixed();
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(ONE);
      const ranged = rng.rangeFixed(fromInt(-3), fromInt(3));
      expect(ranged).toBeGreaterThanOrEqual(fromInt(-3));
      expect(ranged).toBeLessThan(fromInt(3));
    }
  });
});
