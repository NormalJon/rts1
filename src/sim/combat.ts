/**
 * Fighting.
 *
 * A soldier with an enemy to deal with walks up until it is within reach,
 * plants itself, and strikes: a short wind-up, the blow, then a pause before
 * the next. Archers and towers do the same from a distance, and their arrows
 * always find their mark after a moment in the air.
 *
 * What a blow does is plain arithmetic:
 *
 *   damage  =  the weapon's damage
 *            + a bonus if the target is the kind of thing this weapon is good against
 *            + a charge bonus for a rider's first blow after a run
 *            - the target's armour (one figure for blades, another for arrows)
 *
 * and never less than 1. An arrow shot from high ground does a quarter more.
 * A charge that meets a spearman standing ready does nothing extra, and costs
 * the rider a blow from the spear.
 *
 * Whom a soldier goes after depends on its orders. Left alone it guards its
 * post: it fights what comes within eight tiles and then walks back. Sent somewhere with an
 * attack-move it fights whatever it meets on the way and then carries on.
 * Told simply to move, it ignores everything. Told to hold, it strikes only at
 * what comes within reach.
 *
 * Nobody goes after an enemy their side cannot see (see vision.ts).
 *
 * Everything dealt in a tick is taken off at the end of the tick, so two
 * soldiers who strike at the same moment both land their blows.
 */

import { chargeReadyTicks, ENTITY_TYPES, HIGH_GROUND, SHOT_SPEED, ticksOf, type EntityType } from './entityTypes';
import { HALF, idiv, length, mulDiv, ONE, type Fixed } from './fixed';
import { buildNeighbourGrid, CELL_SHIFT } from './movement';
import { beginOrder, startNextOrder } from './routing';
import { canSee } from './vision';
import { entityIndex, MoveState, NO_ENTITY, OrderKind, SHOT_FIELDS, type EntityId, type World } from './world';

/** How far off a soldier notices an enemy: this, or a little past its own range if that is further. */
const NOTICE: Fixed = 8 * ONE;
const NOTICE_PAST_RANGE: Fixed = 2 * ONE;
/** A guard does not go after anything further than this from its post. */
const LEASH: Fixed = 12 * ONE;
/** A soldier on the march gives up on an enemy that gets this far from it. */
const LOSE_INTEREST: Fixed = 14 * ONE;
/**
 * A blow or shot once begun still goes home if the target has drawn back no
 * more than this in the meantime. It is enough that running away never dodges
 * a blow already on its way; it only keeps the next one from starting.
 */
const SLACK: Fixed = 3 * HALF;
/** How many times a soldier that cannot get at its target tries again before looking for another. */
const CHASE_TRIES = 3;
/** How far a cry for help carries: soldiers this near someone who is hit come to their aid. */
const HEARING: Fixed = 8 * ONE;
/** A unit attacking a building stands this far clear of its wall. */
const AT_THE_WALL: Fixed = ONE >> 4;

export function combatSystem(world: World): void {
  const count = world.highWater;
  buildNeighbourGrid(world);
  let buildings = 0;
  for (let slot = 0; slot < count; slot++) {
    if (world.alive[slot] === 1 && world.mobile[slot] === 0) world.scratchBuildings[buildings++] = slot;
  }
  world.scratchBuildingCount = buildings;

  landShots(world);

  const tickRate = world.config.tickRate;
  const lookEvery = Math.max(1, idiv(tickRate, 4));
  const aimEvery = Math.max(1, idiv(tickRate, 5));
  for (let slot = 0; slot < count; slot++) {
    if (world.alive[slot] === 0) continue;
    const type = ENTITY_TYPES[world.entityType[slot]!]!;
    if (type.damage === 0) continue;
    if (world.cooldown[slot]! > 0) world.cooldown[slot] = world.cooldown[slot]! - 1;
    if (world.mobile[slot] === 1) fight(world, slot, type, lookEvery, aimEvery);
    else if (world.built[slot] === 1) shootFromBuilding(world, slot, type, lookEvery);
  }

  // Everything dealt this tick comes off together, and the dead are removed.
  const damage = world.scratchDamage;
  for (let slot = 0; slot < count; slot++) {
    const taken = damage[slot]!;
    if (taken === 0) continue;
    damage[slot] = 0;
    if (world.alive[slot] === 0) continue;
    world.hp[slot] = world.hp[slot]! - taken;
    if (world.hp[slot]! <= 0) world.destroy(world.idAt(slot));
  }
}

