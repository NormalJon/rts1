// Ported from src/sim/vision.ts. Keep the two in step.

using System;
using System.Collections.Generic;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    /// <summary>
    /// What each side can see: the fog of war.
    ///
    /// Every unit and building sees a disc of tiles around itself. Allies see as
    /// one. For each side the world keeps two things about every tile: how many
    /// of its own are looking at it right now, and whether it has ever been seen.
    /// That gives the three states a player knows:
    ///
    ///   unexplored   never seen: nothing is known, not even the ground
    ///   explored     seen once, not now: the ground is known, what stands on it is a memory
    ///   visible      someone is looking: everything there is known
    ///
    /// The simulation needs this, not just the screen, because it decides what a
    /// side may do: soldiers go only for enemies their side can see, an attack
    /// cannot be ordered on a unit that is out of sight, and nothing can be built
    /// on ground that has never been seen.
    ///
    /// The counts are kept up to date as things move: when a unit crosses into a
    /// new tile its old disc is taken away and a new one laid down. They always
    /// equal what counting from scratch would give, so a saved game stores only
    /// what has been explored and counts the rest again on loading.
    /// </summary>
    public static class Vision
    {
        /// <summary>The furthest anything can see, in tiles.</summary>
        public const int MAX_SIGHT = 20;

        /// <summary>
        /// For each sight radius, how far its disc reaches either side of the
        /// middle on each row: SPANS[r][dy + r]. A tile is inside if its centre is
        /// within r + 1/2 tiles, which makes small discs round instead of
        /// diamond-shaped.
        /// </summary>
        static readonly sbyte[][] SPANS = MakeSpans();

        static sbyte[][] MakeSpans()
        {
            var spans = new sbyte[MAX_SIGHT + 1][];
            for (int r = 0; r <= MAX_SIGHT; r++)
            {
                var rows = new sbyte[2 * r + 1];
                for (int dy = -r; dy <= r; dy++) rows[dy + r] = (sbyte)(Isqrt((2 * r + 1) * (2 * r + 1) - 4 * dy * dy) >> 1);
                spans[r] = rows;
            }
            return spans;
        }

        /// <summary>A number that stands for one side having explored one tile, for the running checksum.</summary>
        static int ExploredMark(int view, int tile)
        {
            unchecked
            {
                uint h = (uint)(tile + 1) * 0x9e3779b1 ^ (uint)(view + 1) * 0x85ebca6b;
                h ^= h >> 15;
                h *= 0x2c1b3c6d;
                return (int)(h ^ (h >> 12));
            }
        }

        /// <summary>Lays a disc of sight down on a side's view, or takes one away.</summary>
        static void Look(World world, int view, int tile, int radius, bool add)
        {
            int width = world.map.width;
            int height = world.map.height;
            ushort[] seen = world.seen[view];
            byte[] explored = world.explored[view];
            sbyte[] spans = SPANS[radius];
            int cx = tile % width;
            int cy = Idiv(tile, width);
            for (int dy = -radius; dy <= radius; dy++)
            {
                int y = cy + dy;
                if (y < 0 || y >= height) continue;
                int half = spans[dy + radius];
                int from = y * width + Math.Max(0, cx - half);
                int to = y * width + Math.Min(width - 1, cx + half);
                if (!add)
                {
                    for (int i = from; i <= to; i++) seen[i] = unchecked((ushort)(seen[i] - 1));
                    continue;
                }
                for (int i = from; i <= to; i++)
                {
                    seen[i] = unchecked((ushort)(seen[i] + 1));
                    if (explored[i] == 0)
                    {
                        explored[i] = 1;
                        world.exploredHash ^= ExploredMark(view, i);
                    }
                }
            }
        }

        /// <summary>How far an entity sees just now. A building site sees little until it is finished.</summary>
        static int SightOf(World world, int slot)
        {
            EntityType type = world.TypeOf(slot);
            if (type.building && world.built[slot] == 0) return Math.Min(type.sight, SITE_SIGHT);
            return Math.Min(type.sight, MAX_SIGHT);
        }

        /// <summary>Brings what one entity sees up to date with where it now stands.</summary>
        public static void LookAround(World world, int slot)
        {
            int tile = world.map.TileAt(world.posX[slot], world.posY[slot]);
            int radius = SightOf(world, slot);
            int was = world.sightTile[slot];
            if (was == tile && world.sightRadius[slot] == radius) return;
            int view = world.view[world.owner[slot]];
            // The new disc goes down before the old comes up, so ground under both is never left unwatched.
            Look(world, view, tile, radius, true);
            if (was >= 0) Look(world, view, was, world.sightRadius[slot], false);
            world.sightTile[slot] = tile;
            world.sightRadius[slot] = (byte)radius;
        }

        /// <summary>Takes away what an entity sees, as when it dies.</summary>
        public static void StopLooking(World world, int slot)
        {
            int was = world.sightTile[slot];
            if (was < 0) return;
            Look(world, world.view[world.owner[slot]], was, world.sightRadius[slot], false);
            world.sightTile[slot] = -1;
        }

        /// <summary>Every tick, after everything has moved: everyone looks around from where they now stand.</summary>
        public static void VisionSystem(World world)
        {
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 1) LookAround(world, slot);
            }
        }

        /// <summary>Marks the whole map as explored by every side, for matches that start with the land known.</summary>
        public static void ExploreEverything(World world)
        {
            for (int view = 0; view < world.explored.Count; view++)
            {
                byte[] explored = world.explored[view];
                for (int tile = 0; tile < explored.Length; tile++)
                {
                    if (explored[tile] == 1) continue;
                    explored[tile] = 1;
                    world.exploredHash ^= ExploredMark(view, tile);
                }
            }
        }

        /// <summary>
        /// Puts a side's view back as it was saved: what it had explored, and from
        /// that the checksum; then what everyone alive can see, counted afresh.
        /// </summary>
        public static void RestoreVision(World world, int[][] explored)
        {
            world.exploredHash = 0;
            for (int view = 0; view < world.explored.Count; view++)
            {
                byte[] mine = world.explored[view];
                int[] runs = view < explored.Length && explored[view] != null ? explored[view] : new int[0];
                // Saved as runs: so many unexplored, so many explored, and so on in turn.
                int tile = 0;
                int value = 0;
                foreach (int run in runs)
                {
                    if (value == 1)
                    {
                        for (int i = tile; i < tile + run && i < mine.Length; i++)
                        {
                            mine[i] = 1;
                            world.exploredHash ^= ExploredMark(view, i);
                        }
                    }
                    tile += run;
                    value = 1 - value;
                }
                Array.Clear(world.seen[view], 0, world.seen[view].Length);
            }
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.sightTile[slot] < 0) continue;
                Look(world, world.view[world.owner[slot]], world.sightTile[slot], world.sightRadius[slot], true);
            }
        }

        /// <summary>What a side has explored, as runs of unexplored and explored tiles in turn, for saving.</summary>
        public static int[] ExploredRuns(World world, int view)
        {
            byte[] explored = world.explored[view];
            var runs = new List<int>();
            int value = 0;
            int length = 0;
            for (int tile = 0; tile < explored.Length; tile++)
            {
                if (explored[tile] == value)
                {
                    length++;
                    continue;
                }
                runs.Add(length);
                value = 1 - value;
                length = 1;
            }
            runs.Add(length);
            return runs.ToArray();
        }

        // ---- Questions ---------------------------------------------------------------

        /// <summary>Whether a player's side has anyone looking at a tile right now.</summary>
        public static bool Sees(World world, int player, int tile)
        {
            if (world.config.mapState == MapState.Revealed) return true;
            ushort[] seen = world.seen[world.view[player]];
            return tile >= 0 && tile < seen.Length && seen[tile] > 0;
        }

        /// <summary>Whether a player's side has ever seen a tile.</summary>
        public static bool HasExplored(World world, int player, int tile)
        {
            if (world.config.mapState == MapState.Revealed) return true;
            byte[] explored = world.explored[world.view[player]];
            return tile >= 0 && tile < explored.Length && explored[tile] == 1;
        }

        /// <summary>
        /// Whether a player's side can see an entity right now. A unit is seen
        /// where it stands; a building if any part of it is.
        /// </summary>
        public static bool CanSee(World world, int player, int slot)
        {
            if (world.config.mapState == MapState.Revealed) return true;
            GameMap map = world.map;
            ushort[] seen = world.seen[world.view[player]];
            if (world.mobile[slot] == 1) return seen[map.TileAt(world.posX[slot], world.posY[slot])] > 0;
            // Its corners, the middles of its sides, and its centre.
            int half = world.TypeOf(slot).footprint >> 1;
            int cx = world.posX[slot] >> 16;
            int cy = world.posY[slot] >> 16;
            for (int oy = -half; oy <= half; oy += Math.Max(1, half))
            {
                for (int ox = -half; ox <= half; ox += Math.Max(1, half))
                {
                    int tile = (cy + oy) * map.width + cx + ox;
                    // A tile off the end of the map is seen by nobody.
                    if (tile >= 0 && tile < seen.Length && seen[tile] > 0) return true;
                }
            }
            return false;
        }
    }
}
