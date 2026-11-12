// Ported from src/sim/movement.ts. Keep the two in step.

using System;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    /// <summary>
    /// Moving units, one tick at a time.
    ///
    /// Every tick runs in three passes over all units, each reading only what
    /// the pass before it wrote, so the result never depends on the order units
    /// are visited in:
    ///
    ///   1. Intent: each unit decides where it would like to step.
    ///   2. Separation: units that would overlap are eased apart. A standing unit
    ///      gives way to a comrade on the move, then drifts back to its post.
    ///   3. Commit: positions are kept out of trees, rock and water, and each unit
    ///      checks whether it has arrived or is getting nowhere.
    /// </summary>
    public static class Movement
    {
        /// <summary>How many tiles ahead along a flow field a unit looks for a straight run.</summary>
        const int LOOKAHEAD = 10;
        /// <summary>A standing unit tolerates being this far off its post before walking back.</summary>
        const int HOLD_TOLERANCE = ONE >> 5;
        /// <summary>Close enough to count as having arrived.</summary>
        const int ARRIVAL_RANGE = ONE >> 4;
        /// <summary>A blocked unit this near its destination settles where it stands.</summary>
        const int SETTLE_RANGE = 2 * ONE;
        /// <summary>How many times a blocked unit asks for a fresh route before giving up.</summary>
        const int MAX_RETRIES = 2;
        /// <summary>The neighbour grid's cells are two tiles across.</summary>
        public const int CELL_SHIFT = 17;

        /// <summary>Flags noted during separation, per unit.</summary>
        const int PUSHED_BY_STANDING = 1;
        const int PUSHED_BY_MOVING = 2;

        /// <summary>Eight unit vectors, for separating two units standing on the same spot.</summary>
        static readonly int DIAGONAL = FromRatio(46341, 65536);
        static readonly int[] NUDGE_X = { ONE, DIAGONAL, 0, -DIAGONAL, -ONE, -DIAGONAL, 0, DIAGONAL };
        static readonly int[] NUDGE_Y = { 0, DIAGONAL, ONE, DIAGONAL, 0, -DIAGONAL, -ONE, -DIAGONAL };

        public static void MovementSystem(World world)
        {
            int count = world.highWater;
            if (count == 0) return;
            BuildNeighbourGrid(world);
            int steerEvery = Math.Max(1, Idiv(world.config.tickRate, 8));
            int stuckLimit = Math.Max(4, Idiv(world.config.tickRate * 3, 2));
            int fullRun = TicksOf(CHARGE_RUN_SECONDS, world.config.tickRate);

            byte[] alive = world.alive;
            byte[] moveState = world.moveState;
            int[] posX = world.posX;
            int[] posY = world.posY;
            int[] nextX = world.scratchX;
            int[] nextY = world.scratchY;

            // Pass 1: intent. Buildings take no part in any of this.
            byte[] mobile = world.mobile;
            for (int slot = 0; slot < count; slot++)
            {
                if (alive[slot] == 0 || mobile[slot] == 0) continue;
                nextX[slot] = posX[slot];
                nextY[slot] = posY[slot];
                int state = moveState[slot];
                if (state == MoveState.Awaiting) continue;
                if (state == MoveState.Idle)
                {
                    StepToward(world, slot, world.goalX[slot], world.goalY[slot], HOLD_TOLERANCE, false);
                    continue;
                }
                Steer(world, slot, (world.tick + slot) % steerEvery == 0);
                // Steering can hand the unit back to the route queue.
                if (moveState[slot] == MoveState.Awaiting) continue;
                StepToward(world, slot, world.steerX[slot], world.steerY[slot], 0, true);
            }

            Separate(world);

            // Pass 3: commit.
            int[] pushX = world.scratchPushX;
            int[] pushY = world.scratchPushY;
            byte[] flags = world.scratchFlags;
            for (int slot = 0; slot < count; slot++)
            {
                if (alive[slot] == 0 || mobile[slot] == 0) continue;
                int fromX = posX[slot];
                int fromY = posY[slot];
                SettleOnGround(world, slot, nextX[slot] + pushX[slot], nextY[slot] + pushY[slot]);
                if (world.TypeOf(slot).charge > 0)
                {
                    // A rider gathers way while it keeps moving and loses it standing about,
                    // though not in the moment between pulling up and striking.
                    int dx = posX[slot] - fromX;
                    int dy = posY[slot] - fromY;
                    int way = world.momentum[slot];
                    if ((dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy) >= world.speed[slot] >> 1)
                    {
                        if (way < fullRun) world.momentum[slot] = (ushort)(way + 1);
                    }
                    else if (way > 0 && world.windup[slot] == 0)
                    {
                        world.momentum[slot] = (ushort)(way - 1);
                    }
                }
                int state = moveState[slot];
                if (state == MoveState.Idle)
                {
                    // Two standing units that crowd each other both shuffle over for good.
                    if ((flags[slot] & PUSHED_BY_STANDING) != 0)
                    {
                        world.goalX[slot] = posX[slot];
                        world.goalY[slot] = posY[slot];
                    }
                    continue;
                }
                if (state == MoveState.Awaiting) continue;

                int toGoal = Length(world.goalX[slot] - posX[slot], world.goalY[slot] - posY[slot]);
                int[] path = world.paths[slot];
                bool onLastLeg =
                    state == MoveState.Direct ||
                    (state == MoveState.Path && path != null && world.pathIndex[slot] * 2 >= path.Length - 2);
                if (onLastLeg && toGoal <= Math.Max(ARRIVAL_RANGE, world.speed[slot]))
                {
                    Routing.FinishOrder(world, slot);
                    continue;
                }

                // Is it getting anywhere? On the final approach that means getting
                // nearer; before that, any real movement counts, since a route may lead
                // away from the destination for a while.
                int quarterStride = world.speed[slot] >> 2;
                bool progressing;
                if (onLastLeg)
                {
                    progressing = toGoal < world.closest[slot] - quarterStride;
                    if (progressing) world.closest[slot] = toGoal;
                }
                else
                {
                    int dx = posX[slot] - fromX;
                    int dy = posY[slot] - fromY;
                    progressing = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy) >= quarterStride;
                }
                if (progressing)
                {
                    if (world.stuck[slot] > 0) world.stuck[slot] = world.stuck[slot] - 1;
                    continue;
                }
                // Held up behind others who are also on the move is a queue, not a dead
                // end, so patience runs out eight times more slowly.
                if ((flags[slot] & PUSHED_BY_MOVING) != 0 && (world.tick & 7) != 0) continue;
                world.stuck[slot] = world.stuck[slot] + 1;
                if (world.stuck[slot] <= stuckLimit) continue;
                world.stuck[slot] = 0;
                if (toGoal > SETTLE_RANGE && world.retries[slot] < MAX_RETRIES)
                {
                    world.retries[slot] = (byte)(world.retries[slot] + 1);
                    Routing.RequestPath(world, slot);
                }
                else
                {
                    // Its place is taken or cannot be reached. Here will do.
                    world.goalX[slot] = posX[slot];
                    world.goalY[slot] = posY[slot];
                    Routing.FinishOrder(world, slot);
                }
            }
        }

        /// <summary>Sorts units into grid cells so each can find its neighbours quickly.</summary>
        public static void BuildNeighbourGrid(World world)
        {
            byte[] alive = world.alive;
            byte[] mobile = world.mobile;
            int[] posX = world.posX;
            int[] posY = world.posY;
            int[] cellStart = world.cellStart;
            int[] cellItems = world.cellItems;
            int columns = (world.map.width + 1) >> 1;
            Array.Clear(cellStart, 0, cellStart.Length);
            int units = 0;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (alive[slot] == 0 || mobile[slot] == 0) continue;
                units++;
                cellStart[(posY[slot] >> CELL_SHIFT) * columns + (posX[slot] >> CELL_SHIFT) + 1]++;
            }
            for (int cell = 1; cell < cellStart.Length; cell++) cellStart[cell] = cellStart[cell] + cellStart[cell - 1];
            // Filling from the highest slot down leaves each cell in ascending slot order.
            for (int slot = world.highWater - 1; slot >= 0; slot--)
            {
                if (alive[slot] == 0 || mobile[slot] == 0) continue;
                int cell = (posY[slot] >> CELL_SHIFT) * columns + (posX[slot] >> CELL_SHIFT);
                cellItems[cellStart[cell + 1] - 1] = slot;
                cellStart[cell + 1] = cellStart[cell + 1] - 1;
            }
            // The fill shifted every boundary down by one cell; shift them back.
            for (int cell = 0; cell < cellStart.Length - 1; cell++) cellStart[cell] = cellStart[cell + 1];
            cellStart[cellStart.Length - 1] = units;
        }

        /// <summary>Updates where a moving unit is heading.</summary>
        static void Steer(World world, int slot, bool refresh)
        {
            GameMap map = world.map;
            int px = world.posX[slot];
            int py = world.posY[slot];
            int goalX = world.goalX[slot];
            int goalY = world.goalY[slot];
            int state = world.moveState[slot];

            if (state == MoveState.Direct)
            {
                world.steerX[slot] = goalX;
                world.steerY[slot] = goalY;
                // Jostling can shove it behind an obstacle. If so, find a proper route.
                if (refresh && !map.ClearPath(px, py, goalX, goalY, world.radius[slot])) Routing.ChooseRoute(world, slot);
                return;
            }

            int stride = world.speed[slot];
            if (state == MoveState.Path)
            {
                int[] path = world.paths[slot];
                int index = world.pathIndex[slot];
                int lastIndex = (path.Length >> 1) - 1;
                while (index < lastIndex)
                {
                    int wx = path[index * 2];
                    int wy = path[index * 2 + 1];
                    if (Length(wx - px, wy - py) > stride) break;
                    index++;
                }
                world.pathIndex[slot] = index;
                world.steerX[slot] = path[index * 2];
                world.steerY[slot] = path[index * 2 + 1];
                return;
            }

            // Following the group's flow field.
            bool reached = Length(world.steerX[slot] - px, world.steerY[slot] - py) <= stride;
            if (!refresh && !reached) return;
            MoveGroup group = world.groups.Get(world.group[slot]);
            if (group == null || group.field == null)
            {
                Routing.RequestPath(world, slot);
                return;
            }
            int radius = world.radius[slot];
            int tile = map.TileAt(px, py);
            if (tile == group.goalTile || map.ClearPath(px, py, goalX, goalY, radius))
            {
                world.moveState[slot] = MoveState.Direct;
                world.steerX[slot] = goalX;
                world.steerY[slot] = goalY;
                return;
            }
            byte[] field = group.field;
            if (field[tile] > Search.FIELD_GOAL)
            {
                // Pushed somewhere the field does not cover. Go it alone.
                Routing.RequestPath(world, slot);
                return;
            }
            // Aim at the furthest tile along the flow that can be walked to in a
            // straight line, so the unit crosses open ground at any angle instead of
            // zigzagging from tile to tile.
            int aim = -1;
            for (int k = 0; k < LOOKAHEAD; k++)
            {
                int dir = field[tile];
                if (dir >= Search.FIELD_GOAL) break;
                tile += GameMap.DIR_Y[dir] * map.width + GameMap.DIR_X[dir];
                if (k > 0 && !map.ClearPath(px, py, map.CentreX(tile), map.CentreY(tile), radius)) break;
                aim = tile;
            }
            if (aim == -1) return;
            world.steerX[slot] = map.CentreX(aim);
            world.steerY[slot] = map.CentreY(aim);
        }

        /// <summary>
        /// Sets the unit's intended position one stride toward a point, or onto it
        /// if that is nearer. Does nothing within `tolerance` of the point.
        /// </summary>
        static void StepToward(World world, int slot, int x, int y, int tolerance, bool turn)
        {
            int px = world.posX[slot];
            int py = world.posY[slot];
            int dx = x - px;
            int dy = y - py;
            int distance = Length(dx, dy);
            if (distance <= tolerance || distance == 0) return;
            int stride = world.speed[slot];
            if (distance <= stride)
            {
                world.scratchX[slot] = x;
                world.scratchY[slot] = y;
            }
            else
            {
                world.scratchX[slot] = px + MulDiv(dx, stride, distance);
                world.scratchY[slot] = py + MulDiv(dy, stride, distance);
            }
            if (turn)
            {
                world.dirX[slot] = MulDiv(dx, ONE, distance);
                world.dirY[slot] = MulDiv(dy, ONE, distance);
            }
        }

        /// <summary>
        /// Pass 2. For each unit, works out how far it must shift so that it does
        /// not overlap its neighbours' intended positions.
        /// </summary>
        static void Separate(World world)
        {
            byte[] alive = world.alive;
            byte[] moveState = world.moveState;
            byte[] owner = world.owner;
            int[] radius = world.radius;
            byte[] rooted = world.rooted;
            int[] dirX = world.dirX;
            int[] dirY = world.dirY;
            int[] cellStart = world.cellStart;
            int[] cellItems = world.cellItems;
            int[] nextX = world.scratchX;
            int[] nextY = world.scratchY;
            int[] pushX = world.scratchPushX;
            int[] pushY = world.scratchPushY;
            byte[] flags = world.scratchFlags;
            int columns = (world.map.width + 1) >> 1;
            int rows = (world.map.height + 1) >> 1;

            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (alive[slot] == 0 || world.mobile[slot] == 0) continue;
                int x = nextX[slot];
                int y = nextY[slot];
                int r = radius[slot];
                bool moving = moveState[slot] >= MoveState.Path;
                int shiftX = 0;
                int shiftY = 0;
                int flag = 0;
                int cellX = world.posX[slot] >> CELL_SHIFT;
                int cellY = world.posY[slot] >> CELL_SHIFT;
                for (int cy = cellY - 1; cy <= cellY + 1; cy++)
                {
                    if (cy < 0 || cy >= rows) continue;
                    for (int cx = cellX - 1; cx <= cellX + 1; cx++)
                    {
                        if (cx < 0 || cx >= columns) continue;
                        int cell = cy * columns + cx;
                        for (int at = cellStart[cell]; at < cellStart[cell + 1]; at++)
                        {
                            int other = cellItems[at];
                            if (other == slot) continue;
                            int dx = x - nextX[other];
                            int dy = y - nextY[other];
                            int apart = r + radius[other];
                            if (dx >= apart || dx <= -apart || dy >= apart || dy <= -apart) continue;
                            int distance = Length(dx, dy);
                            if (distance >= apart) continue;
                            int overlap = apart - distance;

                            // How much of the overlap this unit gives up: none, half or all.
                            bool otherMoving = moveState[other] >= MoveState.Path;
                            // A soldier planted in front of an enemy holds its ground against
                            // friend and foe alike, so the ranks behind go round the fighting
                            // line instead of shoving it out of reach.
                            bool comrades = owner[slot] == owner[other] && rooted[slot] == 0 && rooted[other] == 0;
                            int halves;
                            if (otherMoving) flag |= PUSHED_BY_MOVING;
                            if (moving == otherMoving)
                            {
                                halves = 1;
                                if (!moving) flag |= PUSHED_BY_STANDING;
                            }
                            else if (moving)
                            {
                                halves = comrades ? 0 : 2;
                            }
                            else
                            {
                                halves = comrades ? 2 : 0;
                            }

                            if (halves == 2 && comrades)
                            {
                                // A standing unit steps aside for a comrade coming through: to
                                // whichever side of the walker's line it is already on, never
                                // ahead of them, or it would be swept along like a leaf.
                                int side = (long)dirX[other] * dy - (long)dirY[other] * dx >= 0 ? 1 : -1;
                                shiftX += side * MulDiv(-dirY[other], overlap, ONE);
                                shiftY += side * MulDiv(dirX[other], overlap, ONE);
                            }
                            else if (halves > 0)
                            {
                                if (distance == 0)
                                {
                                    // Exactly on top of each other: part along a direction both agree on.
                                    int low = slot < other ? slot : other;
                                    int high = slot < other ? other : slot;
                                    int way = (low * 7 + high * 13) & 7;
                                    int sign = slot < other ? 1 : -1;
                                    shiftX += sign * MulDiv(NUDGE_X[way], overlap * halves, 2 * ONE);
                                    shiftY += sign * MulDiv(NUDGE_Y[way], overlap * halves, 2 * ONE);
                                }
                                else
                                {
                                    shiftX += MulDiv(dx, overlap * halves, 2 * distance);
                                    shiftY += MulDiv(dy, overlap * halves, 2 * distance);
                                }
                            }

                            // Keep to the right when meeting someone head on, or someone who
                            // will not budge, so two columns pass instead of locking shields.
                            if (moving)
                            {
                                bool headOn = otherMoving && (long)dirX[slot] * dirX[other] + (long)dirY[slot] * dirY[other] < 0;
                                if (headOn || (!otherMoving && !comrades))
                                {
                                    shiftX += MulDiv(-dirY[slot], overlap, 2 * ONE);
                                    shiftY += MulDiv(dirX[slot], overlap, 2 * ONE);
                                }
                            }
                        }
                    }
                }
                // Never shove a unit further than its own radius in one tick.
                if (shiftX > r) shiftX = r;
                else if (shiftX < -r) shiftX = -r;
                if (shiftY > r) shiftY = r;
                else if (shiftY < -r) shiftY = -r;
                pushX[slot] = shiftX;
                pushY[slot] = shiftY;
                flags[slot] = (byte)flag;
            }
        }

        /// <summary>
        /// Pass 3, per unit. Moves it to (x, y) but keeps its whole body on open
        /// ground: out of impassable tiles and inside the map.
        /// </summary>
        static void SettleOnGround(World world, int slot, int x, int y)
        {
            GameMap map = world.map;
            int r = world.radius[slot];
            if (x < r) x = r;
            else if (x > map.maxX - r) x = map.maxX - r;
            if (y < r) y = r;
            else if (y > map.maxY - r) y = map.maxY - r;

            for (int round = 0; round < 2; round++)
            {
                int tx = x >> 16;
                int ty = y >> 16;
                for (int oy = -1; oy <= 1; oy++)
                {
                    for (int ox = -1; ox <= 1; ox++)
                    {
                        if ((ox == 0 && oy == 0) || map.IsPassable(tx + ox, ty + oy)) continue;
                        // The nearest point of the blocked tile.
                        int left = (tx + ox) << 16;
                        int top = (ty + oy) << 16;
                        int nearX = x < left ? left : x > left + ONE ? left + ONE : x;
                        int nearY = y < top ? top : y > top + ONE ? top + ONE : y;
                        int dx = x - nearX;
                        int dy = y - nearY;
                        if (dx >= r || dx <= -r || dy >= r || dy <= -r) continue;
                        int distance = Length(dx, dy);
                        if (distance >= r || distance == 0) continue;
                        x += MulDiv(dx, r - distance, distance);
                        y += MulDiv(dy, r - distance, distance);
                    }
                }
            }
            // If it has somehow ended up inside an obstacle, it does not move this tick.
            if (!map.IsPassable(x >> 16, y >> 16)) return;
            world.posX[slot] = x;
            world.posY[slot] = y;
        }
    }
}
