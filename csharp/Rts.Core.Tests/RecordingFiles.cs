using System.Text.Json;

namespace Rts.Tests
{
    /// <summary>
    /// Finds and reads the files in recordings/ at the top of the repository,
    /// which the TypeScript game writes (see test/recordings.ts there).
    /// </summary>
    public static class RecordingFiles
    {
        static readonly Lazy<string> directory = new Lazy<string>(Find);

        public static string Directory => directory.Value;

        static string Find()
        {
            // The tests run from csharp/Rts.Core.Tests/bin/...; walk up to the repository.
            var at = new DirectoryInfo(AppContext.BaseDirectory);
            while (at != null)
            {
                string candidate = Path.Combine(at.FullName, "recordings");
                if (File.Exists(Path.Combine(candidate, "figures.json"))) return candidate;
                at = at.Parent;
            }
            throw new DirectoryNotFoundException(
                "Could not find the recordings folder above " + AppContext.BaseDirectory + ". Run `npm run record` at the top of the repository.");
        }

        public static JsonDocument Read(string fileName)
        {
            return JsonDocument.Parse(File.ReadAllText(Path.Combine(Directory, fileName)));
        }

        /// <summary>A map as the match settings describe it: {"kind": "flat"}, {"kind": "generated"} or {"kind": "ascii", "rows": [...]}.</summary>
        public static Rts.Sim.MapSpec ReadMapSpec(JsonElement spec)
        {
            switch (spec.GetProperty("kind").GetString())
            {
                case "flat":
                    return Rts.Sim.MapSpec.Flat();
                case "generated":
                    return Rts.Sim.MapSpec.Generated();
                case "ascii":
                    return Rts.Sim.MapSpec.Ascii(spec.GetProperty("rows").EnumerateArray().Select(row => row.GetString()).ToArray());
                default:
                    throw new InvalidDataException("unknown kind of map: " + spec.GetProperty("kind").GetString());
            }
        }

        /// <summary>The names of the recorded matches, without ".json".</summary>
        public static IEnumerable<string> MatchNames()
        {
            return System.IO.Directory.GetFiles(Directory, "*.json")
                .Select(Path.GetFileNameWithoutExtension)
                .Where(name => name != "figures")
                .OrderBy(name => name, StringComparer.Ordinal);
        }
    }

    /// <summary>Folds a run of numbers into one, 32 bits at a time. The same as Fold in test/recordings.ts.</summary>
    public sealed class Fold
    {
        uint h = 0x811c9dc5;

        public void Add(long value)
        {
            unchecked
            {
                h = (h ^ (uint)value) * 0x01000193;
                h = (h << 13) | (h >> 19);
            }
        }

        public uint Value => h;

        public static uint Of(byte[] values)
        {
            var fold = new Fold();
            foreach (byte value in values) fold.Add(value);
            return fold.Value;
        }

        public static uint Of(int[] values)
        {
            var fold = new Fold();
            foreach (int value in values) fold.Add(value);
            return fold.Value;
        }

        public static uint Of(IEnumerable<int> values)
        {
            var fold = new Fold();
            foreach (int value in values) fold.Add(value);
            return fold.Value;
        }
    }
}
