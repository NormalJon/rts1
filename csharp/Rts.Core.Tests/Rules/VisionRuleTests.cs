// Translated from test/vision.test.ts. Keep the two in step.
//
// Where the TypeScript passes a saved game through JSON before loading it,
// the save is loaded as it is: the C# library has no JSON in it.

using Rts.Sim;

namespace Rts.Tests.Rules
{
    public abstract class VisionScenario : Scenario
    {
        protected const int S = Kind.Spearman;
        protected const int A = Kind.Archer;
        protected const int H = Kind.Horseman;
        protected const int V = Kind.Villager;

        /// <summary>A flat map with the fog on, as in a real match.</summary>
        protected static World Foggy(int size = 48, Action<SimConfig> overrides = null)
        {
            return FlatWorld(size, config =>
            {
                config.mapState = MapState.Concealed;
                overrides?.Invoke(config);
            });
        }

        /// <summary>
        /// Runs ticks, checking after each that nothing is broken and that what
        /// each side is counted as seeing matches a count made from scratch.
        /// (Everywhere else that second check is made every tenth tick.)
        /// </summary>
        protected static new int Run(World world, int ticks, Func<bool> done = null)
        {
            for (int i = 0; i < ticks; i++)
            {
                Simulation.Step(world);
                string broken = Helpers.BrokenInvariant(world) ?? Helpers.BrokenVision(world);
                if (broken != null) Assert.Fail($"tick {world.tick}: {broken}");
                if (done != null && done()) return i + 1;
            }
            return ticks;
        }

        protected static int Place(World world, int player, int kind, double x, double y)
        {
            return world.SpawnUnit(player, kind, F(x), F(y));
        }

        protected static int TileOf(World world, double x, double y)
        {
            return (int)Math.Floor(y) * world.map.width + (int)Math.Floor(x);
        }

        protected static bool AtRest(World world, int id)
        {
            return world.moveState[SlotOf(id)] == MoveState.Idle && world.engaged[SlotOf(id)] == 0;
        }

        protected static int Count(ushort[] cells) => cells.Count(cell => cell > 0);

        protected static int Count(byte[] cells) => cells.Count(cell => cell > 0);

        /// <summary>How many tiles have their centre within r and a half tiles of a tile's centre.</summary>
        protected static int DiscSize(int r)
        {
            int n = 0;
            for (int dy = -r; dy <= r; dy++)
            {
                for (int dx = -r; dx <= r; dx++)
                {
                    if (Hypot(dx, dy) <= r + 0.5) n++;
                }
            }
            return n;
        }
    }

    public class WhatASideSees : VisionScenario
    {
        [Fact]
        public void IsADiscRoundEachOfItsUnitsAsWideAsTheUnitSees()
        {
            World world = Foggy();
            Place(world, 0, S, 20.5, 20.5);
            Assert.Equal(8, EntityTypes.ENTITY_TYPES[S].sight);
            Assert.Equal(DiscSize(8), Count(world.seen[0]));
            Assert.True(Vision.Sees(world, 0, TileOf(world, 20, 20)));
            Assert.True(Vision.Sees(world, 0, TileOf(world, 28, 20)));
            Assert.False(Vision.Sees(world, 0, TileOf(world, 29, 20)));
            Assert.True(Vision.Sees(world, 0, TileOf(world, 26, 26)));
            Assert.False(Vision.Sees(world, 0, TileOf(world, 27, 27)));
            Assert.Null(Helpers.BrokenVision(world));
        }

        [Fact]
        public void IsCutOffAtTheEdgeOfTheMapAndNothingGoesWrongThere()
        {
            World world = Foggy();
            Place(world, 0, H, 0.5, 0.5);
            Place(world, 0, H, 47.5, 47.5);
            Assert.Null(Helpers.BrokenVision(world));
            Assert.True(Vision.Sees(world, 0, 0));
            Assert.True(Vision.Sees(world, 0, world.map.tileCount - 1));
            Assert.False(Vision.Sees(world, 0, TileOf(world, 24, 24)));
        }

        [Fact]
        public void MovesWithThemAndWhatTheyLeaveBehindStaysExploredButOutOfSight()
        {
            World world = Foggy();
            int scout = Place(world, 0, H, 8.5, 24.5);
            int start = TileOf(world, 8, 24);
            int ahead = TileOf(world, 34, 24);
            Assert.False(Vision.HasExplored(world, 0, ahead));
            Send(world, 0, Command.Move(Ids(scout), F(34.5), F(24.5)));
            Run(world, 900, () => AtRest(world, scout));
            Assert.True(XOf(world, scout) > 34);
            Assert.True(Vision.Sees(world, 0, ahead));
            Assert.False(Vision.Sees(world, 0, start));
            Assert.True(Vision.HasExplored(world, 0, start));
            // A band twenty-one tiles deep along the whole ride, and nothing far from it.
            Assert.True(Vision.HasExplored(world, 0, TileOf(world, 22, 15)));
            Assert.False(Vision.HasExplored(world, 0, TileOf(world, 22, 36)));
            Assert.Equal(DiscSize(10), Count(world.seen[0]));
            Assert.True(Count(world.explored[0]) > DiscSize(10) + 500);
        }

