using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Rts.Ai;
using Rts.Session;
using Rts.Sim;

namespace Rts.Game.Tests
{
    /// <summary>
    /// The proof that the game Unity runs is the same game. Unity compiles the
    /// rules with its own compiler and runs them on its own runtime, not the
    /// one the .NET tests use. So the matches recorded from the TypeScript
    /// game are played here too, inside Unity, and the world checksum must be
    /// the same after every single tick.
    /// </summary>
    public class RecordedMatchTests
    {
        const int TEN_MINUTES = 600000;

        static IEnumerable<string> Matches()
        {
            return RecordedMatch.Names();
        }

        static IEnumerable<string> AiMatches()
        {
            return RecordedMatch.Names().Where(name => RecordedMatch.Load(name).controllers != null);
        }

        static Difficulty Level(string level)
        {
            switch (level)
            {
                case "easy": return Difficulty.Easy;
                case "standard": return Difficulty.Standard;
                case "hard": return Difficulty.Hard;
                default: throw new System.IO.InvalidDataException("unknown AI level: " + level);
            }
        }

        [Test]
        public void TheRecordingsAreThere()
        {
            Assert.That(RecordedMatch.Names().Count(), Is.GreaterThanOrEqualTo(10), "no recorded matches in " + RecordedMatch.Folder);
        }

        [TestCaseSource(nameof(Matches))]
        [Timeout(TEN_MINUTES)]
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
            Assert.That(tick, Is.EqualTo(match.ticks), name + ": the number of ticks run");
            Assert.That(firstWrong, Is.EqualTo(-1),
                firstWrong == -1 ? "" : $"{name}: the first tick to differ is tick {firstWrong} of {match.ticks}. After it Unity's checksum is {mine}; the TypeScript recorded {match.ChecksumAfter(firstWrong)}.");
        }

        /// <summary>
        /// A replay does not consult the AI. Here the AI plays each recorded AI
        /// match itself from the first tick, as it does when the game is run,
        /// and must bring the match to the same state on every tick. The AI
        /// does a few sums in decimals, so this is where a difference between
        /// Unity's runtime and .NET's would show.
        /// </summary>
        [TestCaseSource(nameof(AiMatches))]
        [Timeout(TEN_MINUTES)]
        public void TheAiPlayingItselfReachesTheSameChecksumOnEveryTick(string name)
        {
            RecordedMatch match = RecordedMatch.Load(name);
            var session = new LocalSession(match.config.Clone());
            for (int player = 0; player < match.controllers.Length; player++)
            {
                if (match.controllers[player] != null) session.Control(player, new SkirmishAi(player, Level(match.controllers[player])));
            }
            for (int tick = 0; tick < match.ticks; tick++)
            {
                session.Step();
                string checksum = Hash.HashHex(Hash.HashWorld(session.world));
                if (checksum == match.ChecksumAfter(tick)) continue;
                Assert.Fail($"{name}: with the AI playing, the first tick to differ is tick {tick} of {match.ticks}. After it Unity's checksum is {checksum}; the TypeScript recorded {match.ChecksumAfter(tick)}.");
            }
        }

        [Test]
        public void TheReferenceMatchEndsOnTheReferenceChecksum()
        {
            // Keep in step with test/determinism.test.ts in the TypeScript.
            World world = Replay.RunReplay(RecordedMatch.Load("reference").ToReplay());
            Assert.That(Hash.HashHex(Hash.HashWorld(world)), Is.EqualTo("8faaf6a6"));
        }
    }
}
