// Ported from src/ai/skirmish.ts. Keep the two in step.

using System;
using System.Collections.Generic;
using Rts.Sim;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Techs;

namespace Rts.Ai
{
    /// <summary>Anything that plays a side by issuing commands: an AI, a script, a network peer.</summary>
    public interface IController
    {
        /// <summary>Called once before every tick. Returns the commands this player gives now.</summary>
        List<Command> Act(World world);
    }

    public enum Difficulty
    {
        Easy,
        Standard,
        Hard,
    }

    public enum Mode
    {
        Gather,
        Defend,
        Attack,
    }

    public sealed class Point
    {
        public int x;
        public int y;

        public Point(int x, int y)
        {
            this.x = x;
            this.y = y;
        }
    }

    /// <summary>What the AI is up to, for tests and for anyone watching it play.</summary>
    public sealed class AiStatus
    {
        public Mode mode;
        public int waveSize;
        public Point target;
        public int knownBuildings;
        public bool scouting;
    }

    /// <summary>
    /// The skirmish AI: a computer opponent that plays the same game a person does.
    ///
    /// It is a player, not part of the simulation. A few times a second it looks
    /// at the world and returns commands, which go through the session exactly
    /// as a person's clicks do, so replays and multiplayer need know nothing
    /// about it.
    ///
    /// It plays fair. It gets no extra resources and it does not see through the
    /// fog: of the enemy it knows only what its side can see now, plus the
    /// buildings it remembers seeing. The one thing it is given is where towns
    /// can start on the map, which any player who knows the map would know too.
    ///
    /// What it does, in the order it thinks about them:
    ///
    ///   the town   train villagers; build houses before running out of room;
    ///              share the villagers between food and wood (and a little
    ///              stone for towers); plant farms when the berries are spoken
    ///              for; put a lumber camp by the trees when the walk gets long
    ///   the forge  barracks, archery range, stable and blacksmith as the town
    ///              grows; keep them training, leaning toward whatever beats the
    ///              enemy's soldiers it has seen
    ///   progress   mine gold; choose a reform and move up an age when the town
    ///              can bear the cost; research what its buildings offer
    ///   the army   send one scout to find the enemy; gather the rest in front of
    ///              the town; come home to fight raiders; when the army is big
    ///              enough, march on the nearest enemy building it knows of, and
    ///              keep going from one to the next; fall back when the attack
    ///              is broken, and come again with more
    ///
    /// Nothing here is random and nothing reads a clock, so the same match
    /// always plays out the same way.
    ///
    /// Unlike the simulation, the AI does a little arithmetic in decimals, just
    /// as the TypeScript does: how its memory of enemy soldiers fades, how it
    /// weighs one kind of soldier against another, and what share of its
    /// villagers gather food. Those are marked where they occur. They use only
    /// multiplication, division and addition of 64-bit floats, which give the
    /// same answers in both languages.
    /// </summary>
    public sealed class SkirmishAi : IController
    {
        sealed class Tuning
        {
            /// <summary>Seconds between one look at the world and the next.</summary>
            public double thinkSeconds;
            /// <summary>How many villagers it works up to.</summary>
            public int villagers;
            /// <summary>How many soldiers it keeps at most.</summary>
            public int army;
            /// <summary>How big the army must be for the first attack, and how much bigger for each one after.</summary>
            public int firstAttack;
            public int attackGrowth;
            /// <summary>Seconds it leaves its opponent in peace at the start, however many soldiers it has.</summary>
            public int patience;
            /// <summary>Villagers it wants before each military building.</summary>
            public int barracksAt;
            public int rangeAt;
            public int stableAt;
            /// <summary>Whether it trains what beats the soldiers it has seen.</summary>
            public bool counters;
            /// <summary>Watchtowers it builds at home, and second copies of its military buildings.</summary>
            public int towers;
            public bool doubles;
            /// <summary>The last age it climbs to, and the villagers it wants before leaving each age.</summary>
            public int lastAge;
            public int[] ageAt;
            /// <summary>Villagers it keeps on gold once it has a use for it.</summary>
            public int goldMiners;
        }

        static Tuning TuningFor(Difficulty difficulty)
        {
            switch (difficulty)
            {
                case Difficulty.Easy:
                    return new Tuning
                    {
                        thinkSeconds = 2,
                        villagers = 14,
                        army = 12,
                        firstAttack = 5,
                        attackGrowth = 2,
                        patience = 540,
                        barracksAt = 12,
                        rangeAt = 14,
                        stableAt = 99,
                        counters = false,
                        towers = 0,
                        doubles = false,
                        lastAge = 1,
                        ageAt = new[] { 14, 99, 99 },
                        goldMiners = 2,
                    };
                case Difficulty.Standard:
                    return new Tuning
                    {
                        thinkSeconds = 1,
                        villagers = 24,
                        army = 40,
                        firstAttack = 8,
                        attackGrowth = 4,
                        patience = 300,
                        barracksAt = 8,
                        rangeAt = 12,
                        stableAt = 15,
                        counters = true,
                        towers = 1,
                        doubles = false,
                        lastAge = 2,
                        ageAt = new[] { 18, 24, 99 },
                        goldMiners = 3,
                    };
                case Difficulty.Hard:
                    return new Tuning
                    {
                        thinkSeconds = 0.5,
                        villagers = 34,
                        army = 70,
                        firstAttack = 12,
                        attackGrowth = 6,
                        patience = 0,
                        barracksAt = 7,
                        rangeAt = 10,
                        stableAt = 13,
                        counters = true,
                        towers = 2,
                        doubles = true,
                        lastAge = 3,
                        ageAt = new[] { 16, 24, 32 },
                        goldMiners = 5,
                    };
                default:
                    throw new ArgumentOutOfRangeException(nameof(difficulty));
            }
        }

        /// <summary>The soldiers it trains: how much of each it likes in an army with no enemy in mind (1 for any not listed).</summary>
        static int Likes(int kind)
        {
            switch (kind)
            {
                case Kind.Spearman: return 4;
                case Kind.Archer: return 4;
                case Kind.Horseman: return 2;
                case Kind.ManAtArms: return 4;
                case Kind.Knight: return 2;
                case Kind.Crossbowman: return 2;
                case Kind.Handgunner: return 3;
                default: return 1;
            }
        }

