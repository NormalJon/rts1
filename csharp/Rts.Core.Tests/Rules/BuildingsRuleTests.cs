// Translated from test/buildings.test.ts. Keep the two in step.
//
// Where the TypeScript passes a saved game through JSON before loading it,
// the save is loaded as it is: the C# library has no JSON in it.

using Rts.Sim;

namespace Rts.Tests.Rules
{
    public abstract class BuildingScenario : Scenario
    {
        protected static int Villager(World world, double x, double y, int player = 0)
        {
            return world.SpawnUnit(player, Kind.Villager, F(x), F(y));
        }

        protected static int[] Stock(World world, int player = 0) => world.stock.Skip(player * 4).Take(4).ToArray();

        protected static void Give(World world, int[] amounts, int player = 0) => amounts.CopyTo(world.stock, player * 4);

        protected static int JobOf(World world, int id) => world.job[SlotOf(id)];

        /// <summary>The player's buildings of a type, finished or not.</summary>
        protected static int[] BuildingsOf(World world, int kind, int player = 0)
        {
            return world.LivingEntities(player).Where(id => world.entityType[SlotOf(id)] == kind).ToArray();
        }

        protected static bool IsBuilt(World world, int id) => world.built[SlotOf(id)] == 1;

        //   0         1         2
        //   0123456789012345678901234
        protected static readonly string[] FIELD =
        {
            ".........................",
            ".........................",
            "..TTT....................",
            "..TTT....................",
            "..TTT....................",
            ".........................",
            ".........................",
            "....................bb...",
            ".........................",
            ".........................",
            ".........................",
            ".........................",
        };

        /// <summary>The field with a town centre at (12, 5) and stores to spend.</summary>
        protected static (World world, int hall) Settlement()
        {
            World world = WorldFrom(FIELD);
            int hall = world.SpawnBuilding(0, Kind.TownCentre, 12, 5);
            Give(world, new[] { 500, 500, 100, 100 });
            return (world, hall);
        }

        protected static void AssertPopulation(World world, int[] used, int[] room)
        {
            Population population = Production.CountPopulation(world);
            Assert.Equal(used, population.used);
            Assert.Equal(room, population.room);
        }
    }

    public class FoundingABuilding : BuildingScenario
    {
        [Fact]
        public void NeedsOpenGrassUnderEveryTileOfItsPlot()
        {
            World world = WorldFrom(new[] { ".......", ".T..~..", "....,..", ".#.....", ".....g.", ".......", "......." });
            world.SpawnBuilding(0, Kind.House, 5, 1 - 1 + 6 - 1); // a house at (5, 5), covering (4..6, 4..6)
            Assert.False(Buildings.CanPlace(world, Kind.House, 3, 5)); // overlaps that house
            Assert.True(Buildings.CanPlace(world, Kind.House, 2, 5));
            Assert.False(Buildings.CanPlace(world, Kind.House, 1, 1)); // a tree
            Assert.False(Buildings.CanPlace(world, Kind.House, 3, 1)); // the river and the ford
            Assert.False(Buildings.CanPlace(world, Kind.House, 2, 3)); // rock
            Assert.False(Buildings.CanPlace(world, Kind.House, 0, 5)); // hangs off the map
            // The TypeScript also refuses a plot at tile 2.5. Here a tile is a whole number by its type.
            Assert.False(Buildings.CanPlace(world, Kind.Villager, 2, 5)); // not a building
        }

        [Fact]
        public void TakesTheCostAtOnceAndMarksOutASiteThatBlocksTheGround()
        {
            (World world, _) = Settlement();
            int worker = Villager(world, 16.5, 9.5);
            Send(world, 0, Command.Build(Ids(worker), Kind.House, 20, 3));
            Simulation.Step(world);
            int[] houses = BuildingsOf(world, Kind.House);
            Assert.Single(houses);
            int house = houses[0];
            Assert.False(IsBuilt(world, house));
            Assert.Equal(new[] { 500, 450, 100, 100 }, Stock(world));
            Assert.Equal(new[] { 0, 50, 0, 0 }, world.spent.Take(4).ToArray());
            for (int ty = 2; ty <= 4; ty++)
            {
                for (int tx = 19; tx <= 21; tx++) Assert.False(world.map.IsPassable(tx, ty));
            }
            Assert.True(world.map.IsPassable(18, 3));
            Assert.Equal(Job.ToSite, JobOf(world, worker));
        }

