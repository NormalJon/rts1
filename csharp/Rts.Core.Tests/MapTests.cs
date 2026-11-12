using System.Text.Json;
using Rts.Sim;

namespace Rts.Tests
{
    /// <summary>
    /// Maps and route searches, checked against figures worked out by the
    /// TypeScript game (recordings/figures.json): every tile of every map, and
    /// what each search found and how much work it took.
    /// </summary>
    public class MapTests
    {
        public static IEnumerable<object[]> Maps()
        {
            using JsonDocument figures = RecordingFiles.Read("figures.json");
            int count = figures.RootElement.GetProperty("maps").GetArrayLength();
            for (int i = 0; i < count; i++) yield return new object[] { i };
        }

        /// <summary>The same as checksumBytes in src/sim/routing.ts, written out again here so the two can be told apart if one is wrong.</summary>
        static uint ChecksumBytes(byte[] bytes)
        {
            uint h = 0x811c9dc5;
            foreach (byte b in bytes) h = unchecked((h ^ b) * 0x01000193);
            return h;
        }

        [Theory]
        [MemberData(nameof(Maps))]
        public void MapsAndSearchesComeOutTheSameAsTheTypeScript(int index)
        {
            using JsonDocument figures = RecordingFiles.Read("figures.json");
            JsonElement want = figures.RootElement.GetProperty("maps")[index];
            int width = want.GetProperty("width").GetInt32();
            int height = want.GetProperty("height").GetInt32();
            int seed = want.GetProperty("seed").GetInt32();
            MapSpec spec = RecordingFiles.ReadMapSpec(want.GetProperty("map"));
            string what = $"{spec.kind} map {width} by {height}, seed {seed}";

            GameMap map = MapGen.BuildMap(width, height, seed, spec);

            Assert.True(want.GetProperty("terrain").GetUInt32() == Fold.Of(map.terrain), $"{what}: the terrain differs");
            Assert.True(want.GetProperty("amount").GetUInt32() == Fold.Of(map.amount), $"{what}: the resources differ");
            Assert.True(want.GetProperty("passable").GetUInt32() == Fold.Of(map.passable), $"{what}: which tiles can be walked on differs");
            Assert.True(want.GetProperty("region").GetUInt32() == Fold.Of(map.region), $"{what}: the connected regions differ");
            Assert.True(want.GetProperty("elevation").GetUInt32() == Fold.Of(map.elevation), $"{what}: the heights differ");
            int[] starts = want.GetProperty("starts").EnumerateArray().Select(value => value.GetInt32()).ToArray();
            Assert.Equal(starts, map.starts.SelectMany(start => new[] { start.x, start.y }).ToArray());
            Assert.True(want.GetProperty("checksum").GetUInt32() == map.checksum, $"{what}: the map checksum differs");
            Assert.True(want.GetProperty("stateHash").GetInt32() == map.stateHash, $"{what}: the map state checksum differs");

            var scratch = new SearchScratch(map.tileCount);
            int number = 0;
            foreach (JsonElement search in want.GetProperty("searches").EnumerateArray())
            {
                number++;
                int start = search.GetProperty("start").GetInt32();
                int goal = search.GetProperty("goal").GetInt32();
                int expansions = search.GetProperty("expansions").GetInt32();
                uint folded = search.GetProperty("folded").GetUInt32();
                if (search.GetProperty("kind").GetString() == "path")
                {
                    var astar = new AStarSearch(map, scratch, start, goal);
                    while (!astar.done) astar.Run(37);
                    int[] path = astar.found ? astar.Path() : new int[0];
                    Assert.True(search.GetProperty("found").GetBoolean() == astar.found, $"{what}, search {number}: found a path where the TypeScript did not, or the reverse");
                    Assert.True(expansions == astar.expansions, $"{what}, search {number}: examined {astar.expansions} tiles, the TypeScript {expansions}");
                    Assert.True(search.GetProperty("length").GetInt32() == path.Length, $"{what}, search {number}: the path is a different length");
                    Assert.True(folded == Fold.Of(path), $"{what}, search {number}: the path goes a different way");
                }
                else
                {
                    int[] targets = search.GetProperty("targets").EnumerateArray().Select(value => value.GetInt32()).ToArray();
                    var field = new FieldSearch(map, scratch, start, targets);
                    while (!field.done) field.Run(53);
                    Assert.True(expansions == field.expansions, $"{what}, search {number}: examined {field.expansions} tiles, the TypeScript {expansions}");
                    Assert.True(folded == ChecksumBytes(field.directions), $"{what}, search {number}: the flow field differs");
                }
            }
        }
    }
}
