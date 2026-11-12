// Translated from test/tech.test.ts. Keep the two in step.
//
// Where the TypeScript compares two tables of units and buildings by writing
// them out as JSON, the same is done here by writing out every field of
// every entry (Describe, below). Where it passes a saved game through JSON
// before loading it, the save is loaded as it is.

using System.Globalization;
using System.Reflection;
using Rts.Sim;
using static Rts.Sim.Techs;

namespace Rts.Tests.Rules
{
    public abstract class TechScenario : Scenario
    {
        protected static (World world, int hall) Town(Action<SimConfig> overrides = null)
        {
            var config = new SimConfig { mapWidth = 60, mapHeight = 60, mapState = MapState.Revealed };
            overrides?.Invoke(config);
            var world = new World(config);
            int hall = world.SpawnBuilding(0, Kind.TownCentre, 12, 12);
            world.SpawnBuilding(1, Kind.TownCentre, 48, 48);
            new[] { 5000, 5000, 5000, 5000 }.CopyTo(world.stock, 0);
            new[] { 5000, 5000, 5000, 5000 }.CopyTo(world.stock, 4);
            return (world, hall);
        }

        protected static bool Has(World world, int player, int tech) => world.researched[player * TECHS.Length + tech] == 1;

        protected static int[] Stock(World world, int player) => world.stock.Skip(player * 4).Take(4).ToArray();

        /// <summary>Gives a player a technology on the spot, as if one of their buildings had just finished researching it.</summary>
        protected static void Grant(World world, int building, int tech) => FinishResearch(world, SlotOf(building), tech);

        /// <summary>Every figure of a unit or building, written out, so that two can be compared whole.</summary>
        protected static string Describe(EntityType type)
        {
            var parts = new List<string>();
            foreach (FieldInfo field in typeof(EntityType).GetFields(BindingFlags.Public | BindingFlags.Instance).OrderBy(f => f.Name, StringComparer.Ordinal))
            {
                object value = field.GetValue(type);
                string text = value switch
                {
                    int[] list => "[" + string.Join(",", list) + "]",
                    int[][] lists => "[" + string.Join(",", lists.Select(list => "[" + string.Join(",", list) + "]")) + "]",
                    _ => Convert.ToString(value, CultureInfo.InvariantCulture),
                };
                parts.Add(field.Name + ":" + text);
            }
            return "{" + string.Join(",", parts) + "}";
        }

        protected static string Describe(EntityType[] types) => string.Join("\n", types.Select(Describe));

        protected static string Describe(EntityType[][] types) => string.Join("\n\n", types.Select(Describe));
    }

    public class TheTechnologiesThemselves : TechScenario
    {
        [Fact]
        public void AreEachResearchedSomewhereAPlayerCanHaveAfterThingsThatComeBeforeThem()
        {
            for (int id = 0; id < TECHS.Length; id++)
            {
                Tech tech = TECHS[id];
                EntityType where = EntityTypes.ENTITY_TYPES[tech.at];
                Assert.True(where.building, tech.name);
                Assert.True(where.age <= tech.age, $"{tech.name} is researched at a building of a later age");
                foreach (int first in tech.requires)
                {
                    Assert.True(first < id, tech.name);
                    Assert.True(TECHS[first].age <= tech.age, tech.name);
                }
                Assert.True(tech.cost.All(amount => amount >= 0), tech.name);
                Assert.True(tech.cost.Any(amount => amount > 0), tech.name);
                Assert.True(tech.seconds > 0, tech.name);
                Assert.True(tech.about.Length > 40, tech.name);
                Assert.True(tech.effects.Length > 0, tech.name);
            }
            Assert.Equal(TECHS.Length, typeof(TechId).GetFields(BindingFlags.Public | BindingFlags.Static).Length);
            Assert.True(TECHS.Length < 256 - QUEUED_TECH);
        }

        [Fact]
        public void OfferExactlyTwoReformsInEachAgeButTheLast()
        {
            foreach (int age in new[] { Age.EarlyMedieval, Age.HighMedieval, Age.LateMedieval })
            {
                Tech[] offered = TECHS.Where(tech => tech.reform && tech.age == age).ToArray();
                Assert.True(offered.Length == 2, $"age {age}");
                foreach (Tech tech in offered) Assert.Equal(Kind.TownCentre, tech.at);
            }
            Assert.DoesNotContain(TECHS, tech => tech.reform && tech.age == Age.EarlyModern);
        }

