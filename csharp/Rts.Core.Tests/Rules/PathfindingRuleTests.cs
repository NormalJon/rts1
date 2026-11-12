// Translated from test/pathfinding.test.ts. Keep the two in step.

using Rts.Sim;

namespace Rts.Tests.Rules
{
    static class Pathfinding
    {
        /// <summary>Stands for "cannot be reached" in ReferenceCosts (Infinity in the TypeScript).</summary>
        public const int UNREACHABLE = int.MaxValue;

        /// <summary>A map with rock scattered over about a third of it.</summary>
        public static GameMap RandomMap(Rng rng, int size)
        {
            var rows = new string[size];
            for (int y = 0; y < size; y++)
            {
                var row = new char[size];
                for (int x = 0; x < size; x++) row[x] = rng.Chance(3, 10) ? '#' : '.';
                rows[y] = new string(row);
            }
            return Maps.Ascii(rows);
        }

        /// <summary>
        /// Cheapest cost from every tile to the goal, worked out the slow, obvious
        /// way: keep improving every tile from its neighbours until nothing changes.
        /// </summary>
        public static int[] ReferenceCosts(GameMap map, int goal)
        {
            var cost = new int[map.tileCount];
            Array.Fill(cost, UNREACHABLE);
            cost[goal] = 0;
            for (bool changed = true; changed;)
            {
                changed = false;
                for (int tile = 0; tile < map.tileCount; tile++)
                {
                    if (cost[tile] == UNREACHABLE) continue;
                    int tx = tile % map.width;
                    int ty = tile / map.width;
                    for (int dir = 0; dir < 8; dir++)
                    {
                        if (!map.CanStep(tx, ty, dir)) continue;
                        int next = (ty + GameMap.DIR_Y[dir]) * map.width + tx + GameMap.DIR_X[dir];
                        int through = cost[tile] + (dir % 2 == 0 ? GameMap.STEP_ORTHOGONAL : GameMap.STEP_DIAGONAL);
                        if (through < cost[next])
                        {
                            cost[next] = through;
                            changed = true;
                        }
                    }
                }
            }
            return cost;
        }

        /// <summary>Checks a tile path is made of legal steps and returns what it costs.</summary>
        public static int PathCost(GameMap map, IReadOnlyList<int> tiles)
        {
            int total = 0;
            for (int i = 1; i < tiles.Count; i++)
            {
                int from = tiles[i - 1];
                int to = tiles[i];
                int dx = (to % map.width) - (from % map.width);
                int dy = to / map.width - from / map.width;
                int dir = -1;
                for (int d = 0; d < 8 && dir == -1; d++)
                {
                    if (GameMap.DIR_X[d] == dx && GameMap.DIR_Y[d] == dy) dir = d;
                }
                if (dir == -1) Assert.Fail($"step {i} is not to a neighbouring tile");
                if (!map.CanStep(from % map.width, from / map.width, dir)) Assert.Fail($"step {i} is not allowed");
                total += dir % 2 == 0 ? GameMap.STEP_ORTHOGONAL : GameMap.STEP_DIAGONAL;
            }
            return total;
        }

        public static void RunToEnd(Search search, int slice = 1 << 30)
        {
            while (!search.done) search.Run(slice);
        }
    }

    public class AStarPathSearch
    {
        [Fact]
        public void FindsTheCheapestRouteCheckedAgainstABruteForceReference()
        {
            var rng = new Rng(11);
            int checkedRoutes = 0;
            for (int m = 0; m < 25; m++)
            {
                GameMap map = Pathfinding.RandomMap(rng, 22);
                var scratch = new SearchScratch(map.tileCount);
                for (int trial = 0; trial < 12; trial++)
                {
                    int start = (int)rng.NextInt(map.tileCount);
                    int goal = (int)rng.NextInt(map.tileCount);
                    if (map.passable[start] == 0 || map.passable[goal] == 0) continue;
                    int reference = Pathfinding.ReferenceCosts(map, goal)[start];
                    var search = new AStarSearch(map, scratch, start, goal);
                    Pathfinding.RunToEnd(search);
                    if (reference == Pathfinding.UNREACHABLE)
                    {
                        Assert.False(search.found);
                        Assert.NotEqual(map.region[goal], map.region[start]);
                        continue;
                    }
                    Assert.True(search.found);
                    int[] tiles = search.Path();
                    Assert.Equal(start, tiles[0]);
                    Assert.Equal(goal, tiles[tiles.Length - 1]);
                    int cost = Pathfinding.PathCost(map, tiles);
                    Assert.True(cost == reference, $"map {m}, {start} to {goal}: the route costs {cost}, the cheapest is {reference}");
                    checkedRoutes++;
                }
            }
            Assert.True(checkedRoutes > 80);
        }

        [Fact]
        public void GoesStraightAcrossOpenGround()
        {
            GameMap map = MapGen.BuildMap(40, 40, 1, MapSpec.Flat());
            var search = new AStarSearch(map, new SearchScratch(map.tileCount), map.Index(3, 5), map.Index(30, 20));
            Pathfinding.RunToEnd(search);
            // 27 across and 15 down: 15 diagonal steps and 12 straight ones.
            Assert.Equal(28, search.Path().Length);
            // With nothing in the way it should barely look beyond the route itself.
            Assert.True(search.expansions < 60);
        }

