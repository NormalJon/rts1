// Translated from test/commands.test.ts. Keep the two in step.

using Rts.Sim;
using static Rts.Sim.Fixed;

namespace Rts.Tests.Rules
{
    public class TheCommandQueue
    {
        static ScheduledCommand Stop(int tick, int player, int seq)
        {
            return new ScheduledCommand(tick, player, seq, Command.Stop(new int[0]));
        }

        [Fact]
        public void OrdersCommandsWithinATickByPlayerThenBySequence()
        {
            var queue = new CommandQueue();
            queue.Schedule(Stop(5, 1, 1), 0);
            queue.Schedule(Stop(5, 0, 2), 0);
            queue.Schedule(Stop(5, 1, 0), 0);
            queue.Schedule(Stop(5, 0, 0), 0);
            queue.Schedule(Stop(6, 0, 3), 0);
            Assert.Equal(5, queue.size);
            Assert.Equal(
                new[] { (0, 0), (0, 2), (1, 0), (1, 1) },
                queue.TakeDue(5).Select(c => (c.player, c.seq)).ToArray());
            Assert.Equal(1, queue.size);
            Assert.Empty(queue.TakeDue(5));
        }

        [Fact]
        public void RejectsACommandForATickThatHasAlreadyRun()
        {
            var queue = new CommandQueue();
            Assert.Contains("too late", Assert.Throws<ArgumentOutOfRangeException>(() => queue.Schedule(Stop(9, 0, 0), 10)).Message);
            queue.Schedule(Stop(10, 0, 0), 10);
        }

        [Fact]
        public void RejectsTheSameCommandDeliveredTwice()
        {
            var queue = new CommandQueue();
            queue.Schedule(Stop(3, 0, 0), 0);
            Assert.Contains("duplicate", Assert.Throws<InvalidOperationException>(() => queue.Schedule(Stop(3, 0, 0), 0)).Message);
        }

        [Fact]
        public void ListsWaitingCommandsInTheOrderTheyWillRun()
        {
            var queue = new CommandQueue();
            queue.Schedule(Stop(8, 1, 0), 0);
            queue.Schedule(Stop(2, 1, 1), 0);
            queue.Schedule(Stop(2, 0, 0), 0);
            Assert.Equal(
                new[] { (2, 0), (2, 1), (8, 1) },
                queue.Pending().Select(c => (c.tick, c.player)).ToArray());
        }
    }

    public class ApplyingCommands
    {
        World world;
        int mine;
        int theirs;
        int nextSeq = 0;

        void Setup()
        {
            world = new World(new SimConfig());
            mine = world.SpawnUnit(0, Kind.Spearman, FromInt(10), FromInt(10));
            theirs = world.SpawnUnit(1, Kind.Spearman, FromInt(20), FromInt(20));
        }

        void Send(World world, int player, Command command)
        {
            world.commands.Schedule(new ScheduledCommand(world.tick, player, nextSeq++, command), world.tick);
        }

        static void Run(World world, int ticks)
        {
            for (int i = 0; i < ticks; i++) Simulation.Step(world);
        }

        [Fact]
        public void RunsACommandOnExactlyTheTickItIsStampedWith()
        {
            Setup();
            world.commands.Schedule(
                new ScheduledCommand(3, 0, 0, Command.Move(new[] { mine }, FromInt(30), FromInt(10))),
                world.tick);
            int slot = World.EntityIndex(mine);
            Run(world, 3);
            Assert.Equal(FromInt(10), world.posX[slot]); // ticks 0, 1, 2: nothing yet
            Simulation.Step(world);
            Assert.True(world.posX[slot] > FromInt(10)); // tick 3: moving
        }

        [Fact]
        public void MovesAUnitToItsDestinationAndStopsItThere()
        {
            Setup();
            Send(world, 0, Command.Move(new[] { mine }, FromInt(13), FromInt(14)));
            int slot = World.EntityIndex(mine);
            // 5 tiles at 1.6 tiles per second is just under 94 ticks.
            Run(world, 90);
            Assert.NotEqual(MoveState.Idle, world.moveState[slot]);
            Run(world, 6);
            Assert.Equal(MoveState.Idle, world.moveState[slot]);
            Assert.Equal(FromInt(13), world.posX[slot]);
            Assert.Equal(FromInt(14), world.posY[slot]);
        }

        [Fact]
        public void TurnsAUnitToFaceTheWayItWalks()
        {
            Setup();
            Send(world, 0, Command.Move(new[] { mine }, FromInt(10), FromInt(4)));
            Run(world, 5);
            int slot = World.EntityIndex(mine);
            Assert.Equal(0, world.dirX[slot]);
            Assert.Equal(-ONE, world.dirY[slot]);
        }

        [Fact]
        public void IgnoresOrdersForAnotherPlayersUnits()
        {
            Setup();
            Send(world, 0, Command.Move(new[] { theirs }, 0, 0));
            Run(world, 2);
            Assert.Equal(MoveState.Idle, world.moveState[World.EntityIndex(theirs)]);
            Assert.Equal(FromInt(20), world.posX[World.EntityIndex(theirs)]);
        }

        [Fact]
        public void IgnoresHandlesToUnitsThatNoLongerExist()
        {
            Setup();
            world.Destroy(mine);
            int replacement = world.SpawnUnit(0, Kind.Spearman, FromInt(10), FromInt(10));
            Send(world, 0, Command.Move(new[] { mine }, 0, 0));
            Run(world, 2);
            Assert.Equal(MoveState.Idle, world.moveState[World.EntityIndex(replacement)]);
        }