        [Fact]
        public void IsRefusedWhenItCannotBeAffordedCannotStandThereOrIsNotForVillagersToBuild()
        {
            (World world, _) = Settlement();
            int worker = Villager(world, 16.5, 9.5);
            Give(world, new[] { 500, 40, 100, 100 });
            Send(world, 0, Command.Build(Ids(worker), Kind.House, 20, 3));
            Simulation.Step(world);
            Assert.Equal(new[] { 500, 40, 100, 100 }, Stock(world));
            Give(world, new[] { 500, 500, 100, 100 });
            Send(world, 0, Command.Build(Ids(worker), Kind.House, 3, 3)); // in the trees
            Send(world, 0, Command.Build(Ids(worker), Kind.House, 12, 5)); // on the hall
            Send(world, 0, Command.Build(Ids(worker), Kind.TownCentre, 20, 9));
            Send(world, 0, Command.Build(Ids(worker), Kind.Spearman, 20, 9));
            Send(world, 0, Command.Build(Ids(worker), 99, 20, 9));
            // The TypeScript also sends a plot whose column is "not a number", which cannot be written here.
            Simulation.Step(world);
            Assert.Single(world.LivingEntities(0), id => world.mobile[SlotOf(id)] == 0);
            Assert.Equal(new[] { 500, 500, 100, 100 }, Stock(world));
            Assert.Equal(Job.None, JobOf(world, worker));
        }

        [Fact]
        public void MovesUnitsStandingOnThePlotOffIt()
        {
            (World world, _) = Settlement();
            int[] bystanders = { Villager(world, 20.5, 3.5), Villager(world, 19.5, 2.5), Villager(world, 21.4, 4.4) };
            Send(world, 0, Command.Build(new int[0], Kind.House, 20, 3));
            Run(world, 30);
            foreach (int id in bystanders)
            {
                double x = XOf(world, id);
                double y = YOf(world, id);
                Assert.True(x < 19 || x > 22 || y < 2 || y > 5);
                Assert.Equal(MoveState.Idle, world.moveState[SlotOf(id)]);
            }
        }
    }

    public class BuildingWork : BuildingScenario
    {
        int BuildHouse(int builders)
        {
            (World world, _) = Settlement();
            var workers = new int[builders];
            for (int i = 0; i < builders; i++) workers[i] = Villager(world, 17.5, 2.5 + i * 0.6);
            Send(world, 0, Command.Build(workers, Kind.House, 20, 3));
            Simulation.Step(world);
            int house = BuildingsOf(world, Kind.House)[0];
            Run(world, 300, () => workers.All(id => JobOf(world, id) == Job.Constructing));
            int began = world.tick;
            Run(world, 2000, () => IsBuilt(world, house));
            Assert.True(IsBuilt(world, house));
            return world.tick - began;
        }

        [Fact]
        public void TakesOneVillagerTheStatedTime()
        {
            // A house is 20 seconds of one villager's work: 600 ticks.
            Assert.Equal(20, EntityTypes.ENTITY_TYPES[Kind.House].seconds);
            Assert.Equal(600, BuildHouse(1));
        }

        [Fact]
        public void GoesFasterWithMoreHandsButLessSoEachTime()
        {
            // One builder adds three points a tick, each helper one more: 1,800 points
            // take two builders 450 ticks, three 360 and six 225. The count starts once
            // the last builder has arrived, so the work the first few did while the
            // others walked round the site comes off the total.
            foreach ((int builders, int ticks) in new[] { (2, 450), (3, 360), (6, 225) })
            {
                int took = BuildHouse(builders);
                Assert.True(took <= ticks + 2, $"{builders} builders took {took} ticks");
                Assert.True(took > ticks * 0.9, $"{builders} builders took {took} ticks");
            }
        }

        [Fact]
        public void LeavesTheBuildersIdleWhenThereIsNothingElseToDo()
        {
            (World world, _) = Settlement();
            int worker = Villager(world, 17.5, 3.5);
            Send(world, 0, Command.Build(Ids(worker), Kind.House, 20, 9));
            Run(world, 1500, () => JobOf(world, worker) == Job.None);
            Assert.True(IsBuilt(world, BuildingsOf(world, Kind.House)[0]));
            Assert.Equal(MoveState.Idle, world.moveState[SlotOf(worker)]);
        }

