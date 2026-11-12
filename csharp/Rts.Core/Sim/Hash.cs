// Ported from src/sim/hash.ts. Keep the two in step.

using System.Collections.Generic;

namespace Rts.Sim
{
    /// <summary>
    /// A 32-bit checksum of the whole world.
    ///
    /// Two simulations with the same checksum on the same tick are, for
    /// practical purposes, in the same state. Multiplayer compares checksums
    /// every few ticks to catch a divergence the moment it happens; the tests
    /// use it to prove that replays and saved games reproduce a match exactly,
    /// and that this C# simulation plays exactly as the TypeScript one does.
    /// </summary>
    public static class Hash
    {
        /// <summary>One round of MurmurHash3 (32-bit).</summary>
        static uint Mix(uint h, int value)
        {
            unchecked
            {
                uint k = (uint)value * 0xcc9e2d51;
                k = (k << 15) | (k >> 17);
                k *= 0x1b873593;
                h ^= k;
                h = (h << 13) | (h >> 19);
                return h * 5 + 0xe6546b64;
            }
        }

        static uint Finish(uint h, int length)
        {
            unchecked
            {
                h ^= (uint)length;
                h ^= h >> 16;
                h *= 0x85ebca6b;
                h ^= h >> 13;
                h *= 0xc2b2ae35;
                h ^= h >> 16;
                return h;
            }
        }

        /// <summary>Folds numbers into a checksum, counting them as it goes.</summary>
        struct Hasher
        {
            public uint h;
            public int words;

            public void Add(int value)
            {
                h = Mix(h, value);
                words++;
            }

            public void Add(RouteRequest request)
            {
                if (request.kind == RouteKind.Path)
                {
                    Add(1);
                    Add(request.slot);
                    Add(request.seq);
                }
                else
                {
                    Add(2);
                    Add(request.group);
                }
            }
        }

        public static uint HashWorld(World world)
        {
            var hash = new Hasher { h = 0x2f0b4a1d, words = 0 };

            hash.Add(world.tick);
            hash.Add(unchecked((int)world.map.checksum));
            hash.Add(world.map.stateHash);
            for (int i = 0; i < world.stock.Length; i++) hash.Add(world.stock[i]);
            for (int i = 0; i < world.spent.Length; i++) hash.Add(world.spent[i]);
            for (int i = 0; i < world.lost.Length; i++) hash.Add(world.lost[i]);
            for (int i = 0; i < world.grown.Length; i++) hash.Add(world.grown[i]);
            hash.Add(world.exploredHash);
            for (int i = 0; i < world.age.Length; i++) hash.Add(world.age[i]);
            for (int i = 0; i < world.researched.Length; i++) hash.Add(world.researched[i]);
            hash.Add(world.shotCount);
            for (int i = 0; i < world.shotCount * World.SHOT_FIELDS; i++) hash.Add(world.shots[i]);
            foreach (int word in world.rng.GetState()) hash.Add(word);
            hash.Add(world.highWater);
            hash.Add(world.freeSlots.Count);
            foreach (int slot in world.freeSlots) hash.Add(slot);

            IReadOnlyList<Column> columns = world.columns;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                hash.Add(world.alive[slot]);
                hash.Add(world.generation[slot]);
                // A dead slot's leftover values affect nothing, so they are not state.
                if (world.alive[slot] == 0) continue;
                for (int c = 0; c < columns.Count; c++)
                {
                    Column column = columns[c];
                    for (int k = slot * column.stride; k < (slot + 1) * column.stride; k++) hash.Add(column.Get(k));
                }
                int[] path = world.paths[slot];
                hash.Add(path == null ? -1 : path.Length);
                if (path != null) for (int k = 0; k < path.Length; k++) hash.Add(path[k]);
            }

            // Groups are created with rising ids and kept in that order.
            hash.Add(world.nextGroupId);
            hash.Add(world.groups.Count);
            foreach (MoveGroup group in world.groups.Values)
            {
                hash.Add(group.id);
                hash.Add(group.goalTile);
                hash.Add(group.faceX);
                hash.Add(group.faceY);
                hash.Add(group.refs);
                hash.Add(group.status);
                hash.Add(unchecked((int)group.fieldChecksum));
            }

            hash.Add(world.routeQueue.Count);
            foreach (RouteRequest request in world.routeQueue) hash.Add(request);
            ActiveSearch active = world.activeSearch;
            hash.Add(active == null ? 0 : 1);
            if (active != null)
            {
                hash.Add(active.request);
                hash.Add(active.start);
                hash.Add(active.goal);
                hash.Add(active.targets.Length);
                foreach (int tile in active.targets) hash.Add(tile);
                hash.Add(active.search.expansions);
            }
            return Finish(hash.h, hash.words);
        }

        /// <summary>The checksum as eight hex digits, for logs and debug displays.</summary>
        public static string HashHex(uint hash)
        {
            return hash.ToString("x8");
        }
    }
}
