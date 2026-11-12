// Ported from src/sim/routing.ts. Keep the two in step.

using System.Collections.Generic;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    /// <summary>
    /// Working out how units get where they are told to go.
    ///
    /// A unit that can see its destination walks straight there. Otherwise a
    /// lone unit gets its own path, and a group shares one flow field. Searches
    /// wait in a queue and are given a fixed amount of work each tick; a unit
    /// whose route is not ready yet simply waits, usually for a tick or less.
    /// </summary>
    public static class Routing
    {
        /// <summary>Starts a unit on an order. Its claim on the group must already be counted.</summary>
        public static void BeginOrder(World world, int slot, int groupId, int goalX, int goalY)
        {
            world.orderSeq[slot] = unchecked(world.orderSeq[slot] + 1);
            world.group[slot] = groupId;
            world.goalX[slot] = goalX;
            world.goalY[slot] = goalY;
            // The ground may have been built on since the order was given.
            KeepGoalOnOpenGround(world, slot);
            world.paths[slot] = null;
            world.pathIndex[slot] = 0;
            world.stuck[slot] = 0;
            world.retries[slot] = 0;
            world.closest[slot] = FIXED_MAX;
            ChooseRoute(world, slot);
        }

        /// <summary>Picks how a unit with a destination should travel, from where it is now.</summary>
        public static void ChooseRoute(World world, int slot)
        {
            int px = world.posX[slot];
            int py = world.posY[slot];
            int goalX = world.goalX[slot];
            int goalY = world.goalY[slot];
            if (world.map.ClearPath(px, py, goalX, goalY, world.radius[slot]))
            {
                world.moveState[slot] = MoveState.Direct;
                world.steerX[slot] = goalX;
                world.steerY[slot] = goalY;
                return;
            }
            MoveGroup group = world.groups.Get(world.group[slot]);
            if (group == null)
            {
                RequestPath(world, slot);
                return;
            }
            if (group.status == GroupStatus.Ready)
            {
                world.moveState[slot] = MoveState.Field;
                // Steering toward where it already stands makes it pick a real heading at once.
                world.steerX[slot] = px;
                world.steerY[slot] = py;
                return;
            }
            if (group.status == GroupStatus.New)
            {
                group.status = GroupStatus.Pending;
                world.routeQueue.Enqueue(RouteRequest.Field(group.id));
            }
            world.moveState[slot] = MoveState.Awaiting;
        }

        /// <summary>If a unit's destination is somewhere it cannot stand, moves the destination to the nearest place it can.</summary>
        static bool KeepGoalOnOpenGround(World world, int slot)
        {
            GameMap map = world.map;
            int goalTile = map.TileAt(world.goalX[slot], world.goalY[slot]);
            if (map.passable[goalTile] == 1) return false;
            int region = map.region[map.TileAt(world.posX[slot], world.posY[slot])];
            int near = map.NearestPassable(goalTile % map.width, Idiv(goalTile, map.width), region, 24);
            if (near == -1) near = map.NearestPassable(goalTile % map.width, Idiv(goalTile, map.width));
            if (near == -1) return false;
            world.goalX[slot] = map.CentreX(near);
            world.goalY[slot] = map.CentreY(near);
            return true;
        }

        /// <summary>
        /// Called when a building has just gone up. Any route may now lead through
        /// it, so shared flow fields are thrown away, and each unit on the move
        /// checks that its way is still open and asks for a new route if not.
        /// </summary>
        public static void RoutesAfterObstacle(World world)
        {
            GameMap map = world.map;
            foreach (MoveGroup group in world.groups.Values)
            {
                if (map.passable[group.goalTile] == 0)
                {
                    int near = map.NearestPassable(group.goalTile % map.width, Idiv(group.goalTile, map.width));
                    if (near != -1) group.goalTile = near;
                }
                if (group.status == GroupStatus.Ready)
                {
                    group.field = null;
                    group.fieldChecksum = 0;
                    group.status = GroupStatus.New;
                }
            }
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0) continue;
                bool moved = KeepGoalOnOpenGround(world, slot);
                int state = world.moveState[slot];
                if (state == MoveState.Idle || state == MoveState.Awaiting) continue;
                if (state == MoveState.Field || moved)
                {
                    ChooseRoute(world, slot);
                    continue;
                }
                // Walk the rest of the way in the mind's eye: here to the next waypoint, and on to the last.
                int x = world.posX[slot];
                int y = world.posY[slot];
                bool open = true;
                int[] path = world.paths[slot];
                if (state == MoveState.Path && path != null)
                {
                    for (int i = world.pathIndex[slot] * 2; i < path.Length && open; i += 2)
                    {
                        open = map.LineOfSight(x, y, path[i], path[i + 1]);
                        x = path[i];
                        y = path[i + 1];
                    }
                }
                else
                {
                    open = map.LineOfSight(x, y, world.goalX[slot], world.goalY[slot]);
                }
                if (!open) ChooseRoute(world, slot);
            }
        }

        /// <summary>Queues a search for a path of the unit's own.</summary>
        public static void RequestPath(World world, int slot)
        {
            world.paths[slot] = null;
            world.pathIndex[slot] = 0;
            world.moveState[slot] = MoveState.Awaiting;
            world.routeQueue.Enqueue(RouteRequest.Path(slot, world.orderSeq[slot]));
        }

        /// <summary>
        /// Ends a unit's current order where it stands and starts the next queued
        /// one, if any.
        /// </summary>
        public static void FinishOrder(World world, int slot)
        {
            MoveGroup group = world.groups.Get(world.group[slot]);
            if (group != null)
            {
                // The formation ends up facing the way it was sent.
                world.dirX[slot] = group.faceX;
                world.dirY[slot] = group.faceY;
            }
            world.ReleaseGroup(world.group[slot]);
            world.group[slot] = 0;
            world.paths[slot] = null;
            world.pathIndex[slot] = 0;
            world.stuck[slot] = 0;
            world.retries[slot] = 0;
            world.moveState[slot] = MoveState.Idle;

            // A unit that is after an enemy has only caught up with it, or been held
            // up on the way. What it does next is for the fighting to decide.
            if (world.engaged[slot] == 1) return;

            if (world.orderKind[slot] == OrderKind.Patrol)
            {
                // Reached one end of the beat: turn round and walk back to the other.
                int backX = world.otherX[slot];
                int backY = world.otherY[slot];
                if (Length(backX - world.posX[slot], backY - world.posY[slot]) > ONE)
                {
                    world.otherX[slot] = world.goalX[slot];
                    world.otherY[slot] = world.goalY[slot];
                    BeginOrder(world, slot, 0, backX, backY);
                    return;
                }
            }
            StartNextOrder(world, slot);
        }

        /// <summary>
        /// Starts a unit on the first order waiting in its queue. With none
        /// waiting it goes back to guarding where it stands.
        /// </summary>
        public static void StartNextOrder(World world, int slot)
        {
            int waiting = world.queueLength[slot];
            if (waiting == 0)
            {
                world.orderKind[slot] = OrderKind.None;
                return;
            }
            int start = slot * World.ORDER_QUEUE_LENGTH;
            int groupId = world.queueGroup[start];
            int goalX = world.queueX[start];
            int goalY = world.queueY[start];
            byte kind = world.queueKind[start];
            for (int k = 1; k < waiting; k++)
            {
                world.queueGroup[start + k - 1] = world.queueGroup[start + k];
                world.queueX[start + k - 1] = world.queueX[start + k];
                world.queueY[start + k - 1] = world.queueY[start + k];
                world.queueKind[start + k - 1] = world.queueKind[start + k];
            }
            world.queueGroup[start + waiting - 1] = 0;
            world.queueX[start + waiting - 1] = 0;
            world.queueY[start + waiting - 1] = 0;
            world.queueKind[start + waiting - 1] = 0;
            world.queueLength[slot] = (byte)(waiting - 1);
            world.orderKind[slot] = kind;
            // The queued entry's claim on its group becomes the current order's claim.
            BeginOrder(world, slot, groupId, goalX, goalY);
        }

        /// <summary>Spends this tick's pathfinding budget on the searches at the head of the queue.</summary>
        public static void RoutingSystem(World world)
        {
            int budget = world.config.pathBudget;
            while (budget > 0)
            {
                if (world.activeSearch == null)
                {
                    if (world.routeQueue.Count == 0) return;
                    RouteRequest request = world.routeQueue.Dequeue();
                    world.activeSearch = StartSearch(world, request);
                    if (world.activeSearch == null) continue;
                }
                ActiveSearch active = world.activeSearch;
                if (active.mapVersion != world.map.passVersion)
                {
                    // A tree has fallen or a building gone up since this search began, so
                    // what it has worked out may be wrong. Begin it again on the new map.
                    active = world.activeSearch = StartSearch(world, active.request);
                    if (active == null) continue;
                }
                budget -= active.search.Run(budget);
                if (!active.search.done) return;
                world.activeSearch = null;
                FinishSearch(world, active);
            }
        }

        static bool PathRequestStillWanted(World world, int slot, int seq)
        {
            return world.alive[slot] == 1 &&
                world.orderSeq[slot] == seq &&
                world.moveState[slot] == MoveState.Awaiting;
        }

        static ActiveSearch StartSearch(World world, RouteRequest request)
        {
            GameMap map = world.map;
            if (request.kind == RouteKind.Path)
            {
                int slot = request.slot;
                int seq = request.seq;
                if (!PathRequestStillWanted(world, slot, seq)) return null;
                int start = map.TileAt(world.posX[slot], world.posY[slot]);
                int goal = map.TileAt(world.goalX[slot], world.goalY[slot]);
                return RestoreSearch(world, request, start, goal, new int[0]);
            }
            MoveGroup group = world.groups.Get(request.group);
            if (group == null) return null;
            var targets = new List<int>();
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 1 && world.group[slot] == group.id)
                {
                    targets.Add(map.TileAt(world.posX[slot], world.posY[slot]));
                }
            }
            return RestoreSearch(world, request, group.goalTile, -1, targets.ToArray());
        }

        /// <summary>
        /// Builds a search from its recorded inputs. Also used when loading a
        /// saved game, where the search is then re-run to the point it had reached.
        /// </summary>
        public static ActiveSearch RestoreSearch(World world, RouteRequest request, int start, int goal, int[] targets)
        {
            Search search =
                request.kind == RouteKind.Path
                    ? (Search)new AStarSearch(world.map, world.searchScratch, start, goal)
                    : new FieldSearch(world.map, world.searchScratch, start, targets);
            return new ActiveSearch
            {
                request = request,
                mapVersion = world.map.passVersion,
                start = start,
                goal = goal,
                targets = targets,
                search = search,
            };
        }

        static void FinishSearch(World world, ActiveSearch active)
        {
            RouteRequest request = active.request;
            if (request.kind == RouteKind.Path)
            {
                int slot = request.slot;
                int seq = request.seq;
                if (!PathRequestStillWanted(world, slot, seq)) return;
                var astar = (AStarSearch)active.search;
                if (!astar.found)
                {
                    // Nowhere to go. Stay put and carry on with whatever is queued next.
                    world.goalX[slot] = world.posX[slot];
                    world.goalY[slot] = world.posY[slot];
                    // A patrol with an end that cannot be reached is no patrol.
                    if (world.orderKind[slot] == OrderKind.Patrol) world.orderKind[slot] = OrderKind.None;
                    FinishOrder(world, slot);
                    return;
                }
                int[] waypoints = SmoothPath(world, slot, astar.Path());
                world.paths[slot] = waypoints;
                world.pathIndex[slot] = 0;
                world.steerX[slot] = waypoints[0];
                world.steerY[slot] = waypoints[1];
                world.moveState[slot] = MoveState.Path;
                return;
            }
            MoveGroup group = world.groups.Get(request.group);
            if (group == null) return;
            byte[] field = ((FieldSearch)active.search).directions;
            group.field = field;
            group.fieldChecksum = ChecksumBytes(field);
            group.status = GroupStatus.Ready;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 1 &&
                    world.group[slot] == group.id &&
                    world.moveState[slot] == MoveState.Awaiting)
                {
                    world.moveState[slot] = MoveState.Field;
                    world.steerX[slot] = world.posX[slot];
                    world.steerY[slot] = world.posY[slot];
                }
            }
        }

        public static uint ChecksumBytes(byte[] bytes)
        {
            unchecked
            {
                uint h = 0x811c9dc5;
                for (int i = 0; i < bytes.Length; i++) h = (h ^ bytes[i]) * 0x01000193;
                return h;
            }
        }

        /// <summary>
        /// Turns a tile-by-tile path into a few waypoints the unit can walk
        /// between in straight lines, cutting every corner that can safely be cut.
        /// </summary>
        static int[] SmoothPath(World world, int slot, int[] tiles)
        {
            GameMap map = world.map;
            int radius = world.radius[slot];
            int goalX = world.goalX[slot];
            int goalY = world.goalY[slot];
            var points = new List<int>();
            int fromX = world.posX[slot];
            int fromY = world.posY[slot];
            int last = tiles.Length - 1;
            int reached = 0;
            while (reached < last && !map.ClearPath(fromX, fromY, goalX, goalY, radius))
            {
                // The furthest tile ahead that can be walked to in a straight line. The
                // next tile is always taken, since stepping to a neighbour is always possible.
                int next = reached + 1;
                for (int j = reached + 1; j <= last; j++)
                {
                    int tile = tiles[j];
                    if (!map.ClearPath(fromX, fromY, map.CentreX(tile), map.CentreY(tile), radius)) break;
                    next = j;
                }
                fromX = map.CentreX(tiles[next]);
                fromY = map.CentreY(tiles[next]);
                points.Add(fromX);
                points.Add(fromY);
                reached = next;
            }
            points.Add(goalX);
            points.Add(goalY);
            return points.ToArray();
        }
    }
}
