// Translated from test/movement.test.ts. Keep the two in step.

using Rts.Sim;

namespace Rts.Tests.Rules
{
    public abstract class MovementScenario : Scenario
    {
        protected static int Place(World world, int player, double x, double y, int kind = Kind.Spearman)
        {
            return world.SpawnUnit(player, kind, F(x), F(y));
        }

        protected static bool Idle(World world, int id)
        {
            return world.moveState[SlotOf(id)] == MoveState.Idle && world.queueLength[SlotOf(id)] == 0;
        }

        protected static bool AllIdle(World world, IEnumerable<int> ids)
        {
            return ids.All(id => Idle(world, id));
        }

        /// <summary>A block of units, half a tile and a bit apart.</summary>
        protected static int[] Block(World world, int player, double x, double y, int columns, int rows)
        {
            var ids = new List<int>();
            for (int r = 0; r < rows; r++)
            {
                for (int c = 0; c < columns; c++) ids.Add(Place(world, player, x + c * 0.6, y + r * 0.6));
            }
            return ids.ToArray();
        }
    }

    public class ASingleUnit : MovementScenario
    {
        [Fact]
        public void WalksRoundAWallToReachTheOtherSide()
        {
            World world = WorldFrom(new[]
            {
                "............",
                ".....#......",
                ".....#......",
                ".....#......",
                ".....#......",
                "............",
            });
            int unit = Place(world, 0, 1.5, 2.5);
            Move(world, 0, Ids(unit), 9.5, 2.5);
            var states = new HashSet<int>();
            int ticks = Run(world, 400, () =>
            {
                states.Add(world.moveState[SlotOf(unit)]);
                return Idle(world, unit);
            });
            Assert.True(Idle(world, unit));
            Assert.True(DistanceTo(world, unit, 9.5, 2.5) < 0.07);
            Assert.Contains(MoveState.Path, states);
            // Round the end of the wall is about 9 tiles; at 1.6 tiles a second that is about 170 ticks.
            Assert.True(ticks > 150);
            Assert.True(ticks < 200);
        }

        [Fact]
        public void WalksStraightThereWhenNothingIsInTheWayWithoutASearch()
        {
            World world = FlatWorld(32);
            int unit = Place(world, 0, 4.5, 4.5);
            Move(world, 0, Ids(unit), 20.5, 12.5);
            Simulation.Step(world);
            Assert.Equal(MoveState.Direct, world.moveState[SlotOf(unit)]);
            Assert.Empty(world.routeQueue);
            Run(world, 400, () => Idle(world, unit));
            Assert.True(DistanceTo(world, unit, 20.5, 12.5) < 0.07);
        }

        [Fact]
        public void TakesARouteCloseToTheShortestOneThroughAMaze()
        {
            World world = WorldFrom(new[]
            {
                "..........#.........",
                ".########.#.#######.",
                ".#......#.#.#.....#.",
                ".#.####.#.#.#.###.#.",
                ".#.#..#.#...#.#...#.",
                ".#.#.##.#####.#.###.",
                ".#.#..........#.....",
                ".#.############.###.",
                ".#..................",
                ".##################.",
                "....................",
            });
            int unit = Place(world, 0, 0.5, 0.5);
            Move(world, 0, Ids(unit), 15.5, 4.5);
            double walked = 0;
            double lastX = 0.5;
            double lastY = 0.5;
            Run(world, 3000, () =>
            {
                walked += Hypot(XOf(world, unit) - lastX, YOf(world, unit) - lastY);
                lastX = XOf(world, unit);
                lastY = YOf(world, unit);
                return Idle(world, unit);
            });
            Assert.True(DistanceTo(world, unit, 15.5, 4.5) < 0.07);
            // Compare with the cheapest tile-to-tile route. Cutting corners makes the
            // real walk a little shorter, never longer.
            GameMap map = world.map;
            var search = new AStarSearch(map, new SearchScratch(map.tileCount), map.Index(0, 0), map.Index(15, 4));
            while (!search.done) search.Run(1000);
            int[] tiles = search.Path();
            double byTiles = 0;
            for (int i = 1; i < tiles.Length; i++)
            {
                bool straight = tiles[i] % map.width == tiles[i - 1] % map.width || Math.Abs(tiles[i] - tiles[i - 1]) == 1;
                byTiles += straight ? 1 : Math.Sqrt(2);
            }
            Assert.True(byTiles > 30);
            Assert.True(walked <= byTiles + 0.5);
            Assert.True(walked > byTiles * 0.85);
        }