        [Fact]
        public void EachChangeSomethingNoEffectFallsOnNothing()
        {
            (World world, int hall) = Town();
            string Mine() => Describe(world.types[0]) + "\n" + string.Join(",", world.gatherBonus.Take(TERRAINS));
            for (int id = 0; id < TECHS.Length; id++)
            {
                string before = Mine();
                Grant(world, hall, id);
                string after = Mine();
                Assert.True(after != before, TECHS[id].name);
            }
            // And none of it touched the other player.
            Assert.Equal(Describe(EntityTypes.ENTITY_TYPES), Describe(world.types[1]));
            Assert.Null(Helpers.BrokenInvariant(world));
        }

        [Fact]
        public void ComeOutTheSameWhateverOrderTheyAreResearchedIn()
        {
            (World world, int hall) forward = Town();
            (World world, int hall) backward = Town();
            for (int id = 0; id < TECHS.Length; id++) Grant(forward.world, forward.hall, id);
            for (int id = TECHS.Length - 1; id >= 0; id--) Grant(backward.world, backward.hall, id);
            Assert.Equal(Describe(forward.world.types[0]), Describe(backward.world.types[0]));
            Assert.Equal(forward.world.gatherBonus, backward.world.gatherBonus);
        }
    }

    public class Ages : TechScenario
    {
        [Fact]
        public void BeginWithTheEarlyMedievalWhereOnlyItsOwnSoldiersAndBuildingsCanBeHad()
        {
            (World world, _) = Town();
            Assert.Equal(new byte[] { 0, 0 }, world.age);
            int barracks = world.SpawnBuilding(0, Kind.Barracks, 20, 12);
            int builder = world.SpawnUnit(0, Kind.Villager, F(16.5), F(16.5));
            Send(world, 0, Command.Train(barracks, Kind.ManAtArms));
            Send(world, 0, Command.Build(Ids(builder), Kind.Blacksmith, 20, 20));
            Run(world, 5);
            Assert.Equal(0, world.trainLength[SlotOf(barracks)]);
            Assert.Equal(3, world.LivingEntities(0).Count);
            Assert.Equal(new[] { 5000, 5000, 5000, 5000 }, Stock(world, 0));
            // The spearman, the archer and the horseman are there from the start.
            Send(world, 0, Command.Train(barracks, Kind.Spearman));
            Run(world, 5);
            Assert.Equal(1, world.trainLength[SlotOf(barracks)]);
        }

        [Fact]
        public void AreLeftByChoosingOneOfTwoReformsWhichNeedsTwoKindsOfBuildingStanding()
        {
            (World world, int hall) = Town();
            Assert.Contains("needs 2 of", WhyNot(world, 0, TechId.OpenFields));
            Send(world, 0, Command.Research(hall, TechId.OpenFields));
            Run(world, 5);
            Assert.Equal(0, world.trainLength[SlotOf(hall)]);
            world.SpawnBuilding(0, Kind.Mill, 20, 12);
            world.SpawnBuilding(0, Kind.Mill, 24, 12); // two of one kind is still one kind
            Assert.Contains("needs 2 of", WhyNot(world, 0, TechId.OpenFields));
            world.SpawnBuilding(0, Kind.LumberCamp, 20, 16);
            Assert.Null(WhyNot(world, 0, TechId.OpenFields));
            Assert.Equal("not yet", WhyNot(world, 0, TechId.TownCharters));

            Send(world, 0, Command.Research(hall, TechId.OpenFields));
            Run(world, 2);
            Assert.Equal(new[] { 4600, 5000, 5000, 4850 }, Stock(world, 0));
            Assert.True(IsQueued(world, 0, TechId.OpenFields));
            // Having started down one road, the other cannot be started too.
            Send(world, 0, Command.Research(hall, TechId.KnightService));
            Run(world, 2);
            Assert.Equal(1, world.trainLength[SlotOf(hall)]);
            Assert.Equal("another reform is under way", WhyNot(world, 0, TechId.KnightService));

            int ticks = Run(world, 3000, () => world.age[0] == Age.HighMedieval);
            // Sixty seconds of work, four ticks of which were done above.
            Assert.Equal(60 * 30 - 4, ticks);
            Assert.True(Has(world, 0, TechId.OpenFields));
            Assert.Equal(0, world.trainLength[SlotOf(hall)]);
            Assert.Equal(Age.EarlyMedieval, world.age[1]);
            // The road not taken is closed.
            Assert.Equal("that age is past", WhyNot(world, 0, TechId.KnightService));
            Send(world, 0, Command.Research(hall, TechId.KnightService));
            Run(world, 5);
            Assert.Equal(0, world.trainLength[SlotOf(hall)]);
            Assert.False(Has(world, 0, TechId.KnightService));
            // Its mark is on the player: farms a fifth faster.
            Assert.Equal(20, world.gatherBonus[Terrain.Field]);
            Assert.Equal(0, world.gatherBonus[TERRAINS + Terrain.Field]);
        }

