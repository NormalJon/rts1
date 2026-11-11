/**
 * The simulation's only source of randomness: xoshiro128**, which uses nothing
 * but 32-bit integer operations. Its state is part of the world, so it is
 * saved, restored and checksummed with everything else.
 */

import { mul, type Fixed } from './fixed';

export type RngState = readonly [number, number, number, number];

export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    // splitmix32 spreads one seed across the four state words.
    let a = seed | 0;
    const next = (): number => {
      a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15;
      t = Math.imul(t, 0x735a2d97);
      return t ^ (t >>> 15);
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    // An all-zero state would produce zeros forever.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Uniform integer from 0 to 2^32 - 1. */
  nextU32(): number {
    const s1 = this.s1;
    const m = Math.imul(s1, 5);
    const result = Math.imul((m << 7) | (m >>> 25), 9) >>> 0;
    const t = s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = (this.s3 << 11) | (this.s3 >>> 21);
    return result;
  }

  /** Uniform integer in [0, bound), with no bias toward low values. */
  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1 || bound > 0x100000000) {
      throw new RangeError(`nextInt bound must be an integer from 1 to 2^32, got ${bound}`);
    }
    // Reject the few values at the bottom that would make some results likelier.
    const threshold = (0x100000000 - bound) % bound;
    for (;;) {
      const r = this.nextU32();
      if (r >= threshold) return r % bound;
    }
  }

  /** Uniform fixed-point value in [0, 1). */
  nextFixed(): Fixed {
    return this.nextU32() >>> 16;
  }

  /** Uniform fixed-point value in [lo, hi). */
  rangeFixed(lo: Fixed, hi: Fixed): Fixed {
    return (lo + mul(this.nextFixed(), hi - lo)) | 0;
  }

  /** True with probability numerator/denominator. */
  chance(numerator: number, denominator: number): boolean {
    return this.nextInt(denominator) < numerator;
  }

  getState(): RngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  setState(state: RngState): void {
    this.s0 = state[0] | 0;
    this.s1 = state[1] | 0;
    this.s2 = state[2] | 0;
    this.s3 = state[3] | 0;
  }
}
