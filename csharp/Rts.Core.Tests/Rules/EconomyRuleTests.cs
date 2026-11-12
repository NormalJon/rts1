// Translated from test/economy.test.ts. Keep the two in step.
//
// Where the TypeScript passes a saved game through JSON before loading it,
// the save is loaded as it is: the C# library has no JSON in it.

using Rts.Sim;

namespace Rts.Tests.Rules
{
    public abstract class EconomyScenario : Scenario
    {
        protected static int Villager(World world, double x, double y, int player = 0)
        {
            return world.SpawnUnit(player, Kind.Villager, F(x), F(y));
        }

        protected static int Stock(World world, int resource, int player = 0) => world.stock[player * 4 + resource];

        protected static int[] StockOf(World world, int player) => world.stock.Skip(player * 4).Take(4).ToArray();

        protected static int JobOf(World world, int id) => world.job[SlotOf(id)];

        protected static int CarryOf(World world, int id) => world.carry[SlotOf(id)];

        /// <summary>Gathers from a tile until only `left` units remain, so a test need not wait for the whole tile.</summary>
        protected static void ThinOut(World world, int tile, int left)
        {
            while (world.map.amount[tile] > left) world.map.Harvest(tile);
        }

        //   0123456789012345
        protected static readonly string[] YARD =
        {
            "................",
            "................",
            "..T.............",
            "................",
            "................",
            "................",
            "..........bb....",
            "................",
            "................",
            "................",
        };

        /// <summary>The yard with a town centre at (8, 3).</summary>
        protected static (World world, int hall, int tree) Yard()
        {
            World world = WorldFrom(YARD);
            int hall = world.SpawnBuilding(0, Kind.TownCentre, 8, 3);
            return (world, hall, world.map.Index(2, 2));
        }
    }

    public class Gathering : EconomyScenario
    {
        [Fact]
        public void FillsALoadHandsItInAtTheTownCentreAndGoesBackForMore()
        {
            (World world, _, int tree) = Yard();
            int worker = Villager(world, 4.5, 4.5);
            Send(world, 0, Command.Gather(Ids(worker), tree));
            var stages = new List<int>();
            int mostCarried = 0;
            Run(world, 2400, () =>
            {
                int job = JobOf(world, worker);
                if (stages.Count == 0 || stages[stages.Count - 1] != job) stages.Add(job);
                mostCarried = Math.Max(mostCarried, CarryOf(world, worker));
                return Stock(world, Resource.Wood) >= 20;
            });
            Assert.Equal(20, Stock(world, Resource.Wood));
            Assert.Equal(10, mostCarried);
            // To the tree, chop, to the hall, and round again.
            Assert.Equal(
                new[] { Job.ToResource, Job.Harvesting, Job.ToDropOff, Job.ToResource, Job.Harvesting, Job.ToDropOff },
                stages.Take(6).ToArray());
            Assert.Equal(100 - 20 - CarryOf(world, worker), world.map.amount[tree]);
        }

        [Fact]
        public void TakesTheStatedTimeOverEachUnit()
        {
            (World world, _, int tree) = Yard();
            int worker = Villager(world, 3.4, 2.5);
            Send(world, 0, Command.Gather(Ids(worker), tree));
            Run(world, 600, () => JobOf(world, worker) == Job.Harvesting);
            int began = world.tick;
            Run(world, 600, () => CarryOf(world, worker) == 6);
            // Wood takes a second and a half a unit: 45 ticks at 30 ticks a second.
            Assert.Equal(45, EntityTypes.TicksPerUnit(Terrain.Forest, 30));
            Assert.Equal(6 * 45, world.tick - began);
            Assert.Equal(38, EntityTypes.TicksPerUnit(Terrain.Berries, 30));
            Assert.Equal(48, EntityTypes.TicksPerUnit(Terrain.Gold, 30));
            Assert.Equal(12, EntityTypes.TicksPerUnit(Terrain.Forest, 8));
            // A farm is slower than a berry bush.
            Assert.Equal(48, EntityTypes.TicksPerUnit(Terrain.Field, 30));
        }