        [Fact]
        public void IsItsOwnTheEnemySeesNoneOfIt()
        {
            World world = Foggy();
            int mine = Place(world, 0, S, 10.5, 10.5);
            int theirs = Place(world, 1, S, 40.5, 40.5);
            Assert.NotEqual(world.view[1], world.view[0]);
            Assert.True(Vision.CanSee(world, 0, SlotOf(mine)));
            Assert.False(Vision.CanSee(world, 0, SlotOf(theirs)));
            Assert.False(Vision.CanSee(world, 1, SlotOf(mine)));
            Assert.False(Vision.HasExplored(world, 1, TileOf(world, 10, 10)));
        }

        [Fact]
        public void IsSharedWithAllies()
        {
            World world = Foggy(48, config =>
            {
                config.playerCount = 3;
                config.teams = new[] { 0, 1, 0 };
            });
            int friend = Place(world, 2, S, 40.5, 8.5);
            int foe = Place(world, 1, S, 42.5, 8.5);
            Assert.Equal(world.view[0], world.view[2]);
            Assert.Equal(2, world.seen.Count);
            Assert.True(Vision.CanSee(world, 0, SlotOf(foe)));
            Assert.True(Vision.Sees(world, 0, TileOf(world, 40, 8)));
            Assert.True(Vision.CanSee(world, 1, SlotOf(friend)));
        }

        [Fact]
        public void EndsWithTheUnitTheDeadSeeNothingThoughWhatTheySawStaysExplored()
        {
            World world = Foggy();
            int scout = Place(world, 0, S, 20.5, 20.5);
            world.Destroy(scout);
            Assert.Equal(0, Count(world.seen[0]));
            Assert.Equal(DiscSize(8), Count(world.explored[0]));
            Assert.Null(Helpers.BrokenVision(world));
        }

        [Fact]
        public void IsLittleForABuildingSiteAndItsFullRangeOnceTheBuildingIsFinished()
        {
            World world = Foggy();
            new[] { 0, 500, 500, 0 }.CopyTo(world.stock, 0);
            int builder = Place(world, 0, V, 20.5, 20.5);
            Send(world, 0, Command.Build(Ids(builder), Kind.Watchtower, 24, 20));
            Run(world, 30);
            int far = TileOf(world, 36, 20);
            Assert.False(Vision.Sees(world, 0, far));
            int tower = world.LivingEntities(0).First(id => world.mobile[SlotOf(id)] == 0);
            Assert.Equal(3, world.sightRadius[SlotOf(tower)]);
            Run(world, 3000, () => world.built[SlotOf(tower)] == 1);
            Run(world, 2);
            Assert.Equal(13, world.sightRadius[SlotOf(tower)]);
            Assert.True(Vision.Sees(world, 0, far));
        }

        [Fact]
        public void TakesInABuildingWhenAnyPartOfItIsInView()
        {
            World world = Foggy();
            int barracks = world.SpawnBuilding(1, Kind.Barracks, 30, 20);
            Place(world, 0, S, 19.5, 20.5); // sees as far as x = 27; the barracks covers 28 to 32
            Assert.False(Vision.CanSee(world, 0, SlotOf(barracks)));
            Place(world, 0, S, 20.5, 20.5); // sees as far as x = 28: one edge
            Assert.True(Vision.CanSee(world, 0, SlotOf(barracks)));
        }
    }

    public class TheMapToBeginWith : VisionScenario
    {
        [Fact]
        public void IsUnknownInTheUsualGameApartFromWhatTheStartingUnitsSee()
        {
            var world = new World(new SimConfig { seed = 3, map = MapSpec.Generated(), start = StartKind.Standard });
            Assert.Equal(MapState.Concealed, world.config.mapState);
            StartPosition home = world.map.starts[0];
            StartPosition there = world.map.starts[1];
            Assert.True(Vision.Sees(world, 0, world.map.TileAt(home.x, home.y)));
            Assert.False(Vision.HasExplored(world, 0, world.map.TileAt(there.x, there.y)));
            Assert.True(Vision.HasExplored(world, 1, world.map.TileAt(there.x, there.y)));
            Assert.True(Count(world.explored[0]) < world.map.tileCount >> 2);
        }