        [Fact]
        public void SendsTheBuildersOnToTheNextSiteNearby()
        {
            (World world, _) = Settlement();
            int worker = Villager(world, 17.5, 3.5);
            Send(world, 0, Command.Build(Ids(worker), Kind.House, 20, 9));
            Send(world, 0, Command.Build(new int[0], Kind.House, 16, 9));
            Run(world, 3000, () => BuildingsOf(world, Kind.House).All(id => IsBuilt(world, id)));
            Assert.Equal(2, BuildingsOf(world, Kind.House).Length);
            Assert.True(BuildingsOf(world, Kind.House).All(id => IsBuilt(world, id)));
        }

        [Fact]
        public void SetsTheBuildersOfALumberCampToFellingAndTheyHandInAtTheCamp()
        {
            (World world, int hall) = Settlement();
            int[] workers = { Villager(world, 8.5, 8.5), Villager(world, 8.5, 9.5) };
            Send(world, 0, Command.Build(workers, Kind.LumberCamp, 7, 4));
            Simulation.Step(world);
            int camp = BuildingsOf(world, Kind.LumberCamp)[0];
            Run(world, 1500, () => IsBuilt(world, camp));
            Run(world, 30);
            foreach (int id in workers)
            {
                Assert.Contains(JobOf(world, id), new[] { Job.ToResource, Job.Harvesting });
                Assert.Equal(1, world.jobTerrain[SlotOf(id)]); // forest
            }
            var targets = new List<int>();
            Run(world, 2400, () =>
            {
                foreach (int id in workers)
                {
                    int target = world.jobTarget[SlotOf(id)];
                    if (JobOf(world, id) == Job.ToDropOff && !targets.Contains(target)) targets.Add(target);
                }
                return Stock(world)[Resource.Wood] >= 450 + 40;
            });
            Assert.True(Stock(world)[Resource.Wood] >= 490);
            // The camp is two tiles from the trees; the hall is further. They never walk to the hall.
            Assert.Equal(new[] { camp }, targets.ToArray());
            Assert.DoesNotContain(hall, targets);
        }

        [Fact]
        public void LetsOtherVillagersJoinASiteAndIgnoresASiteThatIsNotTheirs()
        {
            (World world, _) = Settlement();
            int first = Villager(world, 17.5, 3.5);
            int second = Villager(world, 17.5, 8.5);
            int stranger = Villager(world, 23.5, 10.5, 1);
            Send(world, 0, Command.Build(Ids(first), Kind.House, 20, 3));
            Simulation.Step(world);
            int house = BuildingsOf(world, Kind.House)[0];
            Send(world, 0, Command.Construct(Ids(second), house));
            Send(world, 1, Command.Construct(Ids(stranger), house));
            Simulation.Step(world);
            Assert.Equal(Job.ToSite, JobOf(world, second));
            Assert.Equal(Job.None, JobOf(world, stranger));
            Run(world, 1000, () => IsBuilt(world, house));
            Assert.True(IsBuilt(world, house));
        }

        [Fact]
        public void OnlyAcceptsAtADropOffWhatThatBuildingIsFor()
        {
            World world = WorldFrom(FIELD);
            int mill = world.SpawnBuilding(0, Kind.Mill, 20, 3);
            int woodcutter = Villager(world, 5.5, 5.5);
            Send(world, 0, Command.Gather(Ids(woodcutter), world.map.Index(3, 4)));
            Run(world, 900, () => world.carry[SlotOf(woodcutter)] == 10 && JobOf(world, woodcutter) == Job.None);
            // A mill takes food, not wood: with nowhere else to go, the villager stops with its load.
            Assert.Equal(10, world.carry[SlotOf(woodcutter)]);
            Assert.Equal(0, Stock(world)[Resource.Wood]);
            Send(world, 0, Command.Deliver(Ids(woodcutter), mill));
            Run(world, 300);
            Assert.Equal(0, Stock(world)[Resource.Wood]);

            int forager = Villager(world, 19.5, 8.5);
            Send(world, 0, Command.Gather(Ids(forager), world.map.Index(20, 7)));
            Run(world, 1200, () => Stock(world)[Resource.Food] >= 10);
            Assert.Equal(10, Stock(world)[Resource.Food]);
        }

