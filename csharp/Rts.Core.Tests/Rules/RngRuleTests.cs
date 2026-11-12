// Translated from test/rng.test.ts. Keep the two in step.

using Rts.Sim;
using static Rts.Sim.Fixed;

namespace Rts.Tests.Rules
{
    public class RandomNumberGenerator
    {
        [Fact]
        public void GivesTheSameSequenceForTheSameSeed()
        {
            var a = new Rng(12345);
            var b = new Rng(12345);
            for (int i = 0; i < 1000; i++) Assert.Equal(a.NextU32(), b.NextU32());
        }

        [Fact]
        public void GivesDifferentSequencesForDifferentSeeds()
        {
            var a = new Rng(1);
            var b = new Rng(2);
            int same = 0;
            for (int i = 0; i < 100; i++) if (a.NextU32() == b.NextU32()) same++;
            Assert.Equal(0, same);
        }

        [Fact]
        public void MatchesThePublishedXoshiro128StarStarAlgorithm()
        {
            // Worked by hand from the reference C code with state {1, 2, 3, 4}:
            // the first output is rotl(2 * 5, 7) * 9 = 11520.
            var rng = new Rng(0);
            rng.SetState(new[] { 1, 2, 3, 4 });
            Assert.Equal(11520u, rng.NextU32());
            Assert.Equal(new[] { 7, 0, 1026, 12288 }, rng.GetState());
            // Second output: s1 is 0, so the result is 0.
            Assert.Equal(0u, rng.NextU32());
        }

        [Fact]
        public void ResumesExactlyFromASavedState()
        {
            var a = new Rng(99);
            for (int i = 0; i < 50; i++) a.NextU32();
            var b = new Rng(0);
            b.SetState(a.GetState());
            for (int i = 0; i < 200; i++) Assert.Equal(a.NextU32(), b.NextU32());
        }

        [Fact]
        public void KeepsNextIntWithinBoundsAndRoughlyEven()
        {
            var rng = new Rng(7);
            var counts = new int[6];
            for (int i = 0; i < 60_000; i++)
            {
                long v = rng.NextInt(6);
                Assert.True(v >= 0);
                Assert.True(v < 6);
                counts[v]++;
            }
            foreach (int c in counts) Assert.True(Math.Abs(c - 10_000) < 500);
            Assert.Equal(0, rng.NextInt(1));
            Assert.Throws<ArgumentOutOfRangeException>(() => rng.NextInt(0));
            // The TypeScript also refuses a bound of 1.5. Here the bound is a whole number by its type.
        }

        [Fact]
        public void KeepsFixedPointValuesInsideTheirRange()
        {
            var rng = new Rng(8);
            for (int i = 0; i < 10_000; i++)
            {
                int unit = rng.NextFixed();
                Assert.True(unit >= 0);
                Assert.True(unit < ONE);
                int ranged = rng.RangeFixed(FromInt(-3), FromInt(3));
                Assert.True(ranged >= FromInt(-3));
                Assert.True(ranged < FromInt(3));
            }
        }
    }
}
