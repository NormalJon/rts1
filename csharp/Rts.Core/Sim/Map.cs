// Ported from src/sim/map.ts. Keep the two in step.

using System;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    public static class Terrain
    {
        public const int Grass = 0;
        /// <summary>Trees block movement and are the wood supply. One tree to a tile.</summary>
        public const int Forest = 1;
        /// <summary>A ford: water shallow enough to wade.</summary>
        public const int Shallows = 2;
        public const int Water = 3;
        /// <summary>Bare outcrop. Blocks movement and yields nothing.</summary>
        public const int Rock = 4;
        /// <summary>Berry bushes: the first food.</summary>
        public const int Berries = 5;
        /// <summary>Quarryable stone.</summary>
        public const int Stone = 6;
        /// <summary>Gold ore.</summary>
        public const int Gold = 7;
        /// <summary>Tilled ground: a farm. It can be walked over, and its crop never runs out.</summary>
        public const int Field = 8;
    }

    public readonly struct StartPosition
    {
        public readonly int x;
        public readonly int y;

        public StartPosition(int x, int y)
        {
            this.x = x;
            this.y = y;
        }
    }

    /// <summary>
    /// The terrain a match is played on: a square grid of tiles with a height at
    /// every tile corner.
    ///
    /// Positions are in tiles, so the tile containing a fixed-point position is
    /// its whole part. A tile is either passable or not; everything about
    /// movement (pathfinding, line of sight, collision with terrain) reads that
    /// one fact.
    ///
    /// The map changes during a match: trees are felled, deposits are worked
    /// out, buildings go up. Every change goes through the methods here, which
    /// keep passability, the connected regions and the state fingerprint in step.
    /// </summary>
    public sealed class GameMap
    {
        static readonly byte[] PASSABLE_BY_TERRAIN = { 1, 0, 1, 0, 0, 0, 0, 0, 1 };
        /// <summary>How much a tile of each terrain holds before anyone has gathered from it.</summary>
        static readonly int[] STARTING_AMOUNT = { 0, 100, 0, 0, 0, 250, 500, 700, 0 };

        /// <summary>Neighbour offsets, indexed by direction 0 to 7: E, SE, S, SW, W, NW, N, NE.</summary>
        public static readonly int[] DIR_X = { 1, 1, 0, -1, -1, -1, 0, 1 };
        public static readonly int[] DIR_Y = { 0, 1, 1, 1, 0, -1, -1, -1 };
        /// <summary>Cost of an orthogonal and a diagonal step, in the ratio 1 : 1.4143.</summary>
        public const int STEP_ORTHOGONAL = 70;
        public const int STEP_DIAGONAL = 99;

        public readonly int width;
        public readonly int height;
        public readonly int tileCount;
        /// <summary>What is on each tile. Changes as resources are used up.</summary>
        public readonly byte[] terrain;
        /// <summary>How much of its resource each tile still holds.</summary>
        public readonly int[] amount;
        /// <summary>1 where a building stands.</summary>
        public readonly byte[] blocked;
        /// <summary>Height at each tile corner, (width + 1) by (height + 1), in tiles.</summary>
        public readonly int[] elevation;
        public readonly byte[] passable;
        /// <summary>
        /// Which connected area each passable tile belongs to (1 and up; 0 for
        /// impassable tiles). Two tiles can be walked between exactly when their
        /// regions match.
        /// </summary>
        public readonly int[] region;
        public readonly StartPosition[] starts;
        /// <summary>Fingerprint of everything about the map that never changes.</summary>
        public readonly uint checksum;
        /// <summary>Fingerprint of everything that does: terrain, amounts and buildings. Kept up to date change by change.</summary>
        public int stateHash;
        /// <summary>Goes up whenever a tile opens or closes, so anything planned on the old layout can tell.</summary>
        public int passVersion;
        int regionCount;
        /// <summary>The largest valid coordinate on each axis.</summary>
        public readonly int maxX;
        public readonly int maxY;

        /// <summary>Working memory for labelRegions.</summary>
        readonly int[] regionStack;

        public GameMap(int width, int height, byte[] terrain, int[] elevation, StartPosition[] starts)
        {
            if (terrain.Length != width * height) throw new ArgumentException("terrain size does not match the map");
            if (elevation.Length != (width + 1) * (height + 1))
            {
                throw new ArgumentException("elevation size does not match the map");
            }
            this.width = width;
            this.height = height;
            tileCount = width * height;
            this.terrain = terrain;
            this.elevation = elevation;
            this.starts = starts;
            maxX = width * ONE - 1;
            maxY = height * ONE - 1;
            amount = new int[tileCount];
            blocked = new byte[tileCount];
            passable = new byte[tileCount];
            region = new int[tileCount];
            regionStack = new int[tileCount];
            for (int i = 0; i < tileCount; i++) amount[i] = terrain[i] < STARTING_AMOUNT.Length ? STARTING_AMOUNT[terrain[i]] : 0;
            Rebuild();
            checksum = ComputeChecksum();
        }

        static byte PassableTerrain(int terrain)
        {
            return terrain >= 0 && terrain < PASSABLE_BY_TERRAIN.Length ? PASSABLE_BY_TERRAIN[terrain] : (byte)0;
        }

        // ---- Changes ---------------------------------------------------------------

        /// <summary>Recomputes everything derived from terrain, amounts and buildings.</summary>
        void Rebuild()
        {
            int hash = 0;
            for (int i = 0; i < tileCount; i++)
            {
                passable[i] = blocked[i] == 0 ? PassableTerrain(terrain[i]) : (byte)0;
                hash = unchecked(hash + TileHash(i));
            }
            stateHash = hash;
            passVersion++;
            LabelRegions();
        }

        int TileHash(int tile)
        {
            unchecked
            {
                uint h =
                    (uint)(tile + 1) * 0x9e3779b1 ^
                    (uint)(terrain[tile] + 1) * 0x85ebca6b ^
                    (uint)(amount[tile] + 1) * 0xc2b2ae35 ^
                    (uint)(blocked[tile] + 1) * 0x27d4eb2f;
                h = (h ^ (h >> 15)) * 0x2c1b3c6d;
                return (int)(h ^ (h >> 13));
            }
        }

        /// <summary>
        /// Takes one unit of resource from a tile. When the last is taken the tile
        /// becomes open grass. Returns whether that happened.
        /// </summary>
        public bool Harvest(int tile)
        {
            if (amount[tile] <= 0) return false;
            stateHash = unchecked(stateHash - TileHash(tile));
            amount[tile] = amount[tile] - 1;
            bool exhausted = amount[tile] == 0;
            if (exhausted) terrain[tile] = Terrain.Grass;
            stateHash = unchecked(stateHash + TileHash(tile));
            if (exhausted) Open(tile);
            return exhausted;
        }

        /// <summary>
        /// Changes what one tile is and how much it holds, as when a farm is laid
        /// out or ploughed under.
        /// </summary>
        public void SetTerrain(int tile, int terrain, int amount)
        {
            if (this.terrain[tile] == terrain && this.amount[tile] == amount) return;
            stateHash = unchecked(stateHash - TileHash(tile));
            this.terrain[tile] = (byte)terrain;
            this.amount[tile] = amount;
            stateHash = unchecked(stateHash + TileHash(tile));
            byte passable = blocked[tile] == 0 ? PassableTerrain(terrain) : (byte)0;
            if (passable == this.passable[tile]) return;
            this.passable[tile] = passable;
            passVersion++;
            LabelRegions();
        }

        /// <summary>Marks a square of tiles as built on, or clears it again.</summary>
        public void SetBuilding(int left, int top, int size, bool present)
        {
            byte want = present ? (byte)1 : (byte)0;
            for (int ty = top; ty < top + size; ty++)
            {
                for (int tx = left; tx < left + size; tx++)
                {
                    if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
                    int tile = ty * width + tx;
                    if (blocked[tile] == want) continue;
                    stateHash = unchecked(stateHash - TileHash(tile));
                    blocked[tile] = want;
                    passable[tile] = want == 0 ? PassableTerrain(terrain[tile]) : (byte)0;
                    stateHash = unchecked(stateHash + TileHash(tile));
                }
            }
            // A building can cut one area in two, or its removal join two up, so the regions are worked out afresh.
            passVersion++;
            LabelRegions();
        }

        /// <summary>Replaces the changeable state wholesale, as when loading a saved game.</summary>
        public void RestoreState(int[] terrain, int[] amount)
        {
            if (terrain.Length != tileCount || amount.Length != tileCount)
            {
                throw new ArgumentException("saved terrain does not match the map");
            }
            for (int i = 0; i < tileCount; i++)
            {
                this.terrain[i] = unchecked((byte)terrain[i]);
                this.amount[i] = amount[i];
            }
            Rebuild();
        }

        /// <summary>A tile has just become passable: fit it into the regions around it.</summary>
        void Open(int tile)
        {
            if (passable[tile] == 1 || blocked[tile] == 1) return;
            passable[tile] = 1;
            passVersion++;
            int tx = tile % width;
            int ty = Idiv(tile, width);
            int joined = 0;
            for (int dir = 0; dir < 8; dir++)
            {
                if (!CanStep(tx, ty, dir)) continue;
                int other = region[(ty + DIR_Y[dir]) * width + tx + DIR_X[dir]];
                if (joined == 0) joined = other;
                else if (other != joined)
                {
                    // It bridges two areas that were separate. Start again from scratch.
                    LabelRegions();
                    return;
                }
            }
            region[tile] = joined != 0 ? joined : ++regionCount;
        }

        public int Index(int tx, int ty)
        {
            return ty * width + tx;
        }

        /// <summary>The tile containing a position, clamped onto the map.</summary>
        public int TileAt(int x, int y)
        {
            int tx = x >> 16;
            int ty = y >> 16;
            if (tx < 0) tx = 0;
            else if (tx >= width) tx = width - 1;
            if (ty < 0) ty = 0;
            else if (ty >= height) ty = height - 1;
            return ty * width + tx;
        }

        /// <summary>How high the ground is at a tile: the average of its four corners.</summary>
        public int HeightOf(int tile)
        {
            // Corners are stored in rows one longer than the rows of tiles.
            int corner = tile + Idiv(tile, width);
            int below = corner + width + 1;
            int[] e = elevation;
            return unchecked(e[corner] + e[corner + 1] + e[below] + e[below + 1]) >> 2;
        }

        public bool IsPassable(int tx, int ty)
        {
            return tx >= 0 && ty >= 0 && tx < width && ty < height && passable[ty * width + tx] == 1;
        }

        /// <summary>
        /// Whether a unit can step from a tile to its neighbour in a direction.
        /// Diagonal steps need both adjoining tiles open, so nothing squeezes
        /// between two obstacles that touch at a corner.
        /// </summary>
        public bool CanStep(int tx, int ty, int dir)
        {
            int dx = DIR_X[dir];
            int dy = DIR_Y[dir];
            if (!IsPassable(tx + dx, ty + dy)) return false;
            if (dx != 0 && dy != 0)
            {
                return IsPassable(tx + dx, ty) && IsPassable(tx, ty + dy);
            }
            return true;
        }

        /// <summary>
        /// Whether the straight line between two positions crosses only passable
        /// tiles. A line through the exact corner where four tiles meet also needs
        /// both tiles beside the corner to be open.
        /// </summary>
        public bool LineOfSight(int x0, int y0, int x1, int y1)
        {
            int tx = x0 >> 16;
            int ty = y0 >> 16;
            int endX = x1 >> 16;
            int endY = y1 >> 16;
            if (!IsPassable(tx, ty) || !IsPassable(endX, endY)) return false;
            long dx = (long)x1 - x0;
            long dy = (long)y1 - y0;
            int stepX = dx > 0 ? 1 : -1;
            int stepY = dy > 0 ? 1 : -1;
            long absX = dx < 0 ? -dx : dx;
            long absY = dy < 0 ? -dy : dy;
            // Distance along each axis to the next tile boundary.
            long toX = dx > 0 ? ((tx + 1) << 16) - x0 : x0 - (tx << 16);
            long toY = dy > 0 ? ((ty + 1) << 16) - y0 : y0 - (ty << 16);
            for (int guard = width + height + 4; guard > 0; guard--)
            {
                if (tx == endX && ty == endY) return true;
                // The x boundary comes first when toX / absX < toY / absY; compared by
                // cross-multiplying, which stays exact.
                bool moveX;
                if (tx == endX) moveX = false;
                else if (ty == endY) moveX = true;
                else
                {
                    long a = toX * absY;
                    long b = toY * absX;
                    if (a == b)
                    {
                        if (!IsPassable(tx + stepX, ty) || !IsPassable(tx, ty + stepY)) return false;
                        tx += stepX;
                        ty += stepY;
                        toX += ONE;
                        toY += ONE;
                        if (!IsPassable(tx, ty)) return false;
                        continue;
                    }
                    moveX = a < b;
                }
                if (moveX)
                {
                    tx += stepX;
                    toX += ONE;
                }
                else
                {
                    ty += stepY;
                    toY += ONE;
                }
                if (!IsPassable(tx, ty)) return false;
            }
            return false;
        }

        /// <summary>
        /// Whether a unit of the given radius can walk straight from one position
        /// to another. Checks the line its centre follows and the lines its two
        /// sides follow, so it is not sent scraping round a corner.
        /// </summary>
        public bool ClearPath(int x0, int y0, int x1, int y1, int radius)
        {
            if (!LineOfSight(x0, y0, x1, y1)) return false;
            int dx = x1 - x0;
            int dy = y1 - y0;
            int distance = Length(dx, dy);
            if (distance == 0) return true;
            // Slightly inside the unit's edge, so standing against a wall does not count as blocked.
            int reach = radius - (radius >> 3);
            int ox = MulDiv(-dy, reach, distance);
            int oy = MulDiv(dx, reach, distance);
            return LineOfSight(x0 + ox, y0 + oy, x1 + ox, y1 + oy) &&
                LineOfSight(x0 - ox, y0 - oy, x1 - ox, y1 - oy);
        }

        public int CentreX(int tile)
        {
            return (tile % width) * ONE + HALF;
        }

        public int CentreY(int tile)
        {
            return Idiv(tile, width) * ONE + HALF;
        }

        /// <summary>
        /// The tile closest to (tx, ty) that is passable and, if a region is given,
        /// in that region. Returns -1 if none lies within maxRadius tiles.
        /// </summary>
        public int NearestPassable(int tx, int ty, int region = 0, int maxRadius = 64)
        {
            return NearestTile(
                tx,
                ty,
                maxRadius,
                tile => passable[tile] == 1 && (region == 0 || this.region[tile] == region));
        }

        /// <summary>
        /// The nearest tile of a terrain that still holds something and can be
        /// worked: it has a neighbouring tile to stand on, in the given region.
        /// </summary>
        public int NearestResource(int tx, int ty, int terrain, int region, int maxRadius)
        {
            return NearestTile(
                tx,
                ty,
                maxRadius,
                tile => this.terrain[tile] == terrain && amount[tile] > 0 && CanBeWorkedFrom(tile, region));
        }

        /// <summary>Whether any of a tile's eight neighbours is open ground in the region.</summary>
        public bool CanBeWorkedFrom(int tile, int region)
        {
            int tx = tile % width;
            int ty = Idiv(tile, width);
            for (int dir = 0; dir < 8; dir++)
            {
                int nx = tx + DIR_X[dir];
                int ny = ty + DIR_Y[dir];
                if (IsPassable(nx, ny) && this.region[ny * width + nx] == region) return true;
            }
            return false;
        }

        /// <summary>The tile closest to (tx, ty) that passes a test, or -1 if none lies within maxRadius tiles.</summary>
        public int NearestTile(int tx, int ty, int maxRadius, Func<int, bool> wanted)
        {
            int best = -1;
            int bestDistSq = 0;
            int stopAt = maxRadius;
            bool found = false;
            for (int r = 0; r <= stopAt; r++)
            {
                int x0 = tx - r;
                int x1 = tx + r;
                int y0 = ty - r;
                int y1 = ty + r;
                for (int y = y0; y <= y1; y++)
                {
                    if (y < 0 || y >= height) continue;
                    // Only the ring: full rows at top and bottom, the two ends otherwise.
                    int stride = y == y0 || y == y1 || r == 0 ? 1 : 2 * r;
                    for (int x = x0; x <= x1; x += stride)
                    {
                        if (x < 0 || x >= width) continue;
                        int i = y * width + x;
                        if (!wanted(i)) continue;
                        int distSq = (x - tx) * (x - tx) + (y - ty) * (y - ty);
                        if (best == -1 || distSq < bestDistSq)
                        {
                            best = i;
                            bestDistSq = distSq;
                        }
                    }
                }
                // A ring at radius r can hold tiles up to r * 1.42 away, so a closer one
                // may still turn up a few rings further out.
                if (best != -1 && !found)
                {
                    found = true;
                    stopAt = Math.Min(maxRadius, r + (r >> 1) + 1);
                }
            }
            return best;
        }

        void LabelRegions()
        {
            Array.Clear(region, 0, region.Length);
            int[] stack = regionStack;
            int top = 0;
            int next = 0;
            for (int seed = 0; seed < tileCount; seed++)
            {
                if (passable[seed] == 0 || region[seed] != 0) continue;
                next++;
                region[seed] = next;
                stack[top++] = seed;
                while (top > 0)
                {
                    int tile = stack[--top];
                    int tx = tile % width;
                    int ty = Idiv(tile, width);
                    for (int dir = 0; dir < 8; dir++)
                    {
                        if (!CanStep(tx, ty, dir)) continue;
                        int other = (ty + DIR_Y[dir]) * width + tx + DIR_X[dir];
                        if (region[other] != 0) continue;
                        region[other] = next;
                        stack[top++] = other;
                    }
                }
            }
            regionCount = next;
        }

        uint ComputeChecksum()
        {
            unchecked
            {
                uint h = 0x1f3d5b79 ^ (uint)width * 0x9e3779b1 ^ (uint)height * 0x85ebca6b;
                for (int i = 0; i < elevation.Length; i++) h = Mix(h, elevation[i]);
                foreach (StartPosition start in starts)
                {
                    h = Mix(h, start.x);
                    h = Mix(h, start.y);
                }
                return h;
            }
        }

        static uint Mix(uint h, int value)
        {
            unchecked
            {
                h = (h ^ (uint)value) * 0x01000193;
                return (h << 13) | (h >> 19);
            }
        }
    }
}
