// Ported from src/sim/mapgen.ts. Keep the two in step.

using System;
using System.Collections.Generic;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    public enum MapKind
    {
        /// <summary>Open grass. For tests and debug pages.</summary>
        Flat,
        /// <summary>
        /// Drawn by hand, one string per row: . grass, T forest, ~ water, , shallows,
        /// # rock, b berries, s stone, g gold, and digits 0 to 7 for player starts.
        /// </summary>
        Ascii,
        Generated,
    }

    public sealed class MapSpec
    {
        public readonly MapKind kind;
        /// <summary>The rows of a hand-drawn map; null otherwise.</summary>
        public readonly string[] rows;

        public MapSpec(MapKind kind, string[] rows = null)
        {
            this.kind = kind;
            this.rows = rows;
        }

        public static MapSpec Flat()
        {
            return new MapSpec(MapKind.Flat);
        }

        public static MapSpec Ascii(string[] rows)
        {
            return new MapSpec(MapKind.Ascii, rows);
        }

        public static MapSpec Generated()
        {
            return new MapSpec(MapKind.Generated);
        }
    }

    /// <summary>
    /// Builds the map for a match from its settings.
    ///
    /// Generated maps are symmetric under a half turn about the centre: whatever
    /// player 1 finds going out from their start, player 2 finds too. A river
    /// runs between the two starts and can be crossed at three fords. Each start
    /// has berries, a copse, gold and stone within a short walk, and more gold
    /// and stone lie further out to be fought over. Everything is integer
    /// arithmetic, so the same seed gives the same map on every machine.
    /// </summary>
    public static class MapGen
    {
        public const int MIN_GENERATED_SIZE = 48;

        public static GameMap BuildMap(int width, int height, int seed, MapSpec spec)
        {
            switch (spec.kind)
            {
                case MapKind.Flat:
                    return new GameMap(
                        width,
                        height,
                        new byte[width * height],
                        new int[(width + 1) * (height + 1)],
                        RingStarts(width, height));
                case MapKind.Ascii:
                    return FromAscii(width, height, spec.rows);
                case MapKind.Generated:
                    return Generate(width, height, seed);
                default:
                    throw new ArgumentException("unknown kind of map");
            }
        }

        static StartPosition TileCentre(int tx, int ty)
        {
            return new StartPosition(tx * ONE + HALF, ty * ONE + HALF);
        }

        /// <summary>Eight start points around the map, each opposite the one before it.</summary>
        static StartPosition[] RingStarts(int width, int height)
        {
            int[][] offsets =
            {
                new[] { -3, -3 },
                new[] { 3, 3 },
                new[] { 3, -3 },
                new[] { -3, 3 },
                new[] { 0, -3 },
                new[] { 0, 3 },
                new[] { -3, 0 },
                new[] { 3, 0 },
            };
            var starts = new StartPosition[offsets.Length];
            for (int i = 0; i < offsets.Length; i++)
            {
                starts[i] = TileCentre(
                    Math.Min(width - 1, Idiv(width * (5 + offsets[i][0]), 10)),
                    Math.Min(height - 1, Idiv(height * (5 + offsets[i][1]), 10)));
            }
            return starts;
        }

        static GameMap FromAscii(int width, int height, string[] rows)
        {
            bool fits = rows != null && rows.Length == height;
            for (int i = 0; fits && i < rows.Length; i++) fits = rows[i].Length == width;
            if (!fits) throw new ArgumentException($"ascii map must be {width} by {height} to match mapWidth and mapHeight");
            var terrain = new byte[width * height];
            var starts = new List<StartPosition?>();
            for (int ty = 0; ty < height; ty++)
            {
                for (int tx = 0; tx < width; tx++)
                {
                    char ch = rows[ty][tx];
                    if (ch >= '0' && ch <= '7')
                    {
                        int player = ch - '0';
                        while (starts.Count <= player) starts.Add(null);
                        starts[player] = TileCentre(tx, ty);
                        continue;
                    }
                    int id;
                    switch (ch)
                    {
                        case '.': id = Terrain.Grass; break;
                        case 'T': id = Terrain.Forest; break;
                        case '~': id = Terrain.Water; break;
                        case ',': id = Terrain.Shallows; break;
                        case '#': id = Terrain.Rock; break;
                        case 'b': id = Terrain.Berries; break;
                        case 's': id = Terrain.Stone; break;
                        case 'g': id = Terrain.Gold; break;
                        default: throw new ArgumentException($"unknown map character \"{ch}\" at {tx},{ty}");
                    }
                    terrain[ty * width + tx] = (byte)id;
                }
            }
            var all = new StartPosition[starts.Count];
            for (int i = 0; i < starts.Count; i++)
            {
                if (starts[i] == null) throw new ArgumentException($"ascii map is missing start {i}");
                all[i] = starts[i].Value;
            }
            return new GameMap(width, height, terrain, new int[(width + 1) * (height + 1)], all);
        }

        // ---- Noise -----------------------------------------------------------------

        static uint Hash2(int seed, int x, int y)
        {
            unchecked
            {
                uint h = (uint)seed ^ (uint)x * 0x27d4eb2d ^ (uint)y * 0x165667b1;
                h = (h ^ (h >> 15)) * 0x2c1b3c6d;
                h = (h ^ (h >> 12)) * 0x297a2d39;
                return h ^ (h >> 15);
            }
        }

        /// <summary>Smoothly varying value in [0, 1) at a fixed-point lattice coordinate.</summary>
        static int ValueNoise(int seed, int x, int y)
        {
            int xi = x >> 16;
            int yi = y >> 16;
            int fx = x & 0xffff;
            int fy = y & 0xffff;
            // Smoothstep, 3t^2 - 2t^3, so the lattice does not show as creases.
            int sx = Mul(Mul(fx, fx), 3 * ONE - 2 * fx);
            int sy = Mul(Mul(fy, fy), 3 * ONE - 2 * fy);
            int a = (int)(Hash2(seed, xi, yi) >> 16);
            int b = (int)(Hash2(seed, xi + 1, yi) >> 16);
            int c = (int)(Hash2(seed, xi, yi + 1) >> 16);
            int d = (int)(Hash2(seed, xi + 1, yi + 1) >> 16);
            int top = a + Mul(b - a, sx);
            int bottom = c + Mul(d - c, sx);
            return top + Mul(bottom - top, sy);
        }

        // ---- Generator -------------------------------------------------------------

        const int START_CLEARING = 10; // tiles of open ground around each start
        const int FORD_CLEARING = 5;
        const int FOREST_SHARE = 20; // percent of tiles
        const int ROCK_SHARE = 3;
        /// <summary>Nothing is placed this close to a start: the town centre and the ground round it.</summary>
        const int TOWN_RESERVE = 4;
        /// <summary>How far from any start the contested deposits lie, at least.</summary>
        const int NEUTRAL_DISTANCE = 16;

        static readonly int[][] BLOCK_3X2 =
        {
            new[] { 0, 0 },
            new[] { 1, 0 },
            new[] { 2, 0 },
            new[] { 0, 1 },
            new[] { 1, 1 },
            new[] { 2, 1 },
        };
        static readonly int[][] BLOCK_2X2 =
        {
            new[] { 0, 0 },
            new[] { 1, 0 },
            new[] { 0, 1 },
            new[] { 1, 1 },
        };
        /// <summary>A rough disc about five tiles across.</summary>
        static readonly int[][] COPSE = MakeCopse();

        static int[][] MakeCopse()
        {
            var cells = new List<int[]>();
            for (int y = -2; y <= 2; y++)
            {
                for (int x = -2; x <= 2; x++) if (x * x + y * y <= 6) cells.Add(new[] { x, y });
            }
            return cells.ToArray();
        }

        /// <summary>What every start gets, and how many tiles away.</summary>
        static readonly (int id, int[][] cells, int distance)[] STARTING_RESOURCES =
        {
            (Terrain.Berries, BLOCK_3X2, 6),
            (Terrain.Forest, COPSE, 8),
            (Terrain.Gold, BLOCK_3X2, 8),
            (Terrain.Stone, BLOCK_2X2, 9),
        };
        /// <summary>Sixteen compass directions, in 1024ths.</summary>
        static readonly int[][] COMPASS =
        {
            new[] { 1024, 0 },
            new[] { 946, 392 },
            new[] { 724, 724 },
            new[] { 392, 946 },
            new[] { 0, 1024 },
            new[] { -392, 946 },
            new[] { -724, 724 },
            new[] { -946, 392 },
            new[] { -1024, 0 },
            new[] { -946, -392 },
            new[] { -724, -724 },
            new[] { -392, -946 },
            new[] { 0, -1024 },
            new[] { 392, -946 },
            new[] { 724, -724 },
            new[] { 946, -392 },
        };

        /// <summary>A place along the river: where its middle is, and how wide it is there.</summary>
        struct RiverPoint
        {
            public int x;
            public int y;
            public int halfWidth;
        }

        static GameMap Generate(int width, int height, int seed)
        {
            if (width < MIN_GENERATED_SIZE || height < MIN_GENERATED_SIZE)
            {
                throw new ArgumentOutOfRangeException(nameof(width), $"generated maps must be at least {MIN_GENERATED_SIZE} tiles each way");
            }
            int tileCount = width * height;
            var terrain = new byte[tileCount];
            int Mirror(int tile) => tileCount - 1 - tile;
            void SetBoth(int tx, int ty, int id)
            {
                if (tx < 0 || ty < 0 || tx >= width || ty >= height) return;
                int tile = ty * width + tx;
                terrain[tile] = (byte)id;
                terrain[Mirror(tile)] = (byte)id;
            }
            // Sets every tile whose centre lies within radius of (px, py), and its mirror.
            void Stamp(int px, int py, int radius, int id, int only = -1)
            {
                int reach = (radius >> 16) + 1;
                int cx = px >> 16;
                int cy = py >> 16;
                for (int ty = cy - reach; ty <= cy + reach; ty++)
                {
                    for (int tx = cx - reach; tx <= cx + reach; tx++)
                    {
                        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
                        long dx = tx * ONE + HALF - px;
                        long dy = ty * ONE + HALF - py;
                        if (dx * dx + dy * dy > (long)radius * radius) continue;
                        if (only != -1 && terrain[ty * width + tx] != only) continue;
                        SetBoth(tx, ty, id);
                    }
                }
            }

            int[][] startTiles =
            {
                new[] { Idiv(width, 5), Idiv(height, 5) },
                new[] { width - 1 - Idiv(width, 5), height - 1 - Idiv(height, 5) },
            };
            StartPosition[] starts =
            {
                TileCentre(startTiles[0][0], startTiles[0][1]),
                TileCentre(startTiles[1][0], startTiles[1][1]),
            };

            // The river runs corner to corner across the line between the starts,
            // through the centre. It is traced outward from the centre in one direction
            // and mirrored, so both halves match exactly.
            int centreX = Idiv(width * ONE, 2);
            int centreY = Idiv(height * ONE, 2);
            int diagonal = Length(width * ONE, height * ONE);
            int alongX = MulDiv(width * ONE, ONE, diagonal);
            int alongY = -MulDiv(height * ONE, ONE, diagonal);
            int acrossX = MulDiv(height * ONE, ONE, diagonal);
            int acrossY = MulDiv(width * ONE, ONE, diagonal);
            int halfLength = diagonal >> 1;
            int swing = Idiv(Math.Min(width, height) * ONE, 9);
            int riverSeed = seed ^ 0x51ed270b;
            RiverPoint RiverAt(int s)
            {
                // The bends grow from nothing at the centre, keeping the middle ford put.
                int ease = Math.Min(ONE, Idiv(s, 12));
                int bend = Mul(Mul(ValueNoise(riverSeed, Idiv(s, 14), 0) - HALF, 2 * ONE), Mul(swing, ease));
                return new RiverPoint
                {
                    x = centreX + Mul(alongX, s) + Mul(acrossX, bend),
                    y = centreY + Mul(alongY, s) + Mul(acrossY, bend),
                    halfWidth = FromRatio(3, 2) + ValueNoise(unchecked(riverSeed + 1), Idiv(s, 9), 0),
                };
            }
            for (int s = 0; s <= halfLength + 3 * ONE; s += HALF)
            {
                RiverPoint p = RiverAt(s);
                Stamp(p.x, p.y, p.halfWidth, Terrain.Water);
            }
            int[] fordAt = { 0, Mul(halfLength, FromRatio(1, 2)) };
            var fordCentres = new List<StartPosition>();
            foreach (int centre in fordAt)
            {
                for (int s = Math.Max(0, centre - 3 * ONE); s <= centre + 3 * ONE; s += HALF)
                {
                    RiverPoint p = RiverAt(s);
                    Stamp(p.x, p.y, p.halfWidth + ONE, Terrain.Shallows, Terrain.Water);
                }
                RiverPoint ford = RiverAt(centre);
                fordCentres.Add(new StartPosition(ford.x, ford.y));
                fordCentres.Add(new StartPosition(width * ONE - ford.x, height * ONE - ford.y));
            }

            // Forest and rock come from noise fields, each averaged with its own mirror
            // image. The thresholds are taken from the values themselves, so the share
            // of the map each covers is the same on every seed.
            int Symmetric(int noiseSeed, int tx, int ty, int scale) =>
                (ValueNoise(noiseSeed, Idiv(tx * ONE, scale), Idiv(ty * ONE, scale)) +
                    ValueNoise(noiseSeed, Idiv((width - 1 - tx) * ONE, scale), Idiv((height - 1 - ty) * ONE, scale))) >>
                1;
            var forestValue = new int[tileCount];
            var rockValue = new int[tileCount];
            for (int ty = 0; ty < height; ty++)
            {
                for (int tx = 0; tx < width; tx++)
                {
                    int tile = ty * width + tx;
                    forestValue[tile] =
                        Symmetric(seed ^ 0x3c6ef372, tx, ty, 9) + (Symmetric(seed ^ 0x1b873593, tx, ty, 4) >> 1);
                    rockValue[tile] = Symmetric(seed ^ 0x7f4a7c15, tx, ty, 6);
                }
            }
            int Threshold(int[] values, int sharePercent)
            {
                var sorted = (int[])values.Clone();
                // Whole numbers that compare equal are the same number, so any sort gives the same answer.
                Array.Sort(sorted);
                return sorted[Math.Min(tileCount - 1, Idiv(tileCount * (100 - sharePercent), 100))];
            }
            int forestFrom = Threshold(forestValue, FOREST_SHARE);
            int rockFrom = Threshold(rockValue, ROCK_SHARE);
            bool Near(int tx, int ty, IReadOnlyList<StartPosition> points, int tiles)
            {
                long limit = tiles * ONE;
                for (int i = 0; i < points.Count; i++)
                {
                    long dx = tx * ONE + HALF - points[i].x;
                    long dy = ty * ONE + HALF - points[i].y;
                    if (dx * dx + dy * dy < limit * limit) return true;
                }
                return false;
            }
            for (int ty = 0; ty < height; ty++)
            {
                for (int tx = 0; tx < width; tx++)
                {
                    int tile = ty * width + tx;
                    if (terrain[tile] != Terrain.Grass) continue;
                    if (Near(tx, ty, starts, START_CLEARING) || Near(tx, ty, fordCentres, FORD_CLEARING)) continue;
                    if (rockValue[tile] > rockFrom) terrain[tile] = Terrain.Rock;
                    else if (forestValue[tile] > forestFrom) terrain[tile] = Terrain.Forest;
                }
            }

            // Resources. A cluster goes down only on open grass with open grass all
            // round it, so there is always somewhere to stand and work it.
            bool OpenGrass(int tx, int ty)
            {
                if (tx < 1 || ty < 1 || tx >= width - 1 || ty >= height - 1) return false;
                if (terrain[ty * width + tx] != Terrain.Grass) return false;
                foreach (int[] start in startTiles)
                {
                    int dx = tx < start[0] ? start[0] - tx : tx - start[0];
                    int dy = ty < start[1] ? start[1] - ty : ty - start[1];
                    if (dx <= TOWN_RESERVE && dy <= TOWN_RESERVE) return false;
                }
                return true;
            }
            bool PlaceCluster(int[][] cells, int ox, int oy, int id, Func<int, int, bool> alsoNeeds = null)
            {
                foreach (int[] cell in cells)
                {
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        for (int dx = -1; dx <= 1; dx++)
                        {
                            int tx = ox + cell[0] + dx;
                            int ty = oy + cell[1] + dy;
                            if (!OpenGrass(tx, ty) || (alsoNeeds != null && !alsoNeeds(tx, ty))) return false;
                        }
                    }
                }
                foreach (int[] cell in cells) SetBoth(ox + cell[0], oy + cell[1], id);
                return true;
            }
            // Round the first start; the mirror image lands round the second.
            int homeX = startTiles[0][0];
            int homeY = startTiles[0][1];
            for (int i = 0; i < STARTING_RESOURCES.Length; i++)
            {
                (int id, int[][] cells, int distance) = STARTING_RESOURCES[i];
                int first = (int)(Hash2(seed ^ 0x6b43a9b5, i, 0) & 15);
                for (int turn = 0; turn < 16; turn++)
                {
                    int[] compass = COMPASS[(first + turn) & 15];
                    int ox = homeX + Idiv(compass[0] * distance + 512, 1024) - (ReferenceEquals(cells, COPSE) ? 0 : 1);
                    int oy = homeY + Idiv(compass[1] * distance + 512, 1024);
                    if (PlaceCluster(cells, ox, oy, id)) break;
                }
            }
            // The straight line between the starts passes through the middle ford. If
            // forest or rock has cut the starts off from each other, open that line.
            var elevation = new int[(width + 1) * (height + 1)];
            var map = new GameMap(width, height, terrain, elevation, starts);
            int RegionOf(GameMap m, StartPosition start) => m.region[m.TileAt(start.x, start.y)];
            if (RegionOf(map, starts[0]) != RegionOf(map, starts[1]))
            {
                int steps = Math.Max(width, height) * 2;
                for (int i = 0; i <= steps; i++)
                {
                    int x = starts[0].x + MulDiv(starts[1].x - starts[0].x, i, steps);
                    int y = starts[0].y + MulDiv(starts[1].y - starts[0].y, i, steps);
                    Stamp(x, y, FromRatio(3, 2), Terrain.Grass, Terrain.Forest);
                    Stamp(x, y, FromRatio(3, 2), Terrain.Grass, Terrain.Rock);
                }
                map = new GameMap(width, height, terrain, elevation, starts);
                if (RegionOf(map, starts[0]) != RegionOf(map, starts[1]))
                {
                    throw new InvalidOperationException($"map seed {seed} could not connect the two starts");
                }
            }

            // Further out, deposits neither player starts with. They go only where
            // both players can already walk, not in some clearing sealed off by trees.
            {
                GameMap before = map;
                int reachable = RegionOf(before, starts[0]);
                bool Walkable(int tx, int ty) => before.region[ty * width + tx] == reachable;
                int neutral = Idiv(Math.Min(width, height), 40);
                (int id, int[][] cells, int salt)[] deposits =
                {
                    (Terrain.Gold, BLOCK_3X2, 0x3f84d5b5),
                    (Terrain.Stone, BLOCK_2X2, 0x5a827999),
                };
                foreach ((int id, int[][] cells, int salt) in deposits)
                {
                    int placed = 0;
                    for (int attempt = 0; attempt < 120 && placed < neutral; attempt++)
                    {
                        int ox = (int)(Hash2(seed ^ salt, attempt, 1) % (uint)width);
                        int oy = (int)(Hash2(seed ^ salt, attempt, 2) % (uint)height);
                        bool farFromStarts = true;
                        foreach (int[] start in startTiles)
                        {
                            int sx = ox - start[0];
                            int sy = oy - start[1];
                            if (sx * sx + sy * sy < NEUTRAL_DISTANCE * NEUTRAL_DISTANCE) farFromStarts = false;
                        }
                        // Kept off the very middle, where a cluster would run into its own mirror image.
                        int dx = ox * 2 - width;
                        int dy = oy * 2 - height;
                        if (!farFromStarts || dx * dx + dy * dy < 16 * 16) continue;
                        if (PlaceCluster(cells, ox, oy, id, Walkable)) placed++;
                    }
                }
                map = new GameMap(width, height, terrain, elevation, starts);
            }

            // Ground nobody can walk to is only confusing: a clearing ringed by trees
            // becomes more trees, a cut-off stretch of ford becomes river.
            int home = RegionOf(map, starts[0]);
            for (int tile = 0; tile < tileCount; tile++)
            {
                if (map.passable[tile] == 0 || map.region[tile] == home) continue;
                terrain[tile] = terrain[tile] == Terrain.Shallows ? (byte)Terrain.Water : (byte)Terrain.Forest;
            }
            map = new GameMap(width, height, terrain, elevation, starts);

            FillElevation(map, seed, starts);
            return new GameMap(width, height, terrain, elevation, starts);
        }

        /// <summary>
        /// Rolling hills, flattened around the starts, sunk under water and raised
        /// into outcrops under rock. Heights are symmetric like everything else.
        /// </summary>
        static void FillElevation(GameMap map, int seed, StartPosition[] starts)
        {
            int width = map.width;
            int height = map.height;
            byte[] terrain = map.terrain;
            int[] elevation = map.elevation;
            // How many tiles each tile is from water, up to 5.
            const int FAR = 5;
            var fromWater = new byte[map.tileCount];
            for (int i = 0; i < fromWater.Length; i++) fromWater[i] = FAR;
            var frontier = new List<int>();
            for (int tile = 0; tile < map.tileCount; tile++)
            {
                if (terrain[tile] == Terrain.Water || terrain[tile] == Terrain.Shallows)
                {
                    fromWater[tile] = 0;
                    frontier.Add(tile);
                }
            }
            for (int d = 1; d < FAR && frontier.Count > 0; d++)
            {
                var next = new List<int>();
                foreach (int tile in frontier)
                {
                    int tx = tile % width;
                    int ty = Idiv(tile, width);
                    for (int oy = -1; oy <= 1; oy++)
                    {
                        for (int ox = -1; ox <= 1; ox++)
                        {
                            int nx = tx + ox;
                            int ny = ty + oy;
                            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                            int other = ny * width + nx;
                            if (fromWater[other] <= d) continue;
                            fromWater[other] = (byte)d;
                            next.Add(other);
                        }
                    }
                }
                frontier = next;
            }

            int At(int x, int y) =>
                Mul(ValueNoise(seed ^ 0x2545f491, Idiv(x * ONE, 26), Idiv(y * ONE, 26)), 3 * ONE) +
                ValueNoise(seed ^ 0x6a09e667, Idiv(x * ONE, 9), Idiv(y * ONE, 9));
            int Hills(int cx, int cy)
            {
                int raw = ((At(cx, cy) + At(width - cx, height - cy)) >> 1) - FromRatio(6, 5);
                return raw > 0 ? raw : 0;
            }

            for (int cy = 0; cy <= height; cy++)
            {
                for (int cx = 0; cx <= width; cx++)
                {
                    int water = 0;
                    int shallows = 0;
                    int rock = 0;
                    int nearestWater = FAR;
                    // The four tiles that share this corner.
                    for (int oy = -1; oy <= 0; oy++)
                    {
                        for (int ox = -1; ox <= 0; ox++)
                        {
                            int tx = cx + ox;
                            int ty = cy + oy;
                            if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
                            int tile = ty * width + tx;
                            int id = terrain[tile];
                            if (id == Terrain.Water) water++;
                            else if (id == Terrain.Shallows) shallows++;
                            else if (id == Terrain.Rock) rock++;
                            if (fromWater[tile] < nearestWater) nearestWater = fromWater[tile];
                        }
                    }
                    int h;
                    if (water > 0) h = -FromRatio(9, 20);
                    else if (shallows > 0) h = -FromRatio(1, 8);
                    else
                    {
                        h = Hills(cx, cy);
                        // Level ground around each start, easing back into the hills.
                        int flat = ONE;
                        foreach (StartPosition start in starts)
                        {
                            int d = Length(cx * ONE - start.x, cy * ONE - start.y);
                            int ease = d <= 9 * ONE ? 0 : d >= 18 * ONE ? ONE : Idiv(d - 9 * ONE, 9);
                            if (ease < flat) flat = ease;
                        }
                        h = Mul(h, flat);
                        // Banks slope down to the water.
                        h = MulDiv(h, nearestWater, FAR);
                        if (rock > 0)
                        {
                            h += rock * FromRatio(2, 5);
                            if (rock == 4)
                            {
                                h +=
                                    (ValueNoise(seed ^ 0x510e527f, cx * HALF, cy * HALF) +
                                        ValueNoise(seed ^ 0x510e527f, (width - cx) * HALF, (height - cy) * HALF)) >>
                                    2;
                            }
                        }
                    }
                    elevation[cy * (width + 1) + cx] = h;
                }
            }
        }
    }
}