        static readonly int[] NONE = new int[0];
        static readonly int[] BEATEN_BY_SPEARMAN = { Kind.Horseman, Kind.Knight };
        static readonly int[] BEATEN_BY_ARCHER = { Kind.Spearman };
        static readonly int[] BEATEN_BY_HORSEMAN = { Kind.Archer, Kind.Crossbowman, Kind.Handgunner };
        static readonly int[] BEATEN_BY_MAN_AT_ARMS = { Kind.Spearman, Kind.Archer, Kind.Horseman };
        static readonly int[] BEATEN_BY_KNIGHT = { Kind.Archer, Kind.Crossbowman, Kind.Handgunner, Kind.Horseman };
        static readonly int[] BEATEN_BY_CROSSBOWMAN = { Kind.ManAtArms };
        static readonly int[] BEATEN_BY_HANDGUNNER = { Kind.ManAtArms, Kind.Archer };

        /// <summary>What each kind of soldier is good against.</summary>
        static int[] Beats(int kind)
        {
            switch (kind)
            {
                case Kind.Spearman: return BEATEN_BY_SPEARMAN;
                case Kind.Archer: return BEATEN_BY_ARCHER;
                case Kind.Horseman: return BEATEN_BY_HORSEMAN;
                case Kind.ManAtArms: return BEATEN_BY_MAN_AT_ARMS;
                case Kind.Knight: return BEATEN_BY_KNIGHT;
                case Kind.Crossbowman: return BEATEN_BY_CROSSBOWMAN;
                case Kind.Handgunner: return BEATEN_BY_HANDGUNNER;
                default: return NONE;
            }
        }

        /// <summary>The reform it chooses on leaving each age: more food first, then better soldiers, then guns.</summary>
        static readonly int[] REFORMS = { TechId.OpenFields, TechId.PaidRetinues, TechId.Gunfounding };
        /// <summary>What it researches, most wanted first, as its buildings and its age allow.</summary>
        static readonly int[] RESEARCH_ORDER =
        {
            TechId.FellingAxes,
            TechId.HeavyPlough,
            TechId.Wheelbarrow,
            TechId.FireSetting,
            TechId.HorseCollar,
            TechId.LongSpears,
            TechId.SteeledEdges,
            TechId.MailHauberks,
            TechId.BodkinPoints,
            TechId.CouchedLance,
            TechId.ArrowLoops,
            TechId.Sawmills,
            TechId.DrainageAdits,
            TechId.Pikes,
            TechId.Longbows,
            TechId.BlastFurnace,
            TechId.CoatOfPlates,
        };
        static readonly int[] MILITARY_BUILDINGS = { Kind.Barracks, Kind.ArcheryRange, Kind.Stable, Kind.Watchtower, Kind.Blacksmith };
        static readonly int[] SOLDIER_MAKERS = { Kind.Barracks, Kind.ArcheryRange, Kind.Stable };

        /// <summary>How far from home an enemy counts as a threat to the town, in tiles.</summary>
        const int THREAT_RADIUS = 18;
        /// <summary>How far it will send villagers for berries, trees and stone.</summary>
        const int WORK_RADIUS = 22;
        /// <summary>Woodcutters walking further than this to hand in want a lumber camp by the trees.</summary>
        const int LONG_WALK = 5;
        /// <summary>Farms it has before it wants a mill among them.</summary>
        const int FARMS_BEFORE_MILL = 6;

        sealed class KnownBuilding
        {
            public int id;
            public int kind;
            public int x;
            public int y;
        }

        static int FixedOf(int tile) => (tile << 16) + 0x8000;
        static int TileX(World world, int slot) => world.posX[slot] >> 16;
        static int TileY(World world, int slot) => world.posY[slot] >> 16;
        static int Far(int ax, int ay, int bx, int by) => Math.Max(Math.Abs(ax - bx), Math.Abs(ay - by));

        public readonly int player;
        public readonly Difficulty difficulty;
        readonly Tuning tuning;

        // ---- What it remembers from one look to the next ---------------------------
        /// <summary>Where its town is: the town centre, or wherever it last stood.</summary>
        Point home = null;
        /// <summary>
        /// Enemy buildings it has seen and not since seen gone, in the order it
        /// first saw them. The order matters (the first of two equally near is the
        /// one marched on), so this is a list, with a set beside it only to ask
        /// whether a building is already known.
        /// </summary>
        readonly List<KnownBuilding> known = new List<KnownBuilding>();
        readonly HashSet<int> knownIds = new HashSet<int>();
        /// <summary>How many of each kind of enemy soldier it has lately seen, fading with time. A decimal, as in the TypeScript.</summary>
        readonly double[] enemyMix = new double[ENTITY_TYPES.Length];
        Mode mode = Mode.Gather;
        int waveSize;
        int waveStart = 0;
        /// <summary>The soldiers who set out on the present attack. Those trained since wait at home to follow in a body. Asked only whether a soldier is in it.</summary>
        readonly HashSet<int> wave = new HashSet<int>();
        Point target = null;
        int scout = -1;
        bool scouted = false;
        int scoutSentAt = 0;
        /// <summary>Looks since anything threatened the town.</summary>
        int quiet = 0;

        // ---- The world as of this look ----------------------------------------------
        World world;
        List<Command> orders = new List<Command>();
        int[] purse = { 0, 0, 0, 0 };
        List<int> villagers = new List<int>();
        List<int> soldiers = new List<int>();
        List<int> idle = new List<int>();
        /// <summary>Finished buildings by kind, each list in slot order.</summary>
        readonly List<int>[] done = new List<int>[ENTITY_TYPES.Length];
        /// <summary>How many kinds of finished building it has, and the first finished building in slot order (-1 for none).</summary>
        int doneKinds = 0;
        int firstDone = -1;
        List<int> sites = new List<int>();
        int[] gathering = { 0, 0, 0, 0 };
        int berryPickers = 0;
        /// <summary>The farms being worked, and the villagers already given something to do this look. Asked only whether something is in them.</summary>
        HashSet<int> farmed = new HashSet<int>();
        HashSet<int> claimed = new HashSet<int>();
        List<int> threats = new List<int>();
        /// <summary>What is being put by for a building or reform it wants and cannot yet pay for, by resource.</summary>
        int[] saving = { 0, 0, 0, 0 };

        public SkirmishAi(int player, Difficulty difficulty = Difficulty.Standard)
        {
            this.player = player;
            this.difficulty = difficulty;
            tuning = TuningFor(difficulty);
            waveSize = tuning.firstAttack;
            for (int kind = 0; kind < done.Length; kind++) done[kind] = new List<int>();
        }

        /// <summary>What it is up to, for tests and for anyone watching it play.</summary>
        public AiStatus Status()
        {
            return new AiStatus
            {
                mode = mode,
                waveSize = waveSize,
                target = target,
                knownBuildings = known.Count,
                scouting = scout != -1,
            };
        }

