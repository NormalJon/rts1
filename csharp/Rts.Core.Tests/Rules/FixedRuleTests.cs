// Translated from test/fixed.test.ts. Keep the two in step.

using System.Numerics;
using Rts.Sim;
using static Rts.Sim.Fixed;

namespace Rts.Tests.Rules
{
    public class FixedPointArithmetic
    {
        // The reference answers use BigInteger, which is exact at any size.
        static int Wrap32(BigInteger n)
        {
            return unchecked((int)(uint)(n & 0xFFFFFFFF));
        }

        static BigInteger FloorDiv(BigInteger a, BigInteger b)
        {
            BigInteger q = BigInteger.DivRem(a, b, out BigInteger remainder);
            return !remainder.IsZero && (a.Sign < 0) != (b.Sign < 0) ? q - 1 : q;
        }

        static readonly int[] EDGES = { 0, 1, -1, 2, -2, HALF, -HALF, ONE, -ONE, ONE + 1, ONE - 1, FIXED_MAX, FIXED_MIN };

        /// <summary>A signed 32-bit value: sometimes full range, sometimes small, sometimes an edge.</summary>
        static int Int32(Rng rng)
        {
            long shape = rng.NextInt(4);
            if (shape == 0) return EDGES[rng.NextInt(EDGES.Length)];
            if (shape == 1)
            {
                int value = unchecked((int)rng.NextU32());
                return value >> (int)rng.NextInt(31);
            }
            return unchecked((int)rng.NextU32());
        }

        [Fact]
        public void ConvertsWholeNumbersBothWays()
        {
            Assert.Equal(3 * ONE, FromInt(3));
            Assert.Equal(-7 * ONE, FromInt(-7));
            Assert.Equal(42, FloorToInt(FromInt(42)));
            Assert.Equal(-1, FloorToInt(Units.FromFloat(-0.5)));
            Assert.Equal(1.25, ToFloat(Units.FromFloat(1.25)));
        }

        [Fact]
        public void MultipliesExactlyMatchingABigIntegerReferenceOn20000RandomPairs()
        {
            var rng = new Rng(101);
            for (int i = 0; i < 20_000; i++)
            {
                int a = Int32(rng);
                int b = Int32(rng);
                int expected = Wrap32((new BigInteger(a) * new BigInteger(b)) >> 16);
                Assert.True(Mul(a, b) == expected, $"mul({a}, {b}) gave {Mul(a, b)}, not {expected}");
            }
        }

        [Fact]
        public void DividesExactlyMatchingABigIntegerReferenceOn20000RandomPairs()
        {
            var rng = new Rng(202);
            for (int i = 0; i < 20_000; i++)
            {
                int a = Int32(rng);
                int b = Int32(rng);
                if (b == 0) b = 1;
                int expected = Wrap32(FloorDiv(new BigInteger(a) << 16, new BigInteger(b)));
                Assert.True(Div(a, b) == expected, $"div({a}, {b}) gave {Div(a, b)}, not {expected}");
            }
        }

        [Fact]
        public void HandlesEverydayValuesTheWayACalculatorWould()
        {
            Assert.Equal(Units.FromFloat(3.75), Mul(Units.FromFloat(1.5), Units.FromFloat(2.5)));
            Assert.Equal(Units.FromFloat(-1.5), Mul(FromInt(-3), Units.FromFloat(0.5)));
            Assert.Equal(Units.FromFloat(0.25), Div(FromInt(1), FromInt(4)));
            Assert.Equal(FromInt(-3), Div(FromInt(-9), FromInt(3)));
            Assert.Equal(FromInt(3), Sqrt(FromInt(9)));
            Assert.Equal(Units.FromFloat(1.5), Sqrt(Units.FromFloat(2.25)));
            Assert.Equal(FromInt(5), Length(FromInt(3), FromInt(4)));
            Assert.Equal(FromInt(5), Length(FromInt(-3), FromInt(-4)));
            Assert.Equal(FromInt(15), Lerp(FromInt(10), FromInt(20), HALF));
            Assert.Equal(FromInt(2), Abs(FromInt(-2)));
            Assert.Equal(FromInt(3), Clamp(FromInt(5), 0, FromInt(3)));
        }

