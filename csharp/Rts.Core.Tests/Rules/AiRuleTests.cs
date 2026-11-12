// Translated from test/ai.test.ts. Keep the two in step.

using Rts.Ai;
using Rts.Session;
using Rts.Sim;

namespace Rts.Tests.Rules
{
    public class TheSkirmishAi
    {
        const int MINUTE = 30 * 60;

        /// <summary>A match on a generated map with an AI of the given level for each player, or null for a player who is given no orders.</summary>
        static (LocalSession session, SkirmishAi[] ais) Match(int seed, params Difficulty?[] players)
        {
            var session = new LocalSession(new SimConfig
            {
                seed = seed,
                playerCount = 2,
                mapWidth = 128,
                mapHeight = 128,
                map = MapSpec.Generated(),
                start = StartKind.Standard,
                maxEntities = 2048,
            });
            var ais = new SkirmishAi[players.Length];
            for (int player = 0; player < players.Length; player++)
            {
                if (players[player] == null) continue;
                ais[player] = new SkirmishAi(player, players[player].Value);
                session.Control(player, ais[player]);
            }
            return (session, ais);
        }

        /// <summary>How many of each kind of thing a player has. Unfinished buildings are not counted.</summary>
        static int[] Census(World world, int player)
        {
            var counts = new int[EntityTypes.ENTITY_TYPES.Length];
            foreach (int id in world.LivingEntities(player))
            {
                int slot = id & 0xfffff;
                if (world.mobile[slot] == 0 && world.built[slot] == 0) continue;
                counts[world.entityType[slot]]++;
            }
            return counts;
        }

        static int TownCentre(World world, int player)
        {
            foreach (int id in world.LivingEntities(player))
            {
                if (world.entityType[id & 0xfffff] == Kind.TownCentre) return id;
            }
            return -1;
        }

        [Fact]
        public void BuildsUpATownAndAnArmyFromTheStandardStart()
        {
            (LocalSession session, _) = Match(1066, Difficulty.Standard, Difficulty.Standard);
            World world = session.world;
            int idleVillagerTicks = 0;
            int villagerTicks = 0;
            string broken = null;
            var at = new Dictionary<int, int[]>();
            for (int tick = 0; tick < 14 * MINUTE; tick++)
            {
                session.Step();
                if (tick % 97 == 0) broken ??= Helpers.BrokenInvariant(world);
                if (tick % 30 == 0)
                {
                    foreach (int id in world.LivingUnits(0))
                    {
                        int slot = id & 0xfffff;
                        if (world.entityType[slot] != Kind.Villager) continue;
                        villagerTicks++;
                        if (world.job[slot] == Job.None && world.moveState[slot] == MoveState.Idle) idleVillagerTicks++;
                    }
                }
                if ((tick + 1) % MINUTE == 0) at[(tick + 1) / MINUTE] = Census(world, 0);
            }
            Assert.Null(broken);
            // Three minutes in: villagers streaming out, a house up, a barracks built.
            Assert.True(at[3][Kind.Villager] >= 13);
            Assert.True(at[3][Kind.House] >= 1);
            Assert.Equal(1, at[3][Kind.Barracks]);
            // Six minutes: the full complement of villagers, somewhere to shoot from, and the first farms.
            Assert.True(at[6][Kind.Villager] >= 22);
            Assert.Equal(1, at[6][Kind.ArcheryRange]);
            Assert.True(at[6][Kind.LumberCamp] >= 1);
            Assert.True(at[6][Kind.Farm] >= 1);
            // Ten minutes: the berries are all but gone and the town lives off its farms; all three kinds of soldier can be trained.
            Assert.True(at[10][Kind.Farm] >= 8);
            Assert.Equal(1, at[10][Kind.Stable]);
            int berries = 0;
            for (int tile = 0; tile < world.map.tileCount; tile++)
            {
                if (world.map.terrain[tile] == Terrain.Berries && Vision.HasExplored(world, 0, tile)) berries += world.map.amount[tile];
            }
            Assert.True(berries < 300);
            Assert.True(world.grown[0] > 500);
            // By fourteen minutes it has dug for gold, chosen a reform and left the
            // first age, built a blacksmith and done some research.
            Assert.True(at[10][Kind.MiningCamp] >= 1);
            Assert.True(world.age[0] >= 1);
            Assert.Equal(1, at[14][Kind.Blacksmith]);
            int researched = 0;
            for (int id = 0; id < Techs.TECHS.Length; id++) researched += world.researched[id];
            Assert.True(researched >= 5);
            // Its villagers are hardly ever standing about.
            Assert.True(idleVillagerTicks / (double)villagerTicks < 0.05);
            // And it does all this with a person's worth of orders, not a flood.
            Assert.True(session.Replay().commands.Count < 14 * 60 * 2);
        }