        [Fact]
        public void GoesAsNearAsItCanToAPlaceItCannotReach()
        {
            World world = WorldFrom(new[]
            {
                ".....~~.....",
                ".....~~.....",
                ".....~~.....",
                ".....~~.....",
            });
            int unit = Place(world, 0, 1.5, 1.5);
            Move(world, 0, Ids(unit), 10.5, 1.5);
            Run(world, 400, () => Idle(world, unit));
            Assert.True(Idle(world, unit));
            Assert.True(XOf(world, unit) > 4);
            Assert.True(XOf(world, unit) < 5);
            Assert.Empty(world.routeQueue);
            Assert.Null(world.activeSearch);
        }

        [Fact]
        public void StandsBesideAnObstacleItIsOrderedOnto()
        {
            World world = WorldFrom(new[] { "........", "....##..", "....##..", "........" });
            int unit = Place(world, 0, 0.5, 1.5);
            Move(world, 0, Ids(unit), 5.2, 1.8);
            Run(world, 300, () => Idle(world, unit));
            Assert.True(Idle(world, unit));
            Assert.True(DistanceTo(world, unit, 5.0, 2.0) < 2);
        }

        [Fact]
        public void VisitsQueuedWaypointsInTheOrderTheyWereGiven()
        {
            World world = FlatWorld(24);
            int unit = Place(world, 0, 2.5, 2.5);
            (double x, double y)[] stops =
            {
                (12.5, 2.5),
                (12.5, 12.5),
                (2.5, 12.5),
            };
            Move(world, 0, Ids(unit), stops[0].x, stops[0].y);
            Move(world, 0, Ids(unit), stops[1].x, stops[1].y, true);
            Move(world, 0, Ids(unit), stops[2].x, stops[2].y, true);
            var reachedAt = new List<int>();
            Run(world, 1500, () =>
            {
                if (reachedAt.Count < stops.Length)
                {
                    (double x, double y) next = stops[reachedAt.Count];
                    if (DistanceTo(world, unit, next.x, next.y) < 0.2) reachedAt.Add(world.tick);
                }
                return Idle(world, unit);
            });
            Assert.Equal(3, reachedAt.Count);
            Assert.True(DistanceTo(world, unit, 2.5, 12.5) < 0.07);
        }

        [Fact]
        public void DropsWaypointsBeyondWhatItCanRememberAndNoneItWasGivenBeforeThat()
        {
            World world = FlatWorld(24);
            int unit = Place(world, 0, 2.5, 2.5);
            Move(world, 0, Ids(unit), 20.5, 2.5);
            for (int i = 0; i < 12; i++) Move(world, 0, Ids(unit), 3.5 + i, 10.5, true);
            Simulation.Step(world);
            Assert.Equal(8, world.queueLength[SlotOf(unit)]);
            Assert.Equal(10.5, Fixed.ToFloat(world.queueX[SlotOf(unit) * 8 + 7]));
        }

        [Fact]
        public void WaitsWhenPathfindingIsShortOfTimeAndStillGetsThere()
        {
            string[] rows = { "............", ".....#......", ".....#......", ".....#......", ".....#......", "............" };
            World world = WorldFrom(rows, config => config.pathBudget = 3);
            int unit = Place(world, 0, 1.5, 2.5);
            Move(world, 0, Ids(unit), 9.5, 2.5);
            Run(world, 3);
            Assert.Equal(MoveState.Awaiting, world.moveState[SlotOf(unit)]);
            Assert.NotNull(world.activeSearch);
            Run(world, 600, () => Idle(world, unit));
            Assert.True(DistanceTo(world, unit, 9.5, 2.5) < 0.07);
        }

