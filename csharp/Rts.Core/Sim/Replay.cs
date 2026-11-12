// Ported from src/sim/replay.ts. Keep the two in step.

using System;
using System.Collections.Generic;

namespace Rts.Sim
{
    /// <summary>
    /// A replay is the match settings plus every command and the tick it ran on.
    /// Running it again rebuilds the match exactly, which is also how the tests
    /// check that the simulation is deterministic.
    /// </summary>
    public sealed class Replay
    {
        public int version = 1;
        public SimConfig config;
        /// <summary>How many ticks the recorded match ran.</summary>
        public int ticks;
        public IReadOnlyList<ScheduledCommand> commands;

        /// <summary>
        /// Re-runs a replay from the start and returns the resulting world.
        /// onTick, if given, is called after every tick.
        /// </summary>
        /// <param name="untilTick">The tick to stop at; -1 for the whole replay.</param>
        public static World RunReplay(Replay replay, Action<World> onTick = null, int untilTick = -1)
        {
            if (replay.version != 1) throw new InvalidOperationException($"unsupported replay version {replay.version}");
            if (untilTick == -1) untilTick = replay.ticks;
            var world = new World(replay.config);
            foreach (ScheduledCommand entry in replay.commands) world.commands.Schedule(entry, 0);
            while (world.tick < untilTick)
            {
                Simulation.Step(world);
                onTick?.Invoke(world);
            }
            return world;
        }
    }
}