        public List<Command> Act(World world)
        {
            // Math.round in the TypeScript: halves go up.
            int every = Math.Max(1, (int)Math.Floor(tuning.thinkSeconds * world.config.tickRate + 0.5));
            // Players think on different ticks, so their orders do not all land at once.
            if (world.tick % every != (player * 7) % every) return new List<Command>();
            this.world = world;
            orders = new List<Command>();
            TakeStock();
            if (villagers.Count + soldiers.Count + doneKinds + sites.Count == 0) return new List<Command>();
            LookForTheEnemy();
            RunTheTown();
            RunTheArmy();
            return orders;
        }

        // ---- Looking ----------------------------------------------------------------

        /// <summary>Counts up what it has and what its villagers are doing.</summary>
        void TakeStock()
        {
            villagers = new List<int>();
            soldiers = new List<int>();
            idle = new List<int>();
            for (int kind = 0; kind < done.Length; kind++) done[kind].Clear();
            doneKinds = 0;
            firstDone = -1;
            sites = new List<int>();
            gathering = new[] { 0, 0, 0, 0 };
            berryPickers = 0;
            farmed = new HashSet<int>();
            claimed = new HashSet<int>();
            purse = new int[4];
            Array.Copy(world.stock, player * 4, purse, 0, 4);
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.owner[slot] != player) continue;
                int kind = world.entityType[slot];
                if (world.mobile[slot] == 0)
                {
                    if (world.built[slot] == 0) sites.Add(slot);
                    else
                    {
                        if (done[kind].Count == 0) doneKinds++;
                        if (firstDone == -1) firstDone = slot;
                        done[kind].Add(slot);
                    }
                    continue;
                }
                if (kind != Kind.Villager)
                {
                    soldiers.Add(slot);
                    continue;
                }
                villagers.Add(slot);
                int job = world.job[slot];
                if (job == Job.ToResource || job == Job.Harvesting || job == Job.ToDropOff)
                {
                    int terrain = world.jobTerrain[slot];
                    int resource = terrain == Terrain.Forest ? Resource.Wood : terrain == Terrain.Stone ? Resource.Stone : terrain == Terrain.Gold ? Resource.Gold : Resource.Food;
                    gathering[resource]++;
                    if (terrain == Terrain.Berries) berryPickers++;
                    if (terrain == Terrain.Field && world.jobTile[slot] >= 0) farmed.Add(world.jobTile[slot]);
                }
                else if (job == Job.None && world.moveState[slot] == MoveState.Idle && world.engaged[slot] == 0)
                {
                    idle.Add(slot);
                }
            }
            int hall = First(Kind.TownCentre);
            if (hall != -1) home = new Point(TileX(world, hall), TileY(world, hall));
            else if (home == null)
            {
                int first = villagers.Count > 0 ? villagers[0] : soldiers.Count > 0 ? soldiers[0] : sites.Count > 0 ? sites[0] : firstDone;
                if (first != -1) home = new Point(TileX(world, first), TileY(world, first));
            }
        }

        /// <summary>The first finished building of a kind, or -1.</summary>
        int First(int kind)
        {
            return done[kind].Count > 0 ? done[kind][0] : -1;
        }

        int Count(int kind)
        {
            return done[kind].Count;
        }

        int SiteCount(int kind)
        {
            int n = 0;
            foreach (int slot in sites) if (world.entityType[slot] == kind) n++;
            return n;
        }

        /// <summary>Notes the enemy in sight: buildings to remember, soldiers to counter, raiders to drive off.</summary>
        void LookForTheEnemy()
        {
            threats = new List<int>();
            // A decimal, as in the TypeScript: what it has seen fades a little with every look.
            for (int kind = 0; kind < enemyMix.Length; kind++) enemyMix[kind] = enemyMix[kind] * 0.985;
            var inSight = new int[ENTITY_TYPES.Length];
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || !world.Hostile(player, world.owner[slot]) || !Vision.CanSee(world, player, slot)) continue;
                int x = TileX(world, slot);
                int y = TileY(world, slot);
                if (world.mobile[slot] == 0)
                {
                    int id = world.IdAt(slot);
                    if (knownIds.Add(id)) known.Add(new KnownBuilding { id = id, kind = world.entityType[slot], x = x, y = y });
                    continue;
                }
                int kind = world.entityType[slot];
                if (kind != Kind.Villager) inSight[kind]++;
                if (home != null && Far(x, y, home.x, home.y) <= THREAT_RADIUS) threats.Add(slot);
            }
            for (int kind = 0; kind < inSight.Length; kind++)
            {
                if (inSight[kind] > 0) enemyMix[kind] = Math.Max(enemyMix[kind], inSight[kind]);
            }
            // A remembered building is forgotten once its place is in view and it is not there.
            for (int i = 0; i < known.Count; i++)
            {
                KnownBuilding building = known[i];
                if (!world.IsAlive(building.id) && Vision.Sees(world, player, building.y * world.map.width + building.x))
                {
                    knownIds.Remove(building.id);
                    known.RemoveAt(i);
                    i--;
                }
            }
        }

        // ---- Giving orders ----------------------------------------------------------

        bool CanAfford(int[] cost)
        {
            for (int r = 0; r < cost.Length; r++) if (purse[r] < cost[r]) return false;
            return true;
        }

        void Spend(int[] cost)
        {
            for (int r = 0; r < cost.Length; r++) purse[r] = purse[r] - cost[r];
        }

        int[] Ids(List<int> slots)
        {
            var ids = new int[slots.Count];
            for (int i = 0; i < ids.Length; i++) ids[i] = world.IdAt(slots[i]);
            return ids;
        }

        int[] Ids(int slot)
        {
            return new[] { world.IdAt(slot) };
        }

        /// <summary>
        /// A free plot for a building: the nearest to a point, no closer than
        /// `inner` tiles and no further than `outer`, with a tile's width clear of
        /// other buildings all round so that nothing gets walled in. Of the plots
        /// at the same distance it takes the one nearest `toward`, if given.
        /// </summary>
        Point FindPlot(int kind, Point near, int inner, int outer, Point toward = null)
        {
            GameMap map = world.map;
            int reach = (ENTITY_TYPES[kind].footprint >> 1) + 1;
            bool LanesClear(int tx, int ty)
            {
                for (int y = ty - reach; y <= ty + reach; y++)
                {
                    for (int x = tx - reach; x <= tx + reach; x++)
                    {
                        if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
                        if (map.blocked[y * map.width + x] == 1) return false;
                    }
                }
                return true;
            }
            for (int r = inner; r <= outer; r++)
            {
                Point best = null;
                int bestScore = 0;
                for (int dy = -r; dy <= r; dy++)
                {
                    for (int dx = -r; dx <= r; dx++)
                    {
                        if (Math.Max(Math.Abs(dx), Math.Abs(dy)) != r) continue;
                        int tx = near.x + dx;
                        int ty = near.y + dy;
                        if (!Buildings.CanPlace(world, kind, tx, ty, player) || !LanesClear(tx, ty)) continue;
                        int score = toward == null ? 0 : Far(tx, ty, toward.x, toward.y);
                        if (best == null || score < bestScore)
                        {
                            best = new Point(tx, ty);
                            bestScore = score;
                        }
                    }
                }
                if (best != null) return best;
            }
            return null;
        }

        /// <summary>The villager best spared for a building job near a point: an idle one, else one cutting wood.</summary>
        int TakeBuilder(Point near)
        {
            int best = -1;
            int bestScore = 0;
            foreach (int slot in villagers)
            {
                if (claimed.Contains(slot)) continue;
                int job = world.job[slot];
                if (job == Job.ToSite || job == Job.Constructing) continue;
                bool standing = idle.Contains(slot);
                bool felling = world.jobTerrain[slot] == Terrain.Forest && job != Job.None;
                // Idle hands first, then woodcutters, then anyone; nearer is better within each.
                int score = (standing ? 0 : felling ? 1000 : 2000) + Far(TileX(world, slot), TileY(world, slot), near.x, near.y);
                if (best == -1 || score < bestScore)
                {
                    best = slot;
                    bestScore = score;
                }
            }
            if (best != -1) claimed.Add(best);
            return best;
        }

        /// <summary>Founds a building and sets villagers to it. Returns whether it could.</summary>
        bool Build(int kind, Point near, int inner, int outer, int builders, Point toward = null)
        {
            EntityType type = world.types[player][kind];
            if (world.age[player] < type.age || !CanAfford(type.cost)) return false;
            Point plot = FindPlot(kind, near, inner, outer, toward);
            if (plot == null) return false;
            var crew = new List<int>();
            for (int i = 0; i < builders; i++)
            {
                int builder = TakeBuilder(plot);
                if (builder != -1) crew.Add(builder);
            }
            if (crew.Count == 0) return false;
            Spend(type.cost);
            orders.Add(Command.Build(Ids(crew), kind, plot.x, plot.y));
            return true;
        }

        /// <summary>The region of ground the town stands on, or 0 if there is no telling.</summary>
        int HomeRegion()
        {
            if (home == null) return 0;
            GameMap map = world.map;
            int tile = map.NearestPassable(home.x, home.y);
            return tile == -1 ? 0 : map.region[tile];
        }

        /// <summary>The nearest tile of a resource to a point that the side has explored and a villager can stand beside.</summary>
        int NearestResource(int terrain, Point near, int radius)
        {
            GameMap map = world.map;
            int region = HomeRegion();
            return map.NearestTile(
                near.x,
                near.y,
                radius,
                tile =>
                    map.terrain[tile] == terrain &&
                    map.amount[tile] > 0 &&
                    Vision.HasExplored(world, player, tile) &&
                    map.CanBeWorkedFrom(tile, region));
        }

        // ---- The town ---------------------------------------------------------------

        void RunTheTown()
        {
            Point home = this.home;
            if (home == null) return;
            Population population = Production.CountPopulation(world);
            int used = population.used[player];
            int room = population.room[player];
            int workers = villagers.Count;
            Point enemy = EnemyStart() ?? new Point(world.map.width - 1 - home.x, world.map.height - 1 - home.y);

            // More villagers, one in the making at a time.
            int hall = First(Kind.TownCentre);
            if (hall != -1 && world.trainLength[hall] == 0 && workers < tuning.villagers && used < room)
            {
                Train(hall, Kind.Villager);
            }

            // A house before the town is full.
            int forges = 0;
            foreach (int kind in MILITARY_BUILDINGS) forges += Count(kind);
            if (room - used <= 2 + forges && room < POPULATION_LIMIT && SiteCount(Kind.House) == 0)
            {
                // Behind the town, away from the enemy.
                Build(Kind.House, home, 5, 14, 1, new Point(2 * home.x - enemy.x, 2 * home.y - enemy.y));
            }

            // Military buildings, one at a time so the town is not starved to pay
            // for them. If the next one cannot be afforded yet, wood is put by for it
            // instead of all going on soldiers.
            saving = new[] { 0, 0, 0, 0 };
            int age = world.age[player];
            bool building = false;
            foreach (int slot in sites) if (Array.IndexOf(MILITARY_BUILDINGS, (int)world.entityType[slot]) >= 0) building = true;
            if (!building)
            {
                int next = -1;
                int builders = 2;
                if (workers >= tuning.barracksAt && Count(Kind.Barracks) == 0) next = Kind.Barracks;
                else if (workers >= tuning.rangeAt && Count(Kind.ArcheryRange) == 0) next = Kind.ArcheryRange;
                else if (workers >= tuning.stableAt && Count(Kind.Stable) == 0) next = Kind.Stable;
                else if (age >= 1 && workers >= 18 && Count(Kind.Blacksmith) == 0) next = Kind.Blacksmith;
                else if (Count(Kind.Watchtower) < tuning.towers && workers >= 14 && purse[Resource.Stone] >= 50)
                {
                    next = Kind.Watchtower;
                    builders = 1;
                }
                else if (tuning.doubles && workers >= 26)
                {
                    foreach (int kind in SOLDIER_MAKERS)
                    {
                        if (Count(kind) == 1)
                        {
                            next = kind;
                            break;
                        }
                    }
                }
                if (next != -1)
                {
                    int near = next == Kind.Watchtower ? 5 : 7;
                    if (!Build(next, home, near, near + 10, builders, enemy)) saving = (int[])world.types[player][next].cost.Clone();
                }
            }
            Advance(workers);

            // A site nobody is working on gets a builder.
            foreach (int site in sites)
            {
                int id = world.IdAt(site);
                bool crewed = false;
                foreach (int slot in villagers)
                {
                    if (world.jobTarget[slot] == id && (world.job[slot] == Job.ToSite || world.job[slot] == Job.Constructing)) crewed = true;
                }
                if (crewed) continue;
                int builder = TakeBuilder(new Point(TileX(world, site), TileY(world, site)));
                if (builder != -1) orders.Add(Command.Construct(Ids(builder), id));
            }

            ShareOutTheWork(home);
            TrainSoldiers(used, room);

            // New soldiers gather in front of the town.
            Point muster = MusterPoint(home, enemy);
            var unset = new List<int>();
            foreach (int kind in SOLDIER_MAKERS)
            {
                foreach (int slot in done[kind]) if (world.rallyX[slot] < 0) unset.Add(world.IdAt(slot));
            }
            if (unset.Count > 0) orders.Add(Command.Rally(unset.ToArray(), FixedOf(muster.x), FixedOf(muster.y)));
        }

        bool Train(int building, int kind)
        {
            int[] cost = world.types[player][kind].cost;
            if (world.trainLength[building] >= TRAIN_QUEUE_LENGTH || !CanAfford(cost)) return false;
            Spend(cost);
            orders.Add(Command.Train(world.IdAt(building), kind));
            return true;
        }

        /// <summary>
        /// Progress: a reform when the town is big enough to bear it, and whatever
        /// research its buildings offer. A reform it cannot yet pay for is saved
        /// toward, ahead of soldiers.
        /// </summary>
        void Advance(int workers)
        {
            int age = world.age[player];
            int hall = First(Kind.TownCentre);
            if (age < tuning.lastAge && hall != -1 && workers >= tuning.ageAt[age])
            {
                int reform = REFORMS[age];
                string why = WhyNot(world, player, reform);
                if (why == null)
                {
                    int[] cost = TECHS[reform].cost;
                    if (world.trainLength[hall] < 2 && CanAfford(cost))
                    {
                        Spend(cost);
                        orders.Add(Command.Research(world.IdAt(hall), reform));
                        return;
                    }
                    // Not enough yet. Put it by, on top of anything already being saved for.
                    var more = new int[saving.Length];
                    for (int r = 0; r < more.Length; r++) more[r] = saving[r] + cost[r];
                    saving = more;
                }
            }
            // Research, one thing each look, out of what is not being saved for something bigger.
            if (threats.Count > 0) return;
            foreach (int id in RESEARCH_ORDER)
            {
                Tech tech = TECHS[id];
                int at = -1;
                foreach (int slot in done[tech.at])
                {
                    if (world.trainLength[slot] == 0)
                    {
                        at = slot;
                        break;
                    }
                }
                if (at == -1 || !CanAfford(tech.cost) || WhyNot(world, player, id) != null) continue;
                // What makes the villagers work faster pays for itself and is bought
                // whenever there is the money. The rest waits until nothing bigger is
                // being saved for.
                bool pays = id == TechId.Wheelbarrow;
                foreach (Effect effect in tech.effects) if (effect.kind == EffectKind.Gather) pays = true;
                if (!pays && CutsIntoSavings(tech.cost, saving)) continue;
                // Either way, enough food is left that the town does not stop growing for it.
                if (purse[Resource.Food] - tech.cost[Resource.Food] < 50) continue;
                Spend(tech.cost);
                orders.Add(Command.Research(world.IdAt(at), id));
                return;
            }
        }

        /// <summary>Whether paying a cost would leave less of some resource than is being put by.</summary>
        bool CutsIntoSavings(int[] cost, int[] saving)
        {
            for (int r = 0; r < cost.Length; r++)
            {
                if (cost[r] > 0 && purse[r] - cost[r] < saving[r]) return true;
            }
            return false;
        }

        /// <summary>Where the army gathers: a few tiles out from the town on the enemy's side.</summary>
        Point MusterPoint(Point home, Point enemy)
        {
            GameMap map = world.map;
            int dx = Math.Sign(enemy.x - home.x);
            int dy = Math.Sign(enemy.y - home.y);
            int x = Math.Min(map.width - 2, Math.Max(1, home.x + dx * 9));
            int y = Math.Min(map.height - 2, Math.Max(1, home.y + dy * 9));
            int near = map.NearestPassable(home.x, home.y);
            int region = near == -1 ? 0 : map.region[near];
            int tile = map.NearestPassable(x, y, region, 12);
            return tile == -1 ? home : new Point(tile % map.width, Fixed.Idiv(tile, map.width));
        }

        /// <summary>Puts idle villagers to work and keeps the split between food, wood and stone about right.</summary>
        void ShareOutTheWork(Point home)
        {
            int workers = villagers.Count;
            if (workers == 0) return;

            // How many should be on each. Mostly food, which everything costs; more
            // wood when the stores are short of it, and two on stone if a tower is wanted.
            int food = purse[Resource.Food];
            int wood = purse[Resource.Wood];
            int stoneTile = Count(Kind.Watchtower) < tuning.towers && workers >= 14 && purse[Resource.Stone] < 50 ? NearestResource(Terrain.Stone, home, WORK_RADIUS) : -1;
            int onStone = stoneTile == -1 ? 0 : 2;
            // Gold pays for reforms, research and armour. It is mined from the time
            // the town is on its feet, and left alone once there is plenty in hand.
            int goldTile = workers >= 10 && purse[Resource.Gold] < 500 + saving[Resource.Gold] ? NearestResource(Terrain.Gold, home, WORK_RADIUS) : -1;
            int onGold = goldTile == -1 ? 0 : Math.Min(tuning.goldMiners, Math.Max(2, (workers - 8) >> 1));
            int hands = workers - onStone - onGold;
            // A decimal, as in the TypeScript: the share of the remaining hands that gather food.
            double share = food > wood + 150 ? 0.4 : wood > food + 150 ? 0.7 : 0.55;
            int onFood = Math.Min(hands, (int)Math.Ceiling(hands * share));
            int[] wanted = { onFood, hands - onFood, onStone, onGold };
            WantMiningCamp(home, goldTile, onGold);

            Point woodFrom = WoodAnchor(home);
            int woodTile = NearestResource(Terrain.Forest, woodFrom, WORK_RADIUS);
            WantLumberCamp(home, woodTile);

            // Where food can come from: berry bushes with room, then farms without a farmer.
            int berryTile = NearestResource(Terrain.Berries, home, WORK_RADIUS);
            int berryRoom = berryTile == -1 ? 0 : Math.Max(0, BerryBushes(home) * 2 - berryPickers);
            var freeFarms = new List<int>();
            foreach (int farm in done[Kind.Farm])
            {
                int middle = TileY(world, farm) * world.map.width + TileX(world, farm);
                if (!farmed.Contains(middle)) freeFarms.Add(middle);
            }

            // A mill in among the farms once there are several, so the outer ones are not a long walk from the stores.
            int farms = Count(Kind.Farm);
            int mills = Count(Kind.Mill) + SiteCount(Kind.Mill);
            if (farms >= FARMS_BEFORE_MILL * (mills + 1)) Build(Kind.Mill, FoodAnchor(home), 8, 16, 1);

            bool GiveWork(int slot, int resource)
            {
                int[] unit = Ids(slot);
                if (resource == Resource.Wood)
                {
                    if (woodTile == -1) return false;
                    orders.Add(Command.Gather(unit, woodTile));
                    return true;
                }
                if (resource == Resource.Stone)
                {
                    if (stoneTile == -1) return false;
                    orders.Add(Command.Gather(unit, stoneTile));
                    return true;
                }
                if (resource == Resource.Gold)
                {
                    if (goldTile == -1) return false;
                    orders.Add(Command.Gather(unit, goldTile));
                    return true;
                }
                if (berryRoom > 0)
                {
                    berryRoom--;
                    orders.Add(Command.Gather(unit, berryTile));
                    return true;
                }
                if (freeFarms.Count > 0)
                {
                    int farm = freeFarms[freeFarms.Count - 1];
                    freeFarms.RemoveAt(freeFarms.Count - 1);
                    orders.Add(Command.Gather(unit, farm));
                    return true;
                }
                // No farm free: plant one. Whoever plants it farms it.
                int[] cost = world.types[player][Kind.Farm].cost;
                if (!CanAfford(cost)) return false;
                Point plot = FindPlot(Kind.Farm, FoodAnchor(home), 3, 14);
                if (plot == null) return false;
                Spend(cost);
                orders.Add(Command.Build(unit, Kind.Farm, plot.x, plot.y));
                return true;
            }

            // The berries will not last. Plant ahead: when what is left on the bushes
            // would feed the pickers for under two minutes, put one of them to
            // planting a farm each look that there is wood to spare for it.
            if (berryPickers > 0 && BerryFood(home) < berryPickers * 90 && purse[Resource.Wood] >= 125 + saving[Resource.Wood])
            {
                int picker = -1;
                foreach (int slot in villagers)
                {
                    if (!claimed.Contains(slot) && world.jobTerrain[slot] == Terrain.Berries && world.job[slot] == Job.Harvesting)
                    {
                        picker = slot;
                        break;
                    }
                }
                if (picker != -1)
                {
                    int room = berryRoom;
                    berryRoom = 0;
                    if (GiveWork(picker, Resource.Food)) claimed.Add(picker);
                    berryRoom = room;
                }
            }

            int[] have = (int[])gathering.Clone();
            int MostNeeded()
            {
                int best = Resource.Food;
                for (int resource = Resource.Wood; resource <= Resource.Gold; resource++)
                {
                    if (wanted[resource] - have[resource] > wanted[best] - have[best]) best = resource;
                }
                return best;
            }
            var order = new List<int>(3);
            foreach (int slot in idle)
            {
                if (claimed.Contains(slot)) continue;
                int first = MostNeeded();
                // If there is no way to do the job most needed, any honest work will do.
                order.Clear();
                order.Add(first);
                if (!order.Contains(Resource.Wood)) order.Add(Resource.Wood);
                if (!order.Contains(Resource.Food)) order.Add(Resource.Food);
                foreach (int resource in order)
                {
                    if (!GiveWork(slot, resource)) continue;
                    have[resource]++;
                    claimed.Add(slot);
                    break;
                }
            }

            // One villager moves across each look if the split has drifted well off:
            // from whatever has most to spare to whatever is most short.
            int from = -1;
            for (int resource = Resource.Food; resource <= Resource.Gold; resource++)
            {
                int spare = have[resource] - wanted[resource];
                int enough = wanted[resource] == 0 ? 1 : 2;
                if (spare >= enough && (from == -1 || spare > have[from] - wanted[from])) from = resource;
            }
            int to = MostNeeded();
            if (from == -1 || from == to || wanted[to] - have[to] < 1) return;
            int mover = -1;
            foreach (int slot in villagers)
            {
                int job = world.job[slot];
                if (claimed.Contains(slot) || (job != Job.Harvesting && job != Job.ToResource)) continue;
                int terrain = world.jobTerrain[slot];
                bool fits;
                if (from == Resource.Wood) fits = terrain == Terrain.Forest;
                else if (from == Resource.Stone) fits = terrain == Terrain.Stone;
                else if (from == Resource.Gold) fits = terrain == Terrain.Gold;
                else fits = terrain == Terrain.Berries || terrain == Terrain.Field;
                if (fits)
                {
                    mover = slot;
                    break;
                }
            }
            if (mover == -1) return;
            // If the work most needed cannot be had just now, wood always can.
            if (GiveWork(mover, to) || (from != Resource.Wood && GiveWork(mover, Resource.Wood))) claimed.Add(mover);
        }

        /// <summary>How much food is left on the berry bushes within reach of home.</summary>
        int BerryFood(Point home)
        {
            GameMap map = world.map;
            int food = 0;
            for (int y = Math.Max(0, home.y - 14); y <= Math.Min(map.height - 1, home.y + 14); y++)
            {
                for (int x = Math.Max(0, home.x - 14); x <= Math.Min(map.width - 1, home.x + 14); x++)
                {
                    int tile = y * map.width + x;
                    if (map.terrain[tile] == Terrain.Berries && Vision.HasExplored(world, player, tile)) food += map.amount[tile];
                }
            }
            return food;
        }

        /// <summary>How many berry bushes within reach of home still have fruit.</summary>
        int BerryBushes(Point home)
        {
            GameMap map = world.map;
            int n = 0;
            for (int y = Math.Max(0, home.y - 14); y <= Math.Min(map.height - 1, home.y + 14); y++)
            {
                for (int x = Math.Max(0, home.x - 14); x <= Math.Min(map.width - 1, home.x + 14); x++)
                {
                    int tile = y * map.width + x;
                    if (map.terrain[tile] == Terrain.Berries && map.amount[tile] > 0 && Vision.HasExplored(world, player, tile)) n++;
                }
            }
            return n;
        }

        /// <summary>Where woodcutters hand in: the lumber camp built last, or the town centre.</summary>
        Point WoodAnchor(Point home)
        {
            List<int> camps = done[Kind.LumberCamp];
            if (camps.Count == 0) return home;
            int camp = camps[camps.Count - 1];
            return new Point(TileX(world, camp), TileY(world, camp));
        }

        /// <summary>Farms go round the newest mill once there are enough of them to need one, else round the town centre.</summary>
        Point FoodAnchor(Point home)
        {
            List<int> mills = done[Kind.Mill];
            if (mills.Count == 0) return home;
            int mill = mills[mills.Count - 1];
            return new Point(TileX(world, mill), TileY(world, mill));
        }

        /// <summary>Builds a lumber camp by the trees when the nearest drop-off is a long walk from them.</summary>
        void WantLumberCamp(Point home, int woodTile)
        {
            if (woodTile == -1 || SiteCount(Kind.LumberCamp) > 0 || gathering[Resource.Wood] < 3) return;
            var trees = new Point(woodTile % world.map.width, Fixed.Idiv(woodTile, world.map.width));
            int nearest = Far(trees.x, trees.y, home.x, home.y);
            foreach (int camp in done[Kind.LumberCamp])
            {
                nearest = Math.Min(nearest, Far(trees.x, trees.y, TileX(world, camp), TileY(world, camp)));
            }
            if (nearest > LONG_WALK) Build(Kind.LumberCamp, trees, 2, 6, 1, home);
        }

        /// <summary>Builds a mining camp by the gold when the miners have a long walk home with it.</summary>
        void WantMiningCamp(Point home, int goldTile, int miners)
        {
            if (goldTile == -1 || miners < 2 || SiteCount(Kind.MiningCamp) > 0) return;
            var ore = new Point(goldTile % world.map.width, Fixed.Idiv(goldTile, world.map.width));
            int nearest = Far(ore.x, ore.y, home.x, home.y);
            foreach (int camp in done[Kind.MiningCamp])
            {
                nearest = Math.Min(nearest, Far(ore.x, ore.y, TileX(world, camp), TileY(world, camp)));
            }
            if (nearest > LONG_WALK) Build(Kind.MiningCamp, ore, 2, 6, 1, home);
        }

        /// <summary>Keeps the military buildings training, leaning toward what the army is short of.</summary>
        void TrainSoldiers(int used, int room)
        {
            // The town comes first: while it is still growing, soldiers get only what is left over.
            bool growing = villagers.Count < tuning.villagers;
            int reserve = growing ? 50 : 0;
            var have = new int[ENTITY_TYPES.Length];
            int total = 0;
            foreach (int slot in soldiers) have[world.entityType[slot]]++;
            var makers = new List<int>();
            foreach (int building in SOLDIER_MAKERS)
            {
                foreach (int slot in done[building])
                {
                    for (int k = 0; k < world.trainLength[slot]; k++)
                    {
                        int queued = world.trainQueue[slot * TRAIN_QUEUE_LENGTH + k] - 1;
                        if (queued >= 0 && queued < ENTITY_TYPES.Length) have[queued]++;
                    }
                    if (world.trainLength[slot] == 0) makers.Add(slot);
                }
            }
            foreach (int n in have) total += n;
            if (total >= tuning.army || used >= room) return;

            // What it would like the army to be made of: a balance, shifted toward
            // whatever beats the enemy soldiers it has seen.
            EntityType[] types = world.types[player];
            int age = world.age[player];
            // Saving for a building or a reform must not leave the town naked: money
            // is held back from soldiers only once there is a garrison of six, and
            // never with raiders in the town.
            int[] saving = threats.Count > 0 || total < Math.Min(6, waveSize) ? new[] { 0, 0, 0, 0 } : this.saving;
            bool rich = purse[Resource.Gold] > 250 + saving[Resource.Gold];
            // Decimals, as in the TypeScript: how much it wants one more of a kind of soldier.
            double Weight(int kind)
            {
                // With gold to spare, it goes on the soldiers gold buys.
                double w = Likes(kind) * (rich && types[kind].cost[Resource.Gold] > 0 ? 2 : 1);
                if (tuning.counters) foreach (int victim in Beats(kind)) w += 1.5 * enemyMix[victim];
                return w / (have[kind] + 1);
            }
            foreach (int maker in makers)
            {
                if (total >= tuning.army) break;
                // Of what this building trains in this age and the purse will stretch to, the kind the army is shortest of.
                int best = -1;
                foreach (int kind in world.TypeOf(maker).trains)
                {
                    int[] cost = types[kind].cost;
                    if (types[kind].age > age || !CanAfford(cost)) continue;
                    if (purse[Resource.Food] - cost[Resource.Food] < reserve) continue;
                    if (CutsIntoSavings(cost, saving)) continue;
                    if (best == -1 || Weight(kind) > Weight(best)) best = kind;
                }
                if (best != -1 && Train(maker, best))
                {
                    have[best]++;
                    total++;
                }
            }
        }

        // ---- The army ---------------------------------------------------------------

        /// <summary>The nearest place an enemy's town may have started: a guess at where to find them.</summary>
        Point EnemyStart()
        {
            Point best = null;
            int bestDistance = 0;
            for (int other = 0; other < world.config.playerCount; other++)
            {
                if (other >= world.map.starts.Length || !world.Hostile(player, other)) continue;
                StartPosition start = world.map.starts[other];
                var at = new Point(start.x >> 16, start.y >> 16);
                int distance = home == null ? 0 : Far(at.x, at.y, home.x, home.y);
                if (best == null || distance < bestDistance)
                {
                    best = at;
                    bestDistance = distance;
                }
            }
            return best;
        }

        bool AtEase(int slot)
        {
            return world.orderKind[slot] == OrderKind.None && world.engaged[slot] == 0;
        }

        void RunTheArmy()
        {
            Point home = this.home;
            if (home == null) return;
            Point enemy = EnemyStart();

            // One soldier rides out early to find the enemy town.
            if (!world.IsAlive(scout)) scout = -1;
            if (!scouted && scout == -1 && enemy != null && soldiers.Count > 0 && world.tick > 45 * world.config.tickRate)
            {
                int rider = soldiers[0];
                foreach (int slot in soldiers)
                {
                    if (world.entityType[slot] == Kind.Horseman)
                    {
                        rider = slot;
                        break;
                    }
                }
                scout = world.IdAt(rider);
                scouted = true;
                scoutSentAt = world.tick;
                orders.Add(Command.Move(new[] { scout }, FixedOf(enemy.x), FixedOf(enemy.y)));
            }
            var army = new List<int>();
            foreach (int slot in soldiers) if (world.IdAt(slot) != scout) army.Add(slot);
            // The scout rejoins the army once it has had its look.
            if (scout != -1 && world.tick > scoutSentAt + 3 * world.config.tickRate)
            {
                int slot = scout & 0xfffff;
                if (world.moveState[slot] == MoveState.Idle && world.engaged[slot] == 0) scout = -1;
            }
            if (army.Count == 0)
            {
                mode = Mode.Gather;
                wave.Clear();
                return;
            }
            Point muster = MusterPoint(home, enemy ?? home);

            // Raiders at home come before anything else, unless the army is away and they are few.
            quiet = threats.Count == 0 ? quiet + 1 : 0;
            if (threats.Count > 0 && (mode != Mode.Attack || threats.Count >= 4))
            {
                int raider = threats[0];
                var at = new Point(TileX(world, raider), TileY(world, raider));
                var called = new List<int>();
                foreach (int slot in army) if (mode != Mode.Defend || AtEase(slot)) called.Add(slot);
                mode = Mode.Defend;
                wave.Clear();
                if (called.Count > 0) orders.Add(Command.AttackMove(Ids(called), FixedOf(at.x), FixedOf(at.y)));
                return;
            }
            if (mode == Mode.Defend && quiet >= 3) mode = Mode.Gather;

            // Whoever is not out on an attack waits at the mustering place.
            var marching = new List<int>();
            List<int> reserve = army;
            if (mode == Mode.Attack)
            {
                reserve = new List<int>();
                foreach (int slot in army)
                {
                    if (wave.Contains(world.IdAt(slot))) marching.Add(slot);
                    else reserve.Add(slot);
                }
            }
            if (mode == Mode.Gather && army.Count >= waveSize && world.tick >= tuning.patience * world.config.tickRate)
            {
                // Enough of them: everyone goes.
                mode = Mode.Attack;
                waveStart = army.Count;
                target = null;
                wave.Clear();
                foreach (int slot in army) wave.Add(world.IdAt(slot));
                March(army);
                return;
            }
            var strays = new List<int>();
            foreach (int slot in reserve)
            {
                if (AtEase(slot) && Far(TileX(world, slot), TileY(world, slot), muster.x, muster.y) > 7) strays.Add(slot);
            }
            if (strays.Count > 0) orders.Add(Command.Move(Ids(strays), FixedOf(muster.x), FixedOf(muster.y)));
            if (mode != Mode.Attack) return;

            // An attack that has lost two in three is broken: home, and come again stronger.
            if (marching.Count * 3 <= waveStart)
            {
                mode = Mode.Gather;
                waveSize = Math.Min(tuning.army, waveSize + tuning.attackGrowth);
                wave.Clear();
                if (marching.Count > 0) orders.Add(Command.Move(Ids(marching), FixedOf(muster.x), FixedOf(muster.y)));
                return;
            }
            // Reinforcements go out together once there are enough of them to matter, not one at a time to be picked off.
            if (reserve.Count >= Math.Max(4, waveStart >> 1) && target != null)
            {
                foreach (int slot in reserve) wave.Add(world.IdAt(slot));
                waveStart = Math.Max(waveStart, marching.Count + reserve.Count);
                orders.Add(Command.AttackMove(Ids(reserve), FixedOf(target.x), FixedOf(target.y)));
            }
            March(marching);
        }

        /// <summary>The building it knows of at a place, or null. The first it saw there, if more than one.</summary>
        KnownBuilding KnownAt(Point place)
        {
            foreach (KnownBuilding building in known)
            {
                if (building.x == place.x && building.y == place.y) return building;
            }
            return null;
        }

        /// <summary>Runs an attack already under way: where to go next, and what to do on getting there.</summary>
        void March(List<int> army)
        {
            if (army.Count == 0) return;
            Point enemy = EnemyStart();
            // Where is the army now, roughly?
            int sumX = 0;
            int sumY = 0;
            foreach (int slot in army)
            {
                sumX += TileX(world, slot);
                sumY += TileY(world, slot);
            }
            // The average, to the nearest tile, halves going up: Math.round(sum / count) in the TypeScript.
            var centre = new Point(
                Fixed.Idiv(2 * sumX + army.Count, 2 * army.Count),
                Fixed.Idiv(2 * sumY + army.Count, 2 * army.Count));

            // Pick somewhere to march on: the nearest enemy building it knows of; or
            // the enemy's start, if it has never been there; or the nearest ground it
            // has never seen, to hunt down whatever is left.
            bool stale =
                target == null ||
                (Vision.Sees(world, player, target.y * world.map.width + target.x) && KnownAt(target) == null);
            if (stale)
            {
                Point next = null;
                int nearest = 0;
                foreach (KnownBuilding building in known)
                {
                    // Farms and houses can wait: what shoots, trains and governs comes first.
                    int worth = building.kind == Kind.Farm ? 40 : building.kind == Kind.House ? 12 : 0;
                    int distance = Far(building.x, building.y, centre.x, centre.y) + worth;
                    if (next == null || distance < nearest)
                    {
                        next = new Point(building.x, building.y);
                        nearest = distance;
                    }
                }
                if (next == null && enemy != null && !Vision.HasExplored(world, player, enemy.y * world.map.width + enemy.x)) next = enemy;
                if (next == null)
                {
                    int tile = world.map.NearestTile(centre.x, centre.y, 48, t => !Vision.HasExplored(world, player, t));
                    if (tile != -1) next = new Point(tile % world.map.width, Fixed.Idiv(tile, world.map.width));
                }
                if (next == null)
                {
                    // Nothing left to find. Stand down until something turns up.
                    mode = Mode.Gather;
                    wave.Clear();
                    return;
                }
                bool changed = target == null || next.x != target.x || next.y != target.y;
                target = next;
                if (changed)
                {
                    orders.Add(Command.AttackMove(Ids(army), FixedOf(next.x), FixedOf(next.y)));
                    return;
                }
            }
            if (target == null) return;
            // At the enemy's walls with few of his soldiers about: left to
            // themselves the men would chase villagers all day, so those with blades
            // are told to pull the building down. The archers keep the defenders off.
            KnownBuilding mark = KnownAt(target);
            int defenders = 0;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0 || world.entityType[slot] == Kind.Villager) continue;
                if (!world.Hostile(player, world.owner[slot]) || !Vision.CanSee(world, player, slot)) continue;
                if (Far(TileX(world, slot), TileY(world, slot), centre.x, centre.y) <= 12) defenders++;
            }
            bool inSight = mark != null && world.IsAlive(mark.id) && Vision.CanSee(world, player, mark.id & 0xfffff);
            if (mark != null && inSight && Far(centre.x, centre.y, mark.x, mark.y) <= 12 && defenders * 3 < army.Count)
            {
                var wreckers = new List<int>();
                foreach (int slot in army)
                {
                    if (!world.TypeOf(slot).ranged && !(world.orderKind[slot] == OrderKind.AttackTarget && world.target[slot] == mark.id)) wreckers.Add(slot);
                }
                if (wreckers.Count > 0) orders.Add(Command.Attack(Ids(wreckers), mark.id));
            }
            else
            {
                // Defenders have turned up: anyone hacking at a wall turns to face them.
                var busy = new List<int>();
                foreach (int slot in army)
                {
                    if (world.orderKind[slot] == OrderKind.AttackTarget && defenders * 3 >= army.Count) busy.Add(slot);
                }
                if (busy.Count > 0) orders.Add(Command.AttackMove(Ids(busy), FixedOf(target.x), FixedOf(target.y)));
            }
            // Anyone who has stopped with the job unfinished is sent on again.
            var resting = new List<int>();
            foreach (int slot in army) if (AtEase(slot)) resting.Add(slot);
            if (resting.Count > 0)
            {
                orders.Add(Command.AttackMove(Ids(resting), FixedOf(target.x), FixedOf(target.y)));
            }
        }
    }
}