        [Fact]
        public void DropsARouteThatWasBeingWorkedOutForAnOrderSinceReplaced()
        {
            string[] rows = { "............", ".....#......", ".....#......", ".....#......", ".....#......", "............" };
            World world = WorldFrom(rows, config => config.pathBudget = 3);
            int unit = Place(world, 0, 1.5, 2.5);
            Move(world, 0, Ids(unit), 9.5, 2.5);
            Run(world, 2);
            Move(world, 0, Ids(unit), 2.5, 4.5); // in plain sight: no search needed
            Run(world, 200, () => Idle(world, unit));
            Assert.True(DistanceTo(world, unit, 2.5, 4.5) < 0.07);
            Run(world, 60);
            Assert.True(DistanceTo(world, unit, 2.5, 4.5) < 0.07);
            Assert.Null(world.activeSearch);
        }
    }

    public class AGroup : MovementScenario
    {
        [Fact]
        public void FormsUpAtItsDestinationWithoutAnyoneOverlapping()
        {
            World world = FlatWorld(40);
            int[] units = Block(world, 0, 5, 5, 6, 5);
            Move(world, 0, units, 28.5, 22.5);
            Run(world, 1200, () => AllIdle(world, units));
            Assert.True(AllIdle(world, units));
            Run(world, 60); // let any last shuffling finish
            foreach (int id in units) Assert.True(DistanceTo(world, id, 28.5, 22.5) < 3);
            // Radii sum to half a tile; a hair of overlap is tolerated.
            Assert.True(Fixed.ToFloat(Helpers.SmallestGap(world)) > -0.02);
            Assert.Equal(0, world.groups.Count);
        }

        [Fact]
        public void EndsUpFacingTheWayItWasSent()
        {
            World world = FlatWorld(40);
            int[] units = Block(world, 0, 20, 30, 4, 3);
            Move(world, 0, units, 20.9, 8.5);
            Run(world, 1200, () => AllIdle(world, units));
            foreach (int id in units)
            {
                Assert.True(Fixed.ToFloat(world.dirY[SlotOf(id)]) < -0.99);
            }
        }

        [Fact]
        public void GetsEveryoneThroughAGapOneTileWide()
        {
            const string wall = "..........#..........";
            const string gap = ".....................";
            World world = WorldFrom(new[] { wall, wall, wall, wall, gap, wall, wall, wall, wall });
            int[] units = Block(world, 0, 2, 3, 4, 4);
            Move(world, 0, units, 16.5, 4.5);
            Run(world, 2500, () => AllIdle(world, units));
            Assert.True(AllIdle(world, units));
            foreach (int id in units)
            {
                Assert.True(XOf(world, id) > 11, "every unit is past the wall");
                Assert.True(DistanceTo(world, id, 16.5, 4.5) < 3.5);
            }
            Run(world, 60);
            Assert.True(Fixed.ToFloat(Helpers.SmallestGap(world)) > -0.02);
        }

        [Fact]
        public void CrossesARiverByTheFord()
        {
            World world = WorldFrom(new[]
            {
                "................",
                "................",
                "................",
                "~~~~~~~~~~~,,~~~",
                "~~~~~~~~~~~,,~~~",
                "................",
                "................",
                "................",
            });
            int[] units = Block(world, 0, 1, 0.5, 4, 3);
            Move(world, 0, units, 3.5, 6.5);
            int wet = 0;
            Run(world, 2500, () =>
            {
                foreach (int id in units)
                {
                    double y = YOf(world, id);
                    if (y > 3 && y < 5)
                    {
                        wet++;
                        Assert.True(XOf(world, id) > 11);
                        Assert.True(XOf(world, id) < 13);
                    }
                }
                return AllIdle(world, units);
            });
            Assert.True(wet > 0);
            foreach (int id in units) Assert.True(YOf(world, id) > 5);
        }