        [Fact]
        public void StopsUnitsWhereTheyStandAndForgetsTheirWaypoints()
        {
            Setup();
            Send(world, 0, Command.Move(new[] { mine }, FromInt(40), FromInt(10)));
            Send(world, 0, Command.Move(new[] { mine }, FromInt(40), FromInt(40), queue: true));
            Run(world, 10);
            int slot = World.EntityIndex(mine);
            Assert.Equal(1, world.queueLength[slot]);
            Send(world, 0, Command.Stop(new[] { mine }));
            Simulation.Step(world);
            int x = world.posX[slot];
            Run(world, 10);
            Assert.Equal(x, world.posX[slot]);
            Assert.Equal(MoveState.Idle, world.moveState[slot]);
            Assert.Equal(0, world.queueLength[slot]);
        }

        [Fact]
        public void KeepsDestinationsAndSpawnPointsOnTheMap()
        {
            Setup();
            Send(world, 0, Command.Move(new[] { mine }, FromInt(-500), FromInt(9000)));
            Send(world, 0, Command.Spawn(FromInt(-50), FromInt(-50), 30, 0));
            Simulation.Step(world);
            foreach (int id in world.LivingEntities())
            {
                int slot = World.EntityIndex(id);
                foreach (int x in new[] { world.posX[slot], world.goalX[slot] })
                {
                    Assert.True(x >= 0);
                    Assert.True(x <= world.map.maxX);
                }
                foreach (int y in new[] { world.posY[slot], world.goalY[slot] })
                {
                    Assert.True(y >= 0);
                    Assert.True(y <= world.map.maxY);
                }
            }
        }

        [Fact]
        public void GivesEachUnitOfAGroupItsOwnPlaceInABlockFacingTheWayTheyTravel()
        {
            var world = new World(new SimConfig());
            Send(world, 0, Command.Spawn(FromInt(30), FromInt(30), 9, 0));
            Simulation.Step(world);
            int[] units = world.LivingEntities(0).ToArray();
            Send(world, 0, Command.Move(units, FromInt(30), FromInt(10)));
            Simulation.Step(world);
            (int x, int y)[] goals = units.Select(id =>
            {
                int slot = World.EntityIndex(id);
                return (world.goalX[slot], world.goalY[slot]);
            }).ToArray();
            // Nine units make a front rank of five and a second rank of four. The
            // block faces north, so the ranks are the two clusters of y values.
            double[] ys = goals.Select(goal => ToFloat(goal.y)).OrderBy(y => y).ToArray();
            Assert.True(ys[4] - ys[0] < 0.2);
            Assert.True(ys[8] - ys[5] < 0.2);
            Assert.True(ys[5] - ys[4] > 0.4);
            // No two places are closer than the formation spacing.
            for (int a = 0; a < goals.Length; a++)
            {
                for (int b = a + 1; b < goals.Length; b++)
                {
                    double apart = ToFloat(Length(goals[a].x - goals[b].x, goals[a].y - goals[b].y));
                    Assert.True(apart > 0.59);
                }
            }
            Assert.Equal(1, world.groups.Count);
        }

        [Fact]
        public void SurvivesMalformedCommandsWithoutChangingAnything()
        {
            Setup();
            var untouched = new World(new SimConfig());
            untouched.SpawnUnit(0, Kind.Spearman, FromInt(10), FromInt(10));
            untouched.SpawnUnit(1, Kind.Spearman, FromInt(20), FromInt(20));

            // The TypeScript sends ten pieces of nonsense. A command here has typed
            // fields, so text where a number should be, a fraction, "not a number"
            // and a command that is not a command at all cannot be written down.
            // What can be: a missing list, handles that are negative or far out of
            // range, a unit type that does not exist, a kind of command that does
            // not exist, and no command at all.
            var garbage = new[]
            {
                Command.Move(null, 1, 1),
                Command.Move(new[] { -3, int.MaxValue, int.MinValue, 1 << 30 }, int.MinValue, int.MaxValue),
                Command.Move(new int[0], 5, 5),
                Command.Stop(null),
                Command.Spawn(0, 0, 0, -5),
                Command.Spawn(0, 0, 5, 99),
                new Command { kind = (CommandKind)99, units = new[] { 0 } },
                null,
            };
            foreach (Command command in garbage) Send(world, 0, command);
            Send(world, 9, Command.Stop(new int[0])); // no such player
            Send(world, -1, Command.Stop(new int[0]));
            Simulation.Step(world);
            Simulation.Step(untouched);
            Assert.Equal(Hash.HashWorld(untouched), Hash.HashWorld(world));
        }
    }

    public class TickRateIndependence
    {
        [Fact]
        public void CoversTheSameGroundInTheSameTimeAtAnyTickRate()
        {
            foreach (int tickRate in new[] { 8, 20, 30, 60 })
            {
                var world = new World(new SimConfig { tickRate = tickRate });
                int id = world.SpawnUnit(0, Kind.Spearman, FromInt(10), FromInt(10));
                world.commands.Schedule(
                    new ScheduledCommand(0, 0, 0, Command.Move(new[] { id }, FromInt(50), FromInt(10))),
                    0);
                for (int i = 0; i < tickRate * 5; i++) Simulation.Step(world); // five seconds
                double travelled = ToFloat(world.posX[World.EntityIndex(id)]) - 10;
                // A spearman covers 1.6 tiles a second.
                Assert.True(Math.Abs(travelled - 8) < 0.01, $"at {tickRate} ticks per second");
            }
        }
    }
}
