// Translated from test/determinism.test.ts. Keep the two in step.
//
// The TypeScript tests play their matches with playRandomMatch. Here the
// matches it played are read from recordings/ instead, so the tests that are
// about the random player itself have nothing to translate. Where each
// TypeScript test went:
//
//   produces the same checksum on every tick when played twice   here
//   actually exercises the simulation                            here, over the recorded matches
//   never leaves a unit in an obstacle or a group miscounted      InvariantTests
//   rebuilds the match exactly from its replay                    ReplayTests
//   rebuilds the match from a replay that has been through JSON   ReplayTests (the recordings are JSON)
//   does not care what order commands arrive in                   here
//   continues identically from a saved game taken mid-match       SnapshotTests
//   continues identically from a save taken mid route search      SnapshotTests
//   diverges when anything about the inputs differs               here
//   matches the recorded checksum for the reference match         ReplayTests
//   world bookkeeping (four tests)                                WorldTests

using Rts.Sim;

namespace Rts.Tests.Rules
{
    public class Determinism
    {
        static List<uint> ChecksumsOf(Replay replay)
        {
            var hashes = new List<uint>();
            Replay.RunReplay(replay, world => hashes.Add(Hash.HashWorld(world)));
            return hashes;
        }

        [Fact]
        public void ProducesTheSameChecksumOnEveryTickWhenTheSameMatchIsPlayedTwice()
        {
            RecordedMatch match = RecordedMatch.Load("reference");
            List<uint> first = ChecksumsOf(match.ToReplay());
            List<uint> second = ChecksumsOf(match.ToReplay());
            Assert.Equal(match.ticks, first.Count);
            Assert.Equal(first, second);
        }

        [Fact]
        public void ActuallyExercisesTheSimulation()
        {
            // Tally what went on, tick by tick. The TypeScript plays the reference
            // match and two others like it (the random player's seeds 77, 78 and
            // 79). Only the first of those is recorded, so the tally here is over
            // the reference match and the two recorded random matches that have
            // towns and soldiers of other ages: any one match can happen to be
            // short of something; three together never are.
            long harvesting = 0;
            long constructing = 0;
            int mostBuildings = 0;
            int mostQueued = 0;
            long striking = 0;
            long arrows = 0;
            long fighting = 0;
            long deaths = 0;
            long spentOnUnits = 0;
            long unexplored = 0;
            long explored = 0;
            long researching = 0;
            long researched = 0;
            var kindsUsed = new HashSet<CommandKind>();
            bool queuedMoves = false;
            foreach (string name in new[] { "reference", "random-first-age", "random-hand-drawn" })
            {
                RecordedMatch match = RecordedMatch.Load(name);
                var hashes = new HashSet<uint>();
                World world = Replay.RunReplay(match.ToReplay(), after =>
                {
                    hashes.Add(Hash.HashWorld(after));
                    int buildings = 0;
                    arrows += after.shotCount;
                    for (int slot = 0; slot < after.highWater; slot++)
                    {
                        if (after.alive[slot] == 0) continue;
                        if (after.job[slot] == Job.Harvesting) harvesting++;
                        if (after.job[slot] == Job.Constructing) constructing++;
                        if (after.windup[slot] > 0) striking++;
                        if (after.engaged[slot] == 1) fighting++;
                        if (after.mobile[slot] == 0)
                        {
                            buildings++;
                            mostQueued = Math.Max(mostQueued, after.trainLength[slot]);
                            if (after.trainLength[slot] > 0 && after.trainQueue[slot * EntityTypes.TRAIN_QUEUE_LENGTH] >= Techs.QUEUED_TECH) researching++;
                        }
                    }
                    mostBuildings = Math.Max(mostBuildings, buildings);
                });
                Assert.True(hashes.Count > match.ticks - 30, $"{name}: only {hashes.Count} different checksums in {match.ticks} ticks");
                Assert.True(match.commands.Count > 100, name);
                foreach (ScheduledCommand entry in match.commands)
                {
                    kindsUsed.Add(entry.command.kind);
                    if (entry.command.kind == CommandKind.Move && entry.command.queue) queuedMoves = true;
                }
                Assert.True(world.LivingEntities().Count > 20, name);
                for (int slot = 0; slot < world.highWater; slot++) deaths += world.generation[slot];
                spentOnUnits += world.spent[0] + world.spent[4]; // food
                for (int i = 0; i < world.researched.Length; i++) researched += world.researched[i];
                // What each side found out is only a question where the map starts hidden.
                if (match.config.mapState != MapState.Concealed) continue;
                foreach (byte[] side in world.explored)
                {
                    for (int tile = 0; tile < side.Length; tile++)
                    {
                        if (side[tile] == 1) explored++;
                        else unexplored++;
                    }
                }
            }
            Assert.True(queuedMoves);
            CommandKind[] kinds =
            {
                CommandKind.Gather, CommandKind.Deliver, CommandKind.Build, CommandKind.Construct, CommandKind.Train,
                CommandKind.CancelTrain, CommandKind.Rally, CommandKind.Demolish, CommandKind.Attack, CommandKind.AttackMove,
                CommandKind.Patrol, CommandKind.Hold, CommandKind.Stop, CommandKind.Research,
            };
            foreach (CommandKind kind in kinds) Assert.True(kindsUsed.Contains(kind), kind.ToString());
            string tally =
                $"harvesting {harvesting}, constructing {constructing}, mostBuildings {mostBuildings}, mostQueued {mostQueued}, " +
                $"spentOnUnits {spentOnUnits}, fighting {fighting}, striking {striking}, arrows {arrows}, deaths {deaths}, " +
                $"researching {researching}, researched {researched}, explored {explored}, unexplored {unexplored}";
            // Villagers gathered and built, sites were founded, units were queued and paid for.
            Assert.True(harvesting > 900, tally);
            Assert.True(constructing > 900, tally);
            Assert.True(mostBuildings > 2, tally);
            Assert.True(mostQueued > 0, tally);
            Assert.True(spentOnUnits > 0, tally);
            // Soldiers fought, arrows flew, and some of both sides did not come back.
            Assert.True(fighting > 9000, tally);
            Assert.True(striking > 3000, tally);
            Assert.True(arrows > 600, tally);
            Assert.True(deaths > 20, tally);
            // Buildings spent time on research, and some of it was finished.
            Assert.True(researching > 500, tally);
            Assert.True(researched > 0, tally);
            // Each side found out a good deal of the map, and neither found out all of it.
            Assert.True(explored > unexplored, tally);
            Assert.True(unexplored > 2000, tally);
        }

