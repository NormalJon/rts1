// Ported from src/sim/commands.ts. Keep the two in step.

using System;
using System.Collections.Generic;

namespace Rts.Sim
{
    public enum CommandKind
    {
        /// <summary>
        /// Scaffolding for tests and debug pages: drops units on the map without
        /// their being trained or paid for. Uses x, y, count and unitType.
        /// </summary>
        Spawn,
        /// <summary>Uses units, x, y and queue (add to the units' waypoints instead of replacing what they are doing).</summary>
        Move,
        /// <summary>Like move, but the units fight whatever they meet on the way and then carry on.</summary>
        AttackMove,
        /// <summary>Walk to and fro between where each unit stands and this point, fighting whatever comes near. Uses units, x and y.</summary>
        Patrol,
        /// <summary>Go after one enemy unit or building until it is destroyed. Uses units and target.</summary>
        Attack,
        /// <summary>Uses units.</summary>
        Stop,
        /// <summary>Stand fast: strike at what comes within reach, but never give chase. Uses units.</summary>
        Hold,
        /// <summary>Work a resource tile: gather from it, carry the load to a drop-off, and repeat. Uses units and tile (row * map width + column).</summary>
        Gather,
        /// <summary>Hand in whatever is being carried at a drop-off building. Uses units and target.</summary>
        Deliver,
        /// <summary>Found a building with its centre on a tile, and set these villagers to building it. Uses units, buildingType, tileX and tileY.</summary>
        Build,
        /// <summary>Work on a building site that already exists, or mend a damaged building. Uses units and target.</summary>
        Construct,
        /// <summary>Add a unit to a building's training queue. Uses building and unitType.</summary>
        Train,
        /// <summary>Add a technology (or a reform, at the town centre) to a building's queue. Uses building and tech (an index into TECHS).</summary>
        Research,
        /// <summary>Take a unit or a technology out of a building's queue; 0 is the one under way. Uses building and index.</summary>
        CancelTrain,
        /// <summary>Set where units trained at these buildings go. On a resource, villagers start gathering it. Uses buildings, x and y.</summary>
        Rally,
        /// <summary>Pull down the player's own buildings. Unfinished ones are refunded. Uses targets.</summary>
        Demolish,
    }

    /// <summary>
    /// Commands are the only way anything outside the simulation changes it.
    ///
    /// A player's click, an AI decision, a line in a replay file and a packet
    /// from another player all become the same thing: a command stamped with the
    /// tick it runs on. Two simulations given the same commands on the same
    /// ticks end up in exactly the same state.
    ///
    /// One class serves every kind of command; each kind reads only the fields
    /// listed for it under <see cref="CommandKind"/>. A list that a command
    /// needs may be null if whoever sent it left it out, and is then ignored.
    /// </summary>
    public sealed class Command
    {
        public CommandKind kind;
        public int x;
        public int y;
        public int count;
        /// <summary>Index into ENTITY_TYPES.</summary>
        public int unitType;
        public int[] units;
        public bool queue;
        public int target;
        public int tile;
        /// <summary>Index into ENTITY_TYPES.</summary>
        public int buildingType;
        public int tileX;
        public int tileY;
        public int building;
        public int tech;
        public int index;
        public int[] buildings;
        public int[] targets;

        public static Command Spawn(int x, int y, int count, int unitType)
        {
            return new Command { kind = CommandKind.Spawn, x = x, y = y, count = count, unitType = unitType };
        }

        public static Command Move(int[] units, int x, int y, bool queue = false)
        {
            return new Command { kind = CommandKind.Move, units = units, x = x, y = y, queue = queue };
        }

        public static Command AttackMove(int[] units, int x, int y, bool queue = false)
        {
            return new Command { kind = CommandKind.AttackMove, units = units, x = x, y = y, queue = queue };
        }

        public static Command Patrol(int[] units, int x, int y)
        {
            return new Command { kind = CommandKind.Patrol, units = units, x = x, y = y };
        }

        public static Command Attack(int[] units, int target)
        {
            return new Command { kind = CommandKind.Attack, units = units, target = target };
        }

        public static Command Stop(int[] units)
        {
            return new Command { kind = CommandKind.Stop, units = units };
        }

        public static Command Hold(int[] units)
        {
            return new Command { kind = CommandKind.Hold, units = units };
        }

        public static Command Gather(int[] units, int tile)
        {
            return new Command { kind = CommandKind.Gather, units = units, tile = tile };
        }

        public static Command Deliver(int[] units, int target)
        {
            return new Command { kind = CommandKind.Deliver, units = units, target = target };
        }

        public static Command Build(int[] units, int buildingType, int tileX, int tileY)
        {
            return new Command { kind = CommandKind.Build, units = units, buildingType = buildingType, tileX = tileX, tileY = tileY };
        }