        [Fact]
        public void TurnsAWorkedOutTileIntoOpenGroundAndMovesOnToTheNext()
        {
            World world = WorldFrom(new[] { "..........", "..TT......", "..........", "..........", "..........", ".........." });
            int hall = world.SpawnBuilding(0, Kind.TownCentre, 7, 3);
            Assert.True(hall >= 0);
            int first = world.map.Index(2, 1);
            int second = world.map.Index(3, 1);
            ThinOut(world, first, 4);
            ThinOut(world, second, 3);
            int worker = Villager(world, 1.5, 2.5);
            Send(world, 0, Command.Gather(Ids(worker), first));
            Run(world, 3000, () => JobOf(world, worker) == Job.None && CarryOf(world, worker) == 0);
            // Both trees gone, every last unit in the stores, and the villager standing idle.
            Assert.Equal(Terrain.Grass, world.map.terrain[first]);
            Assert.Equal(Terrain.Grass, world.map.terrain[second]);
            Assert.Equal(1, world.map.passable[first]);
            Assert.Equal(7, Stock(world, Resource.Wood));
            Assert.Equal(MoveState.Idle, world.moveState[SlotOf(worker)]);
            Assert.True(Helpers.RegionsAreRight(world));
        }

        [Fact]
        public void OpensAWayThroughWhenTheLastTreeInAWallComesDown()
        {
            World world = WorldFrom(new[] { "...T...", "...T...", "...T..." });
            GameMap map = world.map;
            int west = map.region[map.Index(2, 2)];
            int east = map.region[map.Index(5, 1)];
            Assert.NotEqual(east, west);
            int versionBefore = map.passVersion;
            ThinOut(world, map.Index(3, 1), 0);
            Assert.Equal(Terrain.Grass, map.terrain[map.Index(3, 1)]);
            Assert.True(map.passVersion > versionBefore);
            Assert.Equal(map.region[map.Index(5, 1)], map.region[map.Index(2, 2)]);
            Assert.True(Helpers.RegionsAreRight(world));
        }

        [Fact]
        public void GivesEachVillagerAtATreeItsOwnPlaceToStand()
        {
            (World world, _, int tree) = Yard();
            int[] workers = { Villager(world, 4.5, 1.5), Villager(world, 4.5, 2.5), Villager(world, 4.5, 3.5), Villager(world, 5.5, 2.5) };
            Send(world, 0, Command.Gather(workers, tree));
            Run(world, 900, () => workers.All(id => JobOf(world, id) == Job.Harvesting));
            Assert.True(workers.All(id => JobOf(world, id) == Job.Harvesting));
            Assert.Equal(4, workers.Select(id => world.jobSpot[SlotOf(id)]).Distinct().Count());
            Run(world, 200);
            foreach (int id in workers) Assert.True(CarryOf(world, id) > 0);
        }

        [Fact]
        public void SpreadsACrowdOverNeighbouringTreesWhenOneIsFull()
        {
            // A tree line with only its eastern face open: three tiles to stand on per tree at most.
            World world = WorldFrom(new[]
            {
                "TTT.........",
                "TTT.........",
                "TTT.........",
                "TTT.........",
                "TTT.........",
                "TTT.........",
            });
            world.SpawnBuilding(0, Kind.TownCentre, 8, 2);
            var workers = new int[12];
            for (int i = 0; i < 12; i++) workers[i] = Villager(world, 4.2 + (i % 3) * 0.6, 0.6 + (i / 3) * 0.6);
            int target = world.map.Index(2, 2);
            Send(world, 0, Command.Gather(workers, target));
            Run(world, 1200, () => workers.All(id => JobOf(world, id) == Job.Harvesting || JobOf(world, id) == Job.ToDropOff));
            int onTarget = workers.Count(id => world.jobTile[SlotOf(id)] == target);
            Assert.True(onTarget <= 6);
            Assert.True(onTarget > 0);
            // Everyone found work somewhere along the tree line.
            foreach (int id in workers) Assert.NotEqual(Job.None, JobOf(world, id));
            Assert.Equal(12, workers.Select(id => world.jobSpot[SlotOf(id)]).Distinct().Count());
            Run(world, 2500);
            Assert.True(Stock(world, Resource.Wood) > 100);
        }

