using System.Text.Json;
using Rts.Sim;

namespace Rts.Tests
{
    /// <summary>
    /// A match as the TypeScript game recorded it (see test/recordings.ts
    /// there): the settings, every command, and the world checksum after every
    /// tick.
    /// </summary>
    public sealed class RecordedMatch
    {
        const int CHECKSUMS_PER_ROW = 64;

        public string name;
        public string about;
        /// <summary>An AI match: the level of each player's AI, null for a player given no orders. Null for a scripted match.</summary>
        public string[] controllers;
        public SimConfig config;
        public int ticks;
        public List<ScheduledCommand> commands;
        string[] checksums;

        /// <summary>The checksum recorded for the state after a tick has run (tick 0 is the first), as eight hex digits.</summary>
        public string ChecksumAfter(int tick)
        {
            return checksums[tick / CHECKSUMS_PER_ROW].Substring((tick % CHECKSUMS_PER_ROW) * 8, 8);
        }

        public Replay ToReplay()
        {
            return new Replay { config = config.Clone(), ticks = ticks, commands = commands };
        }

        public static RecordedMatch Load(string name)
        {
            using JsonDocument document = RecordingFiles.Read(name + ".json");
            JsonElement root = document.RootElement;
            if (root.GetProperty("format").GetInt32() != 1) throw new InvalidDataException(name + ": unknown recording format");
            var match = new RecordedMatch
            {
                name = root.GetProperty("name").GetString(),
                about = root.GetProperty("about").GetString(),
                config = ReadConfig(root.GetProperty("config")),
                ticks = root.GetProperty("ticks").GetInt32(),
                commands = root.GetProperty("commands").EnumerateArray().Select(ReadScheduled).ToList(),
                checksums = root.GetProperty("checksums").EnumerateArray().Select(row => row.GetString()).ToArray(),
            };
            JsonElement controllers = root.GetProperty("controllers");
            if (controllers.ValueKind != JsonValueKind.Null)
            {
                match.controllers = controllers.EnumerateArray().Select(level => level.GetString()).ToArray();
            }
            return match;
        }

        /// <summary>A whole number from the file, cut to 32 bits the way the TypeScript's `| 0` does.</summary>
        static int Int(JsonElement value)
        {
            return unchecked((int)value.GetInt64());
        }

        static int Int(JsonElement parent, string property)
        {
            return Int(parent.GetProperty(property));
        }

        static int[] Ints(JsonElement parent, string property)
        {
            return parent.TryGetProperty(property, out JsonElement list) && list.ValueKind == JsonValueKind.Array
                ? list.EnumerateArray().Select(Int).ToArray()
                : null;
        }

        static SimConfig ReadConfig(JsonElement json)
        {
            return new SimConfig
            {
                tickRate = Int(json, "tickRate"),
                seed = Int(json, "seed"),
                playerCount = Int(json, "playerCount"),
                teams = Ints(json, "teams"),
                mapState = json.GetProperty("mapState").GetString() switch
                {
                    "concealed" => MapState.Concealed,
                    "explored" => MapState.Explored,
                    "revealed" => MapState.Revealed,
                    string other => throw new InvalidDataException("unknown mapState: " + other),
                },
                startAge = Int(json, "startAge"),
                mapWidth = Int(json, "mapWidth"),
                mapHeight = Int(json, "mapHeight"),
                map = RecordingFiles.ReadMapSpec(json.GetProperty("map")),
                start = json.GetProperty("start").GetString() switch
                {
                    "empty" => StartKind.Empty,
                    "standard" => StartKind.Standard,
                    string other => throw new InvalidDataException("unknown start: " + other),
                },
                maxEntities = Int(json, "maxEntities"),
                pathBudget = Int(json, "pathBudget"),
            };
        }

        static ScheduledCommand ReadScheduled(JsonElement json)
        {
            return new ScheduledCommand(Int(json, "tick"), Int(json, "player"), Int(json, "seq"), ReadCommand(json.GetProperty("command")));
        }

        static Command ReadCommand(JsonElement json)
        {
            string kind = json.GetProperty("kind").GetString();
            switch (kind)
            {
                case "spawn":
                    return Command.Spawn(Int(json, "x"), Int(json, "y"), Int(json, "count"), Int(json, "unitType"));
                case "move":
                    return Command.Move(Ints(json, "units"), Int(json, "x"), Int(json, "y"), Flag(json, "queue"));
                case "attackMove":
                    return Command.AttackMove(Ints(json, "units"), Int(json, "x"), Int(json, "y"), Flag(json, "queue"));
                case "patrol":
                    return Command.Patrol(Ints(json, "units"), Int(json, "x"), Int(json, "y"));
                case "attack":
                    return Command.Attack(Ints(json, "units"), Int(json, "target"));
                case "stop":
                    return Command.Stop(Ints(json, "units"));
                case "hold":
                    return Command.Hold(Ints(json, "units"));
                case "gather":
                    return Command.Gather(Ints(json, "units"), Int(json, "tile"));
                case "deliver":
                    return Command.Deliver(Ints(json, "units"), Int(json, "target"));
                case "build":
                    return Command.Build(Ints(json, "units"), Int(json, "buildingType"), Int(json, "tileX"), Int(json, "tileY"));
                case "construct":
                    return Command.Construct(Ints(json, "units"), Int(json, "target"));
                case "train":
                    return Command.Train(Int(json, "building"), Int(json, "unitType"));
                case "research":
                    return Command.Research(Int(json, "building"), Int(json, "tech"));
                case "cancelTrain":
                    return Command.CancelTrain(Int(json, "building"), Int(json, "index"));
                case "rally":
                    return Command.Rally(Ints(json, "buildings"), Int(json, "x"), Int(json, "y"));
                case "demolish":
                    return Command.Demolish(Ints(json, "targets"));
                default:
                    throw new InvalidDataException("unknown kind of command: " + kind);
            }
        }

        /// <summary>True only if the property is there and is `true`, as `=== true` in the TypeScript.</summary>
        static bool Flag(JsonElement parent, string property)
        {
            return parent.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.True;
        }
    }
}