        [Fact]
        public void OpenUpNewSoldiersAndBuildingsAsTheyAreReached()
        {
            (World world, _) = Town(config => config.startAge = Age.HighMedieval);
            int barracks = world.SpawnBuilding(0, Kind.Barracks, 20, 12);
            int range = world.SpawnBuilding(0, Kind.ArcheryRange, 28, 12);
            world.SpawnBuilding(0, Kind.House, 20, 20);
            int builder = world.SpawnUnit(0, Kind.Villager, F(16.5), F(16.5));
            Send(world, 0, Command.Train(barracks, Kind.ManAtArms));
            Send(world, 0, Command.Train(range, Kind.Crossbowman)); // an age too soon
            Send(world, 0, Command.Build(Ids(builder), Kind.Blacksmith, 30, 22));
            Run(world, 5);
            Assert.Equal(1, world.trainLength[SlotOf(barracks)]);
            Assert.Equal(0, world.trainLength[SlotOf(range)]);
            Assert.Contains(world.LivingEntities(0), id => world.entityType[SlotOf(id)] == Kind.Blacksmith);
            Run(world, 30 * 30, () => world.LivingUnits(0).Count == 2);
            Assert.Equal(
                new[] { Kind.Villager, Kind.ManAtArms },
                world.LivingUnits(0).Select(id => (int)world.entityType[SlotOf(id)]).OrderBy(kind => kind).ToArray());
        }

        [Fact]
        public void CanBeSetForTheWholeMatchForGamesThatStartLater()
        {
            (World world, _) = Town(config => config.startAge = Age.LateMedieval);
            Assert.Equal(new byte[] { 2, 2 }, world.age);
            Assert.Equal("that age is past", WhyNot(world, 0, TechId.OpenFields));
            Assert.ThrowsAny<Exception>(() => new World(new SimConfig { startAge = 4 }));
        }
    }

    public class Research : TechScenario
    {
        [Fact]
        public void WaitsItsTurnInTheBuildingsQueueIsPaidForWhenQueuedAndRefundedWhenCancelled()
        {
            (World world, int hall) = Town(config => config.startAge = Age.HighMedieval);
            world.SpawnBuilding(0, Kind.House, 20, 12);
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Send(world, 0, Command.Research(hall, TechId.Wheelbarrow));
            Send(world, 0, Command.Train(hall, Kind.Villager));
            Run(world, 2);
            int[] queue = world.trainQueue.Skip(SlotOf(hall) * 8).Take(3).Select(queued => (int)queued).ToArray();
            Assert.Equal(new[] { Kind.Villager + 1, QUEUED_TECH + TechId.Wheelbarrow, Kind.Villager + 1 }, queue);
            Assert.Equal(new[] { 5000 - 50 - 150 - 50, 5000 - 100, 5000, 5000 }, Stock(world, 0));
            // It cannot be queued twice, here or anywhere.
            Send(world, 0, Command.Research(hall, TechId.Wheelbarrow));
            Run(world, 2);
            Assert.Equal(3, world.trainLength[SlotOf(hall)]);
            Send(world, 0, Command.CancelTrain(hall, 1));
            Run(world, 2);
            Assert.Equal(2, world.trainLength[SlotOf(hall)]);
            Assert.Equal(new[] { 4900, 5000, 5000, 5000 }, Stock(world, 0));
            Assert.False(IsQueued(world, 0, TechId.Wheelbarrow));
        }

