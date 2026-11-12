// Ported from src/session/localSession.ts. Keep the two in step.

using System;
using System.Collections.Generic;
using Rts.Ai;
using Rts.Sim;

namespace Rts.Session
{
    /// <summary>
    /// A match running on one machine: the world, plus the bookkeeping that
    /// turns "the player clicked" into a tick-stamped command and records it.
    ///
    /// Multiplayer will add a sibling of this class that sends each command to
    /// the other players before it runs. The simulation itself does not change.
    /// </summary>
    public sealed class LocalSession
    {
        public readonly World world;
        /// <summary>
        /// Extra whole ticks between issuing a command and running it. Zero means
        /// the command runs on the very next tick, which is right for local play.
        /// Online play needs a few ticks so the command can reach every player
        /// first.
        /// </summary>
        public int inputDelayTicks;

        readonly int[] nextSeq;
        readonly List<ScheduledCommand> log = new List<ScheduledCommand>();
        /// <summary>Players run by something other than a person at this machine: an AI, say. Null for the rest.</summary>
        readonly IController[] controllers;

        public LocalSession(SimConfig config, int inputDelayTicks = 0)
        {
            world = new World(config);
            this.inputDelayTicks = inputDelayTicks;
            nextSeq = new int[config.playerCount];
            controllers = new IController[config.playerCount];
        }

        /// <summary>Schedules a command for a player and returns it with its tick filled in.</summary>
        public ScheduledCommand Issue(int player, Command command)
        {
            if (player < 0 || player >= nextSeq.Length) throw new ArgumentOutOfRangeException(nameof(player), $"no such player: {player}");
            int seq = nextSeq[player];
            nextSeq[player] = seq + 1;
            var entry = new ScheduledCommand(world.tick + Math.Max(0, inputDelayTicks), player, seq, command);
            world.commands.Schedule(entry, world.tick);
            log.Add(entry);
            return entry;
        }

        /// <summary>
        /// Hands a player over to a controller, which is asked for its commands
        /// before every tick. They are issued and recorded like anyone else's, so
        /// a replay of the match plays back without the controller. Null hands the
        /// player back.
        /// </summary>
        public void Control(int player, IController controller)
        {
            if (player < 0 || player >= nextSeq.Length) throw new ArgumentOutOfRangeException(nameof(player), $"no such player: {player}");
            controllers[player] = controller;
        }

        public void Step()
        {
            for (int player = 0; player < controllers.Length; player++)
            {
                IController controller = controllers[player];
                if (controller == null) continue;
                foreach (Command command in controller.Act(world)) Issue(player, command);
            }
            Simulation.Step(world);
        }

        /// <summary>Everything needed to re-run the match so far.</summary>
        public Replay Replay()
        {
            return new Replay
            {
                version = 1,
                config = world.config.Clone(),
                ticks = world.tick,
                commands = new List<ScheduledCommand>(log),
            };
        }
    }
}
