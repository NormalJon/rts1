using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Rts.Sim;
using UnityEngine;

namespace Rts.Game.Tests
{
    /// <summary>
    /// A match as the TypeScript game recorded it, read from recordings/ at
    /// the top of the repository: the settings, every command, and the world
    /// checksum after every tick. The same files csharp/Rts.Core.Tests reads;
    /// keep this in step with RecordedMatch.cs there.
    /// </summary>
    public sealed class RecordedMatch
    {
        const int CHECKSUMS_PER_ROW = 64;

        public string name;
        /// <summary>An AI match: the level of each player's AI, null for a player given no orders. Null for a scripted match.</summary>
        public string[] controllers;
        public SimConfig config;
        public int ticks;
        public List<ScheduledCommand> commands;
        string[] checksums;

        public static string Folder => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "recordings"));

        /// <summary>The names of the recorded matches, without ".json".</summary>
        public static IEnumerable<string> Names()
        {
            if (!Directory.Exists(Folder)) return new string[0];
            return Directory.GetFiles(Folder, "*.json")
                .Select(Path.GetFileNameWithoutExtension)
                .Where(name => name != "figures")
                .OrderBy(name => name, StringComparer.Ordinal);
        }

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
            var root = (Dictionary<string, object>)MiniJson.Parse(File.ReadAllText(Path.Combine(Folder, name + ".json")));
            if (Int(root["format"]) != 1) throw new InvalidDataException(name + ": unknown recording format");
            var match = new RecordedMatch
            {
                name = (string)root["name"],
                config = ReadConfig((Dictionary<string, object>)root["config"]),
                ticks = Int(root["ticks"]),
                commands = ((List<object>)root["commands"]).Select(ReadScheduled).ToList(),
                checksums = ((List<object>)root["checksums"]).Select(row => (string)row).ToArray(),
            };
            if (root["controllers"] is List<object> levels) match.controllers = levels.Select(level => (string)level).ToArray();
            return match;
        }

        /// <summary>A whole number from the file, cut to 32 bits the way the TypeScript's `| 0` does.</summary>
        static int Int(object value)
        {
            return unchecked((int)(long)value);
        }

        static int Int(Dictionary<string, object> parent, string property)
        {
            return Int(parent[property]);
        }

        static int[] Ints(Dictionary<string, object> parent, string property)
        {
            return parent.TryGetValue(property, out object list) && list is List<object> items ? items.Select(Int).ToArray() : null;
        }

        /// <summary>True only if the property is there and is `true`, as `=== true` in the TypeScript.</summary>
        static bool Flag(Dictionary<string, object> parent, string property)
        {
            return parent.TryGetValue(property, out object value) && value is bool flag && flag;
        }

        static SimConfig ReadConfig(Dictionary<string, object> json)
        {
            var config = new SimConfig
            {
                tickRate = Int(json, "tickRate"),
                seed = Int(json, "seed"),
                playerCount = Int(json, "playerCount"),
                teams = Ints(json, "teams"),
                startAge = Int(json, "startAge"),
                mapWidth = Int(json, "mapWidth"),
                mapHeight = Int(json, "mapHeight"),
                map = ReadMapSpec((Dictionary<string, object>)json["map"]),
                maxEntities = Int(json, "maxEntities"),
                pathBudget = Int(json, "pathBudget"),
            };
            switch ((string)json["mapState"])
            {
                case "concealed": config.mapState = MapState.Concealed; break;
                case "explored": config.mapState = MapState.Explored; break;
                case "revealed": config.mapState = MapState.Revealed; break;
                default: throw new InvalidDataException("unknown mapState: " + json["mapState"]);
            }
            switch ((string)json["start"])
            {
                case "empty": config.start = StartKind.Empty; break;
                case "standard": config.start = StartKind.Standard; break;
                default: throw new InvalidDataException("unknown start: " + json["start"]);
            }
            return config;
        }

        static MapSpec ReadMapSpec(Dictionary<string, object> spec)
        {
            switch ((string)spec["kind"])
            {
                case "flat": return MapSpec.Flat();
                case "generated": return MapSpec.Generated();
                case "ascii": return MapSpec.Ascii(((List<object>)spec["rows"]).Select(row => (string)row).ToArray());
                default: throw new InvalidDataException("unknown kind of map: " + spec["kind"]);
            }
        }

        static ScheduledCommand ReadScheduled(object entry)
        {
            var json = (Dictionary<string, object>)entry;
            return new ScheduledCommand(Int(json, "tick"), Int(json, "player"), Int(json, "seq"), ReadCommand((Dictionary<string, object>)json["command"]));
        }

        static Command ReadCommand(Dictionary<string, object> json)
        {
            string kind = (string)json["kind"];
            switch (kind)
            {
                case "spawn": return Command.Spawn(Int(json, "x"), Int(json, "y"), Int(json, "count"), Int(json, "unitType"));
                case "move": return Command.Move(Ints(json, "units"), Int(json, "x"), Int(json, "y"), Flag(json, "queue"));
                case "attackMove": return Command.AttackMove(Ints(json, "units"), Int(json, "x"), Int(json, "y"), Flag(json, "queue"));
                case "patrol": return Command.Patrol(Ints(json, "units"), Int(json, "x"), Int(json, "y"));
                case "attack": return Command.Attack(Ints(json, "units"), Int(json, "target"));
                case "stop": return Command.Stop(Ints(json, "units"));
                case "hold": return Command.Hold(Ints(json, "units"));
                case "gather": return Command.Gather(Ints(json, "units"), Int(json, "tile"));
                case "deliver": return Command.Deliver(Ints(json, "units"), Int(json, "target"));
                case "build": return Command.Build(Ints(json, "units"), Int(json, "buildingType"), Int(json, "tileX"), Int(json, "tileY"));
                case "construct": return Command.Construct(Ints(json, "units"), Int(json, "target"));
                case "train": return Command.Train(Int(json, "building"), Int(json, "unitType"));
                case "research": return Command.Research(Int(json, "building"), Int(json, "tech"));
                case "cancelTrain": return Command.CancelTrain(Int(json, "building"), Int(json, "index"));
                case "rally": return Command.Rally(Ints(json, "buildings"), Int(json, "x"), Int(json, "y"));
                case "demolish": return Command.Demolish(Ints(json, "targets"));
                default: throw new InvalidDataException("unknown kind of command: " + kind);
            }
        }
    }
}