        [Fact]
        public void CanBeExploredFromTheStartWithOnlyTheEnemyStillHidden()
        {
            World world = Foggy(48, config => config.mapState = MapState.Explored);
            int theirs = Place(world, 1, S, 40.5, 40.5);
            Place(world, 0, S, 8.5, 8.5);
            Assert.True(Vision.HasExplored(world, 0, TileOf(world, 40, 40)));
            Assert.False(Vision.Sees(world, 0, TileOf(world, 40, 40)));
            Assert.False(Vision.CanSee(world, 0, SlotOf(theirs)));
            Assert.True(Buildings.CanPlace(world, Kind.House, 40, 30, 0));
        }

        [Fact]
        public void CanBeRevealedAndThenNothingIsHiddenFromAnyone()
        {
            World world = Foggy(48, config => config.mapState = MapState.Revealed);
            int theirs = Place(world, 1, S, 40.5, 40.5);
            Assert.True(Vision.Sees(world, 0, TileOf(world, 40, 40)));
            Assert.True(Vision.HasExplored(world, 0, 0));
            Assert.True(Vision.CanSee(world, 0, SlotOf(theirs)));
        }
    }

    public class WhatTheFogForbids : VisionScenario
    {
        [Fact]
        public void AnAttackCannotBeOrderedOnAUnitNobodyOnTheSideCanSee()
        {
            World world = Foggy();
            int archer = Place(world, 0, A, 8.5, 24.5);
            int prey = Place(world, 1, V, 30.5, 24.5);
            Send(world, 0, Command.Attack(Ids(archer), prey));
            Run(world, 60);
            Assert.Equal(OrderKind.None, world.orderKind[SlotOf(archer)]);
            Assert.Equal(8.5, XOf(world, archer));
            // A scout who can see the villager makes all the difference.
            Place(world, 0, H, 24.5, 30.5);
            Send(world, 0, Command.Attack(Ids(archer), prey));
            Run(world, 5);
            Assert.Equal(OrderKind.AttackTarget, world.orderKind[SlotOf(archer)]);
            Assert.Equal(prey, world.target[SlotOf(archer)]);
        }

        [Fact]
        public void ABuildingCanBeAttackedFromMemoryButNotOneOnGroundNeverSeen()
        {
            World world = Foggy(64);
            int seenOnce = world.SpawnBuilding(1, Kind.House, 30, 20);
            int neverSeen = world.SpawnBuilding(1, Kind.House, 55, 55);
            int spear = Place(world, 0, S, 24.5, 20.5);
            Send(world, 0, Command.Move(Ids(spear), F(8.5), F(20.5)));
            Run(world, 900, () => AtRest(world, spear));
            Assert.False(Vision.CanSee(world, 0, SlotOf(seenOnce)));
            Send(world, 0, Command.Attack(Ids(spear), neverSeen));
            Run(world, 5);
            Assert.Equal(World.NO_ENTITY, world.target[SlotOf(spear)]);
            Send(world, 0, Command.Attack(Ids(spear), seenOnce));
            Run(world, 5);
            Assert.Equal(seenOnce, world.target[SlotOf(spear)]);
            Run(world, 6000, () => !world.IsAlive(seenOnce));
            Assert.False(world.IsAlive(seenOnce));
        }

        [Fact]
        public void ASoldierGivesUpAQuarryThatGetsCleanOutOfSight()
        {
            World world = Foggy(100);
            int spear = Place(world, 0, S, 10.5, 50.5);
            int rider = Place(world, 1, H, 14.5, 50.5);
            Send(world, 1, Command.Move(Ids(rider), F(95.5), F(50.5)));
            Send(world, 0, Command.Attack(Ids(spear), rider));
            bool chased = false;
            Run(world, 2400, () =>
            {
                chased = chased || world.target[SlotOf(spear)] == rider;
                return chased && AtRest(world, spear) && world.target[SlotOf(spear)] == World.NO_ENTITY;
            });
            Assert.True(chased);
            Assert.True(world.IsAlive(rider));
            Assert.Equal(OrderKind.None, world.orderKind[SlotOf(spear)]);
            // It stopped where it lost sight of him, far short of where he went.
            Assert.True(XOf(world, spear) < 60);
            Assert.True(XOf(world, spear) > 12);
        }