// ---- Units -------------------------------------------------------------------

function fight(world: World, slot: number, type: EntityType, lookEvery: number, aimEvery: number): void {
  if (world.windup[slot]! > 0) {
    // Committed to a blow; nothing else happens until it lands.
    world.windup[slot] = world.windup[slot]! - 1;
    if (world.windup[slot] === 0) strike(world, slot, type);
    return;
  }

  let target = world.target[slot]!;
  if (target !== NO_ENTITY && !stillWanted(world, slot, target, type)) {
    loseTarget(world, slot);
    // That may have started it on its next order.
    if (world.engaged[slot] === 0) return;
    target = NO_ENTITY;
  }
  const kind = world.orderKind[slot]!;

  if (target === NO_ENTITY) {
    if (kind === OrderKind.Move) return;
    // A soldier in a fight looks for its next opponent at once; otherwise it glances round a few times a second.
    const looking = type.aggressive && (world.engaged[slot] === 1 || (world.tick + slot) % lookEvery === 0);
    if (looking) target = acquire(world, slot, type, kind);
    if (target === NO_ENTITY) {
      if (world.engaged[slot] === 1) disengage(world, slot);
      return;
    }
    engage(world, slot, target);
  }

  const at = entityIndex(target);
  if (gapBetween(world, slot, at) <= type.range) {
    if (world.moveState[slot] !== MoveState.Idle) world.standStill(slot);
    world.rooted[slot] = 1;
    world.chaseTries[slot] = 0;
    face(world, slot, world.posX[at]!, world.posY[at]!);
    if (world.cooldown[slot] === 0) {
      world.windup[slot] = ticksOf(type.windup, world.config.tickRate);
      if (world.windup[slot] === 0) strike(world, slot, type);
    }
    return;
  }
  world.rooted[slot] = 0;
  chase(world, slot, at, aimEvery);
}

/** Whether a unit should carry on with the target it has. */
function stillWanted(world: World, slot: number, target: EntityId, type: EntityType): boolean {
  if (!world.isAlive(target)) return false;
  const at = entityIndex(target);
  if (!world.hostile(world.owner[slot]!, world.owner[at]!)) return false;
  return worthChasing(world, slot, at, world.orderKind[slot]!, type);
}

/**
 * Whether a unit's orders let it go after something that is where this is
 * now. Nobody goes after what their side cannot see, except that a building
 * once ordered attacked stays a target: it is not going anywhere.
 */
function worthChasing(world: World, slot: number, at: number, kind: number, type: EntityType): boolean {
  const inSight = canSee(world, world.owner[slot]!, at);
  if (kind === OrderKind.AttackTarget) return inSight || world.mobile[at] === 0;
  if (!inSight) return false;
  if (kind === OrderKind.Hold) return gapBetween(world, slot, at) <= type.range;
  if (kind === OrderKind.None) {
    // A guard keeps near its post: where it stands, or where it left to fight.
    const fighting = world.engaged[slot] === 1;
    const postX = fighting ? world.homeX[slot]! : world.goalX[slot]!;
    const postY = fighting ? world.homeY[slot]! : world.goalY[slot]!;
    return distanceTo(world, postX, postY, at) <= LEASH;
  }
  return gapBetween(world, slot, at) <= LOSE_INTEREST;
}