        [Fact]
        public void NeedsTheRightBuildingFinishedAndThePlayersOwnTheRightAgeAndWhatComesBefore()
        {
            (World world, int hall) = Town();
            int mill = world.SpawnBuilding(0, Kind.Mill, 20, 12);
            int site = world.SpawnBuilding(0, Kind.LumberCamp, 20, 16, false);
            int theirs = world.SpawnBuilding(1, Kind.Mill, 40, 48);
            Command[] refused =
            {
                Command.Research(hall, TechId.HeavyPlough), // wrong building
                Command.Research(site, TechId.FellingAxes), // not finished
                Command.Research(theirs, TechId.HeavyPlough), // not the player's
                Command.Research(mill, TechId.HorseCollar), // an age too soon, and nothing before it
                Command.Research(mill, 999),
                Command.Research(mill, -1),
                Command.Research(123456, TechId.HeavyPlough),
            };
            foreach (Command command in refused) Send(world, 0, command);
            Run(world, 3);
            Assert.Equal(new[] { 5000, 5000, 5000, 5000 }, Stock(world, 0));
            Assert.Equal("needs the High Medieval age", WhyNot(world, 0, TechId.HorseCollar));
            world.age[0] = Age.HighMedieval;
            Assert.Equal("needs Heavy plough", WhyNot(world, 0, TechId.HorseCollar));
        }

        [Fact]
        public void CannotBeHadWithoutTheMeansToPayForIt()
        {
            foreach ((int wood, int queued) in new[] { (124, 0), (125, 1) })
            {
                (World world, _) = Town();
                int mill = world.SpawnBuilding(0, Kind.Mill, 20, 12);
                new[] { 0, wood, 0, 0 }.CopyTo(world.stock, 0);
                Send(world, 0, Command.Research(mill, TechId.HeavyPlough));
                Run(world, 3);
                Assert.Equal(queued, world.trainLength[SlotOf(mill)]);
            }
        }

        [Fact]
        public void TakesItsStatedTimeAndNeedsNoRoomInThePopulation()
        {
            (World world, _) = Town();
            int mill = world.SpawnBuilding(0, Kind.Mill, 20, 12);
            // A full town: nothing can be trained, but research goes ahead.
            for (int i = 0; i < 10; i++) world.SpawnUnit(0, Kind.Villager, F(14.5 + i), F(18.5));
            Assert.Equal(Production.CountPopulation(world).room[0], Production.CountPopulation(world).used[0]);
            Send(world, 0, Command.Research(mill, TechId.HeavyPlough));
            int ticks = Run(world, 2000, () => Has(world, 0, TechId.HeavyPlough));
            Assert.Equal(30 * 30, ticks);
            Assert.Equal(10, Production.CountPopulation(world).used[0]);
        }

        [Fact]
        public void IsLostWithTheBuildingAndCanThenBeBegunAgainElsewhere()
        {
            (World world, _) = Town();
            int mill = world.SpawnBuilding(0, Kind.Mill, 20, 12);
            int second = world.SpawnBuilding(0, Kind.Mill, 26, 12);
            Send(world, 0, Command.Research(mill, TechId.HeavyPlough));
            Run(world, 100);
            world.Destroy(mill);
            Assert.False(IsQueued(world, 0, TechId.HeavyPlough));
            Assert.Equal(5000 - 125, Stock(world, 0)[Resource.Wood]); // destroyed, not cancelled: no refund
            Send(world, 0, Command.Research(second, TechId.HeavyPlough));
            Run(world, 2000, () => Has(world, 0, TechId.HeavyPlough));
            Assert.True(Has(world, 0, TechId.HeavyPlough));
            // Pulling a building down oneself does give research back.
            Send(world, 0, Command.Research(second, TechId.FellingAxes)); // wrong building: ignored
            world.age[0] = Age.HighMedieval;
            Send(world, 0, Command.Research(second, TechId.HorseCollar));
            Run(world, 3);
            int[] before = Stock(world, 0);
            Send(world, 0, Command.Demolish(Ids(second)));
            Run(world, 3);
            Assert.Equal(before[Resource.Wood] + 200, Stock(world, 0)[Resource.Wood]);
            Assert.Equal(before[Resource.Gold] + 50, Stock(world, 0)[Resource.Gold]);
        }