        [Fact]
        public void HandsInAtTheNearerOfTwoDropOffs()
        {
            World world = WorldFrom(new[]
            {
                "................................",
                "................................",
                "................................",
                "...............T................",
                "................................",
                "................................",
                "................................",
            });
            int near = world.SpawnBuilding(0, Kind.TownCentre, 22, 3);
            world.SpawnBuilding(0, Kind.TownCentre, 3, 3);
            world.SpawnBuilding(1, Kind.TownCentre, 28, 3); // someone else's: not an option
            int worker = Villager(world, 16.5, 3.5);
            Send(world, 0, Command.Gather(Ids(worker), world.map.Index(15, 3)));
            Run(world, 1500, () => JobOf(world, worker) == Job.ToDropOff);
            Assert.Equal(near, world.jobTarget[SlotOf(worker)]);
        }

        [Fact]
        public void WithNowhereToHandInStopsWithItsLoadUntilToldWhereToTakeIt()
        {
            World world = WorldFrom(YARD);
            int tree = world.map.Index(2, 2);
            int worker = Villager(world, 3.5, 3.5);
            Send(world, 0, Command.Gather(Ids(worker), tree));
            Run(world, 1200, () => JobOf(world, worker) == Job.None);
            Assert.Equal(10, CarryOf(world, worker));
            Assert.Equal(0, Stock(world, Resource.Wood));

            int hall = world.SpawnBuilding(0, Kind.TownCentre, 8, 3);
            Send(world, 0, Command.Deliver(Ids(worker), hall));
            Run(world, 600, () => Stock(world, Resource.Wood) == 10);
            Assert.Equal(10, Stock(world, Resource.Wood));
            // And then straight back to the tree it was working.
            Assert.Equal(tree, world.jobTile[SlotOf(worker)]);
            Run(world, 600, () => JobOf(world, worker) == Job.Harvesting);
            Assert.Equal(Job.Harvesting, JobOf(world, worker));
        }

        [Fact]
        public void HandsInWhatItHoldsBeforeStartingOnADifferentResource()
        {
            (World world, _, int tree) = Yard();
            int worker = Villager(world, 3.5, 3.5);
            Send(world, 0, Command.Gather(Ids(worker), tree));
            Run(world, 600, () => CarryOf(world, worker) == 3);
            int berries = world.map.Index(10, 6);
            Send(world, 0, Command.Gather(Ids(worker), berries));
            Simulation.Step(world);
            Assert.Equal(Job.ToDropOff, JobOf(world, worker));
            Run(world, 900, () => JobOf(world, worker) == Job.Harvesting);
            Assert.Equal(3, Stock(world, Resource.Wood));
            Assert.Equal(berries, world.jobTile[SlotOf(worker)]);
            Run(world, 120);
            Assert.Equal(Resource.Food, world.carryKind[SlotOf(worker)]);
        }

        [Fact]
        public void IsTakenOffItsWorkByAMoveOrStopOrderAndKeepsItsLoad()
        {
            (World world, _, int tree) = Yard();
            int worker = Villager(world, 3.5, 3.5);
            Send(world, 0, Command.Gather(Ids(worker), tree));
            Run(world, 600, () => CarryOf(world, worker) == 4);
            Send(world, 0, Command.Move(Ids(worker), F(6.5), F(8.5)));
            Run(world, 400, () => world.moveState[SlotOf(worker)] == MoveState.Idle);
            Assert.Equal(Job.None, JobOf(world, worker));
            Assert.Equal(4, CarryOf(world, worker));
            Assert.True(DistanceTo(world, worker, 6.5, 8.5) < 0.1);
            Run(world, 200);
            Assert.Equal(4, CarryOf(world, worker));

            Send(world, 0, Command.Gather(Ids(worker), tree));
            Run(world, 600, () => JobOf(world, worker) == Job.Harvesting);
            Send(world, 0, Command.Stop(Ids(worker)));
            Simulation.Step(world);
            Assert.Equal(Job.None, JobOf(world, worker));
        }