/** Breaks off whatever the unit was doing, remembers it, and sets it on an enemy. */
function engage(world: World, slot: number, target: EntityId): void {
  if (world.engaged[slot] === 0) {
    world.engaged[slot] = 1;
    world.chaseTries[slot] = 0;
    const kind = world.orderKind[slot]!;
    if (kind !== OrderKind.Hold && kind !== OrderKind.AttackTarget) {
      // Where it was going, and the shared order it was going under, to pick up again afterwards.
      world.homeX[slot] = world.goalX[slot]!;
      world.homeY[slot] = world.goalY[slot]!;
      world.homeGroup[slot] = world.group[slot]!;
      world.group[slot] = 0;
      world.standStill(slot);
    }
  }
  world.target[slot] = target;
}

/** The unit's target is dead, gone or out of bounds. */
function loseTarget(world: World, slot: number): void {
  world.target[slot] = NO_ENTITY;
  world.rooted[slot] = 0;
  world.chaseTries[slot] = 0;
  if (world.orderKind[slot] !== OrderKind.AttackTarget) return;
  // The one it was sent after is finished. It goes on to its next order, or guards where it stands.
  world.orderKind[slot] = OrderKind.None;
  world.standStill(slot);
  world.homeX[slot] = world.posX[slot]!;
  world.homeY[slot] = world.posY[slot]!;
  if (world.queueLength[slot]! > 0) {
    world.engaged[slot] = 0;
    startNextOrder(world, slot);
  }
}

/** Nothing left to fight: back to the march, or back to its post. */
function disengage(world: World, slot: number): void {
  world.engaged[slot] = 0;
  world.target[slot] = NO_ENTITY;
  world.rooted[slot] = 0;
  world.chaseTries[slot] = 0;
  const kind = world.orderKind[slot]!;
  if (kind === OrderKind.Hold) return;
  const group = world.homeGroup[slot]!;
  world.homeGroup[slot] = 0;
  const homeX = world.homeX[slot]!;
  const homeY = world.homeY[slot]!;
  if (kind === OrderKind.None && length(homeX - world.posX[slot]!, homeY - world.posY[slot]!) <= ONE >> 3) {
    // Already at its post.
    world.releaseGroup(group);
    world.standStill(slot);
    world.goalX[slot] = homeX;
    world.goalY[slot] = homeY;
    return;
  }
  // Its claim on the shared order passes back to the march.
  beginOrder(world, slot, group, homeX, homeY);
}

/**
 * The nearest enemy this unit's orders let it go after, or NO_ENTITY. Units
 * come before buildings, and only a unit sent out to attack goes for
 * buildings of its own accord. A guard leaves them alone unless one shoots at
 * it, which hurt() deals with.
 */
function acquire(world: World, slot: number, type: EntityType, kind: number): EntityId {
  const { map, cellStart, cellItems, owner, posX, posY, radius } = world;
  const px = posX[slot]!;
  const py = posY[slot]!;
  const me = owner[slot]!;
  const region = map.region[map.tileAt(px, py)]!;
  const sight =
    kind === OrderKind.Hold ? type.range + radius[slot]! : Math.max(NOTICE, type.range + NOTICE_PAST_RANGE);
  // Wide enough to take in the largest unit whose edge is within sight.
  const span = sight + ONE;
  const columns = (map.width + 1) >> 1;
  const rows = (map.height + 1) >> 1;
  const x0 = Math.max(0, (px - span) >> CELL_SHIFT);
  const x1 = Math.min(columns - 1, (px + span) >> CELL_SHIFT);
  const y0 = Math.max(0, (py - span) >> CELL_SHIFT);
  const y1 = Math.min(rows - 1, (py + span) >> CELL_SHIFT);
  let best = -1;
  let bestDistance = 0;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const cell = cy * columns + cx;
      for (let i = cellStart[cell]!; i < cellStart[cell + 1]!; i++) {
        const other = cellItems[i]!;
        if (!world.hostile(me, owner[other]!)) continue;
        const dx = posX[other]! - px;
        const dy = posY[other]! - py;
        if (dx > span || dx < -span || dy > span || dy < -span) continue;
        const distance = length(dx, dy) - radius[other]!;
        if (distance > sight || (best !== -1 && distance >= bestDistance)) continue;
        // A soldier on foot cannot get at someone across the river. An archer can still shoot.
        if (!type.ranged && map.region[map.tileAt(posX[other]!, posY[other]!)] !== region) continue;
        if (!worthChasing(world, slot, other, kind, type)) continue;
        best = other;
        bestDistance = distance;
      }
    }
  }
  if (best !== -1) return world.idAt(best);

  if (kind !== OrderKind.AttackMove && kind !== OrderKind.Patrol) return NO_ENTITY;
  for (let i = 0; i < world.scratchBuildingCount; i++) {
    const other = world.scratchBuildings[i]!;
    if (!world.hostile(me, owner[other]!)) continue;
    const distance = distanceTo(world, px, py, other);
    if (distance > sight || (best !== -1 && distance >= bestDistance)) continue;
    if (!worthChasing(world, slot, other, kind, type)) continue;
    if (distance - radius[slot]! > type.range && !findPlaceBeside(world, slot, other)) continue;
    best = other;
    bestDistance = distance;
  }
  return best === -1 ? NO_ENTITY : world.idAt(best);
}

