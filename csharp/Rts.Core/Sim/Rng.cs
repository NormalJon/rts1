// Ported from src/sim/rng.ts. Keep the two in step.

using System;

namespace Rts.Sim
{
    /// <summary>
    /// The simulation's only source of randomness: xoshiro128**, which uses
    /// nothing but 32-bit integer operations. Its state is part of the world, so
    /// it is saved, restored and checksummed with everything else.
    /// </summary>
    public sealed class Rng
    {
        uint s0;
        uint s1;
        uint s2;
        uint s3;

        public Rng(int seed)
        {
            unchecked
            {
                // splitmix32 spreads one seed across the four state words.
                uint a = (uint)seed;
                s0 = Next(ref a);
                s1 = Next(ref a);
                s2 = Next(ref a);
                s3 = Next(ref a);
                // An all-zero state would produce zeros forever.
                if ((s0 | s1 | s2 | s3) == 0) s0 = 1;
            }
        }

        static uint Next(ref uint a)
        {
            unchecked
            {
                a += 0x9e3779b9;
                uint t = a ^ (a >> 16);
                t *= 0x21f0aaad;
                t ^= t >> 15;
                t *= 0x735a2d97;
                return t ^ (t >> 15);
            }
        }

        /// <summary>Uniform integer from 0 to 2^32 - 1.</summary>
        public uint NextU32()
        {
            unchecked
            {
                uint s1 = this.s1;
                uint m = s1 * 5;
                uint result = ((m << 7) | (m >> 25)) * 9;
                uint t = s1 << 9;
                s2 ^= s0;
                s3 ^= s1;
                this.s1 ^= s2;
                s0 ^= s3;
                s2 ^= t;
                s3 = (s3 << 11) | (s3 >> 21);
                return result;
            }
        }

        /// <summary>Uniform integer in [0, bound), with no bias toward low values. The bound may be up to 2^32.</summary>
        public long NextInt(long bound)
        {
            if (bound < 1 || bound > 0x100000000L)
            {
                throw new ArgumentOutOfRangeException(nameof(bound), $"nextInt bound must be an integer from 1 to 2^32, got {bound}");
            }
            // Reject the few values at the bottom that would make some results likelier.
            long threshold = (0x100000000L - bound) % bound;
            for (;;)
            {
                long r = NextU32();
                if (r >= threshold) return r % bound;
            }
        }

        /// <summary>Uniform fixed-point value in [0, 1).</summary>
        public int NextFixed()
        {
            return (int)(NextU32() >> 16);
        }

        /// <summary>Uniform fixed-point value in [lo, hi).</summary>
        public int RangeFixed(int lo, int hi)
        {
            return unchecked(lo + Fixed.Mul(NextFixed(), hi - lo));
        }

        /// <summary>True with probability numerator/denominator.</summary>
        public bool Chance(long numerator, long denominator)
        {
            return NextInt(denominator) < numerator;
        }

        /// <summary>The four state words, as signed 32-bit numbers.</summary>
        public int[] GetState()
        {
            unchecked
            {
                return new[] { (int)s0, (int)s1, (int)s2, (int)s3 };
            }
        }

        public void SetState(int[] state)
        {
            unchecked
            {
                s0 = (uint)state[0];
                s1 = (uint)state[1];
                s2 = (uint)state[2];
                s3 = (uint)state[3];
            }
        }
    }
}