        [Fact]
        public void DoesNotAcceptDeliveriesUntilItIsFinished()
        {
            World world = WorldFrom(FIELD);
            Give(world, new[] { 0, 100, 0, 0 });
            int woodcutter = Villager(world, 5.5, 5.5);
            Send(world, 0, Command.Build(new int[0], Kind.LumberCamp, 7, 4));
            Send(world, 0, Command.Gather(Ids(woodcutter), world.map.Index(3, 4)));
            Run(world, 900, () => world.carry[SlotOf(woodcutter)] == 10 && JobOf(world, woodcutter) == Job.None);
            Assert.Equal(50, Stock(world)[Resource.Wood]);
        }
    }

    public class PullingABuildingDown : BuildingScenario
    {
        [Fact]
        public void RefundsASiteInFullAndAFinishedBuildingNotAtAllAndReopensTheGround()
        {
            (World world, _) = Settlement();
            int worker = Villager(world, 17.5, 3.5);
            Send(world, 0, Command.Build(Ids(worker), Kind.House, 20, 3));
            Run(world, 200);
            int site = BuildingsOf(world, Kind.House)[0];
            Assert.Equal(450, Stock(world)[Resource.Wood]);
            Send(world, 0, Command.Demolish(Ids(site)));
            Run(world, 5);
            Assert.False(world.IsAlive(site));
            Assert.Equal(500, Stock(world)[Resource.Wood]);
            Assert.True(world.map.IsPassable(20, 3));
            Assert.Equal(Job.None, JobOf(world, worker));

            Send(world, 0, Command.Build(Ids(worker), Kind.House, 20, 3));
            Run(world, 1200, () => BuildingsOf(world, Kind.House).Any(id => IsBuilt(world, id)));
            Send(world, 0, Command.Demolish(BuildingsOf(world, Kind.House)));
            Run(world, 5);
            Assert.Empty(BuildingsOf(world, Kind.House));
            Assert.Equal(450, Stock(world)[Resource.Wood]);
        }

        [Fact]
        public void LeavesOtherPlayersBuildingsAndUnitsAlone()
        {
            (World world, int hall) = Settlement();
            int worker = Villager(world, 17.5, 3.5);
            Send(world, 1, Command.Demolish(Ids(hall)));
            // (The TypeScript's third target is a million million, which is past what a handle here can hold.)
            Send(world, 0, Command.Demolish(Ids(worker, -1, int.MaxValue)));
            Run(world, 3);
            Assert.True(world.IsAlive(hall));
            Assert.True(world.IsAlive(worker));
        }
    }

    public class Training : BuildingScenario
    {
        [Fact]
        public void TurnsOutAVillagerAfterTheStatedTimeBesideTheBuilding()
        {
            (World world, int hall) = Settlement();
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Simulation.Step(world);
            Assert.Equal(new[] { 450, 500, 100, 100 }, Stock(world));
            Assert.Equal(1, world.trainLength[SlotOf(hall)]);
            Assert.Equal(1, Production.CountPopulation(world).used[0]); // room is set aside as training starts
            // 20 seconds is 600 ticks, of which the tick that queued it was the first.
            int ticks = 1 + Run(world, 2000, () => world.LivingUnits(0).Count == 1);
            Assert.Equal(600, ticks);
            int recruit = world.LivingUnits(0)[0];
            Assert.Equal(Kind.Villager, world.entityType[SlotOf(recruit)]);
            // Out of the front of the hall, which faces down the map.
            Assert.Equal(12.5, XOf(world, recruit));
            Assert.Equal(8.5, YOf(world, recruit));
            Assert.Equal(0, world.trainLength[SlotOf(hall)]);
            AssertPopulation(world, used: new[] { 1, 0 }, room: new[] { 10, 0 });
        }

        [Fact]
        public void WorksThroughAQueueInOrderAndRefusesANinth()
        {
            (World world, int hall) = Settlement();
            for (int i = 0; i < 9; i++) Send(world, 0, Command.Train(hall, Kind.Villager));
            Simulation.Step(world);
            Assert.Equal(8, world.trainLength[SlotOf(hall)]);
            Assert.Equal(500 - 8 * 50, Stock(world)[Resource.Food]);
            Run(world, 600 * 3 + 10);
            Assert.Equal(3, world.LivingUnits(0).Count);
            Assert.Equal(5, world.trainLength[SlotOf(hall)]);
        }

