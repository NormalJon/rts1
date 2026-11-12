// Ported from src/sim/search.ts. Keep the two in step.

using System;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    /// <summary>
    /// A heap of items ordered by key, smallest first. The keys pack a cost and
    /// a tiebreak into one whole number, which the TypeScript keeps in a float
    /// and this keeps in a long; both hold them exactly.
    /// </summary>
    public sealed class MinHeap
    {
        long[] keys;
        int[] items;
        public int size;

        public MinHeap(int capacity)
        {
            keys = new long[capacity];
            items = new int[capacity];
        }

        public void Clear()
        {
            size = 0;
        }

        public void Push(long key, int item)
        {
            if (size == keys.Length)
            {
                Array.Resize(ref keys, size * 2);
                Array.Resize(ref items, size * 2);
            }
            int i = size++;
            long[] keys_ = keys;
            int[] items_ = items;
            while (i > 0)
            {
                int parent = (i - 1) >> 1;
                if (keys_[parent] <= key) break;
                keys_[i] = keys_[parent];
                items_[i] = items_[parent];
                i = parent;
            }
            keys_[i] = key;
            items_[i] = item;
        }

        /// <summary>Removes and returns the item with the smallest key.</summary>
        public int Pop()
        {
            long[] keys_ = keys;
            int[] items_ = items;
            int top = items_[0];
            int last = --size;
            if (last > 0)
            {
                long key = keys_[last];
                int item = items_[last];
                int i = 0;
                for (;;)
                {
                    int child = 2 * i + 1;
                    if (child >= last) break;
                    if (child + 1 < last && keys_[child + 1] < keys_[child]) child++;
                    if (keys_[child] >= key) break;
                    keys_[i] = keys_[child];
                    items_[i] = items_[child];
                    i = child;
                }
                keys_[i] = key;
                items_[i] = item;
            }
            return top;
        }
    }

    /// <summary>
    /// Working memory for searches, sized to one map. A world runs one search at
    /// a time, so a single set of buffers is reused.
    /// </summary>
    public sealed class SearchScratch
    {
        public readonly int[] cost;
        public readonly int[] parent;
        /// <summary>0 untouched, 1 waiting in the heap, 2 finished.</summary>
        public readonly byte[] mark;
        public readonly byte[] isTarget;
        public readonly MinHeap heap;

        public SearchScratch(int tileCount)
        {
            cost = new int[tileCount];
            parent = new int[tileCount];
            mark = new byte[tileCount];
            isTarget = new byte[tileCount];
            heap = new MinHeap(Math.Max(64, tileCount));
        }
    }

    /// <summary>
    /// The two searches behind unit movement.
    ///
    /// AStarSearch finds the cheapest route for one unit. FieldSearch works
    /// outward from a destination and records, for every tile it reaches, which
    /// way to step to get there: one search then guides a whole group, wherever
    /// each member happens to stand.
    ///
    /// Both can be run a slice at a time. Work is counted in tiles examined,
    /// never in elapsed time, so a search split across several ticks produces
    /// exactly the result it would have produced in one go, on every machine.
    /// </summary>
    public abstract class Search
    {
        /// <summary>Marks in a flow field for the destination tile and for tiles not reached.</summary>
        public const int FIELD_GOAL = 8;
        public const int FIELD_UNKNOWN = 255;

        /// <summary>Once every unit's tile is reached, a field search carries on this much further.</summary>
        protected const int FIELD_MARGIN = 10 * GameMap.STEP_ORTHOGONAL;

        /// <summary>Keys pack a cost and a tiebreak into one number; both stay far below 2^53.</summary>
        protected const long KEY_SHIFT = 4194304;

        /// <summary>Tiles examined so far.</summary>
        public int expansions;
        public bool done;

        /// <summary>Examines up to budget more tiles and returns how many it examined.</summary>
        public abstract int Run(int budget);
    }

    public sealed class AStarSearch : Search
    {
        public bool found;
        readonly GameMap map;
        readonly SearchScratch scratch;
        public readonly int start;
        public readonly int goal;
        readonly int goalX;
        readonly int goalY;

        public AStarSearch(GameMap map, SearchScratch scratch, int start, int goal)
        {
            this.map = map;
            this.scratch = scratch;
            this.start = start;
            this.goal = goal;
            goalX = goal % map.width;
            goalY = Idiv(goal, map.width);
            Array.Clear(scratch.mark, 0, scratch.mark.Length);
            scratch.heap.Clear();
            scratch.cost[start] = 0;
            scratch.parent[start] = -1;
            scratch.mark[start] = 1;
            scratch.heap.Push(Estimate(start % map.width, Idiv(start, map.width)), start);
        }

        /// <summary>Cost of the straight run to the goal if nothing were in the way.</summary>
        int Estimate(int tx, int ty)
        {
            int dx = tx < goalX ? goalX - tx : tx - goalX;
            int dy = ty < goalY ? goalY - ty : ty - goalY;
            int longer = dx > dy ? dx : dy;
            int shorter = dx > dy ? dy : dx;
            return GameMap.STEP_ORTHOGONAL * longer + (GameMap.STEP_DIAGONAL - GameMap.STEP_ORTHOGONAL) * shorter;
        }

        public override int Run(int budget)
        {
            GameMap map = this.map;
            int[] cost = scratch.cost;
            int[] parent = scratch.parent;
            byte[] mark = scratch.mark;
            MinHeap heap = scratch.heap;
            int width = map.width;
            int used = 0;
            while (!done && used < budget)
            {
                if (heap.size == 0)
                {
                    done = true;
                    break;
                }
                int tile = heap.Pop();
                // A tile can sit in the heap more than once; only its first exit counts.
                if (mark[tile] == 2) continue;
                mark[tile] = 2;
                used++;
                if (tile == goal)
                {
                    found = true;
                    done = true;
                    break;
                }
                int tx = tile % width;
                int ty = Idiv(tile, width);
                int baseCost = cost[tile];
                for (int dir = 0; dir < 8; dir++)
                {
                    if (!map.CanStep(tx, ty, dir)) continue;
                    int nx = tx + GameMap.DIR_X[dir];
                    int ny = ty + GameMap.DIR_Y[dir];
                    int next = ny * width + nx;
                    if (mark[next] == 2) continue;
                    int through = baseCost + ((dir & 1) == 0 ? GameMap.STEP_ORTHOGONAL : GameMap.STEP_DIAGONAL);
                    if (mark[next] == 1 && through >= cost[next]) continue;
                    cost[next] = through;
                    parent[next] = tile;
                    mark[next] = 1;
                    int remaining = Estimate(nx, ny);
                    heap.Push((through + remaining) * KEY_SHIFT + remaining, next);
                }
            }
            expansions += used;
            return used;
        }

        /// <summary>The tiles from start to goal, inclusive. Only valid once found.</summary>
        public int[] Path()
        {
            int count = 0;
            for (int tile = goal; tile != -1; tile = scratch.parent[tile]) count++;
            var tiles = new int[count];
            for (int tile = goal; tile != -1; tile = scratch.parent[tile]) tiles[--count] = tile;
            return tiles;
        }
    }

    public sealed class FieldSearch : Search
    {
        /// <summary>
        /// For each tile, the direction (0 to 7) of the next step toward the goal,
        /// FIELD_GOAL on the goal itself, FIELD_UNKNOWN where the search did not
        /// reach.
        /// </summary>
        public readonly byte[] directions;
        readonly GameMap map;
        readonly SearchScratch scratch;
        public readonly int goal;
        int remainingTargets;
        int furthestTarget;
        readonly bool coverAll;

        /// <param name="targets">
        /// Tiles that must be covered, normally where the group's units stand. The
        /// search stops a little past the furthest one. With no targets it covers
        /// everything that can reach the goal.
        /// </param>
        public FieldSearch(GameMap map, SearchScratch scratch, int goal, int[] targets)
        {
            this.map = map;
            this.scratch = scratch;
            this.goal = goal;
            directions = new byte[map.tileCount];
            for (int i = 0; i < directions.Length; i++) directions[i] = FIELD_UNKNOWN;
            Array.Clear(scratch.mark, 0, scratch.mark.Length);
            Array.Clear(scratch.isTarget, 0, scratch.isTarget.Length);
            scratch.heap.Clear();
            foreach (int tile in targets)
            {
                if (scratch.isTarget[tile] == 0)
                {
                    scratch.isTarget[tile] = 1;
                    remainingTargets++;
                }
            }
            coverAll = remainingTargets == 0;
            scratch.cost[goal] = 0;
            scratch.mark[goal] = 1;
            directions[goal] = FIELD_GOAL;
            scratch.heap.Push(goal, goal);
        }

        public override int Run(int budget)
        {
            GameMap map = this.map;
            byte[] directions = this.directions;
            int[] cost = scratch.cost;
            byte[] mark = scratch.mark;
            byte[] isTarget = scratch.isTarget;
            MinHeap heap = scratch.heap;
            int width = map.width;
            int used = 0;
            while (!done && used < budget)
            {
                if (heap.size == 0)
                {
                    done = true;
                    break;
                }
                int tile = heap.Pop();
                if (mark[tile] == 2) continue;
                int baseCost = cost[tile];
                if (!coverAll && remainingTargets == 0 && baseCost > furthestTarget + FIELD_MARGIN)
                {
                    done = true;
                    break;
                }
                mark[tile] = 2;
                used++;
                if (isTarget[tile] == 1)
                {
                    remainingTargets--;
                    if (baseCost > furthestTarget) furthestTarget = baseCost;
                }
                int tx = tile % width;
                int ty = Idiv(tile, width);
                for (int dir = 0; dir < 8; dir++)
                {
                    // Steps are reversible, so a unit on the neighbour can step here.
                    if (!map.CanStep(tx, ty, dir)) continue;
                    int next = (ty + GameMap.DIR_Y[dir]) * width + tx + GameMap.DIR_X[dir];
                    if (mark[next] == 2) continue;
                    int through = baseCost + ((dir & 1) == 0 ? GameMap.STEP_ORTHOGONAL : GameMap.STEP_DIAGONAL);
                    if (mark[next] == 1 && through >= cost[next]) continue;
                    cost[next] = through;
                    mark[next] = 1;
                    directions[next] = (byte)((dir + 4) & 7);
                    heap.Push(through * KEY_SHIFT + next, next);
                }
            }
            expansions += used;
            return used;
        }
    }
}