        [Fact]
        public void RefusesToDivideByZero()
        {
            Assert.Throws<DivideByZeroException>(() => Div(ONE, 0));
            Assert.Throws<DivideByZeroException>(() => Idiv(1, 0));
            Assert.Throws<DivideByZeroException>(() => Idiv(1L, 0L));
            Assert.Throws<DivideByZeroException>(() => MulDiv(1, 1, 0));
        }

        [Fact]
        public void TakesIntegerSquareRootsExactly()
        {
            var rng = new Rng(303);
            void Check(long n)
            {
                BigInteger r = Isqrt(n);
                Assert.True(r * r <= n && (r + 1) * (r + 1) > n, $"isqrt({n})");
            }
            foreach (long n in new[] { 0, 1, 2, 3, 4, 15, 16, 17, 1L << 32, 1L << 52, (1L << 53) - 1 }) Check(n);
            for (int i = 0; i < 20_000; i++)
            {
                // Up to 52 random bits, with the top bits often zero.
                long bits = rng.NextU32();
                bits >>= (int)rng.NextInt(32);
                long scaled = bits * (1L << (int)rng.NextInt(21));
                long n = scaled + rng.NextInt(1 << 20);
                Check(n);
            }
            // Perfect squares and their neighbours are where an off-by-one would show.
            for (int i = 0; i < 2_000; i++)
            {
                long root = rng.NextInt(1 << 26);
                long square = root * root;
                Assert.Equal(root, Isqrt(square));
                if (root > 0) Assert.Equal(root - 1, Isqrt(square - 1));
            }
        }

        [Fact]
        public void TakesFixedPointSquareRootsAndVectorLengthsExactly()
        {
            var rng = new Rng(404);
            for (int i = 0; i < 10_000; i++)
            {
                uint bits = rng.NextU32();
                long a = bits >> (1 + (int)rng.NextInt(20));
                BigInteger r = Sqrt(a);
                BigInteger scaled = new BigInteger(a) << 16;
                Assert.True(r * r <= scaled && (r + 1) * (r + 1) > scaled, $"sqrt({a})");

                // Anything within 1024 tiles, which covers every distance on a map.
                int x = unchecked((int)rng.NextU32()) >> 6;
                int y = unchecked((int)rng.NextU32()) >> 6;
                BigInteger len = Length(x, y);
                BigInteger sumSq = new BigInteger(x) * x + new BigInteger(y) * y;
                Assert.True(len * len <= sumSq && (len + 1) * (len + 1) > sumSq, $"length({x}, {y})");
            }
        }

        [Fact]
        public void KeepsVeryLongVectorsFiniteAndClose()
        {
            Assert.True(Length(FIXED_MAX, 0) > FIXED_MAX - 64);
            Assert.Equal(FIXED_MAX, Length(FIXED_MIN, FIXED_MIN));
        }

        [Fact]
        public void ComputesMulDivExactlyAndRejectsProductsTooLargeToBeExact()
        {
            var rng = new Rng(505);
            for (int i = 0; i < 10_000; i++)
            {
                int a = unchecked((int)rng.NextU32()) >> 6;
                int b = unchecked((int)rng.NextU32()) >> 8;
                int c = unchecked((int)rng.NextU32());
                c >>= (int)rng.NextInt(24);
                if (c == 0) c = 1;
                int expected = Wrap32(FloorDiv(new BigInteger(a) * b, c));
                Assert.True(MulDiv(a, b, c) == expected, $"mulDiv({a}, {b}, {c}) gave {MulDiv(a, b, c)}, not {expected}");
            }
            Assert.Throws<OverflowException>(() => MulDiv(1L << 40, 1L << 20, 3));
        }
    }

    public class AuthoredUnitConversion
    {
        [Fact]
        public void TurnsSecondsIntoWholeTicks()
        {
            Assert.Equal(30, Units.SecondsToTicks(1, 30));
            Assert.Equal(75, Units.SecondsToTicks(2.5, 30));
            Assert.Equal(1, Units.SecondsToTicks(0.001, 30));
            Assert.Equal(8, Units.SecondsToTicks(1, 8));
        }

        [Fact]
        public void TurnsPerSecondRatesIntoPerTickRates()
        {
            Assert.Equal(ONE, Units.PerSecondToPerTick(FromInt(30), 30));
            Assert.Equal(6553, Units.PerSecondToPerTick(FromInt(3), 30));
        }
    }
}
