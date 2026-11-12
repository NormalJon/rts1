using Rts.Ai;
using Rts.Session;
using Rts.Sim;

namespace Rts.Tests
{
    /// <summary>
    /// The proof of the AI port. Playing a recorded AI match back from its
    /// commands (ReplayTests) says nothing about the AI, which is not consulted.
    /// So here the C# AI plays each recorded AI match itself, from the first
    /// tick: it must give exactly the orders the TypeScript AI gave, on the same
    /// ticks, and the world checksum must be the same after every tick.
    /// </summary>
    public class AiTests
    {
        public static IEnumerable<object[]> AiMatches()
        {
            return RecordingFiles.MatchNames()
                .Where(name => RecordedMatch.Load(name).controllers != null)
                .Select(name => new object[] { name });
        }

        static Difficulty Level(string level)
        {
            switch (level)
            {
                case "easy": return Difficulty.Easy;
                case "standard": return Difficulty.Standard;
                case "hard": return Difficulty.Hard;
                default: throw new InvalidDataException("unknown AI level: " + level);
            }
        }

        /// <summary>A command written out in full, so that two can be compared and a difference shown.</summary>
        static string Describe(ScheduledCommand entry)
        {
            Command c = entry.command;
            string List(int[] ids) => ids == null ? "none" : "[" + string.Join(",", ids) + "]";
            string what;
            switch (c.kind)
            {
                case CommandKind.Spawn: what = $"spawn {c.count} of type {c.unitType} at {c.x},{c.y}"; break;
                case CommandKind.Move: what = $"move {List(c.units)} to {c.x},{c.y}{(c.queue ? " queued" : "")}"; break;
                case CommandKind.AttackMove: what = $"attackMove {List(c.units)} to {c.x},{c.y}{(c.queue ? " queued" : "")}"; break;
                case CommandKind.Patrol: what = $"patrol {List(c.units)} to {c.x},{c.y}"; break;
                case CommandKind.Attack: what = $"attack {c.target} with {List(c.units)}"; break;
                case CommandKind.Stop: what = $"stop {List(c.units)}"; break;
                case CommandKind.Hold: what = $"hold {List(c.units)}"; break;
                case CommandKind.Gather: what = $"gather tile {c.tile} with {List(c.units)}"; break;
                case CommandKind.Deliver: what = $"deliver to {c.target} with {List(c.units)}"; break;
                case CommandKind.Build: what = $"build type {c.buildingType} at tile {c.tileX},{c.tileY} with {List(c.units)}"; break;
                case CommandKind.Construct: what = $"construct {c.target} with {List(c.units)}"; break;
                case CommandKind.Train: what = $"train type {c.unitType} at {c.building}"; break;
                case CommandKind.Research: what = $"research {c.tech} at {c.building}"; break;
                case CommandKind.CancelTrain: what = $"cancel {c.index} at {c.building}"; break;
                case CommandKind.Rally: what = $"rally {List(c.buildings)} to {c.x},{c.y}"; break;
                case CommandKind.Demolish: what = $"demolish {List(c.targets)}"; break;
                default: what = c.kind.ToString(); break;
            }
            return $"tick {entry.tick}, player {entry.player}, order {entry.seq}: {what}";
        }

        [Theory]
        [MemberData(nameof(AiMatches))]
        public void TheAiGivesTheSameOrdersAndTheMatchPlaysOutTheSame(string name)
        {
            RecordedMatch match = RecordedMatch.Load(name);
            var session = new LocalSession(match.config.Clone());
            for (int player = 0; player < match.controllers.Length; player++)
            {
                if (match.controllers[player] != null) session.Control(player, new SkirmishAi(player, Level(match.controllers[player])));
            }

            int firstWrong = -1;
            string mine = null;
            for (int tick = 0; tick < match.ticks; tick++)
            {
                session.Step();
                string checksum = Hash.HashHex(Hash.HashWorld(session.world));
                if (checksum != match.ChecksumAfter(tick))
                {
                    firstWrong = tick;
                    mine = checksum;
                    break;
                }
            }

            // Whether or not the checksums agreed, say which order was the first to differ: that is where an AI bug shows first.
            List<string> given = session.Replay().commands.Select(Describe).ToList();
            List<string> recorded = match.commands.Select(Describe).ToList();
            if (firstWrong != -1) recorded = recorded.Where((_, i) => match.commands[i].tick <= firstWrong + 1).ToList();
            int shared = Math.Min(given.Count, recorded.Count);
            string difference = null;
            for (int i = 0; i < shared && difference == null; i++)
            {
                if (given[i] != recorded[i]) difference = $"The first order to differ: the C# AI gave [{given[i]}] where the TypeScript AI gave [{recorded[i]}].";
            }
            if (difference == null && given.Count < recorded.Count) difference = $"The C# AI gave {given.Count} orders and stopped short of this one: [{recorded[given.Count]}].";
            if (difference == null && given.Count > recorded.Count && firstWrong == -1) difference = $"The C# AI gave an order the TypeScript AI did not: [{given[recorded.Count]}].";

            Assert.True(
                firstWrong == -1,
                firstWrong == -1
                    ? ""
                    : $"{name}: the first tick to differ is tick {firstWrong} of {match.ticks}. After it the C# checksum is {mine}; the TypeScript recorded {match.ChecksumAfter(firstWrong)}. {difference ?? "Every order up to then was the same."}");
            Assert.True(difference == null, $"{name}: {difference}");
            Assert.Equal(match.commands.Count, given.Count);
        }
    }
}