        [Fact]
        public void ComesBackFromASavedGameHalfDoneAndFinishesOnTheSameTick()
        {
            (World world, int hall) = Town(config => config.startAge = Age.HighMedieval);
            int smith = world.SpawnBuilding(0, Kind.Blacksmith, 20, 12);
            Grant(world, hall, TechId.HeavyPlough);
            Send(world, 0, Command.Research(smith, TechId.SteeledEdges));
            Send(world, 0, Command.Research(smith, TechId.MailHauberks));
            Run(world, 500);
            World restored = Snapshot.RestoreSnapshot(Snapshot.TakeSnapshot(world));
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
            Assert.Equal(Describe(world.types), Describe(restored.types));
            Assert.Equal(world.gatherBonus, restored.gatherBonus);
            int finishedAt = -1;
            int restoredAt = -1;
            for (int i = 0; i < 2500; i++)
            {
                Simulation.Step(world);
                Simulation.Step(restored);
                if (finishedAt == -1 && Has(world, 0, TechId.MailHauberks)) finishedAt = world.tick;
                if (restoredAt == -1 && Has(restored, 0, TechId.MailHauberks)) restoredAt = restored.tick;
            }
            Assert.True(finishedAt > 0);
            Assert.Equal(finishedAt, restoredAt);
            Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(restored));
        }
    }

    public class WhatResearchDoes : TechScenario
    {
        [Fact]
        public void SpeedsTheWorkItIsAboutFellingAxesMakeWoodcutters15PerCentFaster()
        {
            (World world, int hall) = Town();
            Assert.Equal(45, EntityTypes.TicksPerUnit(Terrain.Forest, 30));
            Assert.Equal(39, EntityTypes.TicksPerUnit(Terrain.Forest, 30, 15));
            Assert.Equal(33, EntityTypes.TicksPerUnit(Terrain.Forest, 30, 35));
            Grant(world, hall, TechId.FellingAxes);
            Assert.Equal(15, world.gatherBonus[Terrain.Forest]);
            Assert.Equal(0, world.gatherBonus[Terrain.Field]);
            // Bonuses on the same work add up.
            Grant(world, hall, TechId.Sawmills);
            Assert.Equal(35, world.gatherBonus[Terrain.Forest]);
        }

        [Fact]
        public void ChangesTheSoldiersAPlayerAlreadyHasAsWellAsThoseToComeAndNobodyElses()
        {
            (World world, int hall) = Town();
            int sound = world.SpawnUnit(0, Kind.Spearman, F(20.5), F(20.5));
            int hurt = world.SpawnUnit(0, Kind.Spearman, F(22.5), F(20.5));
            int enemy = world.SpawnUnit(1, Kind.Spearman, F(40.5), F(40.5));
            world.hp[SlotOf(hurt)] = 50;
            Grant(world, hall, TechId.PaidRetinues);
            Assert.Equal(88, world.types[0][Kind.Spearman].hp);
            Assert.Equal(88, world.hp[SlotOf(sound)]);
            Assert.Equal(58, world.hp[SlotOf(hurt)]); // the wound stays; only the extra is added
            Assert.Equal(80, world.hp[SlotOf(enemy)]);
            int fresh = world.SpawnUnit(0, Kind.Spearman, F(24.5), F(20.5));
            Assert.Equal(88, world.hp[SlotOf(fresh)]);
            Assert.Equal(80, world.types[1][Kind.Spearman].hp);
            Assert.Equal(80, EntityTypes.ENTITY_TYPES[Kind.Spearman].hp);
        }

        [Fact]
        public void SharpensBladesAndThickensArmourAtTheBlacksmith()
        {
            (World world, int hall) = Town();
            int mine = SlotOf(world.SpawnUnit(0, Kind.Spearman, F(20.5), F(20.5)));
            int theirs = SlotOf(world.SpawnUnit(1, Kind.Spearman, F(21.5), F(20.5)));
            int theirArcher = SlotOf(world.SpawnUnit(1, Kind.Archer, F(25.5), F(20.5)));
            int theirRider = SlotOf(world.SpawnUnit(1, Kind.Horseman, F(23.5), F(20.5)));
            Assert.Equal(8, Combat.DamageOf(world, mine, theirs, 0));
            Grant(world, hall, TechId.SteeledEdges);
            Assert.Equal(9, Combat.DamageOf(world, mine, theirs, 0));
            Assert.Equal(8, Combat.DamageOf(world, theirs, mine, 0));
            Grant(world, hall, TechId.BlastFurnace);
            Assert.Equal(11, Combat.DamageOf(world, mine, theirs, 0));
            Grant(world, hall, TechId.MailHauberks);
            Assert.Equal(7, Combat.DamageOf(world, theirs, mine, 0));
            Assert.Equal(10, Combat.DamageOf(world, theirArcher, mine, 0)); // mail does nothing against arrows
            Grant(world, hall, TechId.CoatOfPlates);
            Assert.Equal(6, Combat.DamageOf(world, theirs, mine, 0));
            Assert.Equal(9, Combat.DamageOf(world, theirArcher, mine, 0));
            // Longer spears do more to horses and nothing more to anyone else.
            Grant(world, hall, TechId.LongSpears);
            Assert.Equal(11 + 16 + 4, Combat.DamageOf(world, mine, theirRider, 0));
            Assert.Equal(11, Combat.DamageOf(world, mine, theirs, 0));
        }

        [Fact]
        public void GivesAUnitItsLaterNameAndReachArchersBecomeLongbowmen()
        {
            (World world, int hall) = Town();
            Assert.Equal("archer", world.types[0][Kind.Archer].name);
            Grant(world, hall, TechId.Longbows);
            EntityType longbow = world.types[0][Kind.Archer];
            Assert.Equal("longbowman", longbow.name);
            Assert.Equal(6 * Fixed.ONE, longbow.range);
            Assert.Equal(6, longbow.damage);
            Assert.Equal("archer", world.types[1][Kind.Archer].name);
            // In the field: a longbowman outranges an archer by a tile.
            int bow = world.SpawnUnit(0, Kind.Archer, F(20.5), F(30.5));
            int foe = world.SpawnUnit(1, Kind.Archer, F(26.9), F(30.5));
            Send(world, 0, Command.Hold(Ids(bow)));
            Send(world, 1, Command.Hold(Ids(foe)));
            Run(world, 200);
            Assert.True(world.hp[SlotOf(foe)] < 60);
            Assert.Equal(60, world.hp[SlotOf(bow)]);
        }

        [Fact]
        public void MakesVillagersCarryMoreAndWalkFasterWithTheWheelbarrow()
        {
            (World world, int hall) = Town();
            int villager = SlotOf(world.SpawnUnit(0, Kind.Villager, F(20.5), F(20.5)));
            int before = world.speed[villager];
            Grant(world, hall, TechId.Wheelbarrow);
            Assert.Equal(15, world.types[0][Kind.Villager].carries);
            Assert.True(world.speed[villager] > before);
            AssertCloseTo(1.1, world.speed[villager] / (double)before, 2);
        }

        [Fact]
        public void ChangesWhatSoldiersCostAndHowLongTheyTake()
        {
            (World world, int hall) = Town(config => config.startAge = Age.HighMedieval);
            world.SpawnBuilding(0, Kind.House, 20, 20);
            Grant(world, hall, TechId.StandingCompanies);
            Assert.Equal(new[] { 51, 17, 0, 0 }, world.types[0][Kind.Spearman].cost);
            Assert.Equal(new[] { 119, 0, 0, 85 }, world.types[0][Kind.Knight].cost);
            Assert.Equal(new[] { 50, 0, 0, 0 }, world.types[0][Kind.Villager].cost);
            Grant(world, hall, TechId.KnightService);
            Assert.Equal(12, world.types[0][Kind.Spearman].seconds);
            Assert.Equal(20, world.types[0][Kind.Villager].seconds);
            int barracks = world.SpawnBuilding(0, Kind.Barracks, 20, 12);
            Send(world, 0, Command.Train(barracks, Kind.Spearman));
            Run(world, 2);
            Assert.Equal(new[] { 5000 - 51, 5000 - 17, 5000, 5000 }, Stock(world, 0));
            int ticks = Run(world, 1000, () => world.LivingUnits(0).Count == 1);
            // Twelve seconds, not fifteen; two ticks were done above.
            Assert.Equal(12 * 30 - 2, ticks);
        }

        [Fact]
        public void LetsTowersAndTownCentresSeeAndShootFurtherThroughArrowLoops()
        {
            (World world, int hall) = Town();
            int tower = world.SpawnBuilding(0, Kind.Watchtower, 20, 20);
            Run(world, 2);
            Assert.Equal(13, world.sightRadius[SlotOf(tower)]);
            Grant(world, hall, TechId.ArrowLoops);
            Run(world, 2);
            Assert.Equal(15, world.sightRadius[SlotOf(tower)]);
            Assert.Equal(13, world.sightRadius[SlotOf(hall)]);
            Assert.Equal(8 * Fixed.ONE, world.types[0][Kind.Watchtower].range);
        }
    }

    public class TheSoldiersOfLaterAges : TechScenario
    {
        /// <summary>What one blow from a soldier of kind a does to one of kind b.</summary>
        static int Blow(int a, int b)
        {
            var world = new World(new SimConfig { mapWidth = 40, mapHeight = 40, mapState = MapState.Revealed });
            int attacker = SlotOf(world.SpawnUnit(0, a, F(10.5), F(10.5)));
            int victim = SlotOf(world.SpawnUnit(1, b, F(12.5), F(10.5)));
            return Combat.DamageOf(world, attacker, victim, 0);
        }

        [Fact]
        public void WearArmourThatTheCheapTroopsStruggleAgainst()
        {
            Assert.Equal(5, Blow(Kind.Spearman, Kind.ManAtArms));
            Assert.Equal(2, Blow(Kind.Archer, Kind.ManAtArms));
            Assert.Equal(11, Blow(Kind.ManAtArms, Kind.Spearman));
            Assert.Equal(2, Blow(Kind.Archer, Kind.Knight));
            Assert.Equal(6, Blow(Kind.Horseman, Kind.Knight));
        }

        [Fact]
        public void MeetTheirMatchInTheCrossbowThePikeAndTheGun()
        {
            Assert.Equal(10 + 10 - 3, Blow(Kind.Crossbowman, Kind.ManAtArms));
            Assert.Equal(17, Blow(Kind.Crossbowman, Kind.Knight));
            Assert.Equal(10, Blow(Kind.Crossbowman, Kind.Spearman));
            Assert.Equal(8 + 16 - 3, Blow(Kind.Spearman, Kind.Knight));
            Assert.Equal(32 + 6 - 3, Blow(Kind.Handgunner, Kind.Knight));
            Assert.Equal(32, Blow(Kind.Handgunner, Kind.Spearman));
            Assert.Equal(14 + 6, Blow(Kind.Knight, Kind.Crossbowman));
        }

        /// <summary>Two sides march at each other. Returns how many of each are left when one side is gone.</summary>
        (int a, int b) Battle(int kindA, int countA, int kindB, int countB)
        {
            var world = new World(new SimConfig { mapWidth = 48, mapHeight = 48, mapState = MapState.Revealed });
            int[] Line(int player, int kind, int count, double x)
            {
                var ids = new int[count];
                for (int i = 0; i < count; i++) ids[i] = world.SpawnUnit(player, kind, F(x), F(24 + (i - (count - 1) / 2.0) * 0.7));
                return ids;
            }
            int[] a = Line(0, kindA, countA, 18);
            int[] b = Line(1, kindB, countB, 30);
            Send(world, 0, Command.AttackMove(a, F(30), F(24)));
            Send(world, 1, Command.AttackMove(b, F(18), F(24)));
            Run(world, 5400, () => world.LivingUnits(0).Count == 0 || world.LivingUnits(1).Count == 0);
            return (world.LivingUnits(0).Count, world.LivingUnits(1).Count);
        }

        [Fact]
        public void WinTheirFightsAsTheFiguresSayArmourBeatsTheLevyAndItsCountersBeatArmour()
        {
            // 560 resources of men-at-arms against 560 of spearmen.
            Assert.Equal(0, Battle(Kind.ManAtArms, 4, Kind.Spearman, 7).b);
            // 720 of knights against 720 of archers.
            Assert.Equal(0, Battle(Kind.Knight, 3, Kind.Archer, 9).b);
            // 720 of knights against 720 of spearmen: the spear still stops the horse.
            Assert.Equal(0, Battle(Kind.Knight, 3, Kind.Spearman, 9).a);
            // 840 of men-at-arms against 840 of crossbowmen.
            Assert.Equal(0, Battle(Kind.ManAtArms, 6, Kind.Crossbowman, 8).a);
            // 780 of handgunners against 840 of men-at-arms: armour is no answer to the gun.
            Assert.Equal(0, Battle(Kind.Handgunner, 6, Kind.ManAtArms, 6).b);
            // But 910 of handgunners are ridden down by 960 of knights before they can reload.
            Assert.Equal(0, Battle(Kind.Handgunner, 7, Kind.Knight, 4).a);
        }
    }
}