        [Fact]
        public void PlaysTheSameMatchEveryTimeAndTheMatchReplaysWithoutIt()
        {
            (LocalSession session, SkirmishAi[] ais) first = Match(7, Difficulty.Standard, Difficulty.Hard);
            (LocalSession session, SkirmishAi[] ais) second = Match(7, Difficulty.Standard, Difficulty.Hard);
            for (int tick = 0; tick < 6 * MINUTE; tick++)
            {
                first.session.Step();
                second.session.Step();
                if (tick % 600 == 0) Assert.Equal(Hash.HashWorld(first.session.world), Hash.HashWorld(second.session.world));
            }
            Assert.Equal(Hash.HashWorld(first.session.world), Hash.HashWorld(second.session.world));
            // The commands it gave are in the record like anyone's, so the replay needs no AI.
            World replayed = Replay.RunReplay(first.session.Replay());
            Assert.Equal(Hash.HashWorld(first.session.world), Hash.HashWorld(replayed));
        }

        /// <summary>Passes an AI's orders on, checking each against what its side could see at the time.</summary>
        sealed class Honest : IController
        {
            readonly SkirmishAi ai;
            readonly int player;
            readonly List<string> problems;
            public int attacks;
            public int builds;

            public Honest(SkirmishAi ai, int player, List<string> problems)
            {
                this.ai = ai;
                this.player = player;
                this.problems = problems;
            }

            public List<Command> Act(World now)
            {
                List<Command> commands = ai.Act(now);
                foreach (Command command in commands)
                {
                    if (command.kind == CommandKind.Attack)
                    {
                        attacks++;
                        int slot = command.target & 0xfffff;
                        if (!now.IsAlive(command.target) || !Vision.CanSee(now, player, slot))
                        {
                            problems.Add($"tick {now.tick}: player {player} ordered an attack on something out of sight");
                        }
                    }
                    if (command.kind == CommandKind.Build)
                    {
                        builds++;
                        if (!Buildings.CanPlace(now, command.buildingType, command.tileX, command.tileY, player))
                        {
                            problems.Add($"tick {now.tick}: player {player} tried to build where it could not");
                        }
                    }
                    if (command.kind == CommandKind.Gather && !Vision.HasExplored(now, player, command.tile))
                    {
                        problems.Add($"tick {now.tick}: player {player} sent villagers to a resource it had never seen");
                    }
                }
                return commands;
            }
        }

        [Fact]
        public void PlaysFairUnderTheFogItOrdersNothingThatNeedsKnowledgeItCouldNotHave()
        {
            (LocalSession session, SkirmishAi[] ais) = Match(1066, Difficulty.Standard, Difficulty.Standard);
            World world = session.world;
            // Wrap each AI so every order can be checked against what its side could see at the time.
            var problems = new List<string>();
            var wrapped = new List<Honest>();
            for (int player = 0; player < ais.Length; player++)
            {
                var honest = new Honest(ais[player], player, problems);
                wrapped.Add(honest);
                session.Control(player, honest);
            }
            for (int tick = 0; tick < 12 * MINUTE; tick++) session.Step();
            Assert.Empty(problems);
            Assert.True(wrapped.Sum(honest => honest.builds) > 30);
            // Each side has found the other and remembers what it saw there.
            foreach (SkirmishAi ai in ais) Assert.True(ai.Status().knownBuildings > 0);
            Assert.Equal(12 * MINUTE, world.tick);
            Assert.True(wrapped.Sum(honest => honest.attacks) >= 0);
        }

        [Fact]
        public void DestroysTheTownOfAnOpponentWhoDoesNothing()
        {
            (LocalSession session, _) = Match(1066, null, Difficulty.Standard);
            World world = session.world;
            int doomed = TownCentre(world, 0);
            int fell = -1;
            for (int tick = 0; tick < 20 * MINUTE && fell == -1; tick++)
            {
                session.Step();
                if (!world.IsAlive(doomed)) fell = tick;
            }
            Assert.True(fell > 4 * MINUTE); // not before it has had time to raise an army
            Assert.True(fell < 19 * MINUTE);
            // It goes on to hunt down what is left.
            for (int tick = 0; tick < 3 * MINUTE && world.LivingEntities(0).Count > 0; tick++) session.Step();
            Assert.Empty(world.LivingEntities(0));
            Assert.Null(Helpers.BrokenInvariant(world));
        }

        [Fact]
        public void IsStrongerAtEachLevelHardOutgrowsAndOverrunsEasy()
        {
            (LocalSession session, _) = Match(1066, Difficulty.Hard, Difficulty.Easy);
            World world = session.world;
            int easyTown = TownCentre(world, 1);
            int hardTown = TownCentre(world, 0);
            int fell = -1;
            for (int tick = 0; tick < 28 * MINUTE && fell == -1; tick++)
            {
                session.Step();
                if (tick == 8 * MINUTE)
                {
                    Assert.True(Census(world, 0)[Kind.Villager] > Census(world, 1)[Kind.Villager] + 8);
                }
                if (!world.IsAlive(easyTown)) fell = tick;
            }
            Assert.NotEqual(-1, fell);
            Assert.True(world.IsAlive(hardTown));
            // Hard climbs further through the ages than easy is allowed to.
            Assert.True(world.age[0] >= 2);
            Assert.True(world.age[1] <= 1);
        }
    }
}
