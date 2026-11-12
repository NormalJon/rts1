// Ported from test/helpers.ts. Keep the two in step.

using System.Runtime.CompilerServices;
using Rts.Sim;

namespace Rts.Tests
{
    /// <summary>
    /// Things that must hold after every tick, whatever orders were given, and
    /// a few measurements the rule-by-rule tests share.
    ///
    /// The TypeScript file also has playRandomMatch, which plays a match of
    /// random orders. It is not here: the matches in recordings/ were played
    /// by it, and stand in for it.
    /// </summary>
    public static class Helpers
    {
        /// <summary>
        /// What ResourceTotals puts first when a tile holds an amount but no
        /// resource, so that the totals can never be taken for right. (The
        /// TypeScript uses NaN, which is equal to nothing, itself included.)
        /// </summary>
        public const long NOT_A_NUMBER = long.MinValue;

        static readonly ConditionalWeakTable<World, long[]> startingTotals = new ConditionalWeakTable<World, long[]>();

        /// <summary>
        /// Everything of each resource there is: in the ground, on villagers' backs,
        /// in the stores, spent, and lost with the dead; less what farms have grown,
        /// which is the one thing that comes from nowhere.
        /// </summary>
        public static long[] ResourceTotals(World world)
        {
            var totals = new long[EntityTypes.RESOURCE_COUNT];
            bool stray = false;
            GameMap map = world.map;
            for (int tile = 0; tile < map.tileCount; tile++)
            {
                // A farm's crop is not a store in the ground: it is counted as it is grown.
                if (map.terrain[tile] == Terrain.Field) continue;
                int resource = EntityTypes.ResourceOfTerrain(map.terrain[tile]);
                if (resource != -1) totals[resource] += map.amount[tile];
                else if (map.amount[tile] != 0) stray = true; // an amount where there is no resource
            }
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 1) totals[world.carryKind[slot]] += world.carry[slot];
            }
            for (int i = 0; i < world.stock.Length; i++) totals[i % EntityTypes.RESOURCE_COUNT] += (long)world.stock[i] + world.spent[i];
            for (int r = 0; r < EntityTypes.RESOURCE_COUNT; r++) totals[r] += (long)world.lost[r] - world.grown[r];
            if (stray) totals[0] = NOT_A_NUMBER;
            return totals;
        }

        /// <summary>Whether the map's record of which tiles connect matches a flood fill done from scratch.</summary>
        public static bool RegionsAreRight(World world)
        {
            GameMap map = world.map;
            var seen = new bool[map.tileCount];
            var used = new HashSet<int>();
            var stack = new Stack<int>();
            for (int seed = 0; seed < map.tileCount; seed++)
            {
                if (map.passable[seed] == 0)
                {
                    if (map.region[seed] != 0) return false;
                    continue;
                }
                if (seen[seed]) continue;
                int region = map.region[seed];
                if (region == 0 || !used.Add(region)) return false;
                stack.Push(seed);
                seen[seed] = true;
                while (stack.Count > 0)
                {
                    int tile = stack.Pop();
                    if (map.region[tile] != region) return false;
                    int tx = tile % map.width;
                    int ty = tile / map.width;
                    for (int dir = 0; dir < 8; dir++)
                    {
                        if (!map.CanStep(tx, ty, dir)) continue;
                        int dx = new[] { 1, 1, 0, -1, -1, -1, 0, 1 }[dir];
                        int dy = new[] { 0, 1, 1, 1, 0, -1, -1, -1 }[dir];
                        int other = (ty + dy) * map.width + tx + dx;
                        if (!seen[other])
                        {
                            seen[other] = true;
                            stack.Push(other);
                        }
                    }
                }
            }
            return true;
        }

        /// <summary>
        /// Things that must hold after every tick, whatever orders were given.
        /// Returns a description of the first one broken, or null.
        ///
        /// The first call for a world notes how much of each resource there is;
        /// every later call for the same world holds it to that.
        /// </summary>
        public static string BrokenInvariant(World world)
        {
            GameMap map = world.map;
            // Nothing is created or lost: gathering only moves resources about.
            long[] totals = ResourceTotals(world);
            // (Said straight away here. In the TypeScript it comes to light on the second look.)
            if (totals[0] == NOT_A_NUMBER) return "a tile holds an amount where there is no resource";
            if (!startingTotals.TryGetValue(world, out long[] before)) startingTotals.Add(world, totals);
            else if (!totals.SequenceEqual(before))
            {
                return $"resources are not conserved: started with {string.Join("/", before)}, now {string.Join("/", totals)}";
            }
            if (world.tick % 20 == 0 && !RegionsAreRight(world)) return "the map's connected regions are out of date";
            // Every built-on tile belongs to a building and every building's tiles are built on.
            int built = 0;
            int fields = 0;
            // Looked up by id only; nothing depends on its order but which message comes first.
            var claims = new SortedDictionary<int, int>();
            void Claim(int group)
            {
                if (group == 0) return;
                claims.TryGetValue(group, out int already);
                claims[group] = already + 1;
            }
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0) continue;
                int x = world.posX[slot];
                int y = world.posY[slot];
                // Its figures as its owner's research has made them, not as they started.
                EntityType type = world.TypeOf(slot);
                if (world.carry[slot] > type.carries) return $"unit {slot} carries more than it can";
                if (world.hp[slot] <= 0) return $"entity {slot} is alive with {world.hp[slot]} hit points";
                if (world.hp[slot] > type.hp) return $"entity {slot} has more hit points than its kind allows";
                if (world.orderKind[slot] > 5) return $"entity {slot} has an order of no known kind";
                if (world.engaged[slot] == 0 && world.homeGroup[slot] != 0) return $"unit {slot} is holding a march open without being in a fight";
                if (world.windup[slot] > 0 && world.moveState[slot] != 0) return $"unit {slot} is striking a blow on the move";
                if (world.mobile[slot] == 0)
                {
                    if (world.moveState[slot] != 0 || world.group[slot] != 0) return $"building {slot} has been given orders";
                    int needed = EntityTypes.BuildPointsNeeded(world.entityType[slot], world.config.tickRate);
                    if ((world.built[slot] == 1) != (world.buildPoints[slot] >= needed)) return $"building {slot} is finished but not built, or the reverse";
                    if (world.trainLength[slot] > EntityTypes.TRAIN_QUEUE_LENGTH) return $"building {slot} has too long a queue";
                    if (world.trainLength[slot] == 0 && (world.trainTicks[slot] != 0 || world.trainStarted[slot] != 0))
                    {
                        return $"building {slot} is training with nothing queued";
                    }
                    if (type.farm && world.built[slot] == 1)
                    {
                        // A finished farm is tilled ground, not walls: nine tiles of field, the crop in the middle one.
                        int cx = x >> 16;
                        int cy = y >> 16;
                        for (int ty = cy - 1; ty <= cy + 1; ty++)
                        {
                            for (int tx = cx - 1; tx <= cx + 1; tx++)
                            {
                                int tile = ty * map.width + tx;
                                if (map.terrain[tile] != Terrain.Field) return $"farm {slot} is not tilled at tile {tile}";
                                if (map.amount[tile] != (tx == cx && ty == cy ? 1 : 0)) return $"farm {slot} has its crop in the wrong place";
                                if (map.blocked[tile] == 1) return $"farm {slot} blocks the way";
                            }
                        }
                        fields += 9;
                    }
                    else
                    {
                        built += type.footprint * type.footprint;
                    }
                    continue;
                }
                if (x < 0 || y < 0 || x > map.maxX || y > map.maxY) return $"unit {slot} is off the map";
                if (map.passable[map.TileAt(x, y)] == 0) return $"unit {slot} is standing in an obstacle";
                Claim(world.group[slot]);
                Claim(world.homeGroup[slot]);
                for (int k = 0; k < world.queueLength[slot]; k++) Claim(world.queueGroup[slot * World.ORDER_QUEUE_LENGTH + k]);
            }
            int blocked = 0;
            int tilled = 0;
            for (int tile = 0; tile < map.tileCount; tile++)
            {
                blocked += map.blocked[tile];
                if (map.terrain[tile] == Terrain.Field) tilled++;
            }
            if (blocked != built) return $"{blocked} tiles are marked as built on, but buildings cover {built}";
            if (tilled != fields) return $"{tilled} tiles are tilled, but farms cover {fields}";
            foreach (MoveGroup group in world.groups.Values)
            {
                claims.TryGetValue(group.id, out int claimed);
                if (group.refs != claimed) return $"group {group.id} counts {group.refs} units but {claimed} refer to it";
            }
            foreach (int id in claims.Keys)
            {
                if (!world.groups.Has(id)) return $"units refer to group {id}, which no longer exists";
            }
            for (int i = 0; i < world.shotCount; i++)
            {
                if (world.shots[i * World.SHOT_FIELDS + 6] < world.tick) return $"arrow {i} should have landed already";
            }
            if (world.tick % 10 == 0) return BrokenVision(world);
            return null;
        }

        /// <summary>
        /// The smallest gap between any two living units, less their radii.
        /// Negative means overlap. With fewer than two units there is no gap, and
        /// the answer is the largest number there is (Infinity in the TypeScript).
        /// </summary>
        public static int SmallestGap(World world)
        {
            int smallest = int.MaxValue;
            for (int a = 0; a < world.highWater; a++)
            {
                if (world.alive[a] == 0 || world.mobile[a] == 0) continue;
                for (int b = a + 1; b < world.highWater; b++)
                {
                    if (world.alive[b] == 0 || world.mobile[b] == 0) continue;
                    int gap =
                        Fixed.Length((long)world.posX[a] - world.posX[b], (long)world.posY[a] - world.posY[b]) -
                        world.radius[a] -
                        world.radius[b];
                    if (gap < smallest) smallest = gap;
                }
            }
            return smallest;
        }

        /// <summary>
        /// Checks what each side is counted as seeing against a count made from
        /// scratch: every living thing looking out from the tile it stands on.
        /// </summary>
        public static string BrokenVision(World world)
        {
            GameMap map = world.map;
            var expected = new ushort[world.seen.Count][];
            for (int view = 0; view < expected.Length; view++) expected[view] = new ushort[map.tileCount];
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0) continue;
                EntityType type = EntityTypes.ENTITY_TYPES[world.entityType[slot]];
                int radius = type.building && world.built[slot] == 0 ? Math.Min(type.sight, 3) : type.sight;
                int cx = Math.Min(map.width - 1, Math.Max(0, world.posX[slot] >> 16));
                int cy = Math.Min(map.height - 1, Math.Max(0, world.posY[slot] >> 16));
                ushort[] counts = expected[world.view[world.owner[slot]]];
                for (int y = Math.Max(0, cy - radius); y <= Math.Min(map.height - 1, cy + radius); y++)
                {
                    for (int x = Math.Max(0, cx - radius); x <= Math.Min(map.width - 1, cx + radius); x++)
                    {
                        // The TypeScript asks whether Math.hypot(x - cx, y - cy) <= radius + 0.5.
                        // Both sides doubled and squared, it is the same question in whole numbers.
                        int dx = x - cx;
                        int dy = y - cy;
                        if (4 * (dx * dx + dy * dy) <= (2 * radius + 1) * (2 * radius + 1)) counts[y * map.width + x]++;
                    }
                }
            }
            for (int view = 0; view < expected.Length; view++)
            {
                ushort[] counts = expected[view];
                ushort[] seen = world.seen[view];
                byte[] explored = world.explored[view];
                for (int tile = 0; tile < map.tileCount; tile++)
                {
                    if (seen[tile] != counts[tile])
                    {
                        return $"side {view} is counted as having {seen[tile]} lookers on tile {tile}, but {counts[tile]} can see it";
                    }
                    if (seen[tile] > 0 && explored[tile] == 0) return $"side {view} sees tile {tile} without having explored it";
                }
            }
            return null;
        }
    }
}