/** Where chase() should head, worked out by the two functions below. */
let aimX: Fixed = 0;
let aimY: Fixed = 0;

/** Walks a unit toward a target it cannot yet reach. */
function chase(world: World, slot: number, at: number, aimEvery: number): void {
  const standing = world.moveState[slot] === MoveState.Idle;
  // On the move it corrects its aim a few times a second, which is enough to follow a running target.
  if (!standing && (world.tick + slot) % aimEvery !== 0) return;

  let reachable: boolean;
  if (world.mobile[at] === 1) reachable = findWayToward(world, slot, world.posX[at]!, world.posY[at]!);
  else reachable = findPlaceBeside(world, slot, at);

  if (standing) {
    // It has come to a halt short of its target: crowded out, or there is no way through.
    if (!reachable || world.chaseTries[slot]! >= CHASE_TRIES) {
      loseTarget(world, slot);
      return;
    }
    world.chaseTries[slot] = world.chaseTries[slot]! + 1;
    beginOrder(world, slot, 0, aimX, aimY);
    return;
  }
  if (!reachable) return;
  if (length(world.goalX[slot]! - aimX, world.goalY[slot]! - aimY) > HALF) beginOrder(world, slot, 0, aimX, aimY);
}

/**
 * Sets the aim to a point, or, if the point is on ground this unit cannot
 * walk to, to the nearest ground it can. Returns false if there is none near.
 */
function findWayToward(world: World, slot: number, x: Fixed, y: Fixed): boolean {
  const { map } = world;
  const region = map.region[map.tileAt(world.posX[slot]!, world.posY[slot]!)]!;
  const tile = map.tileAt(x, y);
  if (map.region[tile] === region) {
    aimX = x;
    aimY = y;
    return true;
  }
  const near = map.nearestPassable(tile % map.width, idiv(tile, map.width), region, 8);
  if (near === -1) return false;
  aimX = map.centreX(near);
  aimY = map.centreY(near);
  return true;
}

/**
 * Sets the aim to the nearest place this unit can stand right up against a
 * building. Returns false if it cannot get to any side of it.
 */
