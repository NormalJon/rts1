using System.Text.Json;
using Rts.Sim;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Techs;

namespace Rts.Tests
{
    /// <summary>
    /// The tables: every technology as it is written down, what each one (and
    /// all of them together) makes of every unit and building, and how long
    /// everything takes at every tick rate. Checked against figures worked out
    /// by the TypeScript game (recordings/figures.json), because no one match
    /// researches everything or runs at every tick rate.
    /// </summary>
    public class TableTests
    {
        static void AddText(Fold fold, string text)
        {
            fold.Add(text.Length);
            foreach (char c in text) fold.Add(c);
        }

        static void Add(Fold fold, bool flag)
        {
            fold.Add(flag ? 1 : 0);
        }

        [Fact]
        public void EveryTechnologyIsWrittenDownAsInTheTypeScript()
        {
            using JsonDocument figures = RecordingFiles.Read("figures.json");
            JsonElement table = figures.RootElement.GetProperty("techs").GetProperty("table");
            Assert.Equal(table.GetArrayLength(), TECHS.Length);
            for (int id = 0; id < TECHS.Length; id++)
            {
                Tech tech = TECHS[id];
                var fold = new Fold();
                AddText(fold, tech.name);
                AddText(fold, tech.about);
                foreach (int amount in tech.cost) fold.Add(amount);
                fold.Add(tech.seconds);
                fold.Add(tech.at);
                fold.Add(tech.age);
                fold.Add(tech.requires.Length);
                foreach (int first in tech.requires) fold.Add(first);
                Add(fold, tech.reform);
                fold.Add(tech.needs);
                fold.Add(tech.among.Length);
                foreach (int kind in tech.among) fold.Add(kind);
                fold.Add(tech.effects.Length);
                JsonElement want = table[id];
                Assert.Equal(want.GetProperty("name").GetString(), tech.name);
                Assert.True(want.GetProperty("folded").GetUInt32() == fold.Value, $"technology {id} ({tech.name}) is not written down as in the TypeScript: check its description, cost, time, building, age and requirements");
            }
        }

        [Fact]
        public void ResearchMakesTheSameOfEveryUnitAndBuilding()
        {
            using JsonDocument figures = RecordingFiles.Read("figures.json");
            foreach (JsonElement want in figures.RootElement.GetProperty("techs").GetProperty("cases").EnumerateArray())
            {
                int[] researched = want.GetProperty("researched").EnumerateArray().Select(id => id.GetInt32()).ToArray();
                var world = new World(new SimConfig());
                foreach (int id in researched) world.researched[id] = 1;
                RebuildTypes(world, 0);
                var fold = new Fold();
                foreach (EntityType type in world.types[0])
                {
                    AddText(fold, type.name);
                    Add(fold, type.building);
                    foreach (int amount in type.cost) fold.Add(amount);
                    fold.Add(type.seconds);
                    fold.Add(type.age);
                    fold.Add(type.hp);
                    fold.Add(type.sight);
                    fold.Add(type.meleeArmor);
                    fold.Add(type.rangedArmor);
                    fold.Add(type.tags);
                    fold.Add(type.damage);
                    Add(fold, type.ranged);
                    fold.Add(type.range);
                    fold.Add(type.windup);
                    fold.Add(type.cycle);
                    fold.Add(type.bonuses.Length);
                    foreach (int[] bonus in type.bonuses)
                    {
                        fold.Add(bonus[0]);
                        fold.Add(bonus[1]);
                    }
                    fold.Add(type.charge);
                    Add(fold, type.braces);
                    Add(fold, type.aggressive);
                    fold.Add(type.speed);
                    fold.Add(type.radius);
                    fold.Add(type.carries);
                    Add(fold, type.builds);
                    fold.Add(type.population);
                    fold.Add(type.footprint);
                    fold.Add(type.accepts);
                    fold.Add(type.housing);
                    fold.Add(type.trains.Length);
                    foreach (int kind in type.trains) fold.Add(kind);
                    Add(fold, type.buildable);
                    Add(fold, type.farm);
                }
                for (int terrain = 0; terrain < TERRAINS; terrain++) fold.Add(world.gatherBonus[terrain]);
                string what =
                    researched.Length == 0 ? "with nothing researched"
                    : researched.Length == 1 ? $"with only {TECHS[researched[0]].name} researched"
                    : $"with {researched.Length} technologies researched";
                Assert.True(want.GetProperty("folded").GetUInt32() == fold.Value, $"the units and buildings come out differently from the TypeScript {what}");
            }
        }

        [Fact]
        public void EverythingTakesTheSameTimeAtEveryTickRate()
        {
            using JsonDocument figures = RecordingFiles.Read("figures.json");
            uint[] wanted = figures.RootElement.GetProperty("timings").EnumerateArray().Select(value => value.GetUInt32()).ToArray();
            Assert.Equal(120, wanted.Length);
            int[] terrains = { Terrain.Forest, Terrain.Berries, Terrain.Stone, Terrain.Gold, Terrain.Field };
            for (int tickRate = 1; tickRate <= 120; tickRate++)
            {
                var fold = new Fold();
                foreach (int terrain in terrains)
                {
                    fold.Add(TicksPerUnit(terrain, tickRate));
                    fold.Add(TicksPerUnit(terrain, tickRate, 35));
                }
                fold.Add(ChargeReadyTicks(tickRate));
                for (int kind = 0; kind < ENTITY_TYPES.Length; kind++)
                {
                    EntityType type = ENTITY_TYPES[kind];
                    fold.Add(TicksOf(type.windup, tickRate));
                    fold.Add(TicksOf(type.cycle, tickRate));
                    fold.Add(TrainingTicks(type, tickRate));
                    fold.Add(BuildPointsNeeded(kind, tickRate));
                    fold.Add(SiteHp(kind));
                }
                for (int id = 0; id < TECHS.Length; id++) fold.Add(ResearchTicks(id, tickRate));
                Assert.True(wanted[tickRate - 1] == fold.Value, $"at {tickRate} ticks a second, something takes a different number of ticks than in the TypeScript");
            }
        }
    }
}
