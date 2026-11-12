// Ported from src/sim/economy.ts. Keep the two in step.

using System;
using System.Collections.Generic;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    /// <summary>
    /// What villagers do: gathering, and building.
    ///
    /// Gathering is a round trip between a resource and the nearest place to
    /// hand it in:
    ///
    ///   walk to a free place beside the resource  ->  work until loaded
    ///        ^                                              |
    ///        |                                              v
    ///   hand in at the drop-off  &lt;-  carry the load to the nearest one
    ///
    /// When a tile runs out the villager moves to the nearest tile of the same
    /// kind. Everything taken from the map ends up on a villager's back, in a
    /// stockpile, or spent; nothing is created or lost along the way.
    ///
    /// Building is simpler: walk to the site, work until it is finished, then
    /// find something useful to do next. A site gains hit points as it goes up.
    /// Mending a damaged building is the same job on a finished one.
    /// </summary>
    public static class Economy
    {
        /// <summary>How close a villager must stand to a tile or building to work on it or hand in.</summary>
        static readonly int REACH = FromRatio(4, 5);
        /// <summary>How far it will look for another tile of the same resource.</summary>
        const int SEARCH_RADIUS = 14;
        /// <summary>How far from a finished camp its builders look for something to gather.</summary>
        const int CAMP_RADIUS = 10;
        /// <summary>How far a builder looks for another site to help at.</summary>
        const int NEXT_SITE_RADIUS = 14;
        /// <summary>Mending a building from nothing takes this many times as long as building it.</summary>
        const int MENDING_SLOWNESS = 6;
        /// <summary>How many times it tries to reach a place before giving up on it.</summary>
        const int MAX_TRIES = 3;
        /// <summary>Two villagers share a tile beside a resource, standing this far either side of its middle.</summary>
        const int SIDE_STEP = ONE >> 2;
        static readonly int LEAN_IN = FromRatio(3, 20);

        // ---- Orders ------------------------------------------------------------------

        /// <summary>
        /// Sets a villager to gathering from a resource tile. Returns false if
        /// there is nothing there to gather.
        /// </summary>
        /// <param name="taken">
        /// When a whole group is being set to work at once, the standing places
        /// spoken for so far (see SpotsTakenExcept), so the list is not rebuilt
        /// for every villager. Each place handed out is added to it.
        /// </param>
        public static bool AssignGather(World world, int slot, int tile, HashSet<int> taken = null)
        {
            GameMap map = world.map;
            int terrain = map.terrain[tile];
            int resource = ResourceOfTerrain(terrain);
            if (resource == -1 || map.amount[tile] <= 0) return false;
            world.ClearOrders(slot);
            world.ClearJob(slot);
            world.jobTile[slot] = tile;
            world.jobTerrain[slot] = (byte)terrain;
            int capacity = world.TypeOf(slot).carries;
            int loaded = world.carry[slot];
            // A full load, or a load of something else, is handed in first.
            if (loaded >= capacity || (loaded > 0 && world.carryKind[slot] != resource)) StartDelivery(world, slot);
            else GoToResource(world, slot, taken);
            return true;
        }

        /// <summary>
        /// The standing places held by gatherers other than the given units. The
        /// set is only ever asked whether a place is in it; nothing reads it in order.
        /// </summary>
        public static HashSet<int> SpotsTakenExcept(World world, IEnumerable<int> slots)
        {
            var skip = new HashSet<int>(slots);
            var taken = new HashSet<int>();
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || skip.Contains(slot)) continue;
                int job = world.job[slot];
                if (job == Job.ToResource || job == Job.Harvesting) taken.Add(world.jobSpot[slot]);
            }
            return taken;
        }

        /// <summary>Sends a villager to hand in what it carries at a building. Afterwards it goes back to what it was gathering.</summary>
        public static void AssignDelivery(World world, int slot, int building)
        {
            int tile = world.jobTile[slot];
            byte terrain = world.jobTerrain[slot];
            world.ClearOrders(slot);
            world.ClearJob(slot);
            world.jobTile[slot] = tile;
            world.jobTerrain[slot] = terrain;
            StartDelivery(world, slot, building);
        }

        /// <summary>
        /// Sends a villager to work on a building: to finish it, or, if it is
        /// finished but damaged, to mend it. Returns false if it is not one of the
        /// player's buildings or needs no work.
        /// </summary>
        public static bool AssignConstruction(World world, int slot, int site)
        {
            if (!NeedsWork(world, site, world.owner[slot]) || !world.TypeOf(slot).builds) return false;
            world.ClearOrders(slot);
            world.ClearJob(slot);
            if (!WalkToEdgeOf(world, slot, World.EntityIndex(site), true)) return false;
            world.jobTarget[slot] = site;
            world.job[slot] = Job.ToSite;
            return true;
        }

        // ---- Every tick ----------------------------------------------------------------

        public static void EconomySystem(World world)
        {
            GameMap map = world.map;
            Array.Clear(world.scratchBuilders, 0, world.highWater);
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0) continue;
                int job = world.job[slot];
                if (job == Job.None) continue;

                if (job == Job.ToSite || job == Job.Constructing)
                {
                    Build(world, slot);
                    continue;
                }

                if (job == Job.ToDropOff)
                {
                    int target = world.jobTarget[slot];
                    if (!TakesDeliveryOf(world, target, world.owner[slot], world.carryKind[slot]))
                    {
                        // The building has gone. Try another.
                        StartDelivery(world, slot);
                        continue;
                    }
                    if (WithinReachOf(world, slot, World.EntityIndex(target)))
                    {
                        int player = world.owner[slot];
                        int stockAt = player * RESOURCE_COUNT + world.carryKind[slot];
                        world.stock[stockAt] = world.stock[stockAt] + world.carry[slot];
                        world.carry[slot] = 0;
                        world.jobTries[slot] = 0;
                        if (world.jobTile[slot] >= 0) GoToResource(world, slot);
                        else StopWorking(world, slot);
                    }
                    else if (world.moveState[slot] == MoveState.Idle)
                    {
                        world.jobTries[slot] = (byte)(world.jobTries[slot] + 1);
                        if (world.jobTries[slot] > MAX_TRIES) StopWorking(world, slot);
                        else StartDelivery(world, slot, target);
                    }
                    continue;
                }

                int tile = world.jobTile[slot];
                if (tile < 0 || map.terrain[tile] != world.jobTerrain[slot] || map.amount[tile] <= 0)
                {
                    // Worked out, by this villager or another. Find the next one.
                    GoToResource(world, slot);
                    continue;
                }
                bool near = WithinReach(world, slot, tile % map.width, Idiv(tile, map.width), 1);

                if (job == Job.ToResource)
                {
                    if (world.moveState[slot] != MoveState.Idle) continue;
                    if (near)
                    {
                        world.job[slot] = Job.Harvesting;
                        world.jobTimer[slot] = 0;
                        world.jobTries[slot] = 0;
                        Face(world, slot, map.CentreX(tile), map.CentreY(tile));
                    }
                    else
                    {
                        world.jobTries[slot] = (byte)(world.jobTries[slot] + 1);
                        if (world.jobTries[slot] > MAX_TRIES) StopWorking(world, slot);
                        else GoToResource(world, slot);
                    }
                    continue;
                }

                // Harvesting. A villager jostled out of reach waits to drift back before
                // carrying on. If it has come to rest and still cannot reach (its place
                // has been built over, say), it finds another.
                if (!near)
                {
                    int fromPost = Length(world.posX[slot] - world.goalX[slot], world.posY[slot] - world.goalY[slot]);
                    if (fromPost <= ONE >> 4) GoToResource(world, slot);
                    continue;
                }
                int terrain = map.terrain[tile];
                int resource = ResourceOfTerrain(terrain);
                world.jobTimer[slot] = world.jobTimer[slot] + 1;
                int faster = world.gatherBonus[world.owner[slot] * Techs.TERRAINS + terrain];
                if (world.jobTimer[slot] < TicksPerUnit(terrain, world.config.tickRate, faster)) continue;
                world.jobTimer[slot] = 0;
                // A farm's crop is grown, not taken: the field holds as much afterwards as before.
                if (terrain == Terrain.Field) world.grown[resource] = world.grown[resource] + 1;
                else map.Harvest(tile);
                world.carryKind[slot] = (byte)resource;
                world.carry[slot] = world.carry[slot] + 1;
                if (world.carry[slot] >= world.TypeOf(slot).carries) StartDelivery(world, slot);
            }
        }

        static void StopWorking(World world, int slot)
        {
            world.ClearOrders(slot);
            world.ClearJob(slot);
        }

        static void WalkTo(World world, int slot, int x, int y)
        {
            world.ClearOrders(slot);
            Routing.BeginOrder(world, slot, 0, x, y);
        }

        static void Face(World world, int slot, int x, int y)
        {
            int dx = x - world.posX[slot];
            int dy = y - world.posY[slot];
            int distance = Length(dx, dy);
            if (distance == 0) return;
            world.dirX[slot] = MulDiv(dx, ONE, distance);
            world.dirY[slot] = MulDiv(dy, ONE, distance);
        }

        /// <summary>Whether a unit is within reach of a square of tiles.</summary>
        static bool WithinReach(World world, int slot, int left, int top, int size)
        {
            int x = world.posX[slot];
            int y = world.posY[slot];
            int x0 = left * ONE;
            int y0 = top * ONE;
            int x1 = x0 + size * ONE;
            int y1 = y0 + size * ONE;
            int dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
            int dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
            if (dx > REACH || dy > REACH) return false;
            return Length(dx, dy) <= REACH;
        }

        /// <summary>Whether a unit is within reach of a building.</summary>
        static bool WithinReachOf(World world, int slot, int building)
        {
            int footprint = world.TypeOf(building).footprint;
            int half = footprint >> 1;
            return WithinReach(world, slot, (world.posX[building] >> 16) - half, (world.posY[building] >> 16) - half, footprint);
        }

        /// <summary>
        /// Sends a unit to the nearest open tile on the ring just outside a
        /// building. Returns false if there is none it can get to.
        /// </summary>
        /// <param name="spreadOut">
        /// For builders, who stay a while: prefer a tile no other builder of this
        /// site is already heading for, so they work all round it instead of
        /// queuing at one corner.
        /// </param>
        static bool WalkToEdgeOf(World world, int slot, int building, bool spreadOut = false)
        {
            GameMap map = world.map;
            int px = world.posX[slot];
            int py = world.posY[slot];
            // Looked up by tile only; nothing reads it in order.
            Dictionary<int, int> crowd = null;
            if (spreadOut)
            {
                crowd = new Dictionary<int, int>();
                int site = world.IdAt(building);
                for (int other = 0; other < world.highWater; other++)
                {
                    if (other == slot || world.alive[other] == 0 || world.jobTarget[other] != site) continue;
                    if (world.job[other] != Job.ToSite && world.job[other] != Job.Constructing) continue;
                    int tile = map.TileAt(world.goalX[other], world.goalY[other]);
                    crowd.TryGetValue(tile, out int bound);
                    crowd[tile] = bound + 1;
                }
            }
            int region = map.region[map.TileAt(px, py)];
            int reach = (world.TypeOf(building).footprint >> 1) + 1;
            int cx = world.posX[building] >> 16;
            int cy = world.posY[building] >> 16;
            int bestX = 0;
            int bestY = 0;
            int bestDistance = -1;
            for (int oy = -reach; oy <= reach; oy++)
            {
                for (int ox = -reach; ox <= reach; ox++)
                {
                    if (ox != -reach && ox != reach && oy != -reach && oy != reach) continue;
                    int tx = cx + ox;
                    int ty = cy + oy;
                    if (!map.IsPassable(tx, ty) || map.region[ty * map.width + tx] != region) continue;
                    int x = tx * ONE + HALF;
                    int y = ty * ONE + HALF;
                    // Each builder already bound for a tile makes it as unattractive as three more tiles of walking.
                    int crowded = 0;
                    if (crowd != null) crowd.TryGetValue(ty * map.width + tx, out crowded);
                    int distance = Length(x - px, y - py) + crowded * 3 * ONE;
                    if (bestDistance == -1 || distance < bestDistance)
                    {
                        bestX = x;
                        bestY = y;
                        bestDistance = distance;
                    }
                }
            }
            if (bestDistance == -1) return false;
            WalkTo(world, slot, bestX, bestY);
            return true;
        }

        // ---- Going to work ---------------------------------------------------------

        static int SpotX(World world, int spot, int tile)
        {
            GameMap map = world.map;
            int stand = spot >> 1;
            int dx = (tile % map.width) - (stand % map.width);
            int dy = Idiv(tile, map.width) - Idiv(stand, map.width);
            int side = (spot & 1) == 0 ? -1 : 1;
            return map.CentreX(stand) + dx * LEAN_IN - dy * side * SIDE_STEP;
        }

        static int SpotY(World world, int spot, int tile)
        {
            GameMap map = world.map;
            int stand = spot >> 1;
            int dx = (tile % map.width) - (stand % map.width);
            int dy = Idiv(tile, map.width) - Idiv(stand, map.width);
            int side = (spot & 1) == 0 ? -1 : 1;
            return map.CentreY(stand) + dy * LEAN_IN + dx * side * SIDE_STEP;
        }

        /// <summary>The nearest free standing place beside a resource tile, or -1 if every one is taken.</summary>
        static int FreeSpot(World world, int slot, int tile, int region, HashSet<int> taken)
        {
            GameMap map = world.map;
            int tx = tile % map.width;
            int ty = Idiv(tile, map.width);
            int px = world.posX[slot];
            int py = world.posY[slot];
            int best = -1;
            int bestDistance = 0;
            // A farm is worked by one villager, who always stands in the same place: just south of its middle.
            bool farm = map.terrain[tile] == Terrain.Field;
            for (int dir = farm ? 2 : 0; dir < (farm ? 3 : 8); dir++)
            {
                int nx = tx + GameMap.DIR_X[dir];
                int ny = ty + GameMap.DIR_Y[dir];
                if (!map.IsPassable(nx, ny)) continue;
                int stand = ny * map.width + nx;
                if (map.region[stand] != region) continue;
                for (int side = 0; side < (farm ? 1 : 2); side++)
                {
                    int spot = stand * 2 + side;
                    if (taken.Contains(spot)) continue;
                    int distance = Length(SpotX(world, spot, tile) - px, SpotY(world, spot, tile) - py);
                    if (best == -1 || distance < bestDistance)
                    {
                        best = spot;
                        bestDistance = distance;
                    }
                }
            }
            return best;
        }

        /// <summary>
        /// Heads for the villager's resource tile, or, if that one is worked out
        /// or crowded, the nearest tile of the same kind with room. With nowhere
        /// left to work it hands in what it has and stops.
        /// </summary>
        static void GoToResource(World world, int slot, HashSet<int> taken = null)
        {
            if (taken == null) taken = SpotsTakenExcept(world, new[] { slot });
            GameMap map = world.map;
            int terrain = world.jobTerrain[slot];
            int region = map.region[map.TileAt(world.posX[slot], world.posY[slot])];
            int tile = world.jobTile[slot];
            int spot = -1;
            if (tile >= 0 && map.terrain[tile] == terrain && map.amount[tile] > 0)
            {
                spot = FreeSpot(world, slot, tile, region, taken);
            }
            if (spot == -1)
            {
                // Look outward from where it was working, or from where it stands.
                int from = tile >= 0 ? tile : map.TileAt(world.posX[slot], world.posY[slot]);
                tile = map.NearestTile(from % map.width, Idiv(from, map.width), SEARCH_RADIUS, candidate =>
                {
                    if (map.terrain[candidate] != terrain || map.amount[candidate] <= 0) return false;
                    return FreeSpot(world, slot, candidate, region, taken) != -1;
                });
                if (tile != -1) spot = FreeSpot(world, slot, tile, region, taken);
            }
            if (tile == -1 || spot == -1)
            {
                world.jobTile[slot] = -1;
                if (world.carry[slot] > 0) StartDelivery(world, slot);
                else StopWorking(world, slot);
                return;
            }
            taken.Add(spot);
            world.jobTile[slot] = tile;
            world.jobSpot[slot] = spot;
            world.jobTimer[slot] = 0;
            WalkTo(world, slot, SpotX(world, spot, tile), SpotY(world, spot, tile));
            world.job[slot] = Job.ToResource;
        }

        // ---- Handing in ------------------------------------------------------------

        /// <summary>Whether a finished building of this player's takes in a given resource.</summary>
        static bool TakesDeliveryOf(World world, int id, int owner, int resource)
        {
            if (!world.IsAlive(id)) return false;
            int slot = World.EntityIndex(id);
            return world.owner[slot] == owner &&
                world.built[slot] == 1 &&
                (world.TypeOf(slot).accepts & (1 << resource)) != 0;
        }

        /// <summary>Whether a player owns this building and gatherers can hand in something there.</summary>
        public static bool AcceptsDeliveries(World world, int id, int owner)
        {
            if (!world.IsAlive(id)) return false;
            int slot = World.EntityIndex(id);
            return world.owner[slot] == owner && world.built[slot] == 1 && world.TypeOf(slot).accepts != 0;
        }

        /// <summary>
        /// Sends a loaded villager to a drop-off: the one given if it takes what
        /// is being carried, or the nearest that does. With none standing it stops
        /// and keeps its load.
        /// </summary>
        static void StartDelivery(World world, int slot, int building = World.NO_ENTITY)
        {
            int owner = world.owner[slot];
            int resource = world.carryKind[slot];
            int px = world.posX[slot];
            int py = world.posY[slot];
            int target = TakesDeliveryOf(world, building, owner, resource) ? World.EntityIndex(building) : -1;
            if (target == -1)
            {
                int nearest = 0;
                for (int other = 0; other < world.highWater; other++)
                {
                    if (world.alive[other] == 0 || world.mobile[other] == 1) continue;
                    if (!TakesDeliveryOf(world, world.IdAt(other), owner, resource)) continue;
                    int distance = Length(world.posX[other] - px, world.posY[other] - py);
                    if (target == -1 || distance < nearest)
                    {
                        target = other;
                        nearest = distance;
                    }
                }
            }
            int tile = world.jobTile[slot];
            byte terrain = world.jobTerrain[slot];
            if (target == -1 || !WalkToEdgeOf(world, slot, target))
            {
                StopWorking(world, slot);
                // Remember the work, so it can be picked up when there is somewhere to deliver to.
                world.jobTile[slot] = tile;
                world.jobTerrain[slot] = terrain;
                return;
            }
            world.jobTarget[slot] = world.IdAt(target);
            world.job[slot] = Job.ToDropOff;
        }

        // ---- Building ----------------------------------------------------------------

        /// <summary>Whether this is one of the player's buildings that is unfinished or damaged.</summary>
        static bool NeedsWork(World world, int id, int owner)
        {
            if (!world.IsAlive(id)) return false;
            int slot = World.EntityIndex(id);
            if (world.mobile[slot] == 1 || world.owner[slot] != owner) return false;
            return world.built[slot] == 0 || world.hp[slot] < world.TypeOf(slot).hp;
        }

        /// <summary>One tick of a villager's building job.</summary>
        static void Build(World world, int slot)
        {
            int site = world.jobTarget[slot];
            if (!NeedsWork(world, site, world.owner[slot]))
            {
                // Finished by the others, or destroyed.
                AfterBuilding(world, slot, site);
                return;
            }
            int at = World.EntityIndex(site);
            bool near = WithinReachOf(world, slot, at);
            bool arrived = world.moveState[slot] == MoveState.Idle;
            if (world.job[slot] == Job.ToSite)
            {
                if (near)
                {
                    // Close enough to start. It keeps walking to its place, so that it ends
                    // up standing well within reach and a nudge does not put it out of work.
                    world.job[slot] = Job.Constructing;
                    world.jobTries[slot] = 0;
                }
                else if (arrived)
                {
                    world.jobTries[slot] = (byte)(world.jobTries[slot] + 1);
                    if (world.jobTries[slot] > MAX_TRIES) StopWorking(world, slot);
                    else if (!WalkToEdgeOf(world, slot, at, true)) StopWorking(world, slot);
                }
                return;
            }
            if (arrived) Face(world, slot, world.posX[at], world.posY[at]);
            if (!near)
            {
                // Shoved out of reach and come to rest there: walk back.
                if (arrived && !WalkToEdgeOf(world, slot, at, true)) StopWorking(world, slot);
                return;
            }
            int typeId = world.entityType[at];
            EntityType type = world.TypeOf(at);
            if (world.built[at] == 1)
            {
                // Mending is slow work: one villager would take six times as long to
                // restore a building from nothing as to build it, which is about what
                // one spearman hacking at the walls undoes. The villager's timer keeps
                // the fractions.
                int full = type.seconds * world.config.tickRate * MENDING_SLOWNESS;
                int work = world.jobTimer[slot] + type.hp;
                int mended = Idiv(work, full);
                world.jobTimer[slot] = work - mended * full;
                world.hp[at] = Math.Min(type.hp, world.hp[at] + mended);
                if (world.hp[at] >= type.hp) AfterBuilding(world, slot, site);
                return;
            }
            // The first builder to reach a site each tick does the most; each helper adds a little.
            int points = world.scratchBuilders[at] == 0 ? LONE_BUILDER_POINTS : 1;
            world.scratchBuilders[at] = (ushort)(world.scratchBuilders[at] + 1);
            int needed = BuildPointsNeeded(typeId, world.config.tickRate);
            int before = world.buildPoints[at];
            int after = Math.Min(needed, before + points);
            world.buildPoints[at] = after;
            // The walls go up with the work: the rest of its hit points arrive in step with the building.
            int toCome = type.hp - SiteHp(typeId);
            int gained = (int)(Idiv((long)toCome * after, needed) - Idiv((long)toCome * before, needed));
            world.hp[at] = Math.Min(type.hp, world.hp[at] + gained);
            if (after >= needed)
            {
                world.built[at] = 1;
                if (type.farm) world.TillFarm(at);
                AfterBuilding(world, slot, site);
            }
        }

        /// <summary>
        /// A builder's next move once its site is done: if it has just finished a
        /// camp or mill, start gathering what that takes in; otherwise help at the
        /// nearest other site; otherwise stand down.
        /// </summary>
        static void AfterBuilding(World world, int slot, int finished)
        {
            GameMap map = world.map;
            int owner = world.owner[slot];
            int px = world.posX[slot];
            int py = world.posY[slot];
            int region = map.region[map.TileAt(px, py)];
            if (world.IsAlive(finished) && world.built[World.EntityIndex(finished)] == 1)
            {
                int at = World.EntityIndex(finished);
                int cx = world.posX[at] >> 16;
                int cy = world.posY[at] >> 16;
                // Whoever finishes a farm starts farming it, if nobody has beaten them to it.
                if (world.TypeOf(at).farm && world.TypeOf(slot).carries > 0)
                {
                    int tile = cy * map.width + cx;
                    if (FreeSpot(world, slot, tile, region, SpotsTakenExcept(world, new[] { slot })) != -1 && AssignGather(world, slot, tile)) return;
                }
                int best = -1;
                int bestDistance = 0;
                foreach (int terrain in TerrainsAccepted(world.entityType[at]))
                {
                    int tile = map.NearestResource(cx, cy, terrain, region, CAMP_RADIUS);
                    if (tile == -1) continue;
                    int dx = (tile % map.width) - cx;
                    int dy = Idiv(tile, map.width) - cy;
                    int distance = dx * dx + dy * dy;
                    if (best == -1 || distance < bestDistance)
                    {
                        best = tile;
                        bestDistance = distance;
                    }
                }
                if (best != -1 && world.TypeOf(slot).carries > 0 && AssignGather(world, slot, best)) return;
            }
            int next = -1;
            int nearest = NEXT_SITE_RADIUS * ONE;
            for (int other = 0; other < world.highWater; other++)
            {
                if (world.alive[other] == 0 || world.mobile[other] == 1) continue;
                if (world.owner[other] != owner || world.built[other] == 1) continue;
                int distance = Length(world.posX[other] - px, world.posY[other] - py);
                if (distance < nearest)
                {
                    next = other;
                    nearest = distance;
                }
            }
            if (next != -1 && AssignConstruction(world, slot, world.IdAt(next))) return;
            StopWorking(world, slot);
        }
    }
}