        [Fact]
        public void DoesNotCareWhatOrderCommandsArriveIn()
        {
            RecordedMatch match = RecordedMatch.Load("reference");
            var shuffled = new List<ScheduledCommand>(match.commands);
            var shuffler = new Rng(5);
            for (int i = shuffled.Count - 1; i > 0; i--)
            {
                int j = (int)shuffler.NextInt(i + 1);
                (shuffled[i], shuffled[j]) = (shuffled[j], shuffled[i]);
            }
            Assert.False(shuffled.SequenceEqual(match.commands));
            World world = Replay.RunReplay(new Replay { config = match.config.Clone(), ticks = match.ticks, commands = shuffled });
            Assert.Equal(match.ChecksumAfter(match.ticks - 1), Hash.HashHex(Hash.HashWorld(world)));
        }

        [Fact]
        public void DivergesWhenAnythingAboutTheInputsDiffers()
        {
            RecordedMatch match = RecordedMatch.Load("reference");
            string final = match.ChecksumAfter(match.ticks - 1);

            // (In the TypeScript the random player plays again on the other map. Here the same orders are given on it.)
            SimConfig otherSeed = match.config.Clone();
            otherSeed.seed = match.config.seed + 1;
            World elsewhere = Replay.RunReplay(new Replay { config = otherSeed, ticks = match.ticks, commands = match.commands });
            Assert.NotEqual(final, Hash.HashHex(Hash.HashWorld(elsewhere)));

            ScheduledCommand lastMove = match.commands.FindLast(
                c => c.command.kind == CommandKind.Move && c.command.units.Length > 0 && c.tick < match.ticks - 120);
            Assert.NotNull(lastMove);
            List<ScheduledCommand> dropped = match.commands.Where(c => c != lastMove).ToList();
            Assert.Equal(match.commands.Count - 1, dropped.Count);
            World without = Replay.RunReplay(new Replay { config = match.config.Clone(), ticks = match.ticks, commands = dropped });
            Assert.NotEqual(final, Hash.HashHex(Hash.HashWorld(without)));
        }
    }
}
