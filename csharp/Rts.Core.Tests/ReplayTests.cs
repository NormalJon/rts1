using Rts.Sim;

namespace Rts.Tests
{
    /// <summary>
    /// The proof of the port: every match recorded from the TypeScript game is
    /// played back here from its commands, and the world checksum must be the
    /// same after every single tick.
    /// </summary>
    public class ReplayTests
    {
        public static IEnumerable<object[]> Matches()
        {
            return RecordingFiles.MatchNames().Select(name => new object[] { name });
        }

        [Theory]
        [MemberData(nameof(Matches))]
        public void ReplaysToTheSameChecksumOnEveryTick(string name)
        {
            RecordedMatch match = RecordedMatch.Load(name);
            int firstWrong = -1;
            string mine = null;
            int tick = 0;
            Replay.RunReplay(match.ToReplay(), world =>
            {
                if (firstWrong == -1)
                {
                    string checksum = Hash.HashHex(Hash.HashWorld(world));
                    if (checksum != match.ChecksumAfter(tick))
                    {
                        firstWrong = tick;
                        mine = checksum;
                    }
                }
                tick++;
            });
            Assert.True(tick == match.ticks, $"{name}: ran {tick} ticks, but {match.ticks} were recorded");
            Assert.True(
                firstWrong == -1,
                firstWrong == -1
                    ? ""
                    : $"{name}: the first tick to differ is tick {firstWrong} of {match.ticks}. After it the C# checksum is {mine}; the TypeScript recorded {match.ChecksumAfter(firstWrong)}.");
        }

        [Fact]
        public void TheReferenceMatchEndsOnTheReferenceChecksum()
        {
            // Keep in step with test/determinism.test.ts in the TypeScript.
            RecordedMatch match = RecordedMatch.Load("reference");
            World world = Replay.RunReplay(match.ToReplay());
            Assert.Equal("8faaf6a6", Hash.HashHex(Hash.HashWorld(world)));
        }
    }
}