        [Fact]
        public void GivesTheCostBackWhenAUnitIsCancelledAndStartsTheOneInTrainingAfresh()
        {
            (World world, int hall) = Settlement();
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Run(world, 300);
            Send(world, 0, Command.CancelTrain(hall, 1));
            Simulation.Step(world);
            Assert.Equal(450, Stock(world)[Resource.Food]);
            Assert.True(world.trainTicks[SlotOf(hall)] > 290);
            Send(world, 0, Command.CancelTrain(hall, 0));
            Simulation.Step(world);
            Assert.Equal(500, Stock(world)[Resource.Food]);
            Assert.Equal(0, world.trainLength[SlotOf(hall)]);
            Assert.Equal(0, world.trainTicks[SlotOf(hall)]);
            Assert.Equal(0, Production.CountPopulation(world).used[0]);
            Send(world, 0, Command.CancelTrain(hall, 0)); // nothing there: no refund
            // The TypeScript also cancels place 2.5 in the queue, which cannot be written here.
            Simulation.Step(world);
            Assert.Equal(500, Stock(world)[Resource.Food]);
        }

        [Fact]
        public void OnlyTrainsWhatTheBuildingTrainsForItsOwnerOnceItIsBuilt()
        {
            (World world, int hall) = Settlement();
            Give(world, new[] { 500, 500, 0, 0 }, 1);
            int barracksSite = world.SpawnBuilding(0, Kind.Barracks, 20, 3, false);
            Send(world, 0, Command.Train(hall, Kind.Spearman)); // halls train villagers
            Send(world, 0, Command.Train(hall, Kind.House));
            Send(world, 0, Command.Train(hall, 42));
            Send(world, 1, Command.Train(hall, Kind.Villager)); // not theirs
            Send(world, 0, Command.Train(barracksSite, Kind.Spearman)); // not built
            Send(world, 0, Command.Train(12345, Kind.Villager));
            Simulation.Step(world);
            Assert.Equal(new[] { 500, 500, 100, 100 }, Stock(world));
            Assert.Equal(new[] { 500, 500, 0, 0 }, Stock(world, 1));
            Assert.Equal(0, world.trainLength[SlotOf(hall)]);
        }

        [Fact]
        public void TrainsSpearmenAtABarracks()
        {
            (World world, _) = Settlement();
            int barracks = world.SpawnBuilding(0, Kind.Barracks, 20, 3);
            Send(world, 0, Command.Train(barracks, Kind.Spearman));
            Simulation.Step(world);
            Assert.Equal(new[] { 440, 480, 100, 100 }, Stock(world));
            Run(world, 15 * 30);
            int recruit = world.LivingUnits(0)[0];
            Assert.Equal(Kind.Spearman, world.entityType[SlotOf(recruit)]);
        }

        [Fact]
        public void RefusesAUnitThatCannotBeAfforded()
        {
            (World world, int hall) = Settlement();
            Give(world, new[] { 49, 500, 0, 0 });
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Simulation.Step(world);
            Assert.Equal(0, world.trainLength[SlotOf(hall)]);
            Assert.Equal(49, Stock(world)[Resource.Food]);
        }
    }

    public class PopulationRules : BuildingScenario
    {
        [Fact]
        public void CountsRoomFromFinishedBuildingsOnly()
        {
            (World world, _) = Settlement();
            Assert.Equal(10, Production.CountPopulation(world).room[0]);
            world.SpawnBuilding(0, Kind.House, 20, 3, false);
            Assert.Equal(10, Production.CountPopulation(world).room[0]);
            world.SpawnBuilding(0, Kind.House, 20, 9);
            Assert.Equal(20, Production.CountPopulation(world).room[0]);
            world.SpawnBuilding(1, Kind.House, 3, 9);
            AssertPopulation(world, used: new[] { 0, 0 }, room: new[] { 20, 10 });
        }