        [Fact]
        public void NothingCanBeFoundedOnGroundTheSideHasNeverSeen()
        {
            World world = Foggy();
            new[] { 0, 500, 0, 0 }.CopyTo(world.stock, 0);
            int builder = Place(world, 0, V, 10.5, 10.5);
            Assert.True(Buildings.CanPlace(world, Kind.House, 36, 36)); // the ground itself is fine
            Assert.False(Buildings.CanPlace(world, Kind.House, 36, 36, 0));
            Send(world, 0, Command.Build(Ids(builder), Kind.House, 36, 36));
            Run(world, 5);
            Assert.Single(world.LivingEntities());
            Assert.Equal(500, world.stock[1]);
            // One corner of the plot unseen is enough to refuse it.
            Assert.True(Buildings.CanPlace(world, Kind.House, 16, 10, 0));
            Assert.False(Buildings.CanPlace(world, Kind.House, 17, 10, 0));
            Send(world, 0, Command.Build(Ids(builder), Kind.House, 16, 10));
            Run(world, 5);
            Assert.Equal(2, world.LivingEntities().Count);
        }

        [Fact]
        public void GuardsStillDealWithWhateverComesIntoView()
        {
            World world = Foggy();
            int guard = Place(world, 0, S, 10.5, 24.5);
            int raider = Place(world, 1, V, 30.5, 24.5);
            Send(world, 1, Command.Move(Ids(raider), F(13.5), F(24.5)));
            Run(world, 2400, () => !world.IsAlive(raider));
            Assert.False(world.IsAlive(raider));
            Assert.True(world.IsAlive(guard));
        }
    }

    public class TheFogAndTheRecord : VisionScenario
    {
        [Fact]
        public void IsPartOfTheChecksumTheSameWorldWithMoreExploredIsADifferentWorld()
        {
            World concealed = Foggy();
            World explored = Foggy(48, config => config.mapState = MapState.Explored);
            foreach (World world in new[] { concealed, explored }) Place(world, 0, S, 20.5, 20.5);
            Assert.NotEqual(Hash.HashWorld(explored), Hash.HashWorld(concealed));
        }

        [Fact]
        public void ComesBackFromASavedGameExactlySeenAndExploredBoth()
        {
            World world = Foggy(64, config =>
            {
                config.playerCount = 3;
                config.teams = new[] { 0, 1, 0 };
            });
            int[] riders = { Place(world, 0, H, 8.5, 8.5), Place(world, 1, H, 56.5, 56.5), Place(world, 2, H, 8.5, 56.5) };
            Send(world, 0, Command.Move(Ids(riders[0]), F(50.5), F(12.5)));
            Send(world, 1, Command.Move(Ids(riders[1]), F(12.5), F(40.5)));
            Send(world, 2, Command.Move(Ids(riders[2]), F(30.5), F(30.5)));
            Run(world, 200);
            WorldSnapshot saved = Snapshot.TakeSnapshot(world);
            // Runs of unexplored and explored tiles, far shorter than a number per tile.
            Assert.Equal(2, saved.explored.Length);
            Assert.True(saved.explored[0].Length < 400);
            Assert.Equal(world.map.tileCount, saved.explored[0].Sum());
            World restored = Snapshot.RestoreSnapshot(saved);
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
            for (int view = 0; view < 2; view++)
            {
                Assert.Equal(world.seen[view], restored.seen[view]);
                Assert.Equal(world.explored[view], restored.explored[view]);
            }
            for (int i = 0; i < 400; i++)
            {
                Simulation.Step(world);
                Simulation.Step(restored);
                if (Hash.HashWorld(restored) != Hash.HashWorld(world)) Assert.Fail($"diverged {i + 1} ticks after loading");
            }
            Assert.Null(Helpers.BrokenVision(restored));
        }

        [Fact]
        public void KeepsCountThroughACrowdOnTheMoveBirthsAndDeaths()
        {
            World world = Foggy(64);
            world.SpawnBuilding(0, Kind.TownCentre, 12, 12);
            world.SpawnBuilding(1, Kind.TownCentre, 52, 52);
            var a = new int[12];
            var b = new int[12];
            int[] kinds = { S, A, H };
            for (int i = 0; i < 12; i++)
            {
                a[i] = Place(world, 0, kinds[i % 3], 16.5 + (i % 4), 16.5 + (i >> 2));
                b[i] = Place(world, 1, kinds[i % 3], 46.5 + (i % 4), 46.5 + (i >> 2));
            }
            Send(world, 0, Command.AttackMove(a, F(48.5), F(48.5)));
            Send(world, 1, Command.AttackMove(b, F(16.5), F(16.5)));
            // Run() checks the counts against a fresh count after every tick.
            Run(world, 1500);
            Assert.True(world.LivingUnits().Count < 24);
        }
    }
}