        [Fact]
        public void SharesOneFlowFieldRatherThanSearchingOncePerUnit()
        {
            World world = WorldFrom(new[]
            {
                "............",
                ".....#......",
                ".....#......",
                ".....#......",
                ".....#......",
                "............",
            });
            int[] units = Block(world, 0, 1, 2, 3, 3);
            Move(world, 0, units, 9.5, 2.5);
            Simulation.Step(world);
            Assert.Equal(1, world.groups.Count);
            MoveGroup group = world.groups.Values[0];
            Assert.Equal(9, group.refs);
            Assert.NotNull(group.field);
            foreach (int id in units) Assert.Equal(MoveState.Field, world.moveState[SlotOf(id)]);
            Run(world, 800, () => AllIdle(world, units));
            foreach (int id in units) Assert.True(XOf(world, id) > 7);
            Assert.Equal(0, world.groups.Count);
        }

        [Fact]
        public void FollowsQueuedWaypointsTogetherAndTidiesUpAfterItself()
        {
            World world = FlatWorld(30);
            int[] units = Block(world, 0, 3, 3, 3, 2);
            Move(world, 0, units, 20.5, 4.5);
            Move(world, 0, units, 20.5, 20.5, true);
            Move(world, 0, units, 5.5, 20.5, true);
            Simulation.Step(world);
            Assert.Equal(3, world.groups.Count);
            double furthestEast = 0;
            Run(world, 3000, () =>
            {
                foreach (int id in units) furthestEast = Math.Max(furthestEast, XOf(world, id));
                return AllIdle(world, units);
            });
            Assert.True(furthestEast > 19.5);
            foreach (int id in units) Assert.True(DistanceTo(world, id, 5.5, 20.5) < 2);
            Assert.Equal(0, world.groups.Count);
        }

        [Fact]
        public void SendsEachUnitAsNearAsItCanGetWhenSomeCannotReachThePlace()
        {
            World world = WorldFrom(new[]
            {
                "......~~......",
                "......~~......",
                "......~~......",
                "......~~......",
            });
            int[] west = { Place(world, 0, 1.5, 1.5), Place(world, 0, 1.5, 2.5) };
            int[] east = { Place(world, 0, 12.5, 1.5), Place(world, 0, 12.5, 2.5) };
            int[] everyone = west.Concat(east).ToArray();
            Move(world, 0, everyone, 10.5, 2.0);
            Run(world, 600, () => AllIdle(world, everyone));
            foreach (int id in west)
            {
                Assert.True(XOf(world, id) > 4.5);
                Assert.True(XOf(world, id) < 6);
            }
            foreach (int id in east) Assert.True(DistanceTo(world, id, 10.5, 2.0) < 1);
        }
    }

    public class UnitsGettingInEachOthersWay : MovementScenario
    {
        [Fact]
        public void PassThroughAStandingComradeWhoThenReturnsToTheirPost()
        {
            World world = FlatWorld(30);
            int sentry = Place(world, 0, 15.0, 15.0);
            int[] column = Block(world, 0, 14.0, 5, 4, 3);
            Move(world, 0, column, 15.0, 25.5);
            double furthestPushed = 0;
            Run(world, 1200, () =>
            {
                furthestPushed = Math.Max(furthestPushed, DistanceTo(world, sentry, 15.0, 15.0));
                return AllIdle(world, column);
            });
            Assert.True(AllIdle(world, column));
            Assert.True(furthestPushed > 0.1, "the column walked through the sentry");
            Run(world, 90);
            Assert.True(DistanceTo(world, sentry, 15.0, 15.0) < 0.05);
        }

        [Fact]
        public void GoRoundAStandingUnitOfAnotherPlayerWhoDoesNotGiveWay()
        {
            // Allies, so that this is about getting past and not about fighting.
            World world = FlatWorld(30, config => config.teams = new[] { 0, 0 });
            int enemy = Place(world, 1, 15.0, 15.0);
            int unit = Place(world, 0, 15.0, 8.0);
            Move(world, 0, Ids(unit), 15.0, 22.0);
            Run(world, 600, () => Idle(world, unit));
            Assert.True(DistanceTo(world, unit, 15.0, 22.0) < 0.07);
            Assert.Equal(0, DistanceTo(world, enemy, 15.0, 15.0));
        }