        [Fact]
        public void HoldsTrainingUntilThereIsRoomThenCarriesOn()
        {
            (World world, int hall) = Settlement();
            for (int i = 0; i < 10; i++) Villager(world, 4.5 + i, 9.5);
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Run(world, 900);
            // Ten of ten: paid for, but not begun.
            Assert.Equal(10, world.LivingUnits(0).Count);
            Assert.Equal(0, world.trainTicks[SlotOf(hall)]);
            Assert.Equal(0, world.trainStarted[SlotOf(hall)]);
            Assert.Equal(450, Stock(world)[Resource.Food]);

            int builder = world.LivingUnits(0)[0];
            Send(world, 0, Command.Build(Ids(builder), Kind.House, 20, 3));
            Run(world, 1500, () => BuildingsOf(world, Kind.House).Any(id => IsBuilt(world, id)));
            int ticks = Run(world, 1000, () => world.LivingUnits(0).Count == 11);
            Assert.Equal(11, world.LivingUnits(0).Count);
            Assert.True(ticks > 590);
            Assert.True(ticks < 605);
            AssertPopulation(world, used: new[] { 11, 0 }, room: new[] { 20, 0 });
        }

        [Fact]
        public void NeverGoesPastTheLimitHoweverManyHousesThereAre()
        {
            var world = new World(new SimConfig { mapWidth = 128, mapHeight = 128 });
            for (int i = 0; i < 30; i++) world.SpawnBuilding(0, Kind.House, 4 + (i % 10) * 4, 4 + (i / 10) * 4);
            Assert.Equal(200, Production.CountPopulation(world).room[0]);
        }
    }

    public class RallyPoints : BuildingScenario
    {
        [Fact]
        public void SendNewUnitsToAPlace()
        {
            (World world, int hall) = Settlement();
            Send(world, 0, Command.Rally(Ids(hall), F(20.5), F(9.5)));
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Run(world, 605);
            int recruit = world.LivingUnits(0)[0];
            // It comes out on the side nearest the rally point and walks there.
            Assert.True(XOf(world, recruit) > 14.5);
            Run(world, 300, () => world.moveState[SlotOf(recruit)] == MoveState.Idle);
            Assert.True(DistanceTo(world, recruit, 20.5, 9.5) < 0.1);
        }

        [Fact]
        public void OnAResourcePutNewVillagersStraightToWorkOnIt()
        {
            (World world, int hall) = Settlement();
            int berries = world.map.Index(20, 7);
            Send(world, 0, Command.Rally(Ids(hall), world.map.CentreX(berries), world.map.CentreY(berries)));
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Run(world, 605);
            int recruit = world.LivingUnits(0)[0];
            Assert.Equal(berries, world.rallyTile[SlotOf(hall)]);
            Assert.Equal(Job.ToResource, JobOf(world, recruit));
            Run(world, 2000, () => Stock(world)[Resource.Food] > 450);
            Assert.Equal(460, Stock(world)[Resource.Food]);
        }

        [Fact]
        public void CannotBeSetOnSomeoneElsesBuilding()
        {
            (World world, int hall) = Settlement();
            Send(world, 1, Command.Rally(Ids(hall), F(2.5), F(9.5)));
            // (The TypeScript sends the word "all" where the list of buildings should be. The nearest thing here is no list.)
            Send(world, 0, Command.Rally(null, 0, 0));
            Simulation.Step(world);
            Assert.Equal(-1, world.rallyX[SlotOf(hall)]);
        }
    }

    public class RoutesAndNewBuildings : BuildingScenario
    {
        [Fact]
        public void AUnitOnItsWayGoesRoundABuildingFoundedAcrossItsPath()
        {
            (World world, _) = Settlement();
            int walker = world.SpawnUnit(0, Kind.Spearman, F(2.5), F(9.5));
            Send(world, 0, Command.Move(Ids(walker), F(23.5), F(9.5)));
            Run(world, 60);
            Assert.Equal(MoveState.Direct, world.moveState[SlotOf(walker)]);
            Send(world, 0, Command.Build(new int[0], Kind.Barracks, 14, 9));
            int ticks = Run(world, 900, () => world.moveState[SlotOf(walker)] == MoveState.Idle);
            Assert.True(DistanceTo(world, walker, 23.5, 9.5) < 0.1);
            // About 21 tiles straight, a few more for the detour, at 1.6 tiles a second.
            Assert.True(ticks < 470);
        }