function findPlaceBeside(world: World, slot: number, building: number): boolean {
  const { map } = world;
  const px = world.posX[slot]!;
  const py = world.posY[slot]!;
  const region = map.region[map.tileAt(px, py)]!;
  const footprint = ENTITY_TYPES[world.entityType[building]!]!.footprint;
  // The building's walls, pushed out by the room the unit needs to stand clear of them.
  const clear = footprint * HALF + world.radius[slot]! + AT_THE_WALL;
  const left = world.posX[building]! - clear;
  const right = world.posX[building]! + clear;
  const top = world.posY[building]! - clear;
  const bottom = world.posY[building]! + clear;

  // Straight to the nearest point of the wall, if the ground there is open.
  let x = px < left ? left : px > right ? right : px;
  let y = py < top ? top : py > bottom ? bottom : py;
  if (x > left && x < right && y > top && y < bottom) {
    // Inside the outline, which can only happen in the corner of a neighbouring tile. Step out sideways.
    x = px - left < right - px ? left : right;
  }
  if (x >= 0 && y >= 0 && x <= map.maxX && y <= map.maxY) {
    const tile = map.tileAt(x, y);
    if (map.passable[tile] === 1 && map.region[tile] === region) {
      aimX = x;
      aimY = y;
      return true;
    }
  }

  // Otherwise the nearest open tile round the outside.
  const reach = (footprint >> 1) + 1;
  const cx = world.posX[building]! >> 16;
  const cy = world.posY[building]! >> 16;
  let bestDistance = -1;
  for (let oy = -reach; oy <= reach; oy++) {
    for (let ox = -reach; ox <= reach; ox++) {
      if (ox !== -reach && ox !== reach && oy !== -reach && oy !== reach) continue;
      const tx = cx + ox;
      const ty = cy + oy;
      if (!map.isPassable(tx, ty) || map.region[ty * map.width + tx] !== region) continue;
      // The middle of that tile, drawn in toward the wall.
      const midX = tx * ONE + HALF;
      const midY = ty * ONE + HALF;
      const nearX = midX < left ? left : midX > right ? right : midX;
      const nearY = midY < top ? top : midY > bottom ? bottom : midY;
      const distance = length(nearX - px, nearY - py);
      if (bestDistance === -1 || distance < bestDistance) {
        aimX = nearX;
        aimY = nearY;
        bestDistance = distance;
      }
    }
  }
  return bestDistance !== -1;
}

/** The blow lands, or the arrow leaves the string. */
function strike(world: World, slot: number, type: EntityType): void {
  const tickRate = world.config.tickRate;
  world.cooldown[slot] = Math.max(1, ticksOf(type.cycle, tickRate) - ticksOf(type.windup, tickRate));
  const target = world.target[slot]!;
  if (!world.isAlive(target)) return;
  const at = entityIndex(target);
  if (gapBetween(world, slot, at) > type.range + SLACK) return;

  let extra = 0;
  if (type.charge > 0 && world.momentum[slot]! >= chargeReadyTicks(tickRate)) {
    world.momentum[slot] = 0;
    const victim = ENTITY_TYPES[world.entityType[at]!]!;
    if (victim.braces && world.mobile[at] === 1 && world.moveState[at] === MoveState.Idle) {
      // Rode onto levelled spears: the charge is wasted and the rider pays for it.
      hurt(world, slot, damageOf(world, at, slot, 0), target);
    } else {
      extra = type.charge;
    }
  }
  const damage = damageOf(world, slot, at, extra);
  if (type.ranged) loose(world, slot, at, damage);
  else hurt(world, at, damage, world.idAt(slot));
}

/** What one hit from an attacker does to a victim. */
export function damageOf(world: World, attacker: number, victim: number, extra: number): number {
  const weapon = ENTITY_TYPES[world.entityType[attacker]!]!;
  const body = ENTITY_TYPES[world.entityType[victim]!]!;
  let damage = weapon.damage + extra;
  for (const [tags, bonus] of weapon.bonuses) {
    if ((body.tags & tags) !== 0) damage += bonus;
  }
  damage -= weapon.ranged ? body.rangedArmor : body.meleeArmor;
  if (damage < 1) damage = 1;
  if (weapon.ranged) {
    const { map } = world;
    const from = map.heightOf(map.tileAt(world.posX[attacker]!, world.posY[attacker]!));
    const to = map.heightOf(map.tileAt(world.posX[victim]!, world.posY[victim]!));
    // A quarter more from high ground, to the nearest whole point.
    if (from - to >= HIGH_GROUND) damage = (damage * 5 + 2) >> 2;
  }
  return damage;
}

