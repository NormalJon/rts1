// Ported from src/sim/tech.ts. Keep the two in step.

using System;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    /// <summary>Which units and buildings an effect falls on: those named, and those carrying any of the tags.</summary>
    public sealed class Who
    {
        public int[] kinds;
        public int tags;

        public static Who Kinds(params int[] kinds)
        {
            return new Who { kinds = kinds };
        }

        public static Who Tags(int tags)
        {
            return new Who { tags = tags };
        }
    }

    public enum EffectKind
    {
        /// <summary>Adds to a figure, or raises it by a percentage of what it started as.</summary>
        Change,
        /// <summary>Adds to the bonus damage against targets carrying a tag.</summary>
        Bonus,
        /// <summary>Changes what a unit costs, by a percentage of each resource.</summary>
        Cost,
        /// <summary>Speeds up gathering from these terrains, in percent.</summary>
        Gather,
        /// <summary>What a unit is called from now on.</summary>
        Rename,
    }

    public sealed class Effect
    {
        public EffectKind kind;
        /// <summary>Change, Bonus and Cost: whom it falls on.</summary>
        public Who of;
        /// <summary>Change: the figure, what is added to it, and the percentage of its starting value added to it.</summary>
        public Stat change;
        public int add;
        /// <summary>Change and Gather: the percentage.</summary>
        public int percent;
        /// <summary>Bonus: how much more, and against what tags.</summary>
        public int bonus;
        public int against;
        /// <summary>Cost: the percentage.</summary>
        public int cost;
        /// <summary>Gather: the terrains.</summary>
        public int[] gather;
        /// <summary>Rename: which kind, and to what.</summary>
        public int rename;
        public string to;

        public static Effect Change(Stat change, Who of, int add = 0, int percent = 0)
        {
            return new Effect { kind = EffectKind.Change, change = change, of = of, add = add, percent = percent };
        }

        public static Effect Bonus(int bonus, Who of, int against)
        {
            return new Effect { kind = EffectKind.Bonus, bonus = bonus, of = of, against = against };
        }

        public static Effect Cost(int cost, Who of)
        {
            return new Effect { kind = EffectKind.Cost, cost = cost, of = of };
        }

        public static Effect Gather(int percent, params int[] gather)
        {
            return new Effect { kind = EffectKind.Gather, gather = gather, percent = percent };
        }

        public static Effect Rename(int rename, string to)
        {
            return new Effect { kind = EffectKind.Rename, rename = rename, to = to };
        }
    }

    public sealed class Tech
    {
        public string name;
        /// <summary>What it was and what it does, for the player.</summary>
        public string about;
        public int[] cost;
        public int seconds;
        /// <summary>The building it is researched at.</summary>
        public int at;
        /// <summary>The age the player must have reached. For a reform, the age it is chosen in.</summary>
        public int age;
        /// <summary>Technologies that must be researched first.</summary>
        public int[] requires;
        /// <summary>A reform takes the player into the next age and shuts out the other reform offered with it.</summary>
        public bool reform;
        /// <summary>Reforms: how many different kinds of these buildings the player must have standing.</summary>
        public int needs;
        public int[] among;
        public Effect[] effects;
    }

    public static class TechId
    {
        public const int OpenFields = 0;
        public const int KnightService = 1;
        public const int TownCharters = 2;
        public const int PaidRetinues = 3;
        public const int StandingCompanies = 4;
        public const int Gunfounding = 5;
        public const int Wheelbarrow = 6;
        public const int HeavyPlough = 7;
        public const int HorseCollar = 8;
        public const int FellingAxes = 9;
        public const int Sawmills = 10;
        public const int FireSetting = 11;
        public const int DrainageAdits = 12;
        public const int SteeledEdges = 13;
        public const int BlastFurnace = 14;
        public const int MailHauberks = 15;
        public const int CoatOfPlates = 16;
        public const int BodkinPoints = 17;
        public const int Longbows = 18;
        public const int LongSpears = 19;
        public const int Pikes = 20;
        public const int CouchedLance = 21;
        public const int ArrowLoops = 22;
    }

    /// <summary>
    /// Ages and technology.
    ///
    /// A match passes through four ages. A player leaves one for the next by
    /// choosing between two reforms at the town centre, each a real change in
    /// how medieval societies raised food, money or soldiers. Whichever is
    /// chosen takes the player into the next age and leaves its mark for the
    /// rest of the match; the other is closed for good.
    ///
    /// Ordinary technologies are researched at the building they belong to:
    /// better ploughs at the mill, better steel at the blacksmith. Research sits
    /// in the building's queue like a unit in training, is paid for when queued
    /// and refunded if cancelled.
    ///
    /// What research changes is each player's own copy of the unit and building
    /// figures (World.types). It is rebuilt from the starting figures and the
    /// list of what the player has researched, in a fixed order, so it comes out
    /// the same on every machine and need not be saved.
    /// </summary>
    public static class Techs
    {
        static readonly Who SOLDIERS = Who.Tags(Tag.Infantry | Tag.Cavalry);
        static readonly Who BLADES = Who.Kinds(Kind.Spearman, Kind.Horseman, Kind.ManAtArms, Kind.Knight);
        static readonly Who BOWS = Who.Kinds(Kind.Archer, Kind.Crossbowman, Kind.TownCentre, Kind.Watchtower);
        static readonly int[] HIGH_MEDIEVAL_WORKS = { Kind.Mill, Kind.LumberCamp, Kind.MiningCamp, Kind.Barracks };
        static readonly int[] LATE_MEDIEVAL_WORKS = { Kind.ArcheryRange, Kind.Stable, Kind.Blacksmith };

        static Tech Technology(string name, int at, int age, int[] cost, int seconds, string about, Effect[] effects, int[] requires = null)
        {
            return new Tech
            {
                name = name,
                about = about,
                cost = cost,
                seconds = seconds,
                at = at,
                age = age,
                requires = requires ?? new int[0],
                reform = false,
                needs = 0,
                among = new int[0],
                effects = effects,
            };
        }

        static Tech Reform(string name, int age, int[] cost, int seconds, int[] among, string about, Effect[] effects)
        {
            return new Tech
            {
                name = name,
                about = about,
                cost = cost,
                seconds = seconds,
                at = Kind.TownCentre,
                age = age,
                requires = new int[0],
                reform = true,
                needs = 2,
                among = among,
                effects = effects,
            };
        }

        //                                              food wood stone gold  seconds
        public static readonly Tech[] TECHS =
        {
            // ---- Reforms: two offered in each age, one to be chosen ----------------------
            Reform(
                "Open fields",
                Age.EarlyMedieval,
                new[] { 400, 0, 0, 150 },
                60,
                HIGH_MEDIEVAL_WORKS,
                "The village ploughs its strips in common under the manor, and more land comes under the plough. Farms yield a fifth faster.",
                new[] { Effect.Gather(20, Terrain.Field) }),
            Reform(
                "Knight service",
                Age.EarlyMedieval,
                new[] { 400, 0, 0, 150 },
                60,
                HIGH_MEDIEVAL_WORKS,
                "Land is held in return for armed service, so there are always men owed to the lord. Soldiers train a fifth faster.",
                new[] { Effect.Change(Stat.Seconds, SOLDIERS, percent: -20) }),
            Reform(
                "Town charters",
                Age.HighMedieval,
                new[] { 800, 0, 0, 400 },
                80,
                LATE_MEDIEVAL_WORKS,
                "Chartered boroughs with their own markets and guilds draw in trade and craftsmen. Gold and stone are worked a quarter faster.",
                new[] { Effect.Gather(25, Terrain.Gold, Terrain.Stone) }),
            Reform(
                "Paid retinues",
                Age.HighMedieval,
                new[] { 800, 0, 0, 400 },
                80,
                LATE_MEDIEVAL_WORKS,
                "Captains contract to bring companies for wages instead of feudal duty: fewer, better soldiers. Soldiers have a tenth more hit points.",
                new[] { Effect.Change(Stat.Hp, SOLDIERS, percent: 10) }),
            Reform(
                "Standing companies",
                Age.LateMedieval,
                new[] { 1200, 0, 0, 800 },
                100,
                LATE_MEDIEVAL_WORKS,
                "Permanent companies kept in peace and war, as France raised in 1445. Soldiers cost 15 per cent less.",
                new[] { Effect.Cost(-15, SOLDIERS) }),
            Reform(
                "Gunfounding",
                Age.LateMedieval,
                new[] { 1200, 0, 0, 800 },
                100,
                LATE_MEDIEVAL_WORKS,
                "Cast bronze barrels and corned powder make guns that can be trusted. Handgunners hit a fifth harder and shoot a tile further.",
                new[]
                {
                    Effect.Change(Stat.Damage, Who.Tags(Tag.Gunpowder), percent: 20),
                    Effect.Change(Stat.Range, Who.Tags(Tag.Gunpowder), add: ONE),
                }),

            // ---- The town centre ---------------------------------------------------------
            Technology(
                "Wheelbarrow",
                Kind.TownCentre,
                Age.HighMedieval,
                new[] { 150, 100, 0, 0 },
                40,
                "One wheel and two handles, in use on English building sites by the 1200s. Villagers carry 5 more and walk a tenth faster.",
                new[]
                {
                    Effect.Change(Stat.Carries, Who.Kinds(Kind.Villager), add: 5),
                    Effect.Change(Stat.Speed, Who.Kinds(Kind.Villager), percent: 10),
                }),

            // ---- The mill ----------------------------------------------------------------
            Technology(
                "Heavy plough",
                Kind.Mill,
                Age.EarlyMedieval,
                new[] { 0, 125, 0, 0 },
                30,
                "A wheeled plough with a mouldboard turns the heavy northern soils the scratch plough could not. Farms yield 15 per cent faster.",
                new[] { Effect.Gather(15, Terrain.Field) }),
            Technology(
                "Horse collar",
                Kind.Mill,
                Age.HighMedieval,
                new[] { 0, 200, 0, 50 },
                40,
                "A padded collar lets a horse pull with its shoulders, not its windpipe, and a horse ploughs faster than an ox. Farms yield 15 per cent faster.",
                new[] { Effect.Gather(15, Terrain.Field) },
                new[] { TechId.HeavyPlough }),

            // ---- The lumber camp ---------------------------------------------------------
            Technology(
                "Felling axes",
                Kind.LumberCamp,
                Age.EarlyMedieval,
                new[] { 100, 50, 0, 0 },
                30,
                "Long-hafted axes with a narrow steeled bit, made for felling and nothing else. Wood is cut 15 per cent faster.",
                new[] { Effect.Gather(15, Terrain.Forest) }),
            Technology(
                "Sawmills",
                Kind.LumberCamp,
                Age.LateMedieval,
                new[] { 150, 100, 0, 100 },
                45,
                "A water wheel drives the saw, as Villard de Honnecourt drew about 1250. Wood is cut 20 per cent faster.",
                new[] { Effect.Gather(20, Terrain.Forest) },
                new[] { TechId.FellingAxes }),

            // ---- The mining camp ---------------------------------------------------------
            Technology(
                "Fire-setting",
                Kind.MiningCamp,
                Age.EarlyMedieval,
                new[] { 100, 75, 0, 0 },
                30,
                "A fire built against the rock face and quenched cracks stone that picks cannot. Stone and gold are worked 15 per cent faster.",
                new[] { Effect.Gather(15, Terrain.Stone, Terrain.Gold) }),
            Technology(
                "Drainage adits",
                Kind.MiningCamp,
                Age.LateMedieval,
                new[] { 200, 150, 0, 0 },
                45,
                "Tunnels driven in from the hillside drain the workings, so the miners can follow the vein down. Stone and gold are worked 20 per cent faster.",
                new[] { Effect.Gather(20, Terrain.Stone, Terrain.Gold) },
                new[] { TechId.FireSetting }),

            // ---- The blacksmith ----------------------------------------------------------
            Technology(
                "Steeled edges",
                Kind.Blacksmith,
                Age.HighMedieval,
                new[] { 150, 0, 0, 75 },
                40,
                "A strip of hard steel welded to an iron blade takes and keeps an edge. Spears, swords and lances do 1 more damage.",
                new[] { Effect.Change(Stat.Damage, BLADES, add: 1) }),
            Technology(
                "Blast furnace",
                Kind.Blacksmith,
                Age.LateMedieval,
                new[] { 250, 0, 0, 150 },
                55,
                "Water-blown furnaces smelt iron by the ton instead of the bloom. Spears, swords and lances do 2 more damage.",
                new[] { Effect.Change(Stat.Damage, BLADES, add: 2) },
                new[] { TechId.SteeledEdges }),
            Technology(
                "Mail hauberks",
                Kind.Blacksmith,
                Age.HighMedieval,
                new[] { 150, 0, 0, 75 },
                40,
                "Knee-length coats of riveted rings for those who fight hand to hand. Soldiers take 1 less from blades.",
                new[] { Effect.Change(Stat.MeleeArmor, SOLDIERS, add: 1) }),
            Technology(
                "Coat of plates",
                Kind.Blacksmith,
                Age.LateMedieval,
                new[] { 250, 0, 0, 150 },
                55,
                "Iron plates riveted inside a cloth coat, worn over mail from about 1250. Soldiers take 1 less from blades and from arrows.",
                new[]
                {
                    Effect.Change(Stat.MeleeArmor, SOLDIERS, add: 1),
                    Effect.Change(Stat.RangedArmor, SOLDIERS, add: 1),
                },
                new[] { TechId.MailHauberks }),
            Technology(
                "Bodkin points",
                Kind.Blacksmith,
                Age.HighMedieval,
                new[] { 100, 100, 0, 50 },
                40,
                "Narrow four-sided arrowheads that punch through mail where a broadhead would turn. Arrows and bolts do 1 more damage, from towers too.",
                new[] { Effect.Change(Stat.Damage, BOWS, add: 1) }),

            // ---- The archery range -------------------------------------------------------
            Technology(
                "Longbows",
                Kind.ArcheryRange,
                Age.LateMedieval,
                new[] { 150, 200, 0, 100 },
                50,
                "Yew staves as tall as the archer, drawn to the ear by men trained from boyhood. Archers become longbowmen: a tile more range and 1 more damage.",
                new[]
                {
                    Effect.Change(Stat.Range, Who.Kinds(Kind.Archer), add: ONE),
                    Effect.Change(Stat.Damage, Who.Kinds(Kind.Archer), add: 1),
                    Effect.Rename(Kind.Archer, "longbowman"),
                }),

            // ---- The barracks ------------------------------------------------------------
            Technology(
                "Long spears",
                Kind.Barracks,
                Age.HighMedieval,
                new[] { 150, 100, 0, 0 },
                40,
                "Spears of twelve feet and more, and the drill to hold a line with them. Spearmen have 15 more hit points and do 4 more to cavalry.",
                new[]
                {
                    Effect.Change(Stat.Hp, Who.Kinds(Kind.Spearman), add: 15),
                    Effect.Bonus(4, Who.Kinds(Kind.Spearman), Tag.Cavalry),
                }),
            Technology(
                "Pikes",
                Kind.Barracks,
                Age.LateMedieval,
                new[] { 250, 150, 0, 100 },
                55,
                "Eighteen-foot pikes in deep blocks, as the Swiss and Scots carried against knights. Spearmen become pikemen: 15 more hit points, 6 more to cavalry and a longer reach.",
                new[]
                {
                    Effect.Change(Stat.Hp, Who.Kinds(Kind.Spearman), add: 15),
                    Effect.Bonus(6, Who.Kinds(Kind.Spearman), Tag.Cavalry),
                    Effect.Change(Stat.Range, Who.Kinds(Kind.Spearman), add: FromRatio(1, 4)),
                    Effect.Rename(Kind.Spearman, "pikeman"),
                },
                new[] { TechId.LongSpears }),

            // ---- The stable --------------------------------------------------------------
            Technology(
                "Couched lance",
                Kind.Stable,
                Age.HighMedieval,
                new[] { 150, 0, 0, 100 },
                45,
                "The lance tucked under the arm, so that horse and rider strike as one. Horsemen and knights do 6 more on a charge.",
                new[] { Effect.Change(Stat.Charge, Who.Tags(Tag.Cavalry), add: 6) }),

            // ---- The watchtower ----------------------------------------------------------
            Technology(
                "Arrow loops",
                Kind.Watchtower,
                Age.HighMedieval,
                new[] { 100, 0, 100, 0 },
                40,
                "Narrow slits splayed on the inside give an archer cover and a wide field. Towers and town centres shoot a tile further and see two tiles further.",
                new[]
                {
                    Effect.Change(Stat.Range, Who.Kinds(Kind.Watchtower, Kind.TownCentre), add: ONE),
                    Effect.Change(Stat.Sight, Who.Kinds(Kind.Watchtower, Kind.TownCentre), add: 2),
                }),
        };

        /// <summary>Research in a building's queue is stored as this plus the technology's number; units are stored as their kind plus 1.</summary>
        public const int QUEUED_TECH = 128;

        /// <summary>How many terrains gathering speeds are kept for.</summary>
        public const int TERRAINS = 9;

        const int QUEUE = TRAIN_QUEUE_LENGTH;

        static readonly int STAT_COUNT = Enum.GetValues(typeof(Stat)).Length;

        static readonly int[] NOTHING = new int[RESOURCE_COUNT];

        // ---- What a player's research has made of their units ------------------------

        static bool Falls(Who who, int kind, EntityType type)
        {
            return (who.kinds != null && Array.IndexOf(who.kinds, kind) >= 0) || (type.tags & who.tags) != 0;
        }

        /// <summary>
        /// Works out a player's units and buildings afresh from the starting
        /// figures and everything the player has researched, and their gathering
        /// speeds with them. Additions are applied first, then percentages of the
        /// starting figure, so the order things were researched in makes no
        /// difference.
        /// </summary>
        public static void RebuildTypes(World world, int player)
        {
            int count = ENTITY_TYPES.Length;
            var types = new EntityType[count];
            for (int kind = 0; kind < count; kind++) types[kind] = ENTITY_TYPES[kind].Clone();
            var percents = new int[count, STAT_COUNT];
            var costPercent = new int[count];
            int gather = player * TERRAINS;
            for (int terrain = 0; terrain < TERRAINS; terrain++) world.gatherBonus[gather + terrain] = 0;

            for (int id = 0; id < TECHS.Length; id++)
            {
                if (world.researched[player * TECHS.Length + id] == 0) continue;
                foreach (Effect effect in TECHS[id].effects)
                {
                    if (effect.kind == EffectKind.Gather)
                    {
                        foreach (int terrain in effect.gather) world.gatherBonus[gather + terrain] = world.gatherBonus[gather + terrain] + effect.percent;
                        continue;
                    }
                    if (effect.kind == EffectKind.Rename)
                    {
                        types[effect.rename].name = effect.to;
                        continue;
                    }
                    for (int kind = 0; kind < count; kind++)
                    {
                        EntityType type = types[kind];
                        if (!Falls(effect.of, kind, ENTITY_TYPES[kind])) continue;
                        if (effect.kind == EffectKind.Change)
                        {
                            type.Add(effect.change, effect.add);
                            percents[kind, (int)effect.change] += effect.percent;
                        }
                        else if (effect.kind == EffectKind.Bonus)
                        {
                            int at = -1;
                            for (int i = 0; i < type.bonuses.Length && at == -1; i++) if (type.bonuses[i][0] == effect.against) at = i;
                            if (at == -1)
                            {
                                var bonuses = new int[type.bonuses.Length + 1][];
                                type.bonuses.CopyTo(bonuses, 0);
                                bonuses[type.bonuses.Length] = new[] { effect.against, effect.bonus };
                                type.bonuses = bonuses;
                            }
                            else
                            {
                                type.bonuses[at] = new[] { effect.against, type.bonuses[at][1] + effect.bonus };
                            }
                        }
                        else
                        {
                            costPercent[kind] = costPercent[kind] + effect.cost;
                        }
                    }
                }
            }
            for (int kind = 0; kind < count; kind++)
            {
                EntityType type = types[kind];
                EntityType start = ENTITY_TYPES[kind];
                // A figure no research has touched has a percentage of nought, which adds nothing.
                for (int stat = 0; stat < STAT_COUNT; stat++)
                {
                    type.Add((Stat)stat, (int)Idiv((long)start.Get((Stat)stat) * percents[kind, stat], 100));
                }
                if (costPercent[kind] != 0)
                {
                    var cost = new int[start.cost.Length];
                    for (int r = 0; r < cost.Length; r++) cost[r] = start.cost[r] + Idiv(start.cost[r] * costPercent[kind], 100);
                    type.cost = cost;
                }
                if (type.seconds < 1) type.seconds = 1;
            }
            world.types[player] = types;
        }

        /// <summary>
        /// Makes a finished piece of research take effect: the player's figures
        /// are worked out again, and everything they already have in the field is
        /// brought up to them. A unit keeps the wounds it had: only the extra hit
        /// points are added.
        /// </summary>
        static void TakeEffect(World world, int player, int id)
        {
            EntityType[] before = world.types[player];
            world.researched[player * TECHS.Length + id] = 1;
            if (TECHS[id].reform) world.age[player] = (byte)(TECHS[id].age + 1);
            RebuildTypes(world, player);
            EntityType[] after = world.types[player];
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.owner[slot] != player) continue;
                int kind = world.entityType[slot];
                int gained = after[kind].hp - before[kind].hp;
                if (gained > 0 && (world.mobile[slot] == 1 || world.built[slot] == 1)) world.hp[slot] = world.hp[slot] + gained;
                if (world.hp[slot] > after[kind].hp) world.hp[slot] = after[kind].hp;
                if (world.mobile[slot] == 1) world.speed[slot] = Units.PerSecondToPerTick(after[kind].speed, world.config.tickRate);
            }
        }

        // ---- Researching -------------------------------------------------------------

        /// <summary>Whether a technology is waiting or under way in any of a player's buildings.</summary>
        public static bool IsQueued(World world, int player, int id)
        {
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 1 || world.owner[slot] != player) continue;
                for (int k = 0; k < world.trainLength[slot]; k++)
                {
                    if (world.trainQueue[slot * QUEUE + k] == QUEUED_TECH + id) return true;
                }
            }
            return false;
        }

        /// <summary>How many different kinds among a list of buildings a player has standing and finished.</summary>
        static int KindsStanding(World world, int player, int[] among)
        {
            var seen = new bool[ENTITY_TYPES.Length];
            int kinds = 0;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 1 || world.owner[slot] != player || world.built[slot] == 0) continue;
                int kind = world.entityType[slot];
                if (Array.IndexOf(among, kind) >= 0 && !seen[kind])
                {
                    seen[kind] = true;
                    kinds++;
                }
            }
            return kinds;
        }

        /// <summary>
        /// Why a player cannot research something just now, in words for the
        /// player, or null if they can (leaving aside whether they can pay for it).
        /// </summary>
        public static string WhyNot(World world, int player, int id)
        {
            if (id < 0 || id >= TECHS.Length) return "no such technology";
            Tech tech = TECHS[id];
            if (world.researched[player * TECHS.Length + id] == 1) return "already researched";
            if (IsQueued(world, player, id)) return "already under way";
            int age = world.age[player];
            if (tech.reform)
            {
                if (age > tech.age) return "that age is past";
                if (age < tech.age) return "not yet";
                // Only one reform at a time: choosing one is choosing against the other.
                for (int other = 0; other < TECHS.Length; other++)
                {
                    if (other != id && TECHS[other].reform && IsQueued(world, player, other)) return "another reform is under way";
                }
                if (KindsStanding(world, player, tech.among) < tech.needs)
                {
                    var names = new string[tech.among.Length];
                    for (int i = 0; i < names.Length; i++) names[i] = ENTITY_TYPES[tech.among[i]].name;
                    return $"needs {tech.needs} of: {string.Join(", ", names)}";
                }
                return null;
            }
            if (age < tech.age) return $"needs the {AGE_NAMES[tech.age]} age";
            foreach (int first in tech.requires)
            {
                if (world.researched[player * TECHS.Length + first] == 0) return $"needs {TECHS[first].name}";
            }
            return null;
        }

        /// <summary>Adds a technology to a building's queue and takes its cost. Returns false if it cannot be done.</summary>
        public static bool QueueResearch(World world, int player, int building, int id)
        {
            if (id < 0 || id >= TECHS.Length || !world.IsAlive(building)) return false;
            int slot = World.EntityIndex(building);
            Tech tech = TECHS[id];
            if (world.mobile[slot] == 1 || world.owner[slot] != player || world.built[slot] == 0) return false;
            if (world.entityType[slot] != tech.at || WhyNot(world, player, id) != null) return false;
            int waiting = world.trainLength[slot];
            if (waiting >= QUEUE || !world.CanAfford(player, tech.cost)) return false;
            world.Pay(player, tech.cost);
            world.trainQueue[slot * QUEUE + waiting] = (byte)(QUEUED_TECH + id);
            world.trainLength[slot] = (byte)(waiting + 1);
            return true;
        }

        /// <summary>Ticks a technology takes to research.</summary>
        public static int ResearchTicks(int id, int tickRate)
        {
            return Math.Max(1, TECHS[id].seconds * tickRate);
        }

        /// <summary>Called by production when a building has finished researching the technology at the head of its queue.</summary>
        public static void FinishResearch(World world, int building, int id)
        {
            TakeEffect(world, world.owner[building], id);
        }

        /// <summary>What something in a building's queue costs, whether a unit or a technology, for refunds.</summary>
        public static int[] QueuedCost(World world, int player, int queued)
        {
            if (queued >= QUEUED_TECH)
            {
                int id = queued - QUEUED_TECH;
                return id < TECHS.Length ? TECHS[id].cost : NOTHING;
            }
            int kind = queued - 1;
            EntityType[] types = world.types[player];
            return kind >= 0 && kind < types.Length ? types[kind].cost : NOTHING;
        }
    }
}
