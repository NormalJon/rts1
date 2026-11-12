// Ported from src/sim/world.ts. Keep the two in step.

using System;
using System.Collections.Generic;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    /// <summary>
    /// How much of the map each side knows to begin with. Concealed is the usual
    /// game: unexplored ground is black, and explored ground shows only what was
    /// last seen there. Explored starts with the lie of the land known. Revealed
    /// does away with hiding altogether: everyone sees everything, always.
    /// </summary>
    public enum MapState
    {
        Concealed,
        Explored,
        Revealed,
    }

    /// <summary>
    /// What each player begins with. Standard is a town centre on their start
    /// with a handful of villagers; Empty is nothing, for tests and debug pages.
    /// </summary>
    public enum StartKind
    {
        Empty,
        Standard,
    }

    public sealed class SimConfig
    {
        /// <summary>Simulation steps per second. Fixed for the whole match.</summary>
        public int tickRate = World.DEFAULT_TICK_RATE;
        public int seed = 1;
        public int playerCount = 2;
        /// <summary>
        /// Which side each player is on. Players with the same number are allies
        /// and do not fight each other. Players past the end of the list are each
        /// on their own side, so an empty list is a free-for-all.
        /// </summary>
        public int[] teams = new int[0];
        public MapState mapState = MapState.Concealed;
        /// <summary>The age every player begins in: 0 for Early Medieval, the usual game, up to 3 for Early Modern.</summary>
        public int startAge = 0;
        /// <summary>Map size in tiles.</summary>
        public int mapWidth = 64;
        public int mapHeight = 64;
        public MapSpec map = MapSpec.Flat();
        public StartKind start = StartKind.Empty;
        public int maxEntities = 8192;
        /// <summary>
        /// How many tiles pathfinding may examine per tick. Searches that need
        /// more carry on next tick, which keeps a burst of orders from stalling
        /// the game.
        /// </summary>
        public int pathBudget = 10000;

        public SimConfig Clone()
        {
            var copy = (SimConfig)MemberwiseClone();
            copy.teams = (int[])teams.Clone();
            return copy;
        }
    }

    /// <summary>What a unit is doing about getting somewhere.</summary>
    public static class MoveState
    {
        /// <summary>Standing at its post. It drifts back if pushed off it.</summary>
        public const int Idle = 0;
        /// <summary>Has an order and is waiting for its route to be worked out.</summary>
        public const int Awaiting = 1;
        /// <summary>Following its own list of waypoints.</summary>
        public const int Path = 2;
        /// <summary>Following its group's flow field.</summary>
        public const int Field = 3;
        /// <summary>Walking straight at its destination, which is in plain sight.</summary>
        public const int Direct = 4;
    }

    /// <summary>Where a gatherer is in its round trip.</summary>
    public static class Job
    {
        public const int None = 0;
        /// <summary>Walking to its place beside the resource.</summary>
        public const int ToResource = 1;
        public const int Harvesting = 2;
        /// <summary>Carrying a load to a drop-off building.</summary>
        public const int ToDropOff = 3;
        /// <summary>Walking to a building site.</summary>
        public const int ToSite = 4;
        /// <summary>At the site, building.</summary>
        public const int Constructing = 5;
    }

    /// <summary>
    /// What a unit has been told to do, which decides how it treats enemies.
    /// A unit with no orders guards the spot where it stands.
    /// </summary>
    public static class OrderKind
    {
        /// <summary>Guarding its post: fights what comes near, then goes back.</summary>
        public const int None = 0;
        /// <summary>Going where it was sent and ignoring everything on the way.</summary>
        public const int Move = 1;
        /// <summary>Going where it was sent, fighting whatever it meets, then carrying on.</summary>
        public const int AttackMove = 2;
        /// <summary>Walking to and fro between two points, fighting whatever it meets.</summary>
        public const int Patrol = 3;
        /// <summary>After one particular enemy.</summary>
        public const int AttackTarget = 4;
        /// <summary>Standing its ground: strikes at what comes within reach but never gives chase.</summary>
        public const int Hold = 5;
    }

    public static class GroupStatus
    {
        public const int New = 0;
        public const int Pending = 1;
        public const int Ready = 2;
    }

    /// <summary>
    /// A move order shared by several units. They head for the same place, so
    /// they share one flow field and line up facing the same way when they arrive.
    /// </summary>
    public sealed class MoveGroup
    {
        public int id;
        /// <summary>Where the group is headed. Moves only if a building goes up on the spot.</summary>
        public int goalTile;
        /// <summary>The way the formation faces on arrival, as a unit vector.</summary>
        public int faceX;
        public int faceY;
        /// <summary>Units for which this is the current or a queued order.</summary>
        public int refs;
        public int status;
        public byte[] field;
        public uint fieldChecksum;
    }

    /// <summary>
    /// The groups, by id, kept in the order they were made. The order is part of
    /// the state (the checksum reads them in it), so this is not a Dictionary on
    /// its own, whose order is nobody's business.
    /// </summary>
    public sealed class GroupMap
    {
        readonly Dictionary<int, MoveGroup> byId = new Dictionary<int, MoveGroup>();
        readonly List<MoveGroup> inOrder = new List<MoveGroup>();

        public int Count => inOrder.Count;

        /// <summary>The group with an id, or null.</summary>
        public MoveGroup Get(int id)
        {
            return byId.TryGetValue(id, out MoveGroup group) ? group : null;
        }

        public bool Has(int id)
        {
            return byId.ContainsKey(id);
        }

        public void Set(MoveGroup group)
        {
            if (byId.ContainsKey(group.id))
            {
                // A map keeps a key's first place when its value is replaced.
                inOrder[inOrder.FindIndex(other => other.id == group.id)] = group;
            }
            else
            {
                inOrder.Add(group);
            }
            byId[group.id] = group;
        }

        public void Delete(int id)
        {
            if (!byId.Remove(id)) return;
            inOrder.RemoveAt(inOrder.FindIndex(other => other.id == id));
        }

        /// <summary>Every group, oldest first.</summary>
        public IReadOnlyList<MoveGroup> Values => inOrder;
    }

    public enum RouteKind
    {
        Path,
        Field,
    }

    public sealed class RouteRequest
    {
        public readonly RouteKind kind;
        /// <summary>A path: whose, and the number of the order it is for.</summary>
        public readonly int slot;
        public readonly int seq;
        /// <summary>A field: which group's.</summary>
        public readonly int group;

        RouteRequest(RouteKind kind, int slot, int seq, int group)
        {
            this.kind = kind;
            this.slot = slot;
            this.seq = seq;
            this.group = group;
        }

        public static RouteRequest Path(int slot, int seq)
        {
            return new RouteRequest(RouteKind.Path, slot, seq, 0);
        }

        public static RouteRequest Field(int group)
        {
            return new RouteRequest(RouteKind.Field, 0, 0, group);
        }
    }

    /// <summary>A route search that is part-way through, with what is needed to redo it.</summary>
    public sealed class ActiveSearch
    {
        public RouteRequest request;
        /// <summary>The map's passVersion when the search began. If the map has changed since, the search starts over.</summary>
        public int mapVersion;
        public int start;
        public int goal;
        public int[] targets;
        public Search search;
    }

    /// <summary>One entity property: a name, the numbers, and how many of them each entity has.</summary>
    public abstract class Column
    {
        public readonly string name;
        /// <summary>Values per entity.</summary>
        public readonly int stride;

        protected Column(string name, int stride)
        {
            this.name = name;
            this.stride = stride;
        }

        public abstract int Length { get; }
        public abstract int Get(int index);
        /// <summary>Stores a value, cut down to the column's width as a typed array would.</summary>
        public abstract void Set(int index, int value);
        public abstract void Clear(int from, int to);
    }

    public sealed class ByteColumn : Column
    {
        public readonly byte[] data;

        public ByteColumn(string name, byte[] data, int stride) : base(name, stride)
        {
            this.data = data;
        }

        public override int Length => data.Length;
        public override int Get(int index) => data[index];
        public override void Set(int index, int value) => data[index] = unchecked((byte)value);
        public override void Clear(int from, int to) => Array.Clear(data, from, to - from);
    }

    public sealed class UShortColumn : Column
    {
        public readonly ushort[] data;

        public UShortColumn(string name, ushort[] data, int stride) : base(name, stride)
        {
            this.data = data;
        }

        public override int Length => data.Length;
        public override int Get(int index) => data[index];
        public override void Set(int index, int value) => data[index] = unchecked((ushort)value);
        public override void Clear(int from, int to) => Array.Clear(data, from, to - from);
    }

    public sealed class IntColumn : Column
    {
        public readonly int[] data;

        public IntColumn(string name, int[] data, int stride) : base(name, stride)
        {
            this.data = data;
        }

        public override int Length => data.Length;
        public override int Get(int index) => data[index];
        public override void Set(int index, int value) => data[index] = value;
        public override void Clear(int from, int to) => Array.Clear(data, from, to - from);
    }

    /// <summary>
    /// The complete state of a match.
    ///
    /// Entities live in parallel arrays ("columns"), one array per property,
    /// indexed by slot. This keeps the per-tick loops fast, and because every
    /// column is registered in one list, the checksum and the save format cover
    /// new properties automatically.
    /// </summary>
    public sealed class World
    {
        public const int DEFAULT_TICK_RATE = 30;

        /// <summary>
        /// A handle to an entity: its slot plus the slot's generation. When an
        /// entity dies its slot is reused with a new generation, so a stale handle
        /// (say, in a command issued before the unit died) no longer matches
        /// anything.
        /// </summary>
        public const int NO_ENTITY = -1;

        const int INDEX_BITS = 20;
        const int INDEX_MASK = (1 << INDEX_BITS) - 1;
        const int GENERATION_MASK = (1 << 11) - 1;
        public const int ENTITY_LIMIT = 1 << INDEX_BITS;

        public static int EntityIndex(int id)
        {
            return id & INDEX_MASK;
        }

        public static int EntityGeneration(int id)
        {
            return (int)((uint)id >> INDEX_BITS);
        }

        public const int STARTING_VILLAGERS = 6;
        static readonly int[] STARTING_STOCK = { 200, 200, 0, 100 }; // food, wood, stone, gold

        /// <summary>Orders a unit can have waiting behind its current one.</summary>
        public const int ORDER_QUEUE_LENGTH = 8;

        /// <summary>Numbers per arrow in World.shots: from x, from y, source, target, damage, tick loosed, tick it lands.</summary>
        public const int SHOT_FIELDS = 7;

        public readonly SimConfig config;
        public readonly GameMap map;
        /// <summary>Ticks simulated so far, which is also the number of the next tick to run.</summary>
        public int tick = 0;
        public readonly Rng rng;
        public readonly CommandQueue commands = new CommandQueue();

        /// <summary>One past the highest slot ever used.</summary>
        public int highWater = 0;
        /// <summary>Slots of dead entities, reused last-freed-first.</summary>
        public readonly List<int> freeSlots = new List<int>();

        readonly List<Column> columnList = new List<Column>();

        public readonly byte[] alive;
        public readonly ushort[] generation;
        public readonly byte[] owner;
        public readonly byte[] entityType;
        /// <summary>1 for units, 0 for buildings, which never move.</summary>
        public readonly byte[] mobile;
        public readonly int[] posX;
        public readonly int[] posY;
        /// <summary>Facing, as a unit vector.</summary>
        public readonly int[] dirX;
        public readonly int[] dirY;
        /// <summary>Distance covered per tick.</summary>
        public readonly int[] speed;
        public readonly int[] radius;

        public readonly byte[] moveState;
        /// <summary>Where the unit is trying to be: its destination, or its post when idle.</summary>
        public readonly int[] goalX;
        public readonly int[] goalY;
        /// <summary>The point it is walking toward right now.</summary>
        public readonly int[] steerX;
        public readonly int[] steerY;
        /// <summary>The next waypoint, when following a path.</summary>
        public readonly int[] pathIndex;
        /// <summary>The shared order it is carrying out, or 0.</summary>
        public readonly int[] group;
        /// <summary>Goes up with every new order, so a route worked out for an old one is recognised and dropped.</summary>
        public readonly int[] orderSeq;
        /// <summary>Ticks in a row without getting anywhere, and re-routes tried since.</summary>
        public readonly int[] stuck;
        public readonly byte[] retries;
        /// <summary>The nearest it has been to its destination on the final approach.</summary>
        public readonly int[] closest;

        public readonly byte[] queueLength;
        public readonly int[] queueGroup;
        public readonly int[] queueX;
        public readonly int[] queueY;

        /// <summary>Gathering: the stage of the round trip, and the resource tile being worked.</summary>
        public readonly byte[] job;
        public readonly int[] jobTile;
        /// <summary>The terrain being gathered, kept so another tile of it can be found when this one runs out.</summary>
        public readonly byte[] jobTerrain;
        /// <summary>Where it stands to work: a neighbouring tile and which half of it, as tile * 2 + side.</summary>
        public readonly int[] jobSpot;
        /// <summary>Ticks of work done toward the next unit gathered.</summary>
        public readonly int[] jobTimer;
        public readonly byte[] jobTries;
        /// <summary>The drop-off building it is heading for.</summary>
        public readonly int[] jobTarget;
        /// <summary>What it is carrying and how much.</summary>
        public readonly byte[] carryKind;
        public readonly int[] carry;

        /// <summary>Hit points left.</summary>
        public readonly int[] hp;
        /// <summary>How it is to treat enemies (see OrderKind), and the same for each order waiting in its queue.</summary>
        public readonly byte[] orderKind;
        public readonly byte[] queueKind;
        /// <summary>The enemy it is after, or NO_ENTITY, and whether it has broken off what it was doing to fight.</summary>
        public readonly int[] target;
        public readonly byte[] engaged;
        /// <summary>
        /// Where a unit goes back to when the fighting is over: its post, or the
        /// place it was marching to, with the shared order it was marching under.
        /// </summary>
        public readonly int[] homeX;
        public readonly int[] homeY;
        public readonly int[] homeGroup;
        /// <summary>Patrols: the far end of the beat.</summary>
        public readonly int[] otherX;
        public readonly int[] otherY;
        /// <summary>Ticks until the blow now being struck lands, and until another can be started.</summary>
        public readonly ushort[] windup;
        public readonly ushort[] cooldown;
        /// <summary>1 while it is planted in front of an enemy, trading blows. Comrades go round it.</summary>
        public readonly byte[] rooted;
        /// <summary>Times it has come to a halt short of its target.</summary>
        public readonly byte[] chaseTries;
        /// <summary>Riders: ticks of unbroken running, which is what makes a charge.</summary>
        public readonly ushort[] momentum;
        /// <summary>The tile it is counted as looking out from (-1 before its first look), and how far it sees from there.</summary>
        public readonly int[] sightTile;
        public readonly byte[] sightRadius;

        /// <summary>Buildings: 1 once construction is finished, and the work done toward that.</summary>
        public readonly byte[] built;
        public readonly int[] buildPoints;
        /// <summary>Buildings: the unit types waiting to be trained (each stored as type + 1), and how many.</summary>
        public readonly byte[] trainQueue;
        public readonly byte[] trainLength;
        /// <summary>Ticks spent on the unit at the head of the queue, and whether room in the population has been set aside for it.</summary>
        public readonly int[] trainTicks;
        public readonly byte[] trainStarted;
        /// <summary>Where newly trained units go: a point, or a resource tile to start work on. -1 for none.</summary>
        public readonly int[] rallyX;
        public readonly int[] rallyY;
        public readonly int[] rallyTile;

        /// <summary>Each player's stockpile: playerCount x 4, as food, wood, stone, gold.</summary>
        public readonly int[] stock;
        /// <summary>What each player has spent on units and buildings, less refunds, laid out like the stockpile.</summary>
        public readonly int[] spent;
        /// <summary>Resources that were on the backs of villagers when they were killed, by kind.</summary>
        public readonly int[] lost;
        /// <summary>Resources that came from nowhere but work: food grown on farms.</summary>
        public readonly int[] grown;
        /// <summary>Which side each player is on.</summary>
        public readonly byte[] team;

        /// <summary>The age each player has reached, and what each has researched: playerCount x the number of technologies.</summary>
        public readonly byte[] age;
        public readonly byte[] researched;
        /// <summary>
        /// Each player's units and buildings as their research has made them:
        /// types[player][kind]. Worked out from `researched`, so not saved.
        /// Anything that depends on whose a thing is reads its figures from here.
        /// </summary>
        public readonly EntityType[][] types;
        /// <summary>How much faster each player gathers from each terrain, in percent: playerCount x TERRAINS.</summary>
        public readonly int[] gatherBonus;

        /// <summary>
        /// What each side sees. Allies see as one, so this is kept per side, not
        /// per player: `view[player]` says which. For each side, `seen` counts how
        /// many of its units and buildings can see each tile, and `explored` marks
        /// every tile that has ever been seen. See Vision.cs.
        /// </summary>
        public readonly byte[] view;
        public readonly List<ushort[]> seen = new List<ushort[]>();
        public readonly List<byte[]> explored = new List<byte[]>();
        /// <summary>A running checksum of everything explored, so the world checksum need not read every tile.</summary>
        public int exploredHash = 0;

        /// <summary>
        /// Arrows in the air. Each is a row of SHOT_FIELDS numbers: where it was
        /// loosed from, who loosed it, whom it will hit, how hard, and the ticks it
        /// left and lands on. An arrow always finds its target if the target lives.
        /// </summary>
        public int[] shots;
        public int shotCount = 0;

        /// <summary>Waypoints (x, y pairs) for units following their own path; null for none.</summary>
        public readonly int[][] paths;
        public readonly GroupMap groups = new GroupMap();
        public int nextGroupId = 1;
        /// <summary>Route searches waiting their turn, oldest first.</summary>
        public readonly Queue<RouteRequest> routeQueue = new Queue<RouteRequest>();
        public ActiveSearch activeSearch = null;

        /// <summary>Working memory. Rebuilt whenever needed; never part of the saved state.</summary>
        public readonly SearchScratch searchScratch;
        public readonly int[] scratchX;
        public readonly int[] scratchY;
        public readonly int[] scratchPushX;
        public readonly int[] scratchPushY;
        public readonly byte[] scratchFlags;
        /// <summary>How many villagers have worked on each building site so far this tick.</summary>
        public readonly ushort[] scratchBuilders;
        /// <summary>Damage dealt to each entity so far this tick, taken off all at once so that two who strike together both land.</summary>
        public readonly int[] scratchDamage;
        /// <summary>The slots of this tick's buildings.</summary>
        public readonly int[] scratchBuildings;
        public int scratchBuildingCount = 0;
        public readonly int[] cellStart;
        public readonly int[] cellItems;
        /// <summary>
        /// Where a unit chasing an enemy should head, as Combat.cs last worked it
        /// out. (A pair of module-level variables in the TypeScript; kept here so
        /// that two worlds never share them.)
        /// </summary>
        public int aimX;
        public int aimY;

        /// <param name="restoring">
        /// True when a saved game is about to be loaded into this world, so the
        /// starting kit must not be placed a second time.
        /// </param>
        public World(SimConfig config, bool restoring = false)
        {
            if (config.tickRate < 1 || config.tickRate > 120)
            {
                throw new ArgumentOutOfRangeException(nameof(config), $"tickRate must be a whole number from 1 to 120, got {config.tickRate}");
            }
            if (config.maxEntities < 1 || config.maxEntities > ENTITY_LIMIT)
            {
                throw new ArgumentOutOfRangeException(nameof(config), $"maxEntities must be from 1 to {ENTITY_LIMIT}");
            }
            if (config.playerCount < 1 || config.playerCount > 8)
            {
                throw new ArgumentOutOfRangeException(nameof(config), "playerCount must be from 1 to 8");
            }
            if (config.mapWidth < 1 || config.mapHeight < 1 || config.mapWidth > 1024 || config.mapHeight > 1024)
            {
                throw new ArgumentOutOfRangeException(nameof(config), "map size must be from 1 to 1024 tiles each way");
            }
            if (config.pathBudget < 1)
            {
                throw new ArgumentOutOfRangeException(nameof(config), "pathBudget must be a positive whole number");
            }
            this.config = config;
            rng = new Rng(config.seed);
            map = MapGen.BuildMap(config.mapWidth, config.mapHeight, config.seed, config.map);

            int n = config.maxEntities;
            alive = Add("alive", new byte[n]);
            generation = Add("generation", new ushort[n]);
            owner = Add("owner", new byte[n]);
            entityType = Add("entityType", new byte[n]);
            mobile = Add("mobile", new byte[n]);
            posX = Add("posX", new int[n]);
            posY = Add("posY", new int[n]);
            dirX = Add("dirX", new int[n]);
            dirY = Add("dirY", new int[n]);
            speed = Add("speed", new int[n]);
            radius = Add("radius", new int[n]);
            moveState = Add("moveState", new byte[n]);
            goalX = Add("goalX", new int[n]);
            goalY = Add("goalY", new int[n]);
            steerX = Add("steerX", new int[n]);
            steerY = Add("steerY", new int[n]);
            pathIndex = Add("pathIndex", new int[n]);
            group = Add("group", new int[n]);
            orderSeq = Add("orderSeq", new int[n]);
            stuck = Add("stuck", new int[n]);
            retries = Add("retries", new byte[n]);
            closest = Add("closest", new int[n]);
            queueLength = Add("queueLength", new byte[n]);
            const int q = ORDER_QUEUE_LENGTH;
            queueGroup = Add("queueGroup", new int[n * q], q);
            queueX = Add("queueX", new int[n * q], q);
            queueY = Add("queueY", new int[n * q], q);
            job = Add("job", new byte[n]);
            jobTile = Add("jobTile", new int[n]);
            jobTerrain = Add("jobTerrain", new byte[n]);
            jobSpot = Add("jobSpot", new int[n]);
            jobTimer = Add("jobTimer", new int[n]);
            jobTries = Add("jobTries", new byte[n]);
            jobTarget = Add("jobTarget", new int[n]);
            carryKind = Add("carryKind", new byte[n]);
            carry = Add("carry", new int[n]);
            hp = Add("hp", new int[n]);
            orderKind = Add("orderKind", new byte[n]);
            queueKind = Add("queueKind", new byte[n * q], q);
            target = Add("target", new int[n]);
            engaged = Add("engaged", new byte[n]);
            homeX = Add("homeX", new int[n]);
            homeY = Add("homeY", new int[n]);
            homeGroup = Add("homeGroup", new int[n]);
            otherX = Add("otherX", new int[n]);
            otherY = Add("otherY", new int[n]);
            windup = Add("windup", new ushort[n]);
            cooldown = Add("cooldown", new ushort[n]);
            rooted = Add("rooted", new byte[n]);
            chaseTries = Add("chaseTries", new byte[n]);
            momentum = Add("momentum", new ushort[n]);
            sightTile = Add("sightTile", new int[n]);
            sightRadius = Add("sightRadius", new byte[n]);
            built = Add("built", new byte[n]);
            buildPoints = Add("buildPoints", new int[n]);
            trainQueue = Add("trainQueue", new byte[n * TRAIN_QUEUE_LENGTH], TRAIN_QUEUE_LENGTH);
            trainLength = Add("trainLength", new byte[n]);
            trainTicks = Add("trainTicks", new int[n]);
            trainStarted = Add("trainStarted", new byte[n]);
            rallyX = Add("rallyX", new int[n]);
            rallyY = Add("rallyY", new int[n]);
            rallyTile = Add("rallyTile", new int[n]);
            stock = new int[config.playerCount * RESOURCE_COUNT];
            spent = new int[config.playerCount * RESOURCE_COUNT];
            lost = new int[RESOURCE_COUNT];
            grown = new int[RESOURCE_COUNT];
            team = new byte[config.playerCount];
            for (int player = 0; player < config.playerCount; player++)
            {
                // Sides named in the list are numbered from 0; everyone else gets a side to themselves above those.
                team[player] = player < config.teams.Length ? (byte)(config.teams[player] & 127) : (byte)(128 + player);
            }
            shots = new int[64 * SHOT_FIELDS];
            if (config.startAge < 0 || config.startAge > 3)
            {
                throw new ArgumentOutOfRangeException(nameof(config), "startAge must be 0, 1, 2 or 3");
            }
            age = new byte[config.playerCount];
            for (int player = 0; player < config.playerCount; player++) age[player] = (byte)config.startAge;
            researched = new byte[config.playerCount * Techs.TECHS.Length];
            gatherBonus = new int[config.playerCount * Techs.TERRAINS];
            types = new EntityType[config.playerCount][];
            for (int player = 0; player < config.playerCount; player++) Techs.RebuildTypes(this, player);
            // One view for each side, numbered in the order the sides' first players come.
            view = new byte[config.playerCount];
            for (int player = 0; player < config.playerCount; player++)
            {
                int ally = 0;
                while (team[ally] != team[player]) ally++;
                if (ally < player)
                {
                    view[player] = view[ally];
                    continue;
                }
                view[player] = (byte)seen.Count;
                seen.Add(new ushort[map.tileCount]);
                explored.Add(new byte[map.tileCount]);
            }
            if (config.mapState != MapState.Concealed && !restoring) Vision.ExploreEverything(this);

            paths = new int[n][];
            searchScratch = new SearchScratch(map.tileCount);
            scratchX = new int[n];
            scratchY = new int[n];
            scratchPushX = new int[n];
            scratchPushY = new int[n];
            scratchFlags = new byte[n];
            scratchBuilders = new ushort[n];
            scratchDamage = new int[n];
            scratchBuildings = new int[n];
            // The neighbour grid uses cells two tiles across.
            int cells = ((map.width + 1) >> 1) * ((map.height + 1) >> 1);
            cellStart = new int[cells + 1];
            cellItems = new int[n];

            if (config.start == StartKind.Standard && !restoring) PlaceStartingKit();
        }

        /// <summary>A town centre on each player's start, villagers round it, and something in the stores.</summary>
        void PlaceStartingKit()
        {
            int reach = (ENTITY_TYPES[Kind.TownCentre].footprint >> 1) + 1;
            for (int player = 0; player < config.playerCount; player++)
            {
                if (player >= map.starts.Length) break;
                StartPosition start = map.starts[player];
                int tx = start.x >> 16;
                int ty = start.y >> 16;
                SpawnBuilding(player, Kind.TownCentre, tx, ty);
                Array.Copy(STARTING_STOCK, 0, stock, player * RESOURCE_COUNT, RESOURCE_COUNT);
                // Villagers line up along the side of the hall that faces the middle of the map.
                int towardCentreX = tx * 2 < map.width ? 1 : -1;
                int towardCentreY = ty * 2 < map.height ? 1 : -1;
                for (int i = 0; i < STARTING_VILLAGERS; i++)
                {
                    int along = i - (STARTING_VILLAGERS >> 1);
                    int vx = tx + towardCentreX * reach;
                    int vy = ty + towardCentreY * along;
                    if (map.IsPassable(vx, vy)) SpawnUnit(player, Kind.Villager, vx * ONE + HALF, vy * ONE + HALF);
                }
            }
        }

        byte[] Add(string name, byte[] data, int stride = 1)
        {
            columnList.Add(new ByteColumn(name, data, stride));
            return data;
        }

        ushort[] Add(string name, ushort[] data, int stride = 1)
        {
            columnList.Add(new UShortColumn(name, data, stride));
            return data;
        }

        int[] Add(string name, int[] data, int stride = 1)
        {
            columnList.Add(new IntColumn(name, data, stride));
            return data;
        }

        /// <summary>Every entity property, in a fixed order.</summary>
        public IReadOnlyList<Column> columns => columnList;

        /// <summary>Takes a free slot and wipes it, or returns -1 if the world is full.</summary>
        int ClaimSlot()
        {
            int slot;
            if (freeSlots.Count > 0)
            {
                slot = freeSlots[freeSlots.Count - 1];
                freeSlots.RemoveAt(freeSlots.Count - 1);
            }
            else
            {
                if (highWater >= config.maxEntities) return -1;
                slot = highWater++;
            }
            ushort generation = this.generation[slot];
            // Clear whatever the slot's previous occupant left behind.
            foreach (Column column in columnList) column.Clear(slot * column.stride, (slot + 1) * column.stride);
            paths[slot] = null;
            this.generation[slot] = generation;
            alive[slot] = 1;
            jobTile[slot] = -1;
            jobTarget[slot] = NO_ENTITY;
            target[slot] = NO_ENTITY;
            sightTile[slot] = -1;
            rallyX[slot] = -1;
            rallyY[slot] = -1;
            rallyTile[slot] = -1;
            return slot;
        }

        EntityType TypeFor(int owner, int entityType)
        {
            if (owner < 0 || owner >= types.Length) return null;
            EntityType[] mine = types[owner];
            return entityType >= 0 && entityType < mine.Length ? mine[entityType] : null;
        }

        /// <summary>
        /// Creates a unit and returns its handle, or NO_ENTITY if the world is
        /// full. The position must be on passable ground.
        /// </summary>
        public int SpawnUnit(int owner, int entityType, int x, int y)
        {
            EntityType type = TypeFor(owner, entityType);
            if (type == null || type.building) throw new ArgumentOutOfRangeException(nameof(entityType), $"not a unit type: {entityType}");
            int slot = ClaimSlot();
            if (slot == -1) return NO_ENTITY;
            this.owner[slot] = (byte)owner;
            this.entityType[slot] = (byte)entityType;
            mobile[slot] = 1;
            posX[slot] = x;
            posY[slot] = y;
            goalX[slot] = x;
            goalY[slot] = y;
            steerX[slot] = x;
            steerY[slot] = y;
            dirX[slot] = 0;
            dirY[slot] = ONE;
            speed[slot] = Units.PerSecondToPerTick(type.speed, config.tickRate);
            radius[slot] = type.radius;
            hp[slot] = type.hp;
            homeX[slot] = x;
            homeY[slot] = y;
            Vision.LookAround(this, slot);
            return IdAt(slot);
        }

        /// <summary>
        /// Puts up a building centred on a tile and returns its handle, or
        /// NO_ENTITY if the world is full. The ground it covers stops being
        /// passable at once, whether the building is finished or only a site
        /// waiting to be built.
        /// </summary>
        public int SpawnBuilding(int owner, int entityType, int tileX, int tileY, bool finished = true)
        {
            EntityType type = TypeFor(owner, entityType);
            if (type == null || !type.building) throw new ArgumentOutOfRangeException(nameof(entityType), $"not a building type: {entityType}");
            int slot = ClaimSlot();
            if (slot == -1) return NO_ENTITY;
            this.owner[slot] = (byte)owner;
            this.entityType[slot] = (byte)entityType;
            posX[slot] = tileX * ONE + HALF;
            posY[slot] = tileY * ONE + HALF;
            goalX[slot] = posX[slot];
            goalY[slot] = posY[slot];
            dirY[slot] = ONE;
            if (finished)
            {
                built[slot] = 1;
                buildPoints[slot] = BuildPointsNeeded(entityType, config.tickRate);
                hp[slot] = type.hp;
            }
            else
            {
                hp[slot] = SiteHp(entityType);
            }
            int half = type.footprint >> 1;
            if (finished && type.farm) TillFarm(slot);
            else map.SetBuilding(tileX - half, tileY - half, type.footprint, true);
            Vision.LookAround(this, slot);
            return IdAt(slot);
        }

        public void Destroy(int id)
        {
            if (!IsAlive(id)) return;
            int slot = EntityIndex(id);
            ClearOrders(slot);
            Vision.StopLooking(this, slot);
            // Whatever a villager was carrying goes with it.
            if (carry[slot] > 0)
            {
                lost[carryKind[slot]] = lost[carryKind[slot]] + carry[slot];
                carry[slot] = 0;
            }
            EntityType type = TypeOf(slot);
            if (type.building)
            {
                int half = type.footprint >> 1;
                int left = (posX[slot] >> 16) - half;
                int top = (posY[slot] >> 16) - half;
                if (type.farm && built[slot] == 1)
                {
                    // A farm that is destroyed goes back to grass.
                    for (int ty = top; ty < top + type.footprint; ty++)
                    {
                        for (int tx = left; tx < left + type.footprint; tx++) map.SetTerrain(ty * map.width + tx, Terrain.Grass, 0);
                    }
                }
                map.SetBuilding(left, top, type.footprint, false);
            }
            alive[slot] = 0;
            generation[slot] = (ushort)((generation[slot] + 1) & GENERATION_MASK);
            freeSlots.Add(slot);
        }

        /// <summary>
        /// Turns a finished farm's plot into tilled ground. The site blocked the
        /// way while it was being built; the farm does not. Its crop is gathered
        /// from the tile at its centre, which is the only one that holds any.
        /// </summary>
        public void TillFarm(int slot)
        {
            int footprint = TypeOf(slot).footprint;
            int half = footprint >> 1;
            int cx = posX[slot] >> 16;
            int cy = posY[slot] >> 16;
            map.SetBuilding(cx - half, cy - half, footprint, false);
            for (int ty = cy - half; ty <= cy + half; ty++)
            {
                for (int tx = cx - half; tx <= cx + half; tx++)
                {
                    map.SetTerrain(ty * map.width + tx, Terrain.Field, tx == cx && ty == cy ? 1 : 0);
                }
            }
        }

        /// <summary>A unit's or building's figures, as its owner's research has made them.</summary>
        public EntityType TypeOf(int slot)
        {
            return types[owner[slot]][entityType[slot]];
        }

        public bool IsAlive(int id)
        {
            // Handles are non-negative 32-bit integers.
            if (id < 0) return false;
            int slot = EntityIndex(id);
            return slot < highWater &&
                alive[slot] == 1 &&
                generation[slot] == EntityGeneration(id);
        }

        /// <summary>The handle of whatever currently occupies a slot.</summary>
        public int IdAt(int slot)
        {
            return (generation[slot] << INDEX_BITS) | slot;
        }

        /// <summary>Handles of all living entities, optionally one player's (-1 for everyone's), in slot order.</summary>
        public List<int> LivingEntities(int owner = -1)
        {
            var ids = new List<int>();
            for (int slot = 0; slot < highWater; slot++)
            {
                if (alive[slot] == 0) continue;
                if (owner != -1 && this.owner[slot] != owner) continue;
                ids.Add(IdAt(slot));
            }
            return ids;
        }

        /// <summary>Handles of living units (not buildings), optionally one player's (-1 for everyone's), in slot order.</summary>
        public List<int> LivingUnits(int owner = -1)
        {
            var ids = new List<int>();
            for (int slot = 0; slot < highWater; slot++)
            {
                if (alive[slot] == 0 || mobile[slot] == 0) continue;
                if (owner != -1 && this.owner[slot] != owner) continue;
                ids.Add(IdAt(slot));
            }
            return ids;
        }

        // ---- Orders --------------------------------------------------------------

        public MoveGroup CreateGroup(int goalTile, int faceX, int faceY)
        {
            var group = new MoveGroup
            {
                id = nextGroupId++,
                goalTile = goalTile,
                faceX = faceX,
                faceY = faceY,
                refs = 0,
                status = GroupStatus.New,
                field = null,
                fieldChecksum = 0,
            };
            groups.Set(group);
            return group;
        }

        public void RetainGroup(int id)
        {
            if (id == 0) return;
            groups.Get(id).refs++;
        }

        /// <summary>Drops one unit's claim on a group; the group goes when no unit needs it.</summary>
        public void ReleaseGroup(int id)
        {
            if (id == 0) return;
            MoveGroup group = groups.Get(id);
            if (group == null) return;
            if (--group.refs <= 0) groups.Delete(id);
        }

        /// <summary>
        /// Forgets a unit's current and queued orders, and any fight it is in. It
        /// stays where it is, guarding the spot.
        /// </summary>
        public void ClearOrders(int slot)
        {
            ReleaseGroup(group[slot]);
            group[slot] = 0;
            ReleaseGroup(homeGroup[slot]);
            homeGroup[slot] = 0;
            int start = slot * ORDER_QUEUE_LENGTH;
            for (int k = 0; k < queueLength[slot]; k++) ReleaseGroup(queueGroup[start + k]);
            queueLength[slot] = 0;
            orderKind[slot] = OrderKind.None;
            target[slot] = NO_ENTITY;
            engaged[slot] = 0;
            windup[slot] = 0;
            rooted[slot] = 0;
            chaseTries[slot] = 0;
            StandStill(slot);
            homeX[slot] = posX[slot];
            homeY[slot] = posY[slot];
        }

        /// <summary>Stops a unit in its tracks without touching its orders: it stands where it is until told otherwise.</summary>
        public void StandStill(int slot)
        {
            paths[slot] = null;
            pathIndex[slot] = 0;
            stuck[slot] = 0;
            retries[slot] = 0;
            // Any route still being worked out for it is now out of date.
            orderSeq[slot] = unchecked(orderSeq[slot] + 1);
            moveState[slot] = MoveState.Idle;
            goalX[slot] = posX[slot];
            goalY[slot] = posY[slot];
        }

        /// <summary>Whether two players are enemies.</summary>
        public bool Hostile(int a, int b)
        {
            return team[a] != team[b];
        }

        // ---- Arrows ----------------------------------------------------------------

        /// <summary>Looses an arrow that will hit `target` for `damage` when tick `lands` comes.</summary>
        public void AddShot(int fromX, int fromY, int source, int target, int damage, int lands)
        {
            int at = shotCount * SHOT_FIELDS;
            if (at + SHOT_FIELDS > shots.Length) Array.Resize(ref shots, shots.Length * 2);
            shots[at] = fromX;
            shots[at + 1] = fromY;
            shots[at + 2] = source;
            shots[at + 3] = target;
            shots[at + 4] = damage;
            shots[at + 5] = tick;
            shots[at + 6] = lands;
            shotCount++;
        }

        // ---- Stores ----------------------------------------------------------------

        public bool CanAfford(int player, int[] cost)
        {
            for (int r = 0; r < RESOURCE_COUNT; r++)
            {
                if (stock[player * RESOURCE_COUNT + r] < cost[r]) return false;
            }
            return true;
        }

        /// <summary>Takes a cost out of a player's stores. Check CanAfford first.</summary>
        public void Pay(int player, int[] cost)
        {
            for (int r = 0; r < RESOURCE_COUNT; r++)
            {
                int at = player * RESOURCE_COUNT + r;
                stock[at] = stock[at] - cost[r];
                spent[at] = spent[at] + cost[r];
            }
        }

        /// <summary>Gives a cost back, as when a building site or a queued unit is cancelled.</summary>
        public void Refund(int player, int[] cost)
        {
            for (int r = 0; r < RESOURCE_COUNT; r++)
            {
                int at = player * RESOURCE_COUNT + r;
                stock[at] = stock[at] + cost[r];
                spent[at] = spent[at] - cost[r];
            }
        }

        /// <summary>Takes a gatherer off its round trip. It keeps whatever it is carrying.</summary>
        public void ClearJob(int slot)
        {
            job[slot] = Job.None;
            jobTile[slot] = -1;
            jobSpot[slot] = 0;
            jobTimer[slot] = 0;
            jobTries[slot] = 0;
            jobTarget[slot] = NO_ENTITY;
        }
    }
}
