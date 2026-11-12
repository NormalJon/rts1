using System.Text.Json;
using Rts.Sim;

namespace Rts.Tests
{
    /// <summary>
    /// The fixed-point arithmetic and the random numbers, checked against figures
    /// worked out by the TypeScript game (recordings/figures.json).
    /// </summary>
    public class ArithmeticTests
    {
        const int FIXED_ROUNDS = 4000;
        const int FIXED_SEED = 12345;

        sealed class Tally
        {
            public readonly List<long[]> samples = new List<long[]>();
            public readonly Fold fold = new Fold();
            public int calls;

            public void Note(long result, params long[] args)
            {
                var row = new long[args.Length + 1];
                args.CopyTo(row, 0);
                row[args.Length] = result;
                samples.Add(row);
                fold.Add(result);
                calls++;
            }
        }

        [Fact]
        public void FixedPointFunctionsGiveTheSameResultsAsTheTypeScript()
        {
            var rng = new Rng(FIXED_SEED);
            int Draw()
            {
                int word = unchecked((int)rng.NextU32());
                return word >> (int)rng.NextInt(24);
            }

            var names = new[] { "mul", "div", "idiv", "mulDiv", "isqrt", "sqrt", "length", "abs", "clamp", "lerp", "fromInt", "fromRatio" };
            var tallies = names.ToDictionary(name => name, _ => new Tally());
            for (int round = 0; round < FIXED_ROUNDS; round++)
            {
                int a = Draw();
                int b = Draw();
                int c = Draw();
                tallies["mul"].Note(Fixed.Mul(a, b), a, b);
                if (b != 0)
                {
                    tallies["div"].Note(Fixed.Div(a, b), a, b);
                    tallies["idiv"].Note(Fixed.Idiv((long)a, (long)b), a, b);
                }
                if (c != 0 && Math.Abs((long)a * b) <= Fixed.MAX_SAFE_INTEGER) tallies["mulDiv"].Note(Fixed.MulDiv(a, b, c), a, b, c);
                long positive = Math.Abs((long)a);
                long big = positive * 4194303 + Math.Abs(b >> 10);
                tallies["isqrt"].Note(Fixed.Isqrt(big), positive, b >> 10);
                tallies["sqrt"].Note(Fixed.Sqrt(positive), positive);
                tallies["length"].Note(Fixed.Length(a, b), a, b);
                tallies["abs"].Note(Fixed.Abs(a), a);
                tallies["clamp"].Note(Fixed.Clamp(a, Math.Min(b, c), Math.Max(b, c)), a, b, c);
                tallies["lerp"].Note(Fixed.Lerp(a, b, c & 0xffff), a, b, c & 0xffff);
                tallies["fromInt"].Note(Fixed.FromInt(a >> 12), a >> 12);
                if (c >> 8 != 0) tallies["fromRatio"].Note(Fixed.FromRatio(a >> 12, c >> 8), a >> 12, c >> 8);
            }

            using JsonDocument figures = RecordingFiles.Read("figures.json");
            JsonElement expected = figures.RootElement.GetProperty("fixed");
            foreach (string name in names)
            {
                JsonElement want = expected.GetProperty(name);
                Tally got = tallies[name];
                // The first few calls are written out in full, so that a mismatch names the arguments.
                int row = 0;
                foreach (JsonElement sample in want.GetProperty("samples").EnumerateArray())
                {
                    long[] wanted = sample.EnumerateArray().Select(value => value.GetInt64()).ToArray();
                    long[] mine = got.samples[row++];
                    string args = string.Join(", ", wanted.Take(wanted.Length - 1));
                    Assert.True(wanted.Take(wanted.Length - 1).SequenceEqual(mine.Take(mine.Length - 1)), $"{name}: call {row} was made with different arguments ({args})");
                    // Compared as the TypeScript compares everything it stores: by their low 32 bits.
                    Assert.True(unchecked((int)wanted[^1]) == unchecked((int)mine[^1]), $"{name}({args}) gave {mine[^1]}, but the TypeScript gives {wanted[^1]}");
                }
                Assert.Equal(want.GetProperty("calls").GetInt32(), got.calls);
                Assert.True(want.GetProperty("folded").GetUInt32() == got.fold.Value, $"{name}: some result after the first {row} differs from the TypeScript");
            }
        }

        [Fact]
        public void RandomNumbersComeOutInTheSameOrderAsTheTypeScript()
        {
            long[] bounds = { 1, 2, 3, 7, 100, 65536, 0x80000000L, 0xffffffffL, 0x100000000L };
            using JsonDocument figures = RecordingFiles.Read("figures.json");
            foreach (JsonElement want in figures.RootElement.GetProperty("rng").EnumerateArray())
            {
                long seed = want.GetProperty("seed").GetInt64();
                var rng = new Rng(unchecked((int)seed));
                foreach (JsonElement number in want.GetProperty("first").EnumerateArray())
                {
                    Assert.True(number.GetUInt32() == rng.NextU32(), $"seed {seed}: an early number differs");
                }
                var fold = new Fold();
                for (int i = 0; i < 1000; i++) fold.Add(rng.NextU32());
                Assert.True(want.GetProperty("folded").GetUInt32() == fold.Value, $"seed {seed}: a later number differs");

                var bounded = new List<long>();
                foreach (long bound in bounds) bounded.Add(rng.NextInt(bound));
                bounded.Add(rng.RangeFixed(Fixed.FromInt(-2), Fixed.FromInt(2)));
                bounded.Add(rng.Chance(1, 3) ? 1 : 0);
                long[] wanted = want.GetProperty("bounded").EnumerateArray().Select(value => value.GetInt64()).ToArray();
                Assert.Equal(wanted, bounded.ToArray());

                int[] state = want.GetProperty("state").EnumerateArray().Select(value => value.GetInt32()).ToArray();
                Assert.Equal(state, rng.GetState());
            }
        }
    }
}