/** Sends an arrow on its way. It lands after the time it takes to fly the distance. */
function loose(world: World, slot: number, at: number, damage: number): void {
  const distance = length(world.posX[at]! - world.posX[slot]!, world.posY[at]! - world.posY[slot]!);
  const perTick = Math.max(1, idiv(SHOT_SPEED, world.config.tickRate));
  const flight = Math.max(1, idiv(distance + perTick - 1, perTick));
  world.addShot(world.posX[slot]!, world.posY[slot]!, world.idAt(slot), world.idAt(at), damage, world.tick + flight);
}

/** Arrows whose time has come hit their targets, if those are still alive. */
function landShots(world: World): void {
  const { shots } = world;
  let kept = 0;
  for (let i = 0; i < world.shotCount; i++) {
    const at = i * SHOT_FIELDS;
    if (shots[at + 6]! > world.tick) {
      if (kept !== i) shots.copyWithin(kept * SHOT_FIELDS, at, at + SHOT_FIELDS);
      kept++;
      continue;
    }
    const target = shots[at + 3]!;
    if (world.isAlive(target)) hurt(world, entityIndex(target), shots[at + 4]!, shots[at + 2]!);
  }
  world.shotCount = kept;
}

/**
 * Notes damage against a victim. The victim, and any soldiers of its side
 * near enough to hear, turn on whoever did it if they have nothing better to
 * do: so a guard answers when the villagers beside it are cut down, and a
 * whole company goes for the tower that shoots one of them.
 */
function hurt(world: World, victim: number, damage: number, attacker: EntityId): void {
  world.scratchDamage[victim] = world.scratchDamage[victim]! + damage;
  if (!world.isAlive(attacker)) return;
  const from = entityIndex(attacker);
  const side = world.owner[victim]!;
  if (!world.hostile(side, world.owner[from]!)) return;

  const { map, cellStart, cellItems, posX, posY } = world;
  const px = posX[victim]!;
  const py = posY[victim]!;
  const span = HEARING + ENTITY_TYPES[world.entityType[victim]!]!.footprint * HALF;
  const columns = (map.width + 1) >> 1;
  const rows = (map.height + 1) >> 1;
  const x0 = Math.max(0, (px - span) >> CELL_SHIFT);
  const x1 = Math.min(columns - 1, (px + span) >> CELL_SHIFT);
  const y0 = Math.max(0, (py - span) >> CELL_SHIFT);
  const y1 = Math.min(rows - 1, (py + span) >> CELL_SHIFT);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const cell = cy * columns + cx;
      for (let i = cellStart[cell]!; i < cellStart[cell + 1]!; i++) {
        const friend = cellItems[i]!;
        if (world.engaged[friend] === 1 || world.windup[friend]! > 0) continue;
        if (world.hostile(side, world.owner[friend]!)) continue;
        const dx = posX[friend]! - px;
        const dy = posY[friend]! - py;
        if (dx > span || dx < -span || dy > span || dy < -span) continue;
        respond(world, friend, from, attacker);
      }
    }
  }
}

/** Sets a soldier with nothing better to do on an enemy who has just hit it or someone near it. */
function respond(world: World, slot: number, from: number, attacker: EntityId): void {
  const type = ENTITY_TYPES[world.entityType[slot]!]!;
  if (!type.aggressive) return;
  const kind = world.orderKind[slot]!;
  if (kind !== OrderKind.None && kind !== OrderKind.AttackMove && kind !== OrderKind.Patrol) return;
  if (!worthChasing(world, slot, from, kind, type)) return;
  if (!type.ranged && world.mobile[from] === 1) {
    // Shot at from across the river: there is nothing a soldier on foot can do about it.
    const { map } = world;
    const here = map.region[map.tileAt(world.posX[slot]!, world.posY[slot]!)];
    if (map.region[map.tileAt(world.posX[from]!, world.posY[from]!)] !== here) return;
  }
  engage(world, slot, attacker);
}