        [Fact]
        public void AGroupFollowingAFlowFieldDoesToo()
        {
            World world = WorldFrom(new[]
            {
                "..............................",
                "..............................",
                ".....#........................",
                ".....#........................",
                ".....#........................",
                ".....#........................",
                ".....#........................",
                ".....#........................",
                "..............................",
                "..............................",
            });
            Give(world, new[] { 0, 500, 0, 0 });
            var group = new int[9];
            for (int i = 0; i < 9; i++) group[i] = world.SpawnUnit(0, Kind.Spearman, F(1.5 + (i % 3) * 0.6), F(4 + (i / 3) * 0.6));
            Send(world, 0, Command.Move(group, F(27.5), F(4.5)));
            Run(world, 20);
            Assert.True(group.All(id => world.moveState[SlotOf(id)] == MoveState.Field));
            Run(world, 40);
            Send(world, 0, Command.Build(new int[0], Kind.Barracks, 16, 4));
            Send(world, 0, Command.Build(new int[0], Kind.House, 16, 8));
            Run(world, 1500, () => group.All(id => world.moveState[SlotOf(id)] == MoveState.Idle));
            foreach (int id in group) Assert.True(DistanceTo(world, id, 27.5, 4.5) < 2);
        }

        [Fact]
        public void ADestinationThatGetsBuiltOverMovesToTheNearestOpenGround()
        {
            (World world, _) = Settlement();
            int walker = world.SpawnUnit(0, Kind.Spearman, F(2.5), F(9.5));
            Send(world, 0, Command.Move(Ids(walker), F(20.5), F(3.5)));
            Send(world, 0, Command.Move(Ids(walker), F(16.5), F(9.5), queue: true));
            Run(world, 60);
            Send(world, 0, Command.Build(new int[0], Kind.House, 20, 3));
            Send(world, 0, Command.Build(new int[0], Kind.House, 16, 9));
            Run(world, 1500, () => world.moveState[SlotOf(walker)] == MoveState.Idle && world.queueLength[SlotOf(walker)] == 0);
            // It ends beside the second house, having first gone to stand beside the first.
            Assert.True(DistanceTo(world, walker, 16.5, 9.5) < 2.4);
            Assert.Equal(1, world.map.passable[world.map.TileAt(world.posX[SlotOf(walker)], world.posY[SlotOf(walker)])]);
        }

        [Fact]
        public void AVillagerWhosePlaceAtATreeIsBuiltOverFindsAnother()
        {
            (World world, _) = Settlement();
            int worker = Villager(world, 6.5, 3.5);
            Send(world, 0, Command.Gather(Ids(worker), world.map.Index(4, 3)));
            Run(world, 300, () => JobOf(world, worker) == Job.Harvesting);
            Assert.Equal(5, Math.Floor(XOf(world, worker)));
            Send(world, 0, Command.Build(new int[0], Kind.House, 6, 3));
            Run(world, 600, () => JobOf(world, worker) == Job.Harvesting && world.tick > 320);
            Assert.Equal(Job.Harvesting, JobOf(world, worker));
            int before = world.carry[SlotOf(worker)];
            Run(world, 100);
            Assert.True(world.carry[SlotOf(worker)] > before || JobOf(world, worker) == Job.ToDropOff);
        }
    }

    public class SavedGames : BuildingScenario
    {
        [Fact]
        public void CarrySitesQueuesAndRallyPointsAcross()
        {
            (World world, int hall) = Settlement();
            int worker = Villager(world, 17.5, 3.5);
            Send(world, 0, Command.Build(Ids(worker), Kind.House, 20, 3));
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Send(world, 0, Command.Rally(Ids(hall), F(20.5), F(7.5)));
            Run(world, 250);
            World restored = Snapshot.RestoreSnapshot(Snapshot.TakeSnapshot(world));
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
            for (int i = 0; i < 1500; i++)
            {
                Simulation.Step(world);
                Simulation.Step(restored);
                if (Hash.HashWorld(restored) != Hash.HashWorld(world)) Assert.Fail($"diverged at tick {world.tick}");
            }
            Assert.Equal(3, world.LivingUnits(0).Count);
            Assert.True(IsBuilt(world, BuildingsOf(world, Kind.House)[0]));
        }
    }
}