        [Fact]
        public void SendsUnitsThatCannotGatherOrAGatherOrderOnBareGroundAsAPlainMove()
        {
            (World world, _, int tree) = Yard();
            int spearman = world.SpawnUnit(0, Kind.Spearman, F(6.5), F(8.5));
            int worker = Villager(world, 7.5, 8.5);
            Send(world, 0, Command.Gather(Ids(spearman), tree));
            Send(world, 0, Command.Gather(Ids(worker), world.map.Index(13, 8)));
            Run(world, 900, () => world.moveState[SlotOf(spearman)] == MoveState.Idle && world.tick > 5);
            Assert.Equal(Job.None, JobOf(world, spearman));
            Assert.True(DistanceTo(world, spearman, 2.5, 2.5) < 1.6);
            Assert.Equal(Job.None, JobOf(world, worker));
            Assert.True(DistanceTo(world, worker, 13.5, 8.5) < 0.1);
        }

        [Fact]
        public void IgnoresGatherAndDeliverOrdersThatMakeNoSense()
        {
            (World world, _, _) = Yard();
            int worker = Villager(world, 3.5, 3.5);
            int enemyHall = world.SpawnBuilding(1, Kind.TownCentre, 12, 7);
            uint before = Hash.HashWorld(world);
            // The TypeScript also sends a tile with a fraction in it, a gather order
            // with no tile at all and a target that is a word. None can be written here.
            Command[] nonsense =
            {
                Command.Gather(Ids(worker), -1),
                Command.Gather(Ids(worker), 1_000_000_000),
                Command.Deliver(Ids(worker), enemyHall),
                Command.Deliver(Ids(worker), worker),
            };
            foreach (Command command in nonsense) Send(world, 0, command);
            World untouched = Snapshot.RestoreSnapshot(Snapshot.TakeSnapshot(world));
            Simulation.Step(world);
            Simulation.Step(untouched);
            Assert.Equal(Hash.HashWorld(untouched), Hash.HashWorld(world));
            Assert.NotEqual(before, Hash.HashWorld(world)); // only because the tick moved on
            Assert.Equal(Job.None, JobOf(world, worker));
        }
    }

    public class BuildingsOnTheGround : EconomyScenario
    {
        [Fact]
        public void BlockTheGroundTheyStandOnAndTakeNoOrders()
        {
            (World world, int hall, _) = Yard();
            GameMap map = world.map;
            for (int ty = 1; ty <= 5; ty++)
            {
                for (int tx = 6; tx <= 10; tx++) Assert.False(map.IsPassable(tx, ty));
            }
            Assert.True(map.IsPassable(5, 3));
            Assert.True(map.IsPassable(11, 3));
            Send(world, 0, Command.Move(Ids(hall), F(1.5), F(8.5)));
            Send(world, 0, Command.Gather(Ids(hall), map.Index(2, 2)));
            Run(world, 60);
            Assert.Equal(8.5, XOf(world, hall));
            Assert.Empty(world.LivingUnits());
            Assert.Equal(new[] { hall }, world.LivingEntities().ToArray());
        }

        [Fact]
        public void AreWalkedRoundNeverThrough()
        {
            (World world, _, _) = Yard();
            int walker = world.SpawnUnit(0, Kind.Spearman, F(4.5), F(3.5));
            Send(world, 0, Command.Move(Ids(walker), F(12.5), F(3.5)));
            double furthestFromLine = 0;
            Run(world, 900, () =>
            {
                furthestFromLine = Math.Max(furthestFromLine, Math.Abs(YOf(world, walker) - 3.5));
                return world.moveState[SlotOf(walker)] == MoveState.Idle && world.tick > 5;
            });
            AssertCloseTo(12.5, XOf(world, walker), 1);
            Assert.True(furthestFromLine > 2.5);
        }

