// Ported from src/sim/snapshot.ts. Keep the two in step.

using System;
using System.Collections.Generic;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    public sealed class SavedGroup
    {
        public int id;
        public int goalTile;
        public int faceX;
        public int faceY;
        public int refs;
        public int status;
        /// <summary>The flow field, one direction per tile, once it has been worked out; null before.</summary>
        public int[] field;
    }

    /// <summary>
    /// A route search caught part-way through. Searches are repeatable, so it is
    /// saved as its inputs plus how far it had got, and re-run to that point on
    /// loading.
    /// </summary>
    public sealed class SavedSearch
    {
        public RouteRequest request;
        public int start;
        public int goal;
        public int[] targets;
        public int expansions;
    }

    /// <summary>
    /// The whole world as plain data: numbers, lists of numbers and names. How
    /// it is written to a file is for whoever saves it; nothing in it refers
    /// back to the world it was taken from.
    /// </summary>
    public sealed class WorldSnapshot
    {
        public int version = 8;
        public SimConfig config;
        public int tick;
        public int[] rng;
        public int highWater;
        public int[] freeSlots;
        /// <summary>What is on each tile now, and how much of its resource is left.</summary>
        public int[] terrain;
        public int[] amount;
        /// <summary>Each player's stockpile, and what they have spent.</summary>
        public int[] stock;
        public int[] spent;
        /// <summary>Resources that died with the villagers carrying them, and food grown on farms.</summary>
        public int[] lost;
        public int[] grown;
        /// <summary>The age each player has reached and what each has researched. Their effects are worked out again on loading.</summary>
        public int[] age;
        public int[] researched;
        /// <summary>Arrows in the air, SHOT_FIELDS numbers each.</summary>
        public int[] shots;
        /// <summary>
        /// What each side has explored, as runs: so many tiles unexplored, so many
        /// explored, and so on in turn. What each side can see at the moment is
        /// not saved; it follows from where everyone stands.
        /// </summary>
        public int[][] explored;
        /// <summary>Each entity property by name, holding slots 0 to highWater - 1. Looked up by name only.</summary>
        public Dictionary<string, int[]> columns;
        /// <summary>Waypoint lists by slot, for units following their own path; null for the rest.</summary>
        public int[][] paths;
        public int nextGroupId;
        public SavedGroup[] groups;
        public RouteRequest[] routeQueue;
        public SavedSearch activeSearch;
        /// <summary>Commands issued but not yet run.</summary>
        public ScheduledCommand[] pending;
    }

    /// <summary>
    /// Saving and restoring the whole world.
    ///
    /// A snapshot is plain data, so it can be written straight out as a save
    /// file, and the same thing lets a player who dropped out of a multiplayer
    /// match rejoin: load the snapshot, then run the commands issued since.
    ///
    /// The lie of the land is not saved; it is rebuilt from the match settings,
    /// which always produce the same map. What has changed on it since (felled
    /// trees, worked-out deposits) is saved.
    /// </summary>
    public static class Snapshot
    {
        static int[] Numbers(byte[] data)
        {
            var numbers = new int[data.Length];
            for (int i = 0; i < numbers.Length; i++) numbers[i] = data[i];
            return numbers;
        }

        public static WorldSnapshot TakeSnapshot(World world)
        {
            var columns = new Dictionary<string, int[]>();
            foreach (Column column in world.columns)
            {
                var values = new int[world.highWater * column.stride];
                for (int i = 0; i < values.Length; i++) values[i] = column.Get(i);
                columns[column.name] = values;
            }
            var paths = new int[world.highWater][];
            for (int slot = 0; slot < world.highWater; slot++)
            {
                int[] path = world.alive[slot] == 1 ? world.paths[slot] : null;
                paths[slot] = path == null ? null : (int[])path.Clone();
            }
            var shots = new int[world.shotCount * World.SHOT_FIELDS];
            Array.Copy(world.shots, shots, shots.Length);
            var explored = new int[world.explored.Count][];
            for (int view = 0; view < explored.Length; view++) explored[view] = Vision.ExploredRuns(world, view);
            var groups = new List<SavedGroup>();
            foreach (MoveGroup group in world.groups.Values)
            {
                groups.Add(new SavedGroup
                {
                    id = group.id,
                    goalTile = group.goalTile,
                    faceX = group.faceX,
                    faceY = group.faceY,
                    refs = group.refs,
                    status = group.status,
                    field = group.field == null ? null : Numbers(group.field),
                });
            }
            ActiveSearch active = world.activeSearch;
            return new WorldSnapshot
            {
                version = 8,
                config = world.config.Clone(),
                tick = world.tick,
                rng = world.rng.GetState(),
                highWater = world.highWater,
                freeSlots = world.freeSlots.ToArray(),
                terrain = Numbers(world.map.terrain),
                amount = (int[])world.map.amount.Clone(),
                stock = (int[])world.stock.Clone(),
                spent = (int[])world.spent.Clone(),
                lost = (int[])world.lost.Clone(),
                grown = (int[])world.grown.Clone(),
                age = Numbers(world.age),
                researched = Numbers(world.researched),
                shots = shots,
                explored = explored,
                columns = columns,
                paths = paths,
                nextGroupId = world.nextGroupId,
                groups = groups.ToArray(),
                // A request is never changed once made, so the snapshot may hold the same ones.
                routeQueue = world.routeQueue.ToArray(),
                activeSearch =
                    active == null
                        ? null
                        : new SavedSearch
                        {
                            request = active.request,
                            start = active.start,
                            goal = active.goal,
                            targets = (int[])active.targets.Clone(),
                            expansions = active.search.expansions,
                        },
                pending = world.commands.Pending().ToArray(),
            };
        }

        public static World RestoreSnapshot(WorldSnapshot snapshot)
        {
            if (snapshot.version != 8)
            {
                throw new InvalidOperationException($"unsupported snapshot version {snapshot.version}");
            }
            var world = new World(snapshot.config.Clone(), true);
            if (snapshot.highWater > world.config.maxEntities)
            {
                throw new InvalidOperationException("snapshot holds more entities than its config allows");
            }
            world.tick = snapshot.tick;
            for (int i = 0; i < snapshot.age.Length; i++) world.age[i] = unchecked((byte)snapshot.age[i]);
            for (int i = 0; i < snapshot.researched.Length; i++) world.researched[i] = unchecked((byte)snapshot.researched[i]);
            for (int player = 0; player < world.config.playerCount; player++) Techs.RebuildTypes(world, player);
            world.rng.SetState(snapshot.rng);
            world.highWater = snapshot.highWater;
            world.freeSlots.AddRange(snapshot.freeSlots);
            foreach (Column column in world.columns)
            {
                if (!snapshot.columns.TryGetValue(column.name, out int[] saved)) throw new InvalidOperationException($"snapshot is missing column \"{column.name}\"");
                if (saved.Length != snapshot.highWater * column.stride)
                {
                    throw new InvalidOperationException($"snapshot column \"{column.name}\" has the wrong length");
                }
                for (int i = 0; i < saved.Length; i++) column.Set(i, saved[i]);
            }
            for (int slot = 0; slot < snapshot.highWater; slot++)
            {
                int[] path = slot < snapshot.paths.Length ? snapshot.paths[slot] : null;
                world.paths[slot] = path == null ? null : (int[])path.Clone();
            }
            // The ground as it now is, then the buildings standing on it.
            world.map.RestoreState(snapshot.terrain, snapshot.amount);
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 1) continue;
                EntityType type = world.TypeOf(slot);
                // A finished farm is ground to walk on, already in the saved terrain.
                if (type.farm && world.built[slot] == 1) continue;
                int half = type.footprint >> 1;
                world.map.SetBuilding((world.posX[slot] >> 16) - half, (world.posY[slot] >> 16) - half, type.footprint, true);
            }
            Vision.RestoreVision(world, snapshot.explored);
            Array.Copy(snapshot.stock, world.stock, snapshot.stock.Length);
            Array.Copy(snapshot.spent, world.spent, snapshot.spent.Length);
            Array.Copy(snapshot.lost, world.lost, snapshot.lost.Length);
            Array.Copy(snapshot.grown, world.grown, snapshot.grown.Length);
            if (snapshot.shots.Length > world.shots.Length) world.shots = new int[snapshot.shots.Length];
            Array.Copy(snapshot.shots, world.shots, snapshot.shots.Length);
            world.shotCount = Idiv(snapshot.shots.Length, World.SHOT_FIELDS);
            world.nextGroupId = snapshot.nextGroupId;
            var groups = new List<SavedGroup>(snapshot.groups);
            Sorting.StableSort(groups, (a, b) => a.id.CompareTo(b.id));
            foreach (SavedGroup saved in groups)
            {
                byte[] field = null;
                if (saved.field != null)
                {
                    field = new byte[saved.field.Length];
                    for (int i = 0; i < field.Length; i++) field[i] = unchecked((byte)saved.field[i]);
                }
                world.groups.Set(new MoveGroup
                {
                    id = saved.id,
                    goalTile = saved.goalTile,
                    faceX = saved.faceX,
                    faceY = saved.faceY,
                    refs = saved.refs,
                    status = saved.status,
                    field = field,
                    fieldChecksum = field == null ? 0 : Routing.ChecksumBytes(field),
                });
            }
            foreach (RouteRequest request in snapshot.routeQueue) world.routeQueue.Enqueue(request);
            SavedSearch active = snapshot.activeSearch;
            if (active != null)
            {
                world.activeSearch = Routing.RestoreSearch(world, active.request, active.start, active.goal, (int[])active.targets.Clone());
                world.activeSearch.search.Run(active.expansions);
            }
            foreach (ScheduledCommand entry in snapshot.pending) world.commands.Schedule(entry, world.tick);
            return world;
        }
    }
}
