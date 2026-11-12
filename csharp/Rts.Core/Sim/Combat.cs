// Ported from src/sim/combat.ts. Keep the two in step.

using System;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    /// <summary>
    /// Fighting.
    ///
    /// A soldier with an enemy to deal with walks up until it is within reach,
    /// plants itself, and strikes: a short wind-up, the blow, then a pause before
    /// the next. Archers and towers do the same from a distance, and their arrows
    /// always find their mark after a moment in the air.
    ///
    /// What a blow does is plain arithmetic:
    ///
    ///   damage  =  the weapon's damage
    ///            + a bonus if the target is the kind of thing this weapon is good against
    ///            + a charge bonus for a rider's first blow after a run
    ///            - the target's armour (one figure for blades, another for arrows)
    ///
    /// and never less than 1. An arrow shot from high ground does a quarter more.
    /// A charge that meets a spearman standing ready does nothing extra, and
    /// costs the rider a blow from the spear.
    ///
    /// Whom a soldier goes after depends on its orders. Left alone it guards its
    /// post: it fights what comes within eight tiles and then walks back. Sent
    /// somewhere with an attack-move it fights whatever it meets on the way and
    /// then carries on. Told simply to move, it ignores everything. Told to hold,
    /// it strikes only at what comes within reach.
    ///
    /// Nobody goes after an enemy their side cannot see (see Vision.cs).
    ///
    /// Everything dealt in a tick is taken off at the end of the tick, so two
    /// soldiers who strike at the same moment both land their blows.
    /// </summary>
    public static class Combat
    {
        /// <summary>How far off a soldier notices an enemy: this, or a little past its own range if that is further.</summary>
        const int NOTICE = 8 * ONE;
        const int NOTICE_PAST_RANGE = 2 * ONE;
        /// <summary>A guard does not go after anything further than this from its post.</summary>
        const int LEASH = 12 * ONE;
        /// <summary>A soldier on the march gives up on an enemy that gets this far from it.</summary>
        const int LOSE_INTEREST = 14 * ONE;
        /// <summary>
        /// A blow or shot once begun still goes home if the target has drawn back
        /// no more than this in the meantime. It is enough that running away never
        /// dodges a blow already on its way; it only keeps the next one from
        /// starting.
        /// </summary>
        const int SLACK = 3 * HALF;
        /// <summary>How many times a soldier that cannot get at its target tries again before looking for another.</summary>
        const int CHASE_TRIES = 3;
        /// <summary>How far a cry for help carries: soldiers this near someone who is hit come to their aid.</summary>
        const int HEARING = 8 * ONE;
        /// <summary>A unit attacking a building stands this far clear of its wall.</summary>
        const int AT_THE_WALL = ONE >> 4;

        const int CELL_SHIFT = Movement.CELL_SHIFT;

        public static void CombatSystem(World world)
        {
            int count = world.highWater;
            Movement.BuildNeighbourGrid(world);
            int buildings = 0;
            for (int slot = 0; slot < count; slot++)
            {
                if (world.alive[slot] == 1 && world.mobile[slot] == 0) world.scratchBuildings[buildings++] = slot;
            }
            world.scratchBuildingCount = buildings;

            LandShots(world);

            int tickRate = world.config.tickRate;
            int lookEvery = Math.Max(1, Idiv(tickRate, 4));
            int aimEvery = Math.Max(1, Idiv(tickRate, 5));
            for (int slot = 0; slot < count; slot++)
            {
                if (world.alive[slot] == 0) continue;
                EntityType type = world.TypeOf(slot);
                if (type.damage == 0) continue;
                if (world.cooldown[slot] > 0) world.cooldown[slot] = (ushort)(world.cooldown[slot] - 1);
                if (world.mobile[slot] == 1) Fight(world, slot, type, lookEvery, aimEvery);
                else if (world.built[slot] == 1) ShootFromBuilding(world, slot, type, lookEvery);
            }

            // Everything dealt this tick comes off together, and the dead are removed.
            int[] damage = world.scratchDamage;
            for (int slot = 0; slot < count; slot++)
            {
                int taken = damage[slot];
                if (taken == 0) continue;
                damage[slot] = 0;
                if (world.alive[slot] == 0) continue;
                world.hp[slot] = world.hp[slot] - taken;
                if (world.hp[slot] <= 0) world.Destroy(world.IdAt(slot));
            }
        }

        // ---- Units -------------------------------------------------------------------

        static void Fight(World world, int slot, EntityType type, int lookEvery, int aimEvery)
        {
            if (world.windup[slot] > 0)
            {
                // Committed to a blow; nothing else happens until it lands.
                world.windup[slot] = (ushort)(world.windup[slot] - 1);
                if (world.windup[slot] == 0) Strike(world, slot, type);
                return;
            }

            int target = world.target[slot];
            if (target != World.NO_ENTITY && !StillWanted(world, slot, target, type))
            {
                LoseTarget(world, slot);
                // That may have started it on its next order.
                if (world.engaged[slot] == 0) return;
                target = World.NO_ENTITY;
            }
            int kind = world.orderKind[slot];

            if (target == World.NO_ENTITY)
            {
                if (kind == OrderKind.Move) return;
                // A soldier in a fight looks for its next opponent at once; otherwise it glances round a few times a second.
                bool looking = type.aggressive && (world.engaged[slot] == 1 || (world.tick + slot) % lookEvery == 0);
                if (looking) target = Acquire(world, slot, type, kind);
                if (target == World.NO_ENTITY)
                {
                    if (world.engaged[slot] == 1) Disengage(world, slot);
                    return;
                }
                Engage(world, slot, target);
            }

            int at = World.EntityIndex(target);
            if (GapBetween(world, slot, at) <= type.range)
            {
                if (world.moveState[slot] != MoveState.Idle) world.StandStill(slot);
                world.rooted[slot] = 1;
                world.chaseTries[slot] = 0;
                Face(world, slot, world.posX[at], world.posY[at]);
                if (world.cooldown[slot] == 0)
                {
                    world.windup[slot] = (ushort)TicksOf(type.windup, world.config.tickRate);
                    if (world.windup[slot] == 0) Strike(world, slot, type);
                }
                return;
            }
            world.rooted[slot] = 0;
            Chase(world, slot, at, aimEvery);
        }

        /// <summary>Whether a unit should carry on with the target it has.</summary>
        static bool StillWanted(World world, int slot, int target, EntityType type)
        {
            if (!world.IsAlive(target)) return false;
            int at = World.EntityIndex(target);
            if (!world.Hostile(world.owner[slot], world.owner[at])) return false;
            return WorthChasing(world, slot, at, world.orderKind[slot], type);
        }

        /// <summary>
        /// Whether a unit's orders let it go after something that is where this is
        /// now. Nobody goes after what their side cannot see, except that a
        /// building once ordered attacked stays a target: it is not going anywhere.
        /// </summary>
        static bool WorthChasing(World world, int slot, int at, int kind, EntityType type)
        {
            bool inSight = Vision.CanSee(world, world.owner[slot], at);
            if (kind == OrderKind.AttackTarget) return inSight || world.mobile[at] == 0;
            if (!inSight) return false;
            if (kind == OrderKind.Hold) return GapBetween(world, slot, at) <= type.range;
            if (kind == OrderKind.None)
            {
                // A guard keeps near its post: where it stands, or where it left to fight.
                bool fighting = world.engaged[slot] == 1;
                int postX = fighting ? world.homeX[slot] : world.goalX[slot];
                int postY = fighting ? world.homeY[slot] : world.goalY[slot];
                return DistanceTo(world, postX, postY, at) <= LEASH;
            }
            return GapBetween(world, slot, at) <= LOSE_INTEREST;
        }

        /// <summary>Breaks off whatever the unit was doing, remembers it, and sets it on an enemy.</summary>
        static void Engage(World world, int slot, int target)
        {
            if (world.engaged[slot] == 0)
            {
                world.engaged[slot] = 1;
                world.chaseTries[slot] = 0;
                int kind = world.orderKind[slot];
                if (kind != OrderKind.Hold && kind != OrderKind.AttackTarget)
                {
                    // Where it was going, and the shared order it was going under, to pick up again afterwards.
                    world.homeX[slot] = world.goalX[slot];
                    world.homeY[slot] = world.goalY[slot];
                    world.homeGroup[slot] = world.group[slot];
                    world.group[slot] = 0;
                    world.StandStill(slot);
                }
            }
            world.target[slot] = target;
        }

        /// <summary>The unit's target is dead, gone or out of bounds.</summary>
        static void LoseTarget(World world, int slot)
        {
            world.target[slot] = World.NO_ENTITY;
            world.rooted[slot] = 0;
            world.chaseTries[slot] = 0;
            if (world.orderKind[slot] != OrderKind.AttackTarget) return;
            // The one it was sent after is finished. It goes on to its next order, or guards where it stands.
            world.orderKind[slot] = OrderKind.None;
            world.StandStill(slot);
            world.homeX[slot] = world.posX[slot];
            world.homeY[slot] = world.posY[slot];
            if (world.queueLength[slot] > 0)
            {
                world.engaged[slot] = 0;
                Routing.StartNextOrder(world, slot);
            }
        }

        /// <summary>Nothing left to fight: back to the march, or back to its post.</summary>
        static void Disengage(World world, int slot)
        {
            world.engaged[slot] = 0;
            world.target[slot] = World.NO_ENTITY;
            world.rooted[slot] = 0;
            world.chaseTries[slot] = 0;
            int kind = world.orderKind[slot];
            if (kind == OrderKind.Hold) return;
            int group = world.homeGroup[slot];
            world.homeGroup[slot] = 0;
            int homeX = world.homeX[slot];
            int homeY = world.homeY[slot];
            if (kind == OrderKind.None && Length(homeX - world.posX[slot], homeY - world.posY[slot]) <= ONE >> 3)
            {
                // Already at its post.
                world.ReleaseGroup(group);
                world.StandStill(slot);
                world.goalX[slot] = homeX;
                world.goalY[slot] = homeY;
                return;
            }
            // Its claim on the shared order passes back to the march.
            Routing.BeginOrder(world, slot, group, homeX, homeY);
        }

        /// <summary>
        /// The nearest enemy this unit's orders let it go after, or NO_ENTITY.
        /// Units come before buildings, and only a unit sent out to attack goes
        /// for buildings of its own accord. A guard leaves them alone unless one
        /// shoots at it, which Hurt() deals with.
        /// </summary>
        static int Acquire(World world, int slot, EntityType type, int kind)
        {
            GameMap map = world.map;
            int[] cellStart = world.cellStart;
            int[] cellItems = world.cellItems;
            byte[] owner = world.owner;
            int[] posX = world.posX;
            int[] posY = world.posY;
            int[] radius = world.radius;
            int px = posX[slot];
            int py = posY[slot];
            int me = owner[slot];
            int region = map.region[map.TileAt(px, py)];
            int sight =
                kind == OrderKind.Hold ? type.range + radius[slot] : Math.Max(NOTICE, type.range + NOTICE_PAST_RANGE);
            // Wide enough to take in the largest unit whose edge is within sight.
            int span = sight + ONE;
            int columns = (map.width + 1) >> 1;
            int rows = (map.height + 1) >> 1;
            int x0 = Math.Max(0, (px - span) >> CELL_SHIFT);
            int x1 = Math.Min(columns - 1, (px + span) >> CELL_SHIFT);
            int y0 = Math.Max(0, (py - span) >> CELL_SHIFT);
            int y1 = Math.Min(rows - 1, (py + span) >> CELL_SHIFT);
            int best = -1;
            int bestDistance = 0;
            for (int cy = y0; cy <= y1; cy++)
            {
                for (int cx = x0; cx <= x1; cx++)
                {
                    int cell = cy * columns + cx;
                    for (int i = cellStart[cell]; i < cellStart[cell + 1]; i++)
                    {
                        int other = cellItems[i];
                        if (!world.Hostile(me, owner[other])) continue;
                        int dx = posX[other] - px;
                        int dy = posY[other] - py;
                        if (dx > span || dx < -span || dy > span || dy < -span) continue;
                        int distance = Length(dx, dy) - radius[other];
                        if (distance > sight || (best != -1 && distance >= bestDistance)) continue;
                        // A soldier on foot cannot get at someone across the river. An archer can still shoot.
                        if (!type.ranged && map.region[map.TileAt(posX[other], posY[other])] != region) continue;
                        if (!WorthChasing(world, slot, other, kind, type)) continue;
                        best = other;
                        bestDistance = distance;
                    }
                }
            }
            if (best != -1) return world.IdAt(best);

            if (kind != OrderKind.AttackMove && kind != OrderKind.Patrol) return World.NO_ENTITY;
            for (int i = 0; i < world.scratchBuildingCount; i++)
            {
                int other = world.scratchBuildings[i];
                if (!world.Hostile(me, owner[other])) continue;
                int distance = DistanceTo(world, px, py, other);
                if (distance > sight || (best != -1 && distance >= bestDistance)) continue;
                if (!WorthChasing(world, slot, other, kind, type)) continue;
                if (distance - radius[slot] > type.range && !FindPlaceBeside(world, slot, other)) continue;
                best = other;
                bestDistance = distance;
            }
            return best == -1 ? World.NO_ENTITY : world.IdAt(best);
        }

        /// <summary>Walks a unit toward a target it cannot yet reach. Where it should head is left in world.aimX and aimY by the two functions below.</summary>
        static void Chase(World world, int slot, int at, int aimEvery)
        {
            bool standing = world.moveState[slot] == MoveState.Idle;
            // On the move it corrects its aim a few times a second, which is enough to follow a running target.
            if (!standing && (world.tick + slot) % aimEvery != 0) return;

            bool reachable;
            if (world.mobile[at] == 1) reachable = FindWayToward(world, slot, world.posX[at], world.posY[at]);
            else reachable = FindPlaceBeside(world, slot, at);

            if (standing)
            {
                // It has come to a halt short of its target: crowded out, or there is no way through.
                if (!reachable || world.chaseTries[slot] >= CHASE_TRIES)
                {
                    LoseTarget(world, slot);
                    return;
                }
                world.chaseTries[slot] = (byte)(world.chaseTries[slot] + 1);
                Routing.BeginOrder(world, slot, 0, world.aimX, world.aimY);
                return;
            }
            if (!reachable) return;
            if (Length(world.goalX[slot] - world.aimX, world.goalY[slot] - world.aimY) > HALF) Routing.BeginOrder(world, slot, 0, world.aimX, world.aimY);
        }

        /// <summary>
        /// Sets the aim to a point, or, if the point is on ground this unit cannot
        /// walk to, to the nearest ground it can. Returns false if there is none
        /// near.
        /// </summary>
        static bool FindWayToward(World world, int slot, int x, int y)
        {
            GameMap map = world.map;
            int region = map.region[map.TileAt(world.posX[slot], world.posY[slot])];
            int tile = map.TileAt(x, y);
            if (map.region[tile] == region)
            {
                world.aimX = x;
                world.aimY = y;
                return true;
            }
            int near = map.NearestPassable(tile % map.width, Idiv(tile, map.width), region, 8);
            if (near == -1) return false;
            world.aimX = map.CentreX(near);
            world.aimY = map.CentreY(near);
            return true;
        }

        /// <summary>
        /// Sets the aim to the nearest place this unit can stand right up against
        /// a building. Returns false if it cannot get to any side of it.
        /// </summary>
        static bool FindPlaceBeside(World world, int slot, int building)
        {
            GameMap map = world.map;
            int px = world.posX[slot];
            int py = world.posY[slot];
            int region = map.region[map.TileAt(px, py)];
            int footprint = world.TypeOf(building).footprint;
            // The building's walls, pushed out by the room the unit needs to stand clear of them.
            int clear = footprint * HALF + world.radius[slot] + AT_THE_WALL;
            int left = world.posX[building] - clear;
            int right = world.posX[building] + clear;
            int top = world.posY[building] - clear;
            int bottom = world.posY[building] + clear;

            // Straight to the nearest point of the wall, if the ground there is open.
            int x = px < left ? left : px > right ? right : px;
            int y = py < top ? top : py > bottom ? bottom : py;
            if (x > left && x < right && y > top && y < bottom)
            {
                // Inside the outline, which can only happen in the corner of a neighbouring tile. Step out sideways.
                x = px - left < right - px ? left : right;
            }
            if (x >= 0 && y >= 0 && x <= map.maxX && y <= map.maxY)
            {
                int tile = map.TileAt(x, y);
                if (map.passable[tile] == 1 && map.region[tile] == region)
                {
                    world.aimX = x;
                    world.aimY = y;
                    return true;
                }
            }

            // Otherwise the nearest open tile round the outside.
            int reach = (footprint >> 1) + 1;
            int cx = world.posX[building] >> 16;
            int cy = world.posY[building] >> 16;
            int bestDistance = -1;
            for (int oy = -reach; oy <= reach; oy++)
            {
                for (int ox = -reach; ox <= reach; ox++)
                {
                    if (ox != -reach && ox != reach && oy != -reach && oy != reach) continue;
                    int tx = cx + ox;
                    int ty = cy + oy;
                    if (!map.IsPassable(tx, ty) || map.region[ty * map.width + tx] != region) continue;
                    // The middle of that tile, drawn in toward the wall.
                    int midX = tx * ONE + HALF;
                    int midY = ty * ONE + HALF;
                    int nearX = midX < left ? left : midX > right ? right : midX;
                    int nearY = midY < top ? top : midY > bottom ? bottom : midY;
                    int distance = Length(nearX - px, nearY - py);
                    if (bestDistance == -1 || distance < bestDistance)
                    {
                        world.aimX = nearX;
                        world.aimY = nearY;
                        bestDistance = distance;
                    }
                }
            }
            return bestDistance != -1;
        }

        /// <summary>The blow lands, or the arrow leaves the string.</summary>
        static void Strike(World world, int slot, EntityType type)
        {
            int tickRate = world.config.tickRate;
            world.cooldown[slot] = (ushort)Math.Max(1, TicksOf(type.cycle, tickRate) - TicksOf(type.windup, tickRate));
            int target = world.target[slot];
            if (!world.IsAlive(target)) return;
            int at = World.EntityIndex(target);
            if (GapBetween(world, slot, at) > type.range + SLACK) return;

            int extra = 0;
            if (type.charge > 0 && world.momentum[slot] >= ChargeReadyTicks(tickRate))
            {
                world.momentum[slot] = 0;
                EntityType victim = world.TypeOf(at);
                if (victim.braces && world.mobile[at] == 1 && world.moveState[at] == MoveState.Idle)
                {
                    // Rode onto levelled spears: the charge is wasted and the rider pays for it.
                    Hurt(world, slot, DamageOf(world, at, slot, 0), target);
                }
                else
                {
                    extra = type.charge;
                }
            }
            int damage = DamageOf(world, slot, at, extra);
            if (type.ranged) Loose(world, slot, at, damage);
            else Hurt(world, at, damage, world.IdAt(slot));
        }

        /// <summary>What one hit from an attacker does to a victim.</summary>
        public static int DamageOf(World world, int attacker, int victim, int extra)
        {
            EntityType weapon = world.TypeOf(attacker);
            EntityType body = world.TypeOf(victim);
            int damage = weapon.damage + extra;
            foreach (int[] bonus in weapon.bonuses)
            {
                if ((body.tags & bonus[0]) != 0) damage += bonus[1];
            }
            damage -= weapon.ranged ? body.rangedArmor : body.meleeArmor;
            if (damage < 1) damage = 1;
            if (weapon.ranged)
            {
                GameMap map = world.map;
                int from = map.HeightOf(map.TileAt(world.posX[attacker], world.posY[attacker]));
                int to = map.HeightOf(map.TileAt(world.posX[victim], world.posY[victim]));
                // A quarter more from high ground, to the nearest whole point.
                if (from - to >= HIGH_GROUND) damage = (damage * 5 + 2) >> 2;
            }
            return damage;
        }

        /// <summary>Sends an arrow on its way. It lands after the time it takes to fly the distance.</summary>
        static void Loose(World world, int slot, int at, int damage)
        {
            int distance = Length(world.posX[at] - world.posX[slot], world.posY[at] - world.posY[slot]);
            int perTick = Math.Max(1, Idiv(SHOT_SPEED, world.config.tickRate));
            int flight = Math.Max(1, Idiv(distance + perTick - 1, perTick));
            world.AddShot(world.posX[slot], world.posY[slot], world.IdAt(slot), world.IdAt(at), damage, world.tick + flight);
        }

        /// <summary>Arrows whose time has come hit their targets, if those are still alive.</summary>
        static void LandShots(World world)
        {
            int[] shots = world.shots;
            int kept = 0;
            for (int i = 0; i < world.shotCount; i++)
            {
                int at = i * World.SHOT_FIELDS;
                if (shots[at + 6] > world.tick)
                {
                    if (kept != i) Array.Copy(shots, at, shots, kept * World.SHOT_FIELDS, World.SHOT_FIELDS);
                    kept++;
                    continue;
                }
                int target = shots[at + 3];
                if (world.IsAlive(target)) Hurt(world, World.EntityIndex(target), shots[at + 4], shots[at + 2]);
            }
            world.shotCount = kept;
        }

        /// <summary>
        /// Notes damage against a victim. The victim, and any soldiers of its side
        /// near enough to hear, turn on whoever did it if they have nothing better
        /// to do: so a guard answers when the villagers beside it are cut down,
        /// and a whole company goes for the tower that shoots one of them.
        /// </summary>
        static void Hurt(World world, int victim, int damage, int attacker)
        {
            world.scratchDamage[victim] = world.scratchDamage[victim] + damage;
            if (!world.IsAlive(attacker)) return;
            int from = World.EntityIndex(attacker);
            int side = world.owner[victim];
            if (!world.Hostile(side, world.owner[from])) return;

            GameMap map = world.map;
            int[] cellStart = world.cellStart;
            int[] cellItems = world.cellItems;
            int[] posX = world.posX;
            int[] posY = world.posY;
            int px = posX[victim];
            int py = posY[victim];
            int span = HEARING + world.TypeOf(victim).footprint * HALF;
            int columns = (map.width + 1) >> 1;
            int rows = (map.height + 1) >> 1;
            int x0 = Math.Max(0, (px - span) >> CELL_SHIFT);
            int x1 = Math.Min(columns - 1, (px + span) >> CELL_SHIFT);
            int y0 = Math.Max(0, (py - span) >> CELL_SHIFT);
            int y1 = Math.Min(rows - 1, (py + span) >> CELL_SHIFT);
            for (int cy = y0; cy <= y1; cy++)
            {
                for (int cx = x0; cx <= x1; cx++)
                {
                    int cell = cy * columns + cx;
                    for (int i = cellStart[cell]; i < cellStart[cell + 1]; i++)
                    {
                        int friend = cellItems[i];
                        if (world.engaged[friend] == 1 || world.windup[friend] > 0) continue;
                        if (world.Hostile(side, world.owner[friend])) continue;
                        int dx = posX[friend] - px;
                        int dy = posY[friend] - py;
                        if (dx > span || dx < -span || dy > span || dy < -span) continue;
                        Respond(world, friend, from, attacker);
                    }
                }
            }
        }

        /// <summary>Sets a soldier with nothing better to do on an enemy who has just hit it or someone near it.</summary>
        static void Respond(World world, int slot, int from, int attacker)
        {
            EntityType type = world.TypeOf(slot);
            if (!type.aggressive) return;
            int kind = world.orderKind[slot];
            if (kind != OrderKind.None && kind != OrderKind.AttackMove && kind != OrderKind.Patrol) return;
            if (!WorthChasing(world, slot, from, kind, type)) return;
            if (!type.ranged && world.mobile[from] == 1)
            {
                // Shot at from across the river: there is nothing a soldier on foot can do about it.
                GameMap map = world.map;
                int here = map.region[map.TileAt(world.posX[slot], world.posY[slot])];
                if (map.region[map.TileAt(world.posX[from], world.posY[from])] != here) return;
            }
            Engage(world, slot, attacker);
        }

        // ---- Buildings ---------------------------------------------------------------

        /// <summary>A town centre or tower shoots at the nearest enemy within range.</summary>
        static void ShootFromBuilding(World world, int slot, EntityType type, int lookEvery)
        {
            int target = world.target[slot];
            if (target != World.NO_ENTITY)
            {
                // The slot is worked out before the handle is checked, as in the TypeScript; nothing is read from it unless the handle is good.
                int was = World.EntityIndex(target);
                if (!world.IsAlive(target) ||
                    !world.Hostile(world.owner[slot], world.owner[was]) ||
                    GapBetween(world, slot, was) > type.range)
                {
                    target = world.target[slot] = World.NO_ENTITY;
                }
            }
            if (target == World.NO_ENTITY)
            {
                if ((world.tick + slot) % lookEvery != 0) return;
                target = NearestInRange(world, slot, type);
                if (target == World.NO_ENTITY) return;
                world.target[slot] = target;
            }
            if (world.cooldown[slot] != 0) return;
            world.cooldown[slot] = (ushort)TicksOf(type.cycle, world.config.tickRate);
            int at = World.EntityIndex(target);
            Loose(world, slot, at, DamageOf(world, slot, at, 0));
        }

        static int NearestInRange(World world, int slot, EntityType type)
        {
            GameMap map = world.map;
            int[] cellStart = world.cellStart;
            int[] cellItems = world.cellItems;
            byte[] owner = world.owner;
            int px = world.posX[slot];
            int py = world.posY[slot];
            int me = owner[slot];
            int span = type.range + type.footprint * HALF + ONE;
            int columns = (map.width + 1) >> 1;
            int rows = (map.height + 1) >> 1;
            int x0 = Math.Max(0, (px - span) >> CELL_SHIFT);
            int x1 = Math.Min(columns - 1, (px + span) >> CELL_SHIFT);
            int y0 = Math.Max(0, (py - span) >> CELL_SHIFT);
            int y1 = Math.Min(rows - 1, (py + span) >> CELL_SHIFT);
            int best = -1;
            int bestGap = 0;
            for (int cy = y0; cy <= y1; cy++)
            {
                for (int cx = x0; cx <= x1; cx++)
                {
                    int cell = cy * columns + cx;
                    for (int i = cellStart[cell]; i < cellStart[cell + 1]; i++)
                    {
                        int other = cellItems[i];
                        if (!world.Hostile(me, owner[other])) continue;
                        int gap = GapBetween(world, slot, other);
                        if (gap > type.range || (best != -1 && gap >= bestGap)) continue;
                        if (!Vision.CanSee(world, me, other)) continue;
                        best = other;
                        bestGap = gap;
                    }
                }
            }
            return best == -1 ? World.NO_ENTITY : world.IdAt(best);
        }

        // ---- Distances ---------------------------------------------------------------

        /// <summary>How far a point is from the nearest part of an entity: the edge of a unit, or the wall of a building.</summary>
        static int DistanceTo(World world, int x, int y, int at)
        {
            int dx = world.posX[at] - x;
            int dy = world.posY[at] - y;
            if (dx < 0) dx = -dx;
            if (dy < 0) dy = -dy;
            if (world.mobile[at] == 1)
            {
                int distance = Length(dx, dy) - world.radius[at];
                return distance > 0 ? distance : 0;
            }
            int half = world.TypeOf(at).footprint * HALF;
            dx = dx > half ? dx - half : 0;
            dy = dy > half ? dy - half : 0;
            return Length(dx, dy);
        }

        /// <summary>The open ground between two entities, edge to edge. At least one of them is a unit.</summary>
        public static int GapBetween(World world, int a, int b)
        {
            int unit = world.mobile[a] == 1 ? a : b;
            int other = unit == a ? b : a;
            int gap = DistanceTo(world, world.posX[unit], world.posY[unit], other) - world.radius[unit];
            return gap > 0 ? gap : 0;
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
    }
}