        [Fact]
        public void GiveTheGroundBackWhenTheyAreGone()
        {
            (World world, int hall, _) = Yard();
            world.Destroy(hall);
            Assert.True(world.map.IsPassable(8, 3));
            Assert.True(Helpers.RegionsAreRight(world));
            Assert.True(world.map.blocked.All(b => b == 0));
        }
    }

    public class TheStandardStart : EconomyScenario
    {
        static SimConfig Config()
        {
            return new SimConfig { seed = 4, mapWidth = 96, mapHeight = 96, map = MapSpec.Generated(), start = StartKind.Standard };
        }

        [Fact]
        public void GivesEachPlayerATownCentreVillagersBesideItAndSomethingInTheStores()
        {
            var world = new World(Config());
            for (int player = 0; player < 2; player++)
            {
                List<int> mine = world.LivingEntities(player);
                List<int> units = world.LivingUnits(player);
                Assert.Equal(1, mine.Count - units.Count);
                Assert.Equal(World.STARTING_VILLAGERS, units.Count);
                int hall = mine.First(id => !units.Contains(id));
                StartPosition start = world.map.starts[player];
                Assert.Equal(start.x, world.posX[SlotOf(hall)]);
                Assert.Equal(start.y, world.posY[SlotOf(hall)]);
                foreach (int id in units)
                {
                    int slot = SlotOf(id);
                    Assert.Equal(Kind.Villager, world.entityType[slot]);
                    Assert.Equal(1, world.map.passable[world.map.TileAt(world.posX[slot], world.posY[slot])]);
                    // Right beside the hall.
                    Assert.Equal(3, Math.Abs(XOf(world, id) - Fixed.ToFloat(start.x)));
                }
                Assert.Equal(new[] { 200, 200, 0, 100 }, StockOf(world, player));
            }
            Assert.Null(Helpers.BrokenInvariant(world));
        }

        [Fact]
        public void IsNotPlacedASecondTimeWhenASavedGameIsLoaded()
        {
            var world = new World(Config());
            World restored = Snapshot.RestoreSnapshot(Snapshot.TakeSnapshot(world));
            Assert.Equal(world.LivingEntities(), restored.LivingEntities());
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
            Assert.Equal(world.map.passable, restored.map.passable);
        }

        [Fact]
        public void LetsBothPlayersWorkEveryResourceNearHomeFromTheFirstTick()
        {
            var world = new World(Config());
            long[] before = Helpers.ResourceTotals(world);
            for (int player = 0; player < 2; player++)
            {
                StartPosition start = world.map.starts[player];
                List<int> units = world.LivingUnits(player);
                int[] terrains = { Terrain.Berries, Terrain.Forest, Terrain.Gold, Terrain.Stone };
                for (int i = 0; i < terrains.Length; i++)
                {
                    int terrain = terrains[i];
                    int tile = world.map.NearestTile(start.x >> 16, start.y >> 16, 14, t => world.map.terrain[t] == terrain);
                    Assert.True(tile >= 0, $"player {player} has terrain {terrain} within 14 tiles");
                    Send(world, player, Command.Gather(Ids(units[i]), tile));
                }
            }
            Run(world, 30 * 75);
            for (int player = 0; player < 2; player++)
            {
                int[] mine = StockOf(world, player);
                Assert.True(mine[0] > 200, "food");
                Assert.True(mine[1] > 200, "wood");
                Assert.True(mine[2] > 0, "stone");
                Assert.True(mine[3] > 100, "gold");
            }
            // The map is symmetric and so were the orders, so the two economies match exactly.
            Assert.Equal(StockOf(world, 0), StockOf(world, 1));
            Assert.Equal(before, Helpers.ResourceTotals(world));
        }
    }

