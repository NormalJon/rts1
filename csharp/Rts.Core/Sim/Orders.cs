// Ported from src/sim/orders.ts. Keep the two in step.

using System;
using System.Collections.Generic;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    /// <summary>
    /// Applying commands to the world.
    ///
    /// Commands come from outside (a player, the network, a file), so nothing in
    /// them is trusted. Anything invalid is skipped, identically on every machine.
    /// </summary>
    public static class Orders
    {
        /// <summary>Limits on what a single command may ask for, whoever sent it.</summary>
        const int MAX_UNITS_PER_COMMAND = 1024;
        const int MAX_SPAWN_PER_COMMAND = 256;

        const int SPAWN_SCATTER = 2 * ONE;
        /// <summary>Gap between neighbours in a formation, centre to centre.</summary>
        static readonly int FORMATION_SPACING = FromRatio(3, 5);
        /// <summary>How far a formation place may be moved to find open ground.</summary>
        const int SLOT_SEARCH_RADIUS = 12;
        /// <summary>Where the second, third and fourth units sharing a relocated place stand within the tile.</summary>
        static readonly int[][] SHARED_TILE_OFFSETS =
        {
            new[] { 0, 0 },
            new[] { -1, -1 },
            new[] { 1, 1 },
            new[] { 1, -1 },
            new[] { -1, 1 },
        };

        public static void ApplyCommand(World world, ScheduledCommand entry)
        {
            int player = entry.player;
            Command command = entry.command;
            if (player < 0 || player >= world.config.playerCount) return;
            if (command == null) return;
            switch (command.kind)
            {
                case CommandKind.Spawn:
                    ApplySpawn(world, player, command);
                    break;
                case CommandKind.Move:
                    ApplyMove(world, player, command.units, command.x, command.y, command.queue, OrderKind.Move);
                    break;
                case CommandKind.AttackMove:
                    ApplyMove(world, player, command.units, command.x, command.y, command.queue, OrderKind.AttackMove);
                    break;
                case CommandKind.Patrol:
                    ApplyMove(world, player, command.units, command.x, command.y, false, OrderKind.Patrol);
                    break;
                case CommandKind.Attack:
                    ApplyAttack(world, player, command);
                    break;
                case CommandKind.Stop:
                case CommandKind.Hold:
                    foreach (int slot in OwnedSlots(world, player, command.units))
                    {
                        world.ClearOrders(slot);
                        world.ClearJob(slot);
                        if (command.kind == CommandKind.Hold) world.orderKind[slot] = OrderKind.Hold;
                    }
                    break;
                case CommandKind.Gather:
                    ApplyGather(world, player, command);
                    break;
                case CommandKind.Deliver:
                    ApplyDeliver(world, player, command);
                    break;
                case CommandKind.Build:
                {
                    int site = Buildings.Found(world, player, command.buildingType, command.tileX, command.tileY);
                    if (site != World.NO_ENTITY) SendBuilders(world, player, command.units, site);
                    break;
                }
                case CommandKind.Construct:
                    SendBuilders(world, player, command.units, command.target);
                    break;
                case CommandKind.Train:
                    Production.QueueTraining(world, player, command.building, command.unitType);
                    break;
                case CommandKind.Research:
                    Techs.QueueResearch(world, player, command.building, command.tech);
                    break;
                case CommandKind.CancelTrain:
                    Production.CancelTraining(world, player, command.building, command.index);
                    break;
                case CommandKind.Rally:
                    ApplyRally(world, player, command);
                    break;
                case CommandKind.Demolish:
                    if (command.targets != null)
                    {
                        int limit = Math.Min(command.targets.Length, MAX_UNITS_PER_COMMAND);
                        for (int i = 0; i < limit; i++) Buildings.Demolish(world, player, command.targets[i]);
                    }
                    break;
            }
        }

        /// <summary>Sets the listed villagers to work on a site. Units that cannot build walk over to it instead.</summary>
        static void SendBuilders(World world, int player, int[] units, int site)
        {
            if (!world.IsAlive(site)) return;
            int at = World.EntityIndex(site);
            if (world.mobile[at] == 1 || world.owner[at] != player) return;
            var walkers = new List<int>();
            foreach (int slot in OwnedSlots(world, player, units))
            {
                if (!Economy.AssignConstruction(world, slot, site)) walkers.Add(world.IdAt(slot));
            }
            if (walkers.Count > 0) Walk(world, player, walkers.ToArray(), world.posX[at], world.posY[at]);
        }

        /// <summary>Sets the listed units on one enemy. They follow it until it is dead or they are told otherwise.</summary>
        static void ApplyAttack(World world, int player, Command command)
        {
            int target = command.target;
            if (!world.IsAlive(target)) return;
            int at = World.EntityIndex(target);
            if (!world.Hostile(player, world.owner[at])) return;
            // A unit must be in sight to be singled out. A building need only stand on
            // ground the player has seen: it can be attacked from memory.
            bool known =
                world.mobile[at] == 1
                    ? Vision.CanSee(world, player, at)
                    : Vision.CanSee(world, player, at) || Vision.HasExplored(world, player, world.map.TileAt(world.posX[at], world.posY[at]));
            if (!known) return;
            foreach (int slot in OwnedSlots(world, player, command.units))
            {
                if (world.TypeOf(slot).damage == 0) continue;
                world.ClearOrders(slot);
                world.ClearJob(slot);
                world.orderKind[slot] = OrderKind.AttackTarget;
                world.target[slot] = target;
                world.engaged[slot] = 1;
            }
        }

        /// <summary>A plain march, for units sent to do something they cannot do: they walk over to it instead.</summary>
        static void Walk(World world, int player, int[] units, int x, int y)
        {
            ApplyMove(world, player, units, x, y, false, OrderKind.Move);
        }

        static void ApplyRally(World world, int player, Command command)
        {
            GameMap map = world.map;
            if (command.buildings == null) return;
            int x = Clamp(command.x, 0, map.maxX);
            int y = Clamp(command.y, 0, map.maxY);
            int tile = map.TileAt(x, y);
            int limit = Math.Min(command.buildings.Length, MAX_UNITS_PER_COMMAND);
            for (int i = 0; i < limit; i++)
            {
                int id = command.buildings[i];
                if (!world.IsAlive(id)) continue;
                int slot = World.EntityIndex(id);
                if (world.mobile[slot] == 1 || world.owner[slot] != player) continue;
                world.rallyX[slot] = x;
                world.rallyY[slot] = y;
                world.rallyTile[slot] = ResourceOfTerrain(map.terrain[tile]) != -1 ? tile : -1;
            }
        }

        static void ApplyGather(World world, int player, Command command)
        {
            GameMap map = world.map;
            int tile = command.tile;
            if (tile < 0 || tile >= map.tileCount) return;
            // Units that cannot gather, and everyone if there is nothing there, just walk over.
            var walkers = new List<int>();
            List<int> slots = OwnedSlots(world, player, command.units);
            // Everyone in the order gives up their old place; they share out the free ones between them.
            HashSet<int> taken = Economy.SpotsTakenExcept(world, slots);
            foreach (int slot in slots)
            {
                bool gathers = world.TypeOf(slot).carries > 0;
                if (!gathers || !Economy.AssignGather(world, slot, tile, taken)) walkers.Add(world.IdAt(slot));
            }
            if (walkers.Count > 0) Walk(world, player, walkers.ToArray(), map.CentreX(tile), map.CentreY(tile));
        }

        static void ApplyDeliver(World world, int player, Command command)
        {
            int target = command.target;
            if (!Economy.AcceptsDeliveries(world, target, player)) return;
            int at = World.EntityIndex(target);
            var walkers = new List<int>();
            foreach (int slot in OwnedSlots(world, player, command.units))
            {
                if (world.carry[slot] > 0) Economy.AssignDelivery(world, slot, target);
                else walkers.Add(world.IdAt(slot));
            }
            if (walkers.Count > 0) Walk(world, player, walkers.ToArray(), world.posX[at], world.posY[at]);
        }

        static void ApplySpawn(World world, int player, Command command)
        {
            GameMap map = world.map;
            int unitType = command.unitType;
            if (unitType < 0 || unitType >= ENTITY_TYPES.Length) return;
            EntityType type = ENTITY_TYPES[unitType];
            if (type.building) return;
            int count = Clamp(command.count, 0, MAX_SPAWN_PER_COMMAND);
            int centreX = Clamp(command.x, 0, map.maxX);
            int centreY = Clamp(command.y, 0, map.maxY);
            // Everyone in the batch appears on the same connected piece of ground.
            int anchor = map.NearestPassable(centreX >> 16, centreY >> 16);
            if (anchor == -1) return;
            int region = map.region[anchor];
            for (int i = 0; i < count; i++)
            {
                int x = Clamp(centreX + world.rng.RangeFixed(-SPAWN_SCATTER, SPAWN_SCATTER), 0, map.maxX);
                int y = Clamp(centreY + world.rng.RangeFixed(-SPAWN_SCATTER, SPAWN_SCATTER), 0, map.maxY);
                if (map.region[map.TileAt(x, y)] != region)
                {
                    int tile = map.NearestPassable(x >> 16, y >> 16, region);
                    x = map.CentreX(tile);
                    y = map.CentreY(tile);
                }
                world.SpawnUnit(player, unitType, x, y);
            }
        }

        /// <summary>
        /// Sends units to a place, drawn up in a block facing the way they travel.
        /// </summary>
        /// <param name="kind">How they treat enemies on the way: OrderKind.Move, AttackMove or Patrol.</param>
        static void ApplyMove(World world, int player, int[] units, int x, int y, bool queue, int kind)
        {
            GameMap map = world.map;
            List<int> slots = OwnedSlots(world, player, units);
            if (slots.Count == 0) return;

            int destX = Clamp(x, 0, map.maxX);
            int destY = Clamp(y, 0, map.maxY);
            int destTile = map.TileAt(destX, destY);
            if (map.passable[destTile] == 0)
            {
                // Ordered onto water, trees or rock: go to the nearest ground instead.
                destTile = map.NearestPassable(destX >> 16, destY >> 16);
                if (destTile == -1) return;
                destX = map.CentreX(destTile);
                destY = map.CentreY(destTile);
            }
            int destRegion = map.region[destTile];

            // A queued order starts from wherever the unit's previous orders leave it.
            var fromX = new int[slots.Count];
            var fromY = new int[slots.Count];
            for (int i = 0; i < slots.Count; i++)
            {
                int slot = slots[i];
                int waiting = world.queueLength[slot];
                if (queue && waiting > 0)
                {
                    fromX[i] = world.queueX[slot * World.ORDER_QUEUE_LENGTH + waiting - 1];
                    fromY[i] = world.queueY[slot * World.ORDER_QUEUE_LENGTH + waiting - 1];
                }
                else if (queue && world.engaged[slot] == 1 && world.orderKind[slot] != OrderKind.None)
                {
                    // Broken off from a march to fight: the march ends where it was headed.
                    fromX[i] = world.homeX[slot];
                    fromY[i] = world.homeY[slot];
                }
                else if (queue && world.moveState[slot] != MoveState.Idle)
                {
                    fromX[i] = world.goalX[slot];
                    fromY[i] = world.goalY[slot];
                }
                else
                {
                    fromX[i] = world.posX[slot];
                    fromY[i] = world.posY[slot];
                }
            }

            // Units that cannot reach the destination at all (the far side of a river
            // with no ford, say) each go as near as they can get.
            var members = new List<int>();
            for (int i = 0; i < slots.Count; i++)
            {
                int slot = slots[i];
                int region = map.region[map.TileAt(fromX[i], fromY[i])];
                if (region == destRegion)
                {
                    members.Add(i);
                    continue;
                }
                int tile = map.NearestPassable(destX >> 16, destY >> 16, region, Math.Max(map.width, map.height));
                if (tile != -1) GiveOrder(world, slot, 0, map.CentreX(tile), map.CentreY(tile), queue, kind);
            }
            if (members.Count == 0) return;
            if (members.Count == 1)
            {
                GiveOrder(world, slots[members[0]], 0, destX, destY, queue, kind);
                return;
            }

            // The formation faces the way the group is travelling.
            long sumX = 0;
            long sumY = 0;
            foreach (int i in members)
            {
                sumX += fromX[i];
                sumY += fromY[i];
            }
            int centroidX = (int)Idiv(sumX, members.Count);
            int centroidY = (int)Idiv(sumY, members.Count);
            int forwardX = destX - centroidX;
            int forwardY = destY - centroidY;
            int travel = Length(forwardX, forwardY);
            if (travel < HALF)
            {
                int lead = slots[members[0]];
                forwardX = world.dirX[lead];
                forwardY = world.dirY[lead];
            }
            else
            {
                forwardX = MulDiv(forwardX, ONE, travel);
                forwardY = MulDiv(forwardY, ONE, travel);
            }
            int rightX = -forwardY;
            int rightY = forwardX;

            // A block about twice as wide as it is deep.
            int n = members.Count;
            int columns = Isqrt(2 * n);
            if (columns * columns < 2 * n) columns++;
            if (columns > n) columns = n;
            int rows = Idiv(n + columns - 1, columns);

            // Front rank to the units already furthest forward, and within each rank
            // left to right, so the group reshuffles as little as possible.
            long Ahead(int i) => (long)Mul(fromX[i] - centroidX, forwardX) + Mul(fromY[i] - centroidY, forwardY);
            long Across(int i) => (long)Mul(fromX[i] - centroidX, rightX) + Mul(fromY[i] - centroidY, rightY);
            var ordered = new List<int>(members);
            Sorting.StableSort(ordered, (a, b) =>
            {
                int byAhead = Ahead(b).CompareTo(Ahead(a));
                return byAhead != 0 ? byAhead : slots[a].CompareTo(slots[b]);
            });

            MoveGroup group = world.CreateGroup(destTile, forwardX, forwardY);
            // Looked up by tile only; nothing reads it in order.
            var sharing = new Dictionary<int, int>();
            int half = FORMATION_SPACING >> 1;
            for (int row = 0; row < rows; row++)
            {
                int first = row * columns;
                var rank = ordered.GetRange(first, Math.Max(0, Math.Min(columns, ordered.Count - first)));
                Sorting.StableSort(rank, (a, b) =>
                {
                    int byAcross = Across(a).CompareTo(Across(b));
                    return byAcross != 0 ? byAcross : slots[a].CompareTo(slots[b]);
                });
                int depth = (rows - 1 - 2 * row) * half;
                for (int k = 0; k < rank.Count; k++)
                {
                    int side = (2 * k - (rank.Count - 1)) * half;
                    int px = destX + Mul(rightX, side) + Mul(forwardX, depth);
                    int py = destY + Mul(rightY, side) + Mul(forwardY, depth);
                    bool inBounds = px >= 0 && py >= 0 && px <= map.maxX && py <= map.maxY;
                    if (!inBounds || map.region[map.TileAt(px, py)] != destRegion)
                    {
                        // This place in the block is in the trees or the river. Stand on the
                        // nearest ground that can be reached, a few to a tile if need be.
                        int tile = inBounds
                            ? map.NearestPassable(px >> 16, py >> 16, destRegion, SLOT_SEARCH_RADIUS)
                            : -1;
                        int stand = tile == -1 ? destTile : tile;
                        sharing.TryGetValue(stand, out int already);
                        sharing[stand] = already + 1;
                        int[] offset = SHARED_TILE_OFFSETS[already % SHARED_TILE_OFFSETS.Length];
                        px = map.CentreX(stand) + offset[0] * (ONE >> 2);
                        py = map.CentreY(stand) + offset[1] * (ONE >> 2);
                    }
                    GiveOrder(world, slots[rank[k]], group.id, px, py, queue, kind);
                }
            }
            if (group.refs == 0) world.groups.Delete(group.id);
        }

        /// <summary>Hands a unit a destination, either replacing what it is doing or adding to its queue.</summary>
        static void GiveOrder(World world, int slot, int groupId, int x, int y, bool queue, int kind)
        {
            // Being sent somewhere takes a villager off its work.
            world.ClearJob(slot);
            // A unit with orders in hand, or one sent after a particular enemy, takes a queued order as its next.
            int current = world.orderKind[slot];
            bool busy =
                world.queueLength[slot] > 0 ||
                (current != OrderKind.None && current != OrderKind.Hold) ||
                (current == OrderKind.None && world.engaged[slot] == 0 && world.moveState[slot] != MoveState.Idle);
            if (queue && busy)
            {
                int waiting = world.queueLength[slot];
                if (waiting >= World.ORDER_QUEUE_LENGTH) return;
                int at = slot * World.ORDER_QUEUE_LENGTH + waiting;
                world.queueGroup[at] = groupId;
                world.queueX[at] = x;
                world.queueY[at] = y;
                world.queueKind[at] = (byte)kind;
                world.queueLength[slot] = (byte)(waiting + 1);
                world.RetainGroup(groupId);
                return;
            }
            int fromX = world.posX[slot];
            int fromY = world.posY[slot];
            world.ClearOrders(slot);
            world.RetainGroup(groupId);
            world.orderKind[slot] = (byte)kind;
            // A patrol's beat runs from where the unit stands to where it is sent.
            world.otherX[slot] = fromX;
            world.otherY[slot] = fromY;
            Routing.BeginOrder(world, slot, groupId, x, y);
        }

        /// <summary>
        /// The slots of the listed units that are alive, mobile and belong to the
        /// player, in the order listed, each at most once.
        /// </summary>
        static List<int> OwnedSlots(World world, int player, int[] units)
        {
            var slots = new List<int>();
            if (units == null) return slots;
            // Asked only whether a slot is in it; nothing reads it in order.
            var seen = new HashSet<int>();
            int limit = Math.Min(units.Length, MAX_UNITS_PER_COMMAND);
            for (int i = 0; i < limit; i++)
            {
                int id = units[i];
                if (!world.IsAlive(id)) continue;
                int slot = World.EntityIndex(id);
                // Buildings take no orders.
                if (world.owner[slot] != player || world.mobile[slot] == 0 || !seen.Add(slot)) continue;
                slots.Add(slot);
            }
            return slots;
        }
    }
}
