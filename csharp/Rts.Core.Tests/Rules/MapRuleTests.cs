// Translated from test/map.test.ts. Keep the two in step.

using Rts.Sim;
using static Rts.Sim.Fixed;

namespace Rts.Tests.Rules
{
    static class Maps
    {
        public static GameMap Ascii(params string[] rows)
        {
            return MapGen.BuildMap(rows[0].Length, rows.Length, 1, MapSpec.Ascii(rows));
        }

        public static GameMap Generated(int width, int height, int seed)
        {
            return MapGen.BuildMap(width, height, seed, MapSpec.Generated());
        }
    }

    public class HandDrawnMaps
    {
        static readonly GameMap map = Maps.Ascii(
            "0.....#...",
            "......#...",
            "..TT..#...",
            "..TT......",
            "~~~~,,~~~~",
            ".........1");

        [Fact]
        public void ReadsTerrainAndStarts()
        {
            Assert.Equal(10, map.width);
            Assert.Equal(6, map.height);
            Assert.Equal(Terrain.Rock, map.terrain[map.Index(6, 0)]);
            Assert.Equal(Terrain.Forest, map.terrain[map.Index(2, 2)]);
            Assert.Equal(Terrain.Water, map.terrain[map.Index(0, 4)]);
            Assert.Equal(Terrain.Shallows, map.terrain[map.Index(4, 4)]);
            Assert.Equal(2, map.starts.Length);
            Assert.Equal(Units.FromFloat(0.5), map.starts[0].x);
            Assert.Equal(Units.FromFloat(0.5), map.starts[0].y);
            Assert.Equal(Units.FromFloat(9.5), map.starts[1].x);
            Assert.Equal(Units.FromFloat(5.5), map.starts[1].y);
        }

        [Fact]
        public void KnowsWhatCanBeWalkedOn()
        {
            Assert.True(map.IsPassable(0, 0));
            Assert.True(map.IsPassable(4, 4)); // the ford
            Assert.False(map.IsPassable(6, 1));
            Assert.False(map.IsPassable(2, 2));
            Assert.False(map.IsPassable(0, 4));
            Assert.False(map.IsPassable(-1, 0));
            Assert.False(map.IsPassable(10, 0));
        }

        [Fact]
        public void LabelsGroundJoinedByAFordAsOneRegion()
        {
            int north = map.region[map.Index(0, 0)];
            Assert.True(north > 0);
            Assert.Equal(north, map.region[map.Index(9, 5)]);
            Assert.Equal(north, map.region[map.Index(8, 0)]); // round the end of the rock wall
            Assert.Equal(0, map.region[map.Index(6, 0)]);
        }

        [Fact]
        public void SeparatesGroundThatCannotBeReached()
        {
            GameMap island = Maps.Ascii("....~...", "....~...", "....~...");
            Assert.NotEqual(island.region[island.Index(7, 0)], island.region[island.Index(0, 0)]);
        }

        [Fact]
        public void DoesNotLetAnythingSqueezeBetweenObstaclesThatTouchAtACorner()
        {
            GameMap pinch = Maps.Ascii("..#", ".#.", "#..");
            Assert.False(pinch.CanStep(1, 0, 1)); // south-east, between the two rocks
            Assert.NotEqual(pinch.region[pinch.Index(2, 2)], pinch.region[pinch.Index(0, 0)]);
        }

        [Fact]
        public void TracesLinesOfSight()
        {
            bool See(double ax, double ay, double bx, double by)
            {
                return map.LineOfSight(Units.FromFloat(ax), Units.FromFloat(ay), Units.FromFloat(bx), Units.FromFloat(by));
            }
            Assert.True(See(0.5, 0.5, 5.5, 0.5));
            Assert.False(See(0.5, 0.5, 7.5, 0.5)); // through the rock wall
            Assert.False(See(7.5, 0.5, 0.5, 0.5)); // and the other way
            Assert.False(See(0.5, 3.5, 5.5, 3.5)); // through the wood
            Assert.True(See(4.5, 3.5, 4.5, 5.5)); // across the ford
            Assert.False(See(2.5, 3.9, 2.5, 5.5)); // from the wood
            Assert.True(See(5.2, 0.2, 5.2, 3.8)); // straight down a column
            Assert.True(See(4.2, 1.2, 4.2, 1.2)); // a point sees itself
        }

