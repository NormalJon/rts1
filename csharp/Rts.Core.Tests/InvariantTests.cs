using Rts.Sim;

namespace Rts.Tests
{
    /// <summary>
    /// Every recorded match is played back and, after every single tick, the
    /// world is held to the things that must always be true (see
    /// Helpers.BrokenInvariant): nothing of any resource is made or lost, the
    /// map's record of what connects to what is right, buildings and tilled
    /// ground match the map, every shared order counts its units correctly, no
    /// arrow is overdue, nobody stands in an obstacle, and each side is counted
    /// as seeing exactly what its units and buildings can see.
    ///
    /// This is "never leaves a unit in an obstacle or a group miscounted" in
    /// test/determinism.test.ts, which checks the reference match and the same
    /// with pathfinding starved; here all ten recordings are checked.
    /// </summary>
    public class InvariantTests
    {
        public static IEnumerable<object[]> Matches()
        {
            return RecordingFiles.MatchNames().Select(name => new object[] { name });
        }

        [Theory]
        [MemberData(nameof(Matches))]
        public void NothingThatMustAlwaysHoldIsEverBroken(string name)
        {
            RecordedMatch match = RecordedMatch.Load(name);
            string broken = null;
            int brokenAfter = -1;
            int ticks = 0;
            Replay.RunReplay(match.ToReplay(), world =>
            {
                if (broken == null)
                {
                    broken = Helpers.BrokenInvariant(world);
                    if (broken != null) brokenAfter = world.tick - 1;
                }
                ticks++;
            });
            Assert.True(ticks == match.ticks, $"{name}: ran {ticks} ticks, but {match.ticks} were recorded");
            Assert.True(broken == null, $"{name}: after tick {brokenAfter} of {match.ticks}: {broken}");
        }

        [Fact]
        public void TheChecksCanFail()
        {
            // A check that cannot fail proves nothing. Spoil a world in four ways
            // and see that each is noticed.
            RecordedMatch match = RecordedMatch.Load("reference");

            World world = Replay.RunReplay(match.ToReplay(), null, 600);
            Assert.Null(Helpers.BrokenInvariant(world));
            world.stock[0] += 1;
            Assert.StartsWith("resources are not conserved", Helpers.BrokenInvariant(world));

            world = Replay.RunReplay(match.ToReplay(), null, 600);
            int unit = World.EntityIndex(world.LivingUnits()[0]);
            world.hp[unit] = 0;
            Assert.Contains("hit points", Helpers.BrokenInvariant(world));

            world = Replay.RunReplay(match.ToReplay(), null, 600);
            world.seen[0][0]++;
            Assert.Contains("lookers", Helpers.BrokenVision(world));

            world = Replay.RunReplay(match.ToReplay(), null, 600);
            int open = Array.IndexOf(world.map.passable, (byte)1);
            world.map.region[open] = 0;
            Assert.False(Helpers.RegionsAreRight(world));
        }
    }
}