    public class RouteSearchesAndAChangingMap : EconomyScenario
    {
        [Fact]
        public void StartsASearchAgainWhenATreeFallsPartWayThroughIt()
        {
            string[] rows = { "............", ".....T......", ".....T......", ".....T......", ".....T......", "............" };
            World world = WorldFrom(rows, config => config.pathBudget = 3);
            int walker = world.SpawnUnit(0, Kind.Spearman, F(1.5), F(2.5));
            Send(world, 0, Command.Move(Ids(walker), F(9.5), F(2.5)));
            Run(world, 4);
            ActiveSearch before = world.activeSearch;
            Assert.True(before.search.expansions > 6);
            // The tree in the walker's way comes down.
            ThinOut(world, world.map.Index(5, 2), 0);
            Simulation.Step(world);
            ActiveSearch after = world.activeSearch;
            // Either it has begun again on the new map, or the way is now clear and no search is needed.
            if (after != null)
            {
                Assert.Equal(world.map.passVersion, after.mapVersion);
                Assert.True(after.search.expansions <= 3);
            }
            // A save taken now carries on exactly as the original does.
            World restored = Snapshot.RestoreSnapshot(Snapshot.TakeSnapshot(world));
            for (int i = 0; i < 400; i++)
            {
                Simulation.Step(world);
                Simulation.Step(restored);
                Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
            }
            AssertCloseTo(9.5, XOf(world, walker), 1);
        }
    }

    public class Farms : EconomyScenario
    {
        /// <summary>An open field with a town centre, a villager, and wood enough for a few farms.</summary>
        static (World world, int farmer) Homestead()
        {
            var world = new World(new SimConfig { mapWidth = 40, mapHeight = 40, mapState = MapState.Revealed });
            world.SpawnBuilding(0, Kind.TownCentre, 10, 10);
            new[] { 0, 300, 0, 0 }.CopyTo(world.stock, 0);
            return (world, Villager(world, 14.5, 10.5));
        }

        static int FarmOf(World world)
        {
            return world.LivingEntities(0).First(id => world.entityType[SlotOf(id)] == Kind.Farm);
        }

        [Fact]
        public void AreBuiltLikeAnyBuildingAndThenBecomeTilledGroundThatCanBeWalkedOver()
        {
            (World world, int farmer) = Homestead();
            Send(world, 0, Command.Build(Ids(farmer), Kind.Farm, 18, 10));
            Run(world, 5);
            Assert.Equal(225, Stock(world, Resource.Wood));
            // While it is a site it is in the way, like any other.
            Assert.False(world.map.IsPassable(18, 10));
            int farm = FarmOf(world);
            Run(world, 900, () => world.built[SlotOf(farm)] == 1);
            Assert.Equal(1, world.built[SlotOf(farm)]);
            for (int ty = 9; ty <= 11; ty++)
            {
                for (int tx = 17; tx <= 19; tx++)
                {
                    Assert.Equal(Terrain.Field, world.map.terrain[ty * 40 + tx]);
                    Assert.True(world.map.IsPassable(tx, ty));
                }
            }
            // Nothing else can be built on it.
            Send(world, 0, Command.Build(Ids(farmer), Kind.House, 18, 10));
            Run(world, 5);
            Assert.Equal(2, world.LivingEntities(0).Count(id => world.mobile[SlotOf(id)] == 0));
            // A soldier marches straight across.
            int spear = world.SpawnUnit(0, Kind.Spearman, F(18.5), F(6.5));
            Send(world, 0, Command.Move(Ids(spear), F(18.5), F(14.5)));
            bool crossed = false;
            Run(world, 600, () =>
            {
                crossed = crossed || (Math.Abs(YOf(world, spear) - 10.5) < 0.3 && Math.Abs(XOf(world, spear) - 18.5) < 0.6);
                return world.moveState[SlotOf(spear)] == MoveState.Idle;
            });
            Assert.True(crossed);
        }

