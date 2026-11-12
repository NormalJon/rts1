using Rts.Sim;

namespace Rts.Tests
{
    /// <summary>
    /// Saved games. A recorded match is played part of the way, saved, and
    /// played on to the end, so that the world the save was taken from has moved
    /// on. Then the save is loaded into a new world, which must have the
    /// checksum recorded for that moment and for every tick after it.
    /// </summary>
    public class SnapshotTests
    {
        /// <summary>Saves at a tick, loads the save, and checks every later tick against the recording.</summary>
        static void ContinuesFrom(RecordedMatch match, int saveAt)
        {
            World original = Replay.RunReplay(match.ToReplay(), null, saveAt);
            WorldSnapshot saved = Snapshot.TakeSnapshot(original);
            // Play the first world on: nothing it does now may reach into the save.
            while (original.tick < match.ticks) Simulation.Step(original);

            World restored = Snapshot.RestoreSnapshot(saved);
            string straightAfter = Hash.HashHex(Hash.HashWorld(restored));
            Assert.True(
                straightAfter == match.ChecksumAfter(saveAt - 1),
                $"{match.name}: straight after loading a save taken at tick {saveAt} the checksum is {straightAfter}, not {match.ChecksumAfter(saveAt - 1)}");
            // Commands issued after the save still have to be delivered.
            foreach (ScheduledCommand entry in match.commands)
            {
                bool alreadyKnown = saved.pending.Any(p => p.tick == entry.tick && p.player == entry.player && p.seq == entry.seq);
                if (entry.tick >= restored.tick && !alreadyKnown) restored.commands.Schedule(entry, restored.tick);
            }
            while (restored.tick < match.ticks)
            {
                Simulation.Step(restored);
                string checksum = Hash.HashHex(Hash.HashWorld(restored));
                Assert.True(
                    checksum == match.ChecksumAfter(restored.tick - 1),
                    $"{match.name}: saved at tick {saveAt}, the first tick to differ after loading is tick {restored.tick - 1}");
            }
        }

        [Theory]
        [InlineData("reference", new[] { 1, 250, 613, 1180, 1790 })]
        [InlineData("random-first-age", new[] { 900, 2000 })]
        [InlineData("random-hand-drawn", new[] { 1500, 3100 })]
        [InlineData("random-teams", new[] { 700, 1300 })]
        [InlineData("random-crowded", new[] { 400, 1200 })]
        [InlineData("ai-hard-vs-easy", new[] { 12000, 31000 })]
        [InlineData("ai-hard-all-ages", new[] { 50000 })]
        public void ContinuesIdenticallyFromASavedGameTakenMidMatch(string name, int[] saveAt)
        {
            RecordedMatch match = RecordedMatch.Load(name);
            foreach (int tick in saveAt) ContinuesFrom(match, tick);
        }

        [Fact]
        public void ContinuesIdenticallyFromASaveTakenInTheMiddleOfARouteSearch()
        {
            RecordedMatch match = RecordedMatch.Load("reference-starved");
            // Find ticks at which a search was part-way through.
            var midSearch = new List<int>();
            Replay.RunReplay(match.ToReplay(), world =>
            {
                ActiveSearch active = world.activeSearch;
                if (active != null && active.search.expansions > 0 && midSearch.Count < 4)
                {
                    if (midSearch.Count == 0 || world.tick > midSearch[midSearch.Count - 1] + 60) midSearch.Add(world.tick);
                }
            });
            Assert.True(midSearch.Count >= 3, "the starved match should catch searches part-way through");
            foreach (int saveAt in midSearch) ContinuesFrom(match, saveAt);
        }

        [Fact]
        public void ASaveHoldsItsOwnCopyOfEverything()
        {
            RecordedMatch match = RecordedMatch.Load("reference");
            World world = Replay.RunReplay(match.ToReplay(), null, 900);
            WorldSnapshot saved = Snapshot.TakeSnapshot(world);
            World first = Snapshot.RestoreSnapshot(saved);
            // Loading must not use the save up or change it: a second load gives the same world.
            for (int i = 0; i < 300; i++) Simulation.Step(first);
            World second = Snapshot.RestoreSnapshot(saved);
            Assert.Equal(match.ChecksumAfter(899), Hash.HashHex(Hash.HashWorld(second)));
            for (int i = 0; i < 300; i++) Simulation.Step(second);
            Assert.Equal(Hash.HashWorld(first), Hash.HashWorld(second));
            Assert.Equal(match.ChecksumAfter(1199), Hash.HashHex(Hash.HashWorld(second)));
        }
    }
}