        [Fact]
        public void AgreesWithABruteForceCheckOnRandomLines()
        {
            // Sample each line densely and compare with the exact traversal. A line
            // the sampling finds blocked must be reported blocked.
            GameMap big = Maps.Generated(64, 64, 7);
            int state = 12345;
            double Next()
            {
                state = unchecked(state * 1103515245 + 12345) & 0x7fffffff;
                return state / (double)0x7fffffff;
            }
            int clear = 0;
            int blocked = 0;
            for (int i = 0; i < 4000; i++)
            {
                double x0 = 0.1 + Next() * 63.8;
                double y0 = 0.1 + Next() * 63.8;
                double x1 = Math.Min(63.9, Math.Max(0.1, x0 + (Next() - 0.5) * 20));
                double y1 = Math.Min(63.9, Math.Max(0.1, y0 + (Next() - 0.5) * 20));
                bool sampledBlocked = false;
                for (int s = 0; s <= 400; s++)
                {
                    double x = x0 + ((x1 - x0) * s) / 400;
                    double y = y0 + ((y1 - y0) * s) / 400;
                    if (!big.IsPassable((int)Math.Floor(x), (int)Math.Floor(y))) sampledBlocked = true;
                }
                bool result = big.LineOfSight(Units.FromFloat(x0), Units.FromFloat(y0), Units.FromFloat(x1), Units.FromFloat(y1));
                if (sampledBlocked) Assert.False(result, $"line {i}");
                if (result) clear++;
                else blocked++;
            }
            Assert.True(clear > 300);
            Assert.True(blocked > 300);
        }

        [Fact]
        public void AllowsForAUnitsWidthWhenCheckingAStraightWalk()
        {
            GameMap lane = Maps.Ascii("......", ".####.", "......");
            int r = FromRatio(1, 4);
            int F(double x) => Units.FromFloat(x);
            // Walking along the top lane close to the wall: the centre line is clear,
            // but hugging it this tightly is not.
            Assert.True(lane.LineOfSight(F(0.5), F(0.95), F(5.5), F(0.95)));
            Assert.False(lane.ClearPath(F(0.5), F(0.95), F(5.5), F(0.95), r));
            Assert.True(lane.ClearPath(F(0.5), F(0.5), F(5.5), F(0.5), r));
        }

        [Fact]
        public void FindsTheNearestOpenGround()
        {
            Assert.Equal(map.Index(0, 0), map.NearestPassable(0, 0));
            Assert.Equal(map.Index(5, 0), map.NearestPassable(6, 0));
            // From the middle of the wood, any of the tiles just outside it.
            int near = map.NearestPassable(2, 2);
            Assert.Equal(1, map.passable[near]);
            int dx = (near % map.width) - 2;
            int dy = near / map.width - 2;
            Assert.True(dx * dx + dy * dy <= 2);
            // Restricted to a region it is not in.
            GameMap island = Maps.Ascii("....~...", "....~...", "....~...");
            int east = island.region[island.Index(7, 1)];
            Assert.Equal(island.Index(5, 1), island.NearestPassable(0, 1, east));
            Assert.Equal(-1, Maps.Ascii("~~", "~~").NearestPassable(0, 0));
        }

        [Fact]
        public void RejectsMapsItCannotRead()
        {
            Assert.ThrowsAny<Exception>(() => Maps.Ascii("..", "."));
            Assert.Contains("unknown map character", Assert.Throws<ArgumentException>(() => Maps.Ascii(".x")).Message);
            Assert.Contains("missing start 0", Assert.Throws<ArgumentException>(() => Maps.Ascii("1.")).Message);
        }
    }

    public class FlatMaps
    {
        [Fact]
        public void AreOpenGrassWithEightStartPointsOnTheMap()
        {
            GameMap map = MapGen.BuildMap(40, 30, 1, MapSpec.Flat());
            Assert.True(map.passable.All(p => p == 1));
            Assert.Equal(8, map.starts.Length);
            foreach (StartPosition start in map.starts)
            {
                Assert.True(start.x > 0);
                Assert.True(start.x < FromInt(40));
                Assert.True(start.y > 0);
                Assert.True(start.y < FromInt(30));
            }
        }
    }