        [Fact]
        public void GivesTheSameAnswerWhetherRunInOneGoOrAFewTilesAtATime()
        {
            var rng = new Rng(21);
            for (int m = 0; m < 10; m++)
            {
                GameMap map = Pathfinding.RandomMap(rng, 30);
                int start = map.NearestPassable(2, 2);
                int goal = map.NearestPassable(27, 27, map.region[start]);
                if (goal == -1) continue;
                var whole = new AStarSearch(map, new SearchScratch(map.tileCount), start, goal);
                Pathfinding.RunToEnd(whole);
                var sliced = new AStarSearch(map, new SearchScratch(map.tileCount), start, goal);
                int slices = 0;
                while (!sliced.done)
                {
                    Assert.True(sliced.Run(5) <= 5);
                    slices++;
                }
                Assert.Equal(whole.Path(), sliced.Path());
                Assert.Equal(whole.expansions, sliced.expansions);
                if (whole.expansions > 5) Assert.True(slices > 1);
            }
        }

        [Fact]
        public void CanBeReRunToAnExactPointAsLoadingASavedGameDoes()
        {
            GameMap map = Pathfinding.RandomMap(new Rng(31), 30);
            int start = map.NearestPassable(1, 1);
            int goal = map.NearestPassable(28, 28, map.region[start]);
            var a = new AStarSearch(map, new SearchScratch(map.tileCount), start, goal);
            a.Run(17);
            var b = new AStarSearch(map, new SearchScratch(map.tileCount), start, goal);
            Assert.Equal(a.expansions, b.Run(a.expansions));
            Pathfinding.RunToEnd(a, 3);
            Pathfinding.RunToEnd(b, 1000);
            Assert.Equal(a.Path(), b.Path());
        }
    }

    public class FlowFieldSearch
    {
        [Fact]
        public void PointsEveryTileItReachesAlongACheapestRouteToTheGoal()
        {
            var rng = new Rng(41);
            for (int m = 0; m < 12; m++)
            {
                GameMap map = Pathfinding.RandomMap(rng, 22);
                int goal = map.NearestPassable(11, 11);
                var search = new FieldSearch(map, new SearchScratch(map.tileCount), goal, new int[0]);
                Pathfinding.RunToEnd(search);
                int[] reference = Pathfinding.ReferenceCosts(map, goal);
                byte[] field = search.directions;
                Assert.Equal(Search.FIELD_GOAL, field[goal]);
                for (int tile = 0; tile < map.tileCount; tile++)
                {
                    if (reference[tile] == Pathfinding.UNREACHABLE)
                    {
                        Assert.Equal(Search.FIELD_UNKNOWN, field[tile]);
                        continue;
                    }
                    // Walk the field from here and add up the steps.
                    var walked = new List<int> { tile };
                    for (int at = tile; at != goal;)
                    {
                        int dir = field[at];
                        Assert.True(dir < 8);
                        at += GameMap.DIR_Y[dir] * map.width + GameMap.DIR_X[dir];
                        walked.Add(at);
                        if (walked.Count > map.tileCount) Assert.Fail("the field loops");
                    }
                    int cost = Pathfinding.PathCost(map, walked);
                    Assert.True(cost == reference[tile], $"map {m}, tile {tile}: the field's way costs {cost}, the cheapest is {reference[tile]}");
                }
            }
        }

        [Fact]
        public void StopsSoonAfterCoveringTheTilesItWasAskedFor()
        {
            GameMap map = MapGen.BuildMap(120, 120, 1, MapSpec.Flat());
            int goal = map.Index(60, 60);
            int[] targets = { map.Index(55, 58), map.Index(52, 61), map.Index(57, 66) };
            var near = new FieldSearch(map, new SearchScratch(map.tileCount), goal, targets);
            Pathfinding.RunToEnd(near);
            foreach (int tile in targets) Assert.True(near.directions[tile] < 8);
            // A good margin around the group is covered too, so a unit jostled off
            // course still finds the field under its feet.
            Assert.True(near.directions[map.Index(45, 60)] < 8);
            Assert.Equal(Search.FIELD_UNKNOWN, near.directions[map.Index(5, 5)]);
            Assert.True(near.expansions < 2500);

            var everything = new FieldSearch(map, new SearchScratch(map.tileCount), goal, new int[0]);
            Pathfinding.RunToEnd(everything);
            Assert.Equal(map.tileCount, everything.expansions);
        }

        [Fact]
        public void GivesTheSameFieldWhetherRunInOneGoOrAFewTilesAtATime()
        {
            GameMap map = Pathfinding.RandomMap(new Rng(51), 40);
            int goal = map.NearestPassable(20, 20);
            int[] targets = { map.NearestPassable(3, 3, map.region[goal]), map.NearestPassable(36, 30, map.region[goal]) };
            var whole = new FieldSearch(map, new SearchScratch(map.tileCount), goal, targets);
            Pathfinding.RunToEnd(whole);
            var sliced = new FieldSearch(map, new SearchScratch(map.tileCount), goal, targets);
            Pathfinding.RunToEnd(sliced, 7);
            Assert.Equal(whole.directions, sliced.directions);
            Assert.Equal(whole.expansions, sliced.expansions);
        }

        [Fact]
        public void RoutesThroughAFordRatherThanThroughTheRiver()
        {
            GameMap map = Maps.Ascii(
                "........",
                "........",
                "~~~~~,~~",
                "~~~~~,~~",
                "........",
                "........");
            int goal = map.Index(1, 5);
            var search = new FieldSearch(map, new SearchScratch(map.tileCount), goal, new int[0]);
            Pathfinding.RunToEnd(search);
            // From the far bank, the walk must pass over the ford at x = 5.
            var visited = new HashSet<int>();
            for (int at = map.Index(1, 0); at != goal;)
            {
                visited.Add(at);
                int dir = search.directions[at];
                at += GameMap.DIR_Y[dir] * map.width + GameMap.DIR_X[dir];
            }
            Assert.Contains(map.Index(5, 2), visited);
            Assert.Contains(map.Index(5, 3), visited);
        }
    }
}
