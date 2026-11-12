// Ported from src/sim/entityTypes.ts. Keep the two in step.

using System;
using System.Collections.Generic;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    public static class Resource
    {
        public const int Food = 0;
        public const int Wood = 1;
        public const int Stone = 2;
        public const int Gold = 3;
    }

    /// <summary>What a thing is, for the purposes of who hits it hardest. One bit each.</summary>
    public static class Tag
    {
        public const int Infantry = 1;
        public const int Cavalry = 2;
        public const int Ranged = 4;
        /// <summary>Foot soldiers with long weapons and little armour.</summary>
        public const int Spear = 8;
        public const int Villager = 16;
        public const int Building = 32;
        /// <summary>In mail or plate: men-at-arms and knights. Bolts are made for them.</summary>
        public const int Heavy = 64;
        public const int Gunpowder = 128;
    }

    /// <summary>The four ages a match passes through, each reached by choosing a reform (see Tech.cs).</summary>
    public static class Age
    {
        public const int EarlyMedieval = 0;
        public const int HighMedieval = 1;
        public const int LateMedieval = 2;
        public const int EarlyModern = 3;
    }

    public static class Kind
    {
        public const int Spearman = 0;
        public const int Villager = 1;
        public const int TownCentre = 2;
        public const int House = 3;
        public const int Mill = 4;
        public const int LumberCamp = 5;
        public const int MiningCamp = 6;
        public const int Barracks = 7;
        public const int Archer = 8;
        public const int Horseman = 9;
        public const int ArcheryRange = 10;
        public const int Stable = 11;
        public const int Watchtower = 12;
        public const int Farm = 13;
        public const int ManAtArms = 14;
        public const int Knight = 15;
        public const int Crossbowman = 16;
        public const int Handgunner = 17;
        public const int Blacksmith = 18;
    }

    /// <summary>A figure of a unit or building that research can change.</summary>
    public enum Stat
    {
        Hp,
        Damage,
        MeleeArmor,
        RangedArmor,
        Range,
        Sight,
        Speed,
        Carries,
        Seconds,
        Charge,
    }

    public sealed class EntityType
    {
        public string name;
        public bool building;
        /// <summary>What it costs to train or to found: food, wood, stone, gold.</summary>
        public int[] cost;
        /// <summary>Seconds to train a unit, or for one villager to put up a building.</summary>
        public int seconds;
        /// <summary>The age a player must have reached to train or build it.</summary>
        public int age;

        /// <summary>How much damage it can take.</summary>
        public int hp;
        /// <summary>How far it sees, in tiles. Whatever is further off is hidden unless someone else on its side sees it.</summary>
        public int sight;
        /// <summary>Taken off every blow, and off every arrow. A hit always does at least 1.</summary>
        public int meleeArmor;
        public int rangedArmor;
        /// <summary>Tag bits: what it counts as when something has a bonus against it.</summary>
        public int tags;

        /// <summary>Damage per hit before armour, or 0 if it cannot attack.</summary>
        public int damage;
        /// <summary>Whether it shoots. Shots fly over anything and always find their mark.</summary>
        public bool ranged;
        /// <summary>How far it can strike, in tiles, measured between the edges of attacker and target.</summary>
        public int range;
        /// <summary>Seconds from starting an attack to the blow landing, and from one attack to the next.</summary>
        public int windup;
        public int cycle;
        /// <summary>Extra damage against anything carrying one of these tags: pairs of tags and extra.</summary>
        public int[][] bonuses;
        /// <summary>Extra damage on the first blow after a run, or 0.</summary>
        public int charge;
        /// <summary>Whether, standing still, it stops a charge and wounds the charger.</summary>
        public bool braces;
        /// <summary>Whether it goes for enemies that come near without being told to.</summary>
        public bool aggressive;

        /// <summary>Units: tiles per second. One tile is two metres.</summary>
        public int speed;
        /// <summary>Units: the space one takes up, in tiles. Two units keep at least the sum of theirs apart.</summary>
        public int radius;
        /// <summary>Units: how much of a resource one can carry, or 0 if it does not gather.</summary>
        public int carries;
        /// <summary>Units: whether it can put up buildings.</summary>
        public bool builds;
        /// <summary>Units: how much room it takes up in the population.</summary>
        public int population;

        /// <summary>Buildings: tiles along each side. Odd, so the building has a centre tile.</summary>
        public int footprint;
        /// <summary>Buildings: which resources gatherers can hand in here, one bit per resource.</summary>
        public int accepts;
        /// <summary>Buildings: how many more units the player can have for owning it.</summary>
        public int housing;
        /// <summary>Buildings: the unit types it trains.</summary>
        public int[] trains;
        /// <summary>Buildings: whether villagers can be told to build one.</summary>
        public bool buildable;
        /// <summary>
        /// Buildings: whether it is a farm. Once built, a farm is tilled ground
        /// rather than walls: it can be walked over, and one villager at a time
        /// gathers food from the middle of it without end.
        /// </summary>
        public bool farm;

        /// <summary>A copy that can be changed without touching this one: a player's own figures start as one of these.</summary>
        public EntityType Clone()
        {
            var copy = (EntityType)MemberwiseClone();
            copy.cost = (int[])cost.Clone();
            copy.bonuses = new int[bonuses.Length][];
            for (int i = 0; i < bonuses.Length; i++) copy.bonuses[i] = new[] { bonuses[i][0], bonuses[i][1] };
            return copy;
        }

        public int Get(Stat stat)
        {
            switch (stat)
            {
                case Stat.Hp: return hp;
                case Stat.Damage: return damage;
                case Stat.MeleeArmor: return meleeArmor;
                case Stat.RangedArmor: return rangedArmor;
                case Stat.Range: return range;
                case Stat.Sight: return sight;
                case Stat.Speed: return speed;
                case Stat.Carries: return carries;
                case Stat.Seconds: return seconds;
                case Stat.Charge: return charge;
                default: throw new ArgumentOutOfRangeException(nameof(stat));
            }
        }

        public void Add(Stat stat, int amount)
        {
            switch (stat)
            {
                case Stat.Hp: hp += amount; break;
                case Stat.Damage: damage += amount; break;
                case Stat.MeleeArmor: meleeArmor += amount; break;
                case Stat.RangedArmor: rangedArmor += amount; break;
                case Stat.Range: range += amount; break;
                case Stat.Sight: sight += amount; break;
                case Stat.Speed: speed += amount; break;
                case Stat.Carries: carries += amount; break;
                case Stat.Seconds: seconds += amount; break;
                case Stat.Charge: charge += amount; break;
                default: throw new ArgumentOutOfRangeException(nameof(stat));
            }
        }
    }

    /// <summary>
    /// What each kind of unit and building is and can do, and the rules of the
    /// four resources. These tables will move to data files once there is enough
    /// of them to be worth editing outside the code; the simulation only ever
    /// reads them from here.
    /// </summary>
    public static class EntityTypes
    {
        public const int RESOURCE_COUNT = 4;
        public static readonly string[] RESOURCE_NAMES = { "food", "wood", "stone", "gold" };

        public static readonly string[] AGE_NAMES = { "Early Medieval", "High Medieval", "Late Medieval", "Early Modern" };
        /// <summary>The years each age stands for.</summary>
        public static readonly string[] AGE_YEARS = { "800–1000", "1000–1250", "1250–1450", "1450–1600" };

        /// <summary>Which resource a terrain yields, or -1 if it yields none.</summary>
        public static int ResourceOfTerrain(int terrain)
        {
            switch (terrain)
            {
                case Terrain.Berries:
                case Terrain.Field:
                    return Resource.Food;
                case Terrain.Forest:
                    return Resource.Wood;
                case Terrain.Stone:
                    return Resource.Stone;
                case Terrain.Gold:
                    return Resource.Gold;
                default:
                    return -1;
            }
        }

        /// <summary>Seconds of work to gather one unit of each resource, as a fraction.</summary>
        static readonly int[][] SECONDS_PER_UNIT =
        {
            new[] { 5, 4 }, // food, from bushes
            new[] { 3, 2 }, // wood
            new[] { 8, 5 }, // stone
            new[] { 8, 5 }, // gold
        };

        /// <summary>A farm is steadier than a berry bush but slower: seconds of work per unit of food, as a fraction.</summary>
        static readonly int[] SECONDS_PER_UNIT_FARMED = { 8, 5 };

        /// <summary>
        /// Ticks of work to gather one unit from a tile of a given terrain.
        /// </summary>
        /// <param name="faster">
        /// How much quicker the gatherer's side has learned to work this terrain,
        /// in percent: 30 means thirteen units in the time ten took.
        /// </param>
        public static int TicksPerUnit(int terrain, int tickRate, int faster = 0)
        {
            int[] rate = terrain == Terrain.Field ? SECONDS_PER_UNIT_FARMED : SECONDS_PER_UNIT[ResourceOfTerrain(terrain)];
            int seconds = rate[0];
            int per = rate[1];
            int scale = per * (100 + faster);
            return Math.Max(1, Idiv(tickRate * seconds * 200 + scale, scale * 2));
        }

        const int ALL_RESOURCES = (1 << RESOURCE_COUNT) - 1;

        sealed class Weapon
        {
            public int damage;
            public bool ranged;
            public int range;
            public int windup;
            public int cycle;
            public int[][] bonuses = new int[0][];
            public int charge;
        }

        static readonly Weapon UNARMED = new Weapon { damage = 0, range = 0, windup = 0, cycle = ONE };

        static EntityType Unit(
            string name,
            int[] cost,
            int seconds,
            Weapon weapon,
            int hp,
            int sight,
            int speed,
            int radius,
            int tags,
            int meleeArmor = 0,
            int rangedArmor = 0,
            int carries = 0,
            bool builds = false,
            bool braces = false,
            bool aggressive = true,
            int age = Age.EarlyMedieval)
        {
            return new EntityType
            {
                name = name,
                building = false,
                cost = cost,
                seconds = seconds,
                age = age,
                hp = hp,
                sight = sight,
                meleeArmor = meleeArmor,
                rangedArmor = rangedArmor,
                tags = tags,
                damage = weapon.damage,
                ranged = weapon.ranged,
                range = weapon.range,
                windup = weapon.windup,
                cycle = weapon.cycle,
                bonuses = weapon.bonuses,
                charge = weapon.charge,
                braces = braces,
                aggressive = aggressive,
                speed = speed,
                radius = radius,
                carries = carries,
                builds = builds,
                population = 1,
                footprint = 0,
                accepts = 0,
                housing = 0,
                trains = new int[0],
                buildable = false,
                farm = false,
            };
        }

        static EntityType Building(
            string name,
            int[] cost,
            int seconds,
            int footprint,
            int hp,
            Weapon weapon = null,
            int accepts = 0,
            int housing = 0,
            int[] trains = null,
            bool buildable = true,
            int sight = 6,
            bool farm = false,
            int age = Age.EarlyMedieval)
        {
            weapon = weapon ?? UNARMED;
            return new EntityType
            {
                name = name,
                building = true,
                cost = cost,
                seconds = seconds,
                age = age,
                hp = hp,
                sight = sight,
                // Timber and stone shrug off blades, and arrows all but bounce off.
                meleeArmor = 4,
                rangedArmor = 8,
                tags = Tag.Building,
                damage = weapon.damage,
                ranged = weapon.ranged,
                range = weapon.range,
                windup = 0,
                cycle = weapon.cycle,
                bonuses = weapon.bonuses,
                charge = 0,
                braces = false,
                aggressive = weapon.damage > 0,
                speed = 0,
                radius = 0,
                carries = 0,
                builds = false,
                population = 0,
                footprint = footprint,
                accepts = accepts,
                housing = housing,
                trains = trains ?? new int[0],
                buildable = buildable,
                farm = farm,
            };
        }

        static int[][] Against(int tags, int extra)
        {
            return new[] { new[] { tags, extra } };
        }

        /*
         * The counter triangle: spears stop horses, horses ride down archers, and
         * archers shoot spearmen full of holes before they can close.
         *
         *              hp  hit  every  armour  and
         *   spearman   80    8  1.75s   0 / 0  +16 against cavalry; braces against a charge
         *   archer     60    5  1.5s    0 / 0  +5 against spearmen; shoots 5 tiles
         *   horseman  120    9  1.75s   0 / 2  +9 against archers; +10 on a charge; half as fast again
         *
         * Later ages add soldiers in armour, who cost gold and shrug off the cheap
         * troops' blows, and the weapons made to deal with them:
         *
         *   man-at-arms  130   11  1.75s   3 / 3  High Medieval; no weakness to arrows
         *   knight       190   14  1.75s   3 / 3  High Medieval; +14 on a charge; still fears spears
         *   crossbowman   70   10  2.25s   0 / 0  Late Medieval; +10 against armour; shoots 5 tiles
         *   handgunner    70   32  3.5s    0 / 0  Early Modern; +6 against armour; shoots 4 tiles, slowly
         */
        static Weapon ArrowsFromABuilding(int range)
        {
            return new Weapon { damage = 8, ranged = true, range = range, windup = 0, cycle = 2 * ONE };
        }

        //                                    food wood stone gold  seconds
        public static readonly EntityType[] ENTITY_TYPES =
        {
            Unit(
                "spearman",
                new[] { 60, 20, 0, 0 },
                15,
                new Weapon { damage = 8, range = FromRatio(2, 5), windup = FromRatio(1, 2), cycle = FromRatio(7, 4), bonuses = Against(Tag.Cavalry, 16) },
                hp: 80, sight: 8, speed: FromRatio(8, 5), radius: FromRatio(1, 4), tags: Tag.Infantry | Tag.Spear, braces: true),
            Unit(
                "villager",
                new[] { 50, 0, 0, 0 },
                20,
                new Weapon { damage = 3, range = FromRatio(1, 4), windup = FromRatio(1, 2), cycle = 2 * ONE },
                hp: 50, sight: 7, speed: FromRatio(5, 4), radius: FromRatio(9, 40), tags: Tag.Villager, carries: 10, builds: true, aggressive: false),
            Building(
                "town centre",
                new[] { 0, 400, 300, 0 },
                150,
                5,
                2400,
                ArrowsFromABuilding(6 * ONE),
                accepts: ALL_RESOURCES, housing: 10, trains: new[] { Kind.Villager }, buildable: false, sight: 11),
            Building("house", new[] { 0, 50, 0, 0 }, 20, 3, 400, housing: 10),
            Building("mill", new[] { 0, 50, 0, 0 }, 25, 3, 500, accepts: 1 << Resource.Food),
            Building("lumber camp", new[] { 0, 50, 0, 0 }, 25, 3, 500, accepts: 1 << Resource.Wood),
            Building("mining camp", new[] { 0, 50, 0, 0 }, 25, 3, 500, accepts: (1 << Resource.Stone) | (1 << Resource.Gold)),
            Building("barracks", new[] { 0, 150, 0, 0 }, 40, 5, 1000, trains: new[] { Kind.Spearman, Kind.ManAtArms }),
            Unit(
                "archer",
                new[] { 30, 50, 0, 0 },
                15,
                new Weapon { damage = 5, ranged = true, range = 5 * ONE, windup = FromRatio(1, 2), cycle = FromRatio(3, 2), bonuses = Against(Tag.Spear, 5) },
                hp: 60, sight: 9, speed: FromRatio(8, 5), radius: FromRatio(1, 4), tags: Tag.Infantry | Tag.Ranged),
            Unit(
                "horseman",
                new[] { 100, 20, 0, 0 },
                22,
                new Weapon { damage = 9, range = FromRatio(2, 5), windup = FromRatio(2, 5), cycle = FromRatio(7, 4), bonuses = Against(Tag.Ranged, 9), charge = 10 },
                hp: 120, sight: 10, speed: FromRatio(12, 5), radius: FromRatio(7, 20), tags: Tag.Cavalry, rangedArmor: 2),
            Building("archery range", new[] { 0, 150, 0, 0 }, 40, 5, 1000, trains: new[] { Kind.Archer, Kind.Crossbowman, Kind.Handgunner }),
            Building("stable", new[] { 0, 150, 0, 0 }, 40, 5, 1000, trains: new[] { Kind.Horseman, Kind.Knight }),
            Building("watchtower", new[] { 0, 100, 50, 0 }, 45, 3, 700, ArrowsFromABuilding(7 * ONE), sight: 13),
            Building("farm", new[] { 0, 75, 0, 0 }, 20, 3, 300, farm: true, sight: 3),
            Unit(
                "man-at-arms",
                new[] { 100, 0, 0, 40 },
                22,
                new Weapon { damage = 11, range = FromRatio(3, 10), windup = FromRatio(1, 2), cycle = FromRatio(7, 4) },
                hp: 130, sight: 8, speed: FromRatio(7, 5), radius: FromRatio(1, 4), tags: Tag.Infantry | Tag.Heavy,
                meleeArmor: 3, rangedArmor: 3, age: Age.HighMedieval),
            Unit(
                "knight",
                new[] { 140, 0, 0, 100 },
                30,
                new Weapon { damage = 14, range = FromRatio(2, 5), windup = FromRatio(2, 5), cycle = FromRatio(7, 4), bonuses = Against(Tag.Ranged, 6), charge = 14 },
                hp: 190, sight: 9, speed: FromRatio(11, 5), radius: FromRatio(7, 20), tags: Tag.Cavalry | Tag.Heavy,
                meleeArmor: 3, rangedArmor: 3, age: Age.HighMedieval),
            Unit(
                "crossbowman",
                new[] { 60, 0, 0, 45 },
                20,
                new Weapon { damage = 10, ranged = true, range = 5 * ONE, windup = FromRatio(3, 5), cycle = FromRatio(9, 4), bonuses = Against(Tag.Heavy, 10) },
                hp: 70, sight: 9, speed: FromRatio(3, 2), radius: FromRatio(1, 4), tags: Tag.Infantry | Tag.Ranged, age: Age.LateMedieval),
            Unit(
                "handgunner",
                new[] { 70, 0, 0, 60 },
                24,
                new Weapon { damage = 32, ranged = true, range = 4 * ONE, windup = FromRatio(4, 5), cycle = FromRatio(7, 2), bonuses = Against(Tag.Heavy, 6) },
                hp: 70, sight: 8, speed: FromRatio(3, 2), radius: FromRatio(1, 4), tags: Tag.Infantry | Tag.Ranged | Tag.Gunpowder, age: Age.EarlyModern),
            Building("blacksmith", new[] { 0, 150, 0, 0 }, 35, 3, 800, age: Age.HighMedieval),
        };

        /// <summary>How fast an arrow flies, in tiles per second.</summary>
        public const int SHOT_SPEED = 14 * ONE;
        /// <summary>How long a rider must keep moving before a charge is ready, in seconds, and how long the readiness lasts.</summary>
        public static readonly int CHARGE_RUN_SECONDS = FromRatio(3, 2);

        /// <summary>A rider who has run for two thirds of that has a charge ready.</summary>
        public static int ChargeReadyTicks(int tickRate)
        {
            return Math.Max(1, Idiv(TicksOf(CHARGE_RUN_SECONDS, tickRate) * 2, 3));
        }

        /// <summary>A shooter this much higher than its target (in tiles of height) hits a quarter harder.</summary>
        public static readonly int HIGH_GROUND = FromRatio(1, 2);

        /// <summary>A span of seconds, as a fixed-point number, in whole ticks. Zero stays zero.</summary>
        public static int TicksOf(int seconds, int tickRate)
        {
            if (seconds <= 0) return 0;
            return Math.Max(1, unchecked(seconds * tickRate + HALF) >> 16);
        }

        /// <summary>A building site sees only its own surroundings until it is finished.</summary>
        public const int SITE_SIGHT = 3;

        /// <summary>A building site starts with this share of its hit points and gains the rest as it is built.</summary>
        public static int SiteHp(int entityType)
        {
            return Math.Max(1, Idiv(ENTITY_TYPES[entityType].hp, 10));
        }

        /// <summary>No player may have more units than this, however many houses they build.</summary>
        public const int POPULATION_LIMIT = 200;
        /// <summary>Units a building can have waiting to be trained.</summary>
        public const int TRAIN_QUEUE_LENGTH = 8;

        /// <summary>Ticks to train a unit, given its type as its owner's technology has made it.</summary>
        public static int TrainingTicks(EntityType type, int tickRate)
        {
            return Math.Max(1, type.seconds * tickRate);
        }

        public const int LONE_BUILDER_POINTS = 3;

        /// <summary>
        /// Work needed to finish a building. A lone builder adds three points a
        /// tick and each helper one more, so two build half as fast again as one,
        /// and extra hands help less and less.
        /// </summary>
        public static int BuildPointsNeeded(int entityType, int tickRate)
        {
            return Math.Max(1, ENTITY_TYPES[entityType].seconds * tickRate * LONE_BUILDER_POINTS);
        }

        /// <summary>The terrain a drop-off building's gatherers would work, nearest first choice first.</summary>
        public static List<int> TerrainsAccepted(int entityType)
        {
            int accepts = ENTITY_TYPES[entityType].accepts;
            var terrains = new List<int>();
            if ((accepts & (1 << Resource.Food)) != 0) terrains.Add(Terrain.Berries);
            if ((accepts & (1 << Resource.Wood)) != 0) terrains.Add(Terrain.Forest);
            if ((accepts & (1 << Resource.Stone)) != 0) terrains.Add(Terrain.Stone);
            if ((accepts & (1 << Resource.Gold)) != 0) terrains.Add(Terrain.Gold);
            return terrains;
        }
    }
}