    public class GeneratedMaps
    {
        static readonly int[][] sizes =
        {
            new[] { 48, 48 },
            new[] { 64, 64 },
            new[] { 96, 64 },
            new[] { 128, 128 },
        };

        [Fact]
        public void AreTheSameEveryTimeForTheSameSeed()
        {
            GameMap a = Maps.Generated(96, 96, 42);
            GameMap b = Maps.Generated(96, 96, 42);
            Assert.Equal(a.checksum, b.checksum);
            Assert.Equal(a.terrain, b.terrain);
            Assert.NotEqual(a.checksum, Maps.Generated(96, 96, 43).checksum);
        }

        [Fact]
        public void MatchARecordedMapSoAChangeToTheGeneratorIsNoticed()
        {
            // The lie of the land, then what stands on it.
            GameMap map = Maps.Generated(64, 64, 20261111);
            Assert.Equal("93db42d2 fe982e0e", $"{map.checksum:x} {unchecked((uint)map.stateHash):x}");
        }

        [Fact]
        public void AreFairIdenticalUnderAHalfTurnInTerrainAndInHeight()
        {
            foreach (int[] size in sizes)
            {
                int width = size[0];
                int height = size[1];
                for (int seed = 1; seed <= 12; seed++)
                {
                    GameMap map = Maps.Generated(width, height, seed);
                    for (int tile = 0; tile < map.tileCount; tile++)
                    {
                        if (map.terrain[tile] != map.terrain[map.tileCount - 1 - tile])
                        {
                            Assert.Fail($"terrain differs at tile {tile}, {width}x{height} seed {seed}");
                        }
                    }
                    int corners = map.elevation.Length;
                    for (int c = 0; c < corners; c++)
                    {
                        if (map.elevation[c] != map.elevation[corners - 1 - c])
                        {
                            Assert.Fail($"height differs at corner {c}, {width}x{height} seed {seed}");
                        }
                    }
                    StartPosition a = map.starts[0];
                    StartPosition b = map.starts[1];
                    Assert.Equal(FromInt(width), a.x + b.x);
                    Assert.Equal(FromInt(height), a.y + b.y);
                }
            }
        }

        [Fact]
        public void AlwaysLetTheTwoPlayersReachEachOther()
        {
            foreach (int[] size in sizes)
            {
                int width = size[0];
                int height = size[1];
                for (int seed = 1; seed <= 40; seed++)
                {
                    GameMap map = Maps.Generated(width, height, seed);
                    StartPosition a = map.starts[0];
                    StartPosition b = map.starts[1];
                    int regionA = map.region[map.TileAt(a.x, a.y)];
                    Assert.True(regionA > 0, $"{width}x{height} seed {seed}");
                    Assert.True(map.region[map.TileAt(b.x, b.y)] == regionA, $"{width}x{height} seed {seed}");
                }
            }
        }

        [Fact]
        public void HaveARiverWithFordsForestRockAndOpenStarts()
        {
            for (int seed = 1; seed <= 20; seed++)
            {
                GameMap map = Maps.Generated(128, 128, seed);
                double Share(int id) => map.terrain.Count(t => t == id) / (double)map.tileCount;
                Assert.True(Share(Terrain.Water) > 0.015);
                Assert.True(Share(Terrain.Shallows) > 0.002);
                Assert.True(Share(Terrain.Forest) > 0.12);
                // A fifth of the map is sown with forest; cut-off clearings then fill in with more.
                Assert.True(Share(Terrain.Forest) < 0.3);
                Assert.True(Share(Terrain.Rock) > 0.01);
                Assert.True(Share(Terrain.Rock) < 0.035);
                // Open, level ground around each start.
                foreach (StartPosition start in map.starts)
                {
                    int tx = start.x >> 16;
                    int ty = start.y >> 16;
                    for (int oy = -5; oy <= 5; oy++)
                    {
                        for (int ox = -5; ox <= 5; ox++)
                        {
                            Assert.Equal(Terrain.Grass, map.terrain[map.Index(tx + ox, ty + oy)]);
                            Assert.Equal(0, map.elevation[(ty + oy) * (map.width + 1) + tx + ox]);
                        }
                    }
                }
                // Water lies below the ground around it; the highest hills stay modest.
                int highest = map.elevation.Aggregate(0, (m, h) => Math.Max(m, h));
                Assert.True(highest > FromInt(1));
                Assert.True(highest < FromInt(6));
            }
        }