        public static Command Construct(int[] units, int target)
        {
            return new Command { kind = CommandKind.Construct, units = units, target = target };
        }

        public static Command Train(int building, int unitType)
        {
            return new Command { kind = CommandKind.Train, building = building, unitType = unitType };
        }

        public static Command Research(int building, int tech)
        {
            return new Command { kind = CommandKind.Research, building = building, tech = tech };
        }

        public static Command CancelTrain(int building, int index)
        {
            return new Command { kind = CommandKind.CancelTrain, building = building, index = index };
        }

        public static Command Rally(int[] buildings, int x, int y)
        {
            return new Command { kind = CommandKind.Rally, buildings = buildings, x = x, y = y };
        }

        public static Command Demolish(int[] targets)
        {
            return new Command { kind = CommandKind.Demolish, targets = targets };
        }
    }

    public sealed class ScheduledCommand
    {
        /// <summary>The command runs at the start of this tick.</summary>
        public readonly int tick;
        public readonly int player;
        /// <summary>The player's own running count of commands; orders commands within a tick.</summary>
        public readonly int seq;
        public readonly Command command;

        public ScheduledCommand(int tick, int player, int seq, Command command)
        {
            this.tick = tick;
            this.player = player;
            this.seq = seq;
            this.command = command;
        }
    }

    public sealed class CommandQueue
    {
        // Looked up by tick only; nothing reads it in order.
        readonly Dictionary<int, List<ScheduledCommand>> byTick = new Dictionary<int, List<ScheduledCommand>>();
        int count = 0;

        static int ByPlayerThenSeq(ScheduledCommand a, ScheduledCommand b)
        {
            return a.player != b.player ? a.player.CompareTo(b.player) : a.seq.CompareTo(b.seq);
        }

        /// <summary>
        /// Adds a command for a tick that has not run yet. A command for a tick
        /// that has already run can never be applied consistently, so it is an
        /// error.
        /// </summary>
        public void Schedule(ScheduledCommand entry, int nextTick)
        {
            if (entry.tick < nextTick)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(entry),
                    $"command for tick {entry.tick} arrived too late; the next tick to run is {nextTick}");
            }
            if (!byTick.TryGetValue(entry.tick, out List<ScheduledCommand> list))
            {
                list = new List<ScheduledCommand>();
                byTick[entry.tick] = list;
            }
            foreach (ScheduledCommand other in list)
            {
                if (other.player == entry.player && other.seq == entry.seq)
                {
                    throw new InvalidOperationException(
                        $"duplicate command: player {entry.player}, seq {entry.seq}, tick {entry.tick}");
                }
            }
            list.Add(entry);
            count++;
        }

        /// <summary>
        /// Removes and returns the commands for a tick, ordered by player and then
        /// by each player's own sequence. The order never depends on arrival order.
        /// </summary>
        public List<ScheduledCommand> TakeDue(int tick)
        {
            if (!byTick.TryGetValue(tick, out List<ScheduledCommand> list)) return new List<ScheduledCommand>();
            byTick.Remove(tick);
            count -= list.Count;
            Sorting.StableSort(list, ByPlayerThenSeq);
            return list;
        }

        /// <summary>Every command still waiting, in the order it will run.</summary>
        public List<ScheduledCommand> Pending()
        {
            var ticks = new List<int>(byTick.Keys);
            ticks.Sort();
            var waiting = new List<ScheduledCommand>();
            foreach (int tick in ticks)
            {
                var list = new List<ScheduledCommand>(byTick[tick]);
                Sorting.StableSort(list, ByPlayerThenSeq);
                waiting.AddRange(list);
            }
            return waiting;
        }

        public int size => count;
    }

    /// <summary>
    /// Sorting that keeps items that compare equal in the order they came in, as
    /// the TypeScript's sort does and the framework's does not promise to.
    /// </summary>
    public static class Sorting
    {
        public static void StableSort<T>(List<T> items, Comparison<T> compare)
        {
            int count = items.Count;
            if (count < 2) return;
            var from = items.ToArray();
            var to = new T[count];
            // Merge runs of 1, then 2, then 4, taking from the left run on a tie.
            for (int width = 1; width < count; width *= 2)
            {
                for (int left = 0; left < count; left += 2 * width)
                {
                    int middle = Math.Min(left + width, count);
                    int right = Math.Min(left + 2 * width, count);
                    int a = left;
                    int b = middle;
                    for (int k = left; k < right; k++)
                    {
                        if (a < middle && (b >= right || compare(from[a], from[b]) <= 0)) to[k] = from[a++];
                        else to[k] = from[b++];
                    }
                }
                T[] swap = from;
                from = to;
                to = swap;
            }
            for (int i = 0; i < count; i++) items[i] = from[i];
        }
    }
}