        [Fact]
        public void TwoColumnsMarchingThroughEachOtherBothArrive()
        {
            const string lane = "........................";
            const string wall = "########################";
            World world = WorldFrom(new[] { wall, lane, lane, lane, lane, wall });
            int[] east = Block(world, 0, 1, 1.4, 4, 5);
            int[] west = Block(world, 1, 20.5, 1.4, 4, 5);
            Move(world, 0, east, 21.5, 3.0);
            Move(world, 1, west, 2.5, 3.0);
            Run(world, 3500, () => AllIdle(world, east) && AllIdle(world, west));
            Assert.True(AllIdle(world, east) && AllIdle(world, west));
            foreach (int id in east) Assert.True(XOf(world, id) > 18);
            foreach (int id in west) Assert.True(XOf(world, id) < 6);
        }

        [Fact]
        public void SettleNearbyWhenAnotherGroupAlreadyHoldsTheSpot()
        {
            World world = FlatWorld(30);
            int[] first = Block(world, 0, 3, 3, 3, 3);
            int[] second = Block(world, 0, 3, 24, 3, 3);
            Move(world, 0, first, 15.5, 15.5);
            Run(world, 900, () => AllIdle(world, first));
            Move(world, 0, second, 15.5, 15.5);
            Run(world, 1200, () => AllIdle(world, second));
            Assert.True(AllIdle(world, second));
            Run(world, 120);
            int[] everyone = first.Concat(second).ToArray();
            foreach (int id in everyone) Assert.True(DistanceTo(world, id, 15.5, 15.5) < 3.5);
            Assert.True(Fixed.ToFloat(Helpers.SmallestGap(world)) > -0.03);
            // And everyone has come to rest: nobody is still shuffling.
            (double x, double y)[] before = everyone.Select(id => (XOf(world, id), YOf(world, id))).ToArray();
            Run(world, 60);
            for (int i = 0; i < everyone.Length; i++)
            {
                Assert.True(DistanceTo(world, everyone[i], before[i].x, before[i].y) < 0.02);
            }
        }

        [Fact]
        public void SpawnedOnTopOfOneAnotherSpreadOutAndStandStill()
        {
            World world = FlatWorld(20);
            var units = new int[12];
            for (int i = 0; i < units.Length; i++) units[i] = Place(world, 0, 10.0, 10.0);
            Run(world, 300);
            Assert.True(Fixed.ToFloat(Helpers.SmallestGap(world)) > -0.02);
            (double x, double y)[] before = units.Select(id => (XOf(world, id), YOf(world, id))).ToArray();
            Run(world, 60);
            for (int i = 0; i < units.Length; i++)
            {
                Assert.True(DistanceTo(world, units[i], before[i].x, before[i].y) < 0.02);
            }
        }
    }

    public class ALargeBattlesWorthOfMovement : MovementScenario
    {
        [Fact]
        public void Moves400UnitsAcrossAGeneratedMapAndBringsNearlyAllOfThemHome()
        {
            var world = new World(new SimConfig { seed = 5, mapWidth = 128, mapHeight = 128, map = MapSpec.Generated(), maxEntities = 1024 });
            StartPosition a = world.map.starts[0];
            StartPosition b = world.map.starts[1];
            Send(world, 0, Command.Spawn(a.x, a.y, 200, 0));
            Send(world, 1, Command.Spawn(b.x, b.y, 200, 0));
            Run(world, 30);
            // Each army marches on the other's start, straight through the oncoming one.
            Send(world, 0, Command.Move(world.LivingEntities(0).ToArray(), b.x, b.y));
            Send(world, 1, Command.Move(world.LivingEntities(1).ToArray(), a.x, a.y));
            List<int> everyone = world.LivingEntities();
            Run(world, 9000, () => AllIdle(world, everyone));
            bool Home(int id)
            {
                int slot = SlotOf(id);
                StartPosition target = world.owner[slot] == 0 ? b : a;
                return Fixed.ToFloat(Fixed.Length(world.posX[slot] - target.x, world.posY[slot] - target.y)) < 14;
            }
            int arrived = everyone.Count(Home);
            Assert.True(arrived > 380, $"units within 14 tiles of their destination: {arrived}");
            Assert.True(AllIdle(world, everyone));
        }
    }
}
