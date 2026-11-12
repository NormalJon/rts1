using Rts.Sim;

namespace Rts.Tests
{
    /// <summary>
    /// The world's own bookkeeping, as in the "world bookkeeping" tests of
    /// test/determinism.test.ts in the TypeScript.
    /// </summary>
    public class WorldTests
    {
        static int At(int n) => Fixed.FromInt(n);

        [Fact]
        public void ReusesSlotsSafelyAndInvalidatesStaleHandles()
        {
            var world = new World(new SimConfig());
            int a = world.SpawnUnit(0, Kind.Spearman, At(3), At(3));
            int b = world.SpawnUnit(0, Kind.Spearman, At(6), At(3));
            world.Destroy(a);
            Assert.False(world.IsAlive(a));
            Assert.True(world.IsAlive(b));
            int c = world.SpawnUnit(1, Kind.Villager, At(5), At(5));
            Assert.NotEqual(a, c);
            Assert.True(world.IsAlive(c));
            Assert.False(world.IsAlive(a));
            Assert.Equal(new[] { c, b }, world.LivingEntities().ToArray());
            Assert.Equal(new[] { c }, world.LivingEntities(1).ToArray());
            Assert.Equal(new[] { c, b }, world.LivingUnits().ToArray());
        }

        [Fact]
        public void SavesAndRestoresFreeSlotsAndGenerations()
        {
            var world = new World(new SimConfig());
            var ids = new List<int>();
            for (int i = 0; i < 10; i++) ids.Add(world.SpawnUnit(i % 2, i % 2, At(2 + i * 3), At(4)));
            world.Destroy(ids[3]);
            world.Destroy(ids[7]);
            World restored = Snapshot.RestoreSnapshot(Snapshot.TakeSnapshot(world));
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
            // Both worlds must hand out the same handle next.
            Assert.Equal(world.SpawnUnit(0, 0, At(9), At(9)), restored.SpawnUnit(0, 0, At(9), At(9)));
            Assert.False(restored.IsAlive(ids[3]));
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
        }

        [Fact]
        public void ReleasesADeadUnitsClaimOnItsGroup()
        {
            var world = new World(new SimConfig());
            int a = world.SpawnUnit(0, 0, At(10), At(10));
            int b = world.SpawnUnit(0, 0, At(11), At(10));
            world.commands.Schedule(new ScheduledCommand(0, 0, 0, Command.Move(new[] { a, b }, At(40), At(40))), 0);
            Simulation.Step(world);
            Assert.Equal(1, world.groups.Count);
            Assert.Equal(2, world.groups.Values[0].refs);
            world.Destroy(a);
            Assert.Equal(1, world.groups.Values[0].refs);
            Assert.Null(Helpers.BrokenInvariant(world));
            world.Destroy(b);
            Assert.Equal(0, world.groups.Count);
        }

        [Fact]
        public void ReportsAFullWorldInsteadOfOverflowing()
        {
            var world = new World(new SimConfig { maxEntities = 2 });
            Assert.True(world.SpawnUnit(0, 0, At(1), At(1)) >= 0);
            Assert.True(world.SpawnUnit(0, 0, At(2), At(1)) >= 0);
            Assert.Equal(World.NO_ENTITY, world.SpawnUnit(0, 0, At(3), At(1)));
        }

        [Fact]
        public void RefusesSettingsTheTypeScriptRefuses()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => new World(new SimConfig { tickRate = 0 }));
            Assert.Throws<ArgumentOutOfRangeException>(() => new World(new SimConfig { tickRate = 121 }));
            Assert.Throws<ArgumentOutOfRangeException>(() => new World(new SimConfig { playerCount = 9 }));
            Assert.Throws<ArgumentOutOfRangeException>(() => new World(new SimConfig { mapWidth = 1025 }));
            Assert.Throws<ArgumentOutOfRangeException>(() => new World(new SimConfig { startAge = 4 }));
            Assert.Throws<ArgumentOutOfRangeException>(() => new World(new SimConfig { pathBudget = 0 }));
            Assert.Throws<ArgumentOutOfRangeException>(() => new World(new SimConfig { maxEntities = 0 }));
            // A generated map needs room, and a hand-drawn one must be the size it says.
            Assert.Throws<ArgumentOutOfRangeException>(() => new World(new SimConfig { mapWidth = 40, mapHeight = 40, map = MapSpec.Generated() }));
            Assert.Throws<ArgumentException>(() => new World(new SimConfig { mapWidth = 3, mapHeight = 1, map = MapSpec.Ascii(new[] { "0." }) }));
            // A command for a tick that has already run can never be applied the same way everywhere.
            var world = new World(new SimConfig());
            Simulation.Step(world);
            Assert.Throws<ArgumentOutOfRangeException>(() => world.commands.Schedule(new ScheduledCommand(0, 0, 0, Command.Stop(new int[0])), world.tick));
        }
    }
}