        [Fact]
        public void AreFarmedAtOnceByWhoeverBuiltThemAndTheFoodNeverRunsOut()
        {
            (World world, int farmer) = Homestead();
            Send(world, 0, Command.Build(Ids(farmer), Kind.Farm, 18, 10));
            Run(world, 900, () => JobOf(world, farmer) == Job.Harvesting);
            Assert.Equal(Job.Harvesting, JobOf(world, farmer));
            // The farmer stands on the farm itself, just south of the middle.
            Assert.Equal(18, Math.Floor(XOf(world, farmer)));
            Assert.Equal(11, Math.Floor(YOf(world, farmer)));
            long[] before = Helpers.ResourceTotals(world);
            Run(world, 30 * 240);
            // Four minutes of farming: about 150 units grown at one every 1.6 seconds, less the walking.
            Assert.True(Stock(world, Resource.Food) > 90);
            Assert.True(Stock(world, Resource.Food) < 150);
            Assert.True(world.grown[Resource.Food] >= Stock(world, Resource.Food));
            Assert.Equal(1, world.map.amount[10 * 40 + 18]);
            Assert.Equal(before, Helpers.ResourceTotals(world));
        }

        [Fact]
        public void TakeOneFarmerEachASecondVillagerSentToTheSameFarmFindsAnotherOrStandsDown()
        {
            (World world, int farmer) = Homestead();
            int second = Villager(world, 14.5, 12.5);
            Send(world, 0, Command.Build(Ids(farmer), Kind.Farm, 18, 10));
            Run(world, 900, () => JobOf(world, farmer) == Job.Harvesting);
            const int middle = 10 * 40 + 18;
            Send(world, 0, Command.Gather(Ids(second), middle));
            Run(world, 300);
            Assert.Equal(Job.None, JobOf(world, second));
            Assert.Equal(Job.Harvesting, JobOf(world, farmer));
            // With a second farm near by, the same order sends them there instead.
            world.SpawnBuilding(0, Kind.Farm, 18, 14);
            Send(world, 0, Command.Gather(Ids(second), middle));
            Run(world, 600, () => JobOf(world, second) == Job.Harvesting);
            Assert.Equal(14 * 40 + 18, world.jobTile[SlotOf(second)]);
            // Only the middle of a farm can be worked.
            int third = Villager(world, 14.5, 8.5);
            Send(world, 0, Command.Gather(Ids(third), 9 * 40 + 17));
            Run(world, 200);
            Assert.Equal(Job.None, JobOf(world, third));
        }

        [Fact]
        public void GoBackToGrassWhenDestroyedAndTheFarmerLooksForOtherWork()
        {
            (World world, int farmer) = Homestead();
            Send(world, 0, Command.Build(Ids(farmer), Kind.Farm, 18, 10));
            Run(world, 900, () => JobOf(world, farmer) == Job.Harvesting);
            Send(world, 0, Command.Demolish(Ids(FarmOf(world))));
            Run(world, 120);
            for (int ty = 9; ty <= 11; ty++)
            {
                for (int tx = 17; tx <= 19; tx++) Assert.Equal(Terrain.Grass, world.map.terrain[ty * 40 + tx]);
            }
            Assert.NotEqual(Job.Harvesting, JobOf(world, farmer));
            Assert.True(Helpers.RegionsAreRight(world));
        }

        [Fact]
        public void ComeBackFromASavedGameAsFieldsNotWalls()
        {
            (World world, int farmer) = Homestead();
            Send(world, 0, Command.Build(Ids(farmer), Kind.Farm, 18, 10));
            Run(world, 1200, () => Stock(world, Resource.Food) >= 10);
            world.SpawnBuilding(0, Kind.Farm, 25, 25, false); // and a second, still a site
            World restored = Snapshot.RestoreSnapshot(Snapshot.TakeSnapshot(world));
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
            Assert.True(restored.map.IsPassable(18, 10));
            Assert.False(restored.map.IsPassable(25, 25));
            Assert.Equal(world.grown, restored.grown);
            for (int i = 0; i < 300; i++)
            {
                Simulation.Step(world);
                Simulation.Step(restored);
            }
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
            Assert.Null(Helpers.BrokenInvariant(restored));
        }
    }
}