        [Fact]
        public void LeaveNoGroundThatCannotBeWalkedTo()
        {
            foreach (int[] size in sizes)
            {
                int width = size[0];
                int height = size[1];
                for (int seed = 1; seed <= 20; seed++)
                {
                    GameMap map = Maps.Generated(width, height, seed);
                    int regions = map.region.Where(r => r != 0).Distinct().Count();
                    Assert.True(regions == 1, $"{width}x{height} seed {seed}: {regions} separate pieces of ground");
                }
            }
        }

        [Fact]
        public void GiveBothStartsTheSameResourcesWithinAShortWalk()
        {
            foreach (int[] size in sizes)
            {
                int width = size[0];
                int height = size[1];
                for (int seed = 1; seed <= 25; seed++)
                {
                    GameMap map = Maps.Generated(width, height, seed);
                    int home = map.region[map.TileAt(map.starts[0].x, map.starts[0].y)];
                    int[][] counts = map.starts.Select(start =>
                    {
                        var near = new int[8];
                        int startX = start.x >> 16;
                        int startY = start.y >> 16;
                        for (int ty = startY - 13; ty <= startY + 13; ty++)
                        {
                            for (int tx = startX - 13; tx <= startX + 13; tx++)
                            {
                                if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
                                near[map.terrain[map.Index(tx, ty)]]++;
                            }
                        }
                        return near;
                    }).ToArray();
                    string label = $"{width}x{height} seed {seed}";
                    Assert.True(counts[0][Terrain.Berries] >= 6, label);
                    Assert.True(counts[0][Terrain.Gold] >= 6, label);
                    Assert.True(counts[0][Terrain.Stone] >= 4, label);
                    Assert.True(counts[0][Terrain.Forest] >= 15, label);
                    Assert.True(counts[1].SequenceEqual(counts[0]), label);
                    // Every berry, stone and gold tile can be stood beside and worked.
                    for (int tile = 0; tile < map.tileCount; tile++)
                    {
                        int terrain = map.terrain[tile];
                        if (terrain == Terrain.Berries || terrain == Terrain.Stone || terrain == Terrain.Gold)
                        {
                            Assert.True(map.CanBeWorkedFrom(tile, home), $"{label} tile {tile}");
                            Assert.True(map.amount[tile] > 0);
                        }
                    }
                    // The town centre's ground and the ring round it stay clear.
                    int sx = map.starts[0].x >> 16;
                    int sy = map.starts[0].y >> 16;
                    for (int oy = -4; oy <= 4; oy++)
                    {
                        for (int ox = -4; ox <= 4; ox++) Assert.True(map.terrain[map.Index(sx + ox, sy + oy)] == Terrain.Grass, label);
                    }
                }
            }
        }

        [Fact]
        public void PutMoreGoldAndStoneOutInContestedGround()
        {
            GameMap map = Maps.Generated(128, 128, 3);
            bool Far(int tile)
            {
                return map.starts.All(start =>
                {
                    int dx = (tile % map.width) - (start.x >> 16);
                    int dy = tile / map.width - (start.y >> 16);
                    return dx * dx + dy * dy >= 15 * 15;
                });
            }
            int gold = 0;
            int stone = 0;
            for (int tile = 0; tile < map.tileCount; tile++)
            {
                if (!Far(tile)) continue;
                if (map.terrain[tile] == Terrain.Gold) gold++;
                if (map.terrain[tile] == Terrain.Stone) stone++;
            }
            Assert.Equal(36, gold);
            Assert.Equal(24, stone);
        }

        [Fact]
        public void KeepCountOfWhatEachTileHolds()
        {
            GameMap map = Maps.Ascii(".Tbsg#~,");
            Assert.Equal(new[] { 0, 100, 250, 500, 700, 0, 0, 0 }, map.amount);
            int before = map.stateHash;
            Assert.False(map.Harvest(1));
            Assert.Equal(99, map.amount[1]);
            Assert.NotEqual(before, map.stateHash);
            Assert.False(map.Harvest(0)); // nothing to take from grass
            Assert.Equal(0, map.amount[0]);
        }

        [Fact]
        public void RefuseSizesTooSmallToHoldARiverAndTwoBases()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => Maps.Generated(32, 32, 1));
        }
    }
}