// ---- Buildings ---------------------------------------------------------------

/** A town centre or tower shoots at the nearest enemy within range. */
function shootFromBuilding(world: World, slot: number, type: EntityType, lookEvery: number): void {
  let target = world.target[slot]!;
  if (target !== NO_ENTITY) {
    const at = entityIndex(target);
    if (
      !world.isAlive(target) ||
      !world.hostile(world.owner[slot]!, world.owner[at]!) ||
      gapBetween(world, slot, at) > type.range
    ) {
      target = world.target[slot] = NO_ENTITY;
    }
  }
  if (target === NO_ENTITY) {
    if ((world.tick + slot) % lookEvery !== 0) return;
    target = nearestInRange(world, slot, type);
    if (target === NO_ENTITY) return;
    world.target[slot] = target;
  }
  if (world.cooldown[slot] !== 0) return;
  world.cooldown[slot] = ticksOf(type.cycle, world.config.tickRate);
  const at = entityIndex(target);
  loose(world, slot, at, damageOf(world, slot, at, 0));
}

function nearestInRange(world: World, slot: number, type: EntityType): EntityId {
  const { map, cellStart, cellItems, owner, posX, posY } = world;
  const px = posX[slot]!;
  const py = posY[slot]!;
  const me = owner[slot]!;
  const span = type.range + type.footprint * HALF + ONE;
  const columns = (map.width + 1) >> 1;
  const rows = (map.height + 1) >> 1;
  const x0 = Math.max(0, (px - span) >> CELL_SHIFT);
  const x1 = Math.min(columns - 1, (px + span) >> CELL_SHIFT);
  const y0 = Math.max(0, (py - span) >> CELL_SHIFT);
  const y1 = Math.min(rows - 1, (py + span) >> CELL_SHIFT);
  let best = -1;
  let bestGap = 0;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const cell = cy * columns + cx;
      for (let i = cellStart[cell]!; i < cellStart[cell + 1]!; i++) {
        const other = cellItems[i]!;
        if (!world.hostile(me, owner[other]!)) continue;
        const gap = gapBetween(world, slot, other);
        if (gap > type.range || (best !== -1 && gap >= bestGap)) continue;
        if (!canSee(world, me, other)) continue;
        best = other;
        bestGap = gap;
      }
    }
  }
  return best === -1 ? NO_ENTITY : world.idAt(best);
}

// ---- Distances ---------------------------------------------------------------

/** How far a point is from the nearest part of an entity: the edge of a unit, or the wall of a building. */
function distanceTo(world: World, x: Fixed, y: Fixed, at: number): Fixed {
  let dx = world.posX[at]! - x;
  let dy = world.posY[at]! - y;
  if (dx < 0) dx = -dx;
  if (dy < 0) dy = -dy;
  if (world.mobile[at] === 1) {
    const distance = length(dx, dy) - world.radius[at]!;
    return distance > 0 ? distance : 0;
  }
  const half = ENTITY_TYPES[world.entityType[at]!]!.footprint * HALF;
  dx = dx > half ? dx - half : 0;
  dy = dy > half ? dy - half : 0;
  return length(dx, dy);
}

/** The open ground between two entities, edge to edge. At least one of them is a unit. */
export function gapBetween(world: World, a: number, b: number): Fixed {
  const unit = world.mobile[a] === 1 ? a : b;
  const other = unit === a ? b : a;
  const gap = distanceTo(world, world.posX[unit]!, world.posY[unit]!, other) - world.radius[unit]!;
  return gap > 0 ? gap : 0;
}

function face(world: World, slot: number, x: Fixed, y: Fixed): void {
  const dx = x - world.posX[slot]!;
  const dy = y - world.posY[slot]!;
  const distance = length(dx, dy);
  if (distance === 0) return;
  world.dirX[slot] = mulDiv(dx, ONE, distance);
  world.dirY[slot] = mulDiv(dy, ONE, distance);
}
