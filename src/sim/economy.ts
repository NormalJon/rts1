/**
 * What villagers do: gathering, and building.
 *
 * Gathering is a round trip between a resource and the nearest place to hand
 * it in:
 *
 *   walk to a free place beside the resource  ->  work until loaded
 *        ^                                              |
 *        |                                              v
 *   hand in at the drop-off  <-  carry the load to the nearest one
 *
 * When a tile runs out the villager moves to the nearest tile of the same
 * kind. Everything taken from the map ends up on a villager's back, in a
 * stockpile, or spent; nothing is created or lost along the way.
 *
 * Building is simpler: walk to the site, work until it is finished, then
 * find something useful to do next. A site gains hit points as it goes up.
 * Mending a damaged building is the same job on a finished one.
 */

import {
  buildPointsNeeded,
  LONE_BUILDER_POINTS,
  RESOURCE_COUNT,
  resourceOfTerrain,
  siteHp,
  terrainsAccepted,
  ticksPerUnit,
} from './entityTypes';
import { fromRatio, HALF, idiv, length, mulDiv, ONE, type Fixed } from './fixed';
import { DIR_X, DIR_Y, Terrain } from './map';
import { beginOrder } from './routing';
import { TERRAINS } from './tech';
import { entityIndex, Job, MoveState, NO_ENTITY, type EntityId, type World } from './world';

/** How close a villager must stand to a tile or building to work on it or hand in. */
const REACH: Fixed = fromRatio(4, 5);
/** How far it will look for another tile of the same resource. */
const SEARCH_RADIUS = 14;
/** How far from a finished camp its builders look for something to gather. */
const CAMP_RADIUS = 10;
/** How far a builder looks for another site to help at. */
const NEXT_SITE_RADIUS = 14;
/** Mending a building from nothing takes this many times as long as building it. */
const MENDING_SLOWNESS = 6;
/** How many times it tries to reach a place before giving up on it. */
const MAX_TRIES = 3;
/** Two villagers share a tile beside a resource, standing this far either side of its middle. */
const SIDE_STEP: Fixed = ONE >> 2;
const LEAN_IN: Fixed = fromRatio(3, 20);

// ---- Orders ------------------------------------------------------------------

/**
 * Sets a villager to gathering from a resource tile. Returns false if there
 * is nothing there to gather.
 *
 * @param taken  When a whole group is being set to work at once, the standing
 *   places spoken for so far (see spotsTakenExcept), so the list is not
 *   rebuilt for every villager. Each place handed out is added to it.
 */
export function assignGather(world: World, slot: number, tile: number, taken?: Set<number>): boolean {
  const { map } = world;
  const terrain = map.terrain[tile]!;
  const resource = resourceOfTerrain(terrain);
  if (resource === -1 || map.amount[tile]! <= 0) return false;
  world.clearOrders(slot);
  world.clearJob(slot);
  world.jobTile[slot] = tile;
  world.jobTerrain[slot] = terrain;
  const capacity = world.typeOf(slot).carries;
  const loaded = world.carry[slot]!;
  // A full load, or a load of something else, is handed in first.
  if (loaded >= capacity || (loaded > 0 && world.carryKind[slot] !== resource)) startDelivery(world, slot);
  else goToResource(world, slot, taken);
  return true;
}

/** The standing places held by gatherers other than the given units. */
export function spotsTakenExcept(world: World, slots: readonly number[]): Set<number> {
  const skip = new Set(slots);
  const taken = new Set<number>();
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0 || skip.has(slot)) continue;
    const job = world.job[slot];
    if (job === Job.ToResource || job === Job.Harvesting) taken.add(world.jobSpot[slot]!);
  }
  return taken;
}

/** Sends a villager to hand in what it carries at a building. Afterwards it goes back to what it was gathering. */
export function assignDelivery(world: World, slot: number, building: EntityId): void {
  const tile = world.jobTile[slot]!;
  const terrain = world.jobTerrain[slot]!;
  world.clearOrders(slot);
  world.clearJob(slot);
  world.jobTile[slot] = tile;
  world.jobTerrain[slot] = terrain;
  startDelivery(world, slot, building);
}

/**
 * Sends a villager to work on a building: to finish it, or, if it is finished
 * but damaged, to mend it. Returns false if it is not one of the player's
 * buildings or needs no work.
 */
export function assignConstruction(world: World, slot: number, site: EntityId): boolean {
  if (!needsWork(world, site, world.owner[slot]!) || !world.typeOf(slot).builds) return false;
  world.clearOrders(slot);
  world.clearJob(slot);
  if (!walkToEdgeOf(world, slot, entityIndex(site), true)) return false;
  world.jobTarget[slot] = site;
  world.job[slot] = Job.ToSite;
  return true;
}

// ---- Every tick ----------------------------------------------------------------

export function economySystem(world: World): void {
  const { map } = world;
  world.scratchBuilders.fill(0, 0, world.highWater);
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0) continue;
    const job = world.job[slot]!;
    if (job === Job.None) continue;

    if (job === Job.ToSite || job === Job.Constructing) {
      build(world, slot);
      continue;
    }

    if (job === Job.ToDropOff) {
      const target = world.jobTarget[slot]!;
      if (!takesDeliveryOf(world, target, world.owner[slot]!, world.carryKind[slot]!)) {
        // The building has gone. Try another.
        startDelivery(world, slot);
        continue;
      }
      if (withinReachOf(world, slot, entityIndex(target))) {
        const player = world.owner[slot]!;
        const stockAt = player * RESOURCE_COUNT + world.carryKind[slot]!;
        world.stock[stockAt] = world.stock[stockAt]! + world.carry[slot]!;
        world.carry[slot] = 0;
        world.jobTries[slot] = 0;
        if (world.jobTile[slot]! >= 0) goToResource(world, slot);
        else stopWorking(world, slot);
      } else if (world.moveState[slot] === MoveState.Idle) {
        retryOrQuit(world, slot, () => startDelivery(world, slot, target));
      }
      continue;
    }

    const tile = world.jobTile[slot]!;
    if (tile < 0 || map.terrain[tile] !== world.jobTerrain[slot] || map.amount[tile]! <= 0) {
      // Worked out, by this villager or another. Find the next one.
      goToResource(world, slot);
      continue;
    }
    const near = withinReach(world, slot, tile % map.width, idiv(tile, map.width), 1);

    if (job === Job.ToResource) {
      if (world.moveState[slot] !== MoveState.Idle) continue;
      if (near) {
        world.job[slot] = Job.Harvesting;
        world.jobTimer[slot] = 0;
        world.jobTries[slot] = 0;
        face(world, slot, map.centreX(tile), map.centreY(tile));
      } else {
        retryOrQuit(world, slot, () => goToResource(world, slot));
      }
      continue;
    }

    // Harvesting. A villager jostled out of reach waits to drift back before
    // carrying on. If it has come to rest and still cannot reach (its place
    // has been built over, say), it finds another.
    if (!near) {
      const fromPost = length(world.posX[slot]! - world.goalX[slot]!, world.posY[slot]! - world.goalY[slot]!);
      if (fromPost <= ONE >> 4) goToResource(world, slot);
      continue;
    }
    const terrain = map.terrain[tile]!;
    const resource = resourceOfTerrain(terrain);
    world.jobTimer[slot] = world.jobTimer[slot]! + 1;
    const faster = world.gatherBonus[world.owner[slot]! * TERRAINS + terrain]!;
    if (world.jobTimer[slot]! < ticksPerUnit(terrain, world.config.tickRate, faster)) continue;
    world.jobTimer[slot] = 0;
    // A farm's crop is grown, not taken: the field holds as much afterwards as before.
    if (terrain === Terrain.Field) world.grown[resource] = world.grown[resource]! + 1;
    else map.harvest(tile);
    world.carryKind[slot] = resource;
    world.carry[slot] = world.carry[slot]! + 1;
    if (world.carry[slot]! >= world.typeOf(slot).carries) startDelivery(world, slot);
  }
}

function retryOrQuit(world: World, slot: number, again: () => void): void {
  world.jobTries[slot] = world.jobTries[slot]! + 1;
  if (world.jobTries[slot]! > MAX_TRIES) stopWorking(world, slot);
  else again();
}

function stopWorking(world: World, slot: number): void {
  world.clearOrders(slot);
  world.clearJob(slot);
}

function walkTo(world: World, slot: number, x: Fixed, y: Fixed): void {
  world.clearOrders(slot);
  beginOrder(world, slot, 0, x, y);
}

function face(world: World, slot: number, x: Fixed, y: Fixed): void {
  const dx = x - world.posX[slot]!;
  const dy = y - world.posY[slot]!;
  const distance = length(dx, dy);
  if (distance === 0) return;
  world.dirX[slot] = mulDiv(dx, ONE, distance);
  world.dirY[slot] = mulDiv(dy, ONE, distance);
}

/** Whether a unit is within reach of a square of tiles. */
function withinReach(world: World, slot: number, left: number, top: number, size: number): boolean {
  const x = world.posX[slot]!;
  const y = world.posY[slot]!;
  const x0 = left * ONE;
  const y0 = top * ONE;
  const x1 = x0 + size * ONE;
  const y1 = y0 + size * ONE;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  if (dx > REACH || dy > REACH) return false;
  return length(dx, dy) <= REACH;
}

/** Whether a unit is within reach of a building. */
function withinReachOf(world: World, slot: number, building: number): boolean {
  const footprint = world.typeOf(building).footprint;
  const half = footprint >> 1;
  return withinReach(world, slot, (world.posX[building]! >> 16) - half, (world.posY[building]! >> 16) - half, footprint);
}

/**
 * Sends a unit to the nearest open tile on the ring just outside a building.
 * Returns false if there is none it can get to.
 *
 * @param spreadOut  For builders, who stay a while: prefer a tile no other
 *   builder of this site is already heading for, so they work all round it
 *   instead of queuing at one corner.
 */
function walkToEdgeOf(world: World, slot: number, building: number, spreadOut = false): boolean {
  const { map } = world;
  const px = world.posX[slot]!;
  const py = world.posY[slot]!;
  const crowd = new Map<number, number>();
  if (spreadOut) {
    const site = world.idAt(building);
    for (let other = 0; other < world.highWater; other++) {
      if (other === slot || world.alive[other] === 0 || world.jobTarget[other] !== site) continue;
      if (world.job[other] !== Job.ToSite && world.job[other] !== Job.Constructing) continue;
      const tile = map.tileAt(world.goalX[other]!, world.goalY[other]!);
      crowd.set(tile, (crowd.get(tile) ?? 0) + 1);
    }
  }
  const region = map.region[map.tileAt(px, py)]!;
  const reach = (world.typeOf(building).footprint >> 1) + 1;
  const cx = world.posX[building]! >> 16;
  const cy = world.posY[building]! >> 16;
  let bestX = 0;
  let bestY = 0;
  let bestDistance = -1;
  for (let oy = -reach; oy <= reach; oy++) {
    for (let ox = -reach; ox <= reach; ox++) {
      if (ox !== -reach && ox !== reach && oy !== -reach && oy !== reach) continue;
      const tx = cx + ox;
      const ty = cy + oy;
      if (!map.isPassable(tx, ty) || map.region[ty * map.width + tx] !== region) continue;
      const x = tx * ONE + HALF;
      const y = ty * ONE + HALF;
      // Each builder already bound for a tile makes it as unattractive as three more tiles of walking.
      const distance = length(x - px, y - py) + (crowd.get(ty * map.width + tx) ?? 0) * 3 * ONE;
      if (bestDistance === -1 || distance < bestDistance) {
        bestX = x;
        bestY = y;
        bestDistance = distance;
      }
    }
  }
  if (bestDistance === -1) return false;
  walkTo(world, slot, bestX, bestY);
  return true;
}

// ---- Going to work ---------------------------------------------------------

function spotX(world: World, spot: number, tile: number): Fixed {
  const { map } = world;
  const stand = spot >> 1;
  const dx = (tile % map.width) - (stand % map.width);
  const dy = idiv(tile, map.width) - idiv(stand, map.width);
  const side = (spot & 1) === 0 ? -1 : 1;
  return map.centreX(stand) + dx * LEAN_IN - dy * side * SIDE_STEP;
}

function spotY(world: World, spot: number, tile: number): Fixed {
  const { map } = world;
  const stand = spot >> 1;
  const dx = (tile % map.width) - (stand % map.width);
  const dy = idiv(tile, map.width) - idiv(stand, map.width);
  const side = (spot & 1) === 0 ? -1 : 1;
  return map.centreY(stand) + dy * LEAN_IN + dx * side * SIDE_STEP;
}

/** The nearest free standing place beside a resource tile, or -1 if every one is taken. */
function freeSpot(world: World, slot: number, tile: number, region: number, taken: ReadonlySet<number>): number {
  const { map } = world;
  const tx = tile % map.width;
  const ty = idiv(tile, map.width);
  const px = world.posX[slot]!;
  const py = world.posY[slot]!;
  let best = -1;
  let bestDistance = 0;
  // A farm is worked by one villager, who always stands in the same place: just south of its middle.
  const farm = map.terrain[tile] === Terrain.Field;
  for (let dir = farm ? 2 : 0; dir < (farm ? 3 : 8); dir++) {
    const nx = tx + DIR_X[dir]!;
    const ny = ty + DIR_Y[dir]!;
    if (!map.isPassable(nx, ny)) continue;
    const stand = ny * map.width + nx;
    if (map.region[stand] !== region) continue;
    for (let side = 0; side < (farm ? 1 : 2); side++) {
      const spot = stand * 2 + side;
      if (taken.has(spot)) continue;
      const distance = length(spotX(world, spot, tile) - px, spotY(world, spot, tile) - py);
      if (best === -1 || distance < bestDistance) {
        best = spot;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * Heads for the villager's resource tile, or, if that one is worked out or
 * crowded, the nearest tile of the same kind with room. With nowhere left to
 * work it hands in what it has and stops.
 */
function goToResource(world: World, slot: number, taken: Set<number> = spotsTakenExcept(world, [slot])): void {
  const { map } = world;
  const terrain = world.jobTerrain[slot]!;
  const region = map.region[map.tileAt(world.posX[slot]!, world.posY[slot]!)]!;
  let tile = world.jobTile[slot]!;
  let spot = -1;
  if (tile >= 0 && map.terrain[tile] === terrain && map.amount[tile]! > 0) {
    spot = freeSpot(world, slot, tile, region, taken);
  }
  if (spot === -1) {
    // Look outward from where it was working, or from where it stands.
    const from = tile >= 0 ? tile : map.tileAt(world.posX[slot]!, world.posY[slot]!);
    tile = map.nearestTile(from % map.width, idiv(from, map.width), SEARCH_RADIUS, (candidate) => {
      if (map.terrain[candidate] !== terrain || map.amount[candidate]! <= 0) return false;
      return freeSpot(world, slot, candidate, region, taken) !== -1;
    });
    if (tile !== -1) spot = freeSpot(world, slot, tile, region, taken);
  }
  if (tile === -1 || spot === -1) {
    world.jobTile[slot] = -1;
    if (world.carry[slot]! > 0) startDelivery(world, slot);
    else stopWorking(world, slot);
    return;
  }
  taken.add(spot);
  world.jobTile[slot] = tile;
  world.jobSpot[slot] = spot;
  world.jobTimer[slot] = 0;
  walkTo(world, slot, spotX(world, spot, tile), spotY(world, spot, tile));
  world.job[slot] = Job.ToResource;
}

// ---- Handing in ------------------------------------------------------------

/** Whether a finished building of this player's takes in a given resource. */
function takesDeliveryOf(world: World, id: EntityId, owner: number, resource: number): boolean {
  if (!world.isAlive(id)) return false;
  const slot = entityIndex(id);
  return (
    world.owner[slot] === owner &&
    world.built[slot] === 1 &&
    (world.typeOf(slot).accepts & (1 << resource)) !== 0
  );
}

/** Whether a player owns this building and gatherers can hand in something there. */
export function acceptsDeliveries(world: World, id: EntityId, owner: number): boolean {
  if (!world.isAlive(id)) return false;
  const slot = entityIndex(id);
  return world.owner[slot] === owner && world.built[slot] === 1 && world.typeOf(slot).accepts !== 0;
}

/**
 * Sends a loaded villager to a drop-off: the one given if it takes what is
 * being carried, or the nearest that does. With none standing it stops and
 * keeps its load.
 */
function startDelivery(world: World, slot: number, building: EntityId = NO_ENTITY): void {
  const owner = world.owner[slot]!;
  const resource = world.carryKind[slot]!;
  const px = world.posX[slot]!;
  const py = world.posY[slot]!;
  let target = takesDeliveryOf(world, building, owner, resource) ? entityIndex(building) : -1;
  if (target === -1) {
    let nearest = 0;
    for (let other = 0; other < world.highWater; other++) {
      if (world.alive[other] === 0 || world.mobile[other] === 1) continue;
      if (!takesDeliveryOf(world, world.idAt(other), owner, resource)) continue;
      const distance = length(world.posX[other]! - px, world.posY[other]! - py);
      if (target === -1 || distance < nearest) {
        target = other;
        nearest = distance;
      }
    }
  }
  const tile = world.jobTile[slot]!;
  const terrain = world.jobTerrain[slot]!;
  if (target === -1 || !walkToEdgeOf(world, slot, target)) {
    stopWorking(world, slot);
    // Remember the work, so it can be picked up when there is somewhere to deliver to.
    world.jobTile[slot] = tile;
    world.jobTerrain[slot] = terrain;
    return;
  }
  world.jobTarget[slot] = world.idAt(target);
  world.job[slot] = Job.ToDropOff;
}

// ---- Building ----------------------------------------------------------------

/** Whether this is one of the player's buildings that is unfinished or damaged. */
function needsWork(world: World, id: EntityId, owner: number): boolean {
  if (!world.isAlive(id)) return false;
  const slot = entityIndex(id);
  if (world.mobile[slot] === 1 || world.owner[slot] !== owner) return false;
  return world.built[slot] === 0 || world.hp[slot]! < world.typeOf(slot).hp;
}

/** One tick of a villager's building job. */
function build(world: World, slot: number): void {
  const site = world.jobTarget[slot]!;
  if (!needsWork(world, site, world.owner[slot]!)) {
    // Finished by the others, or destroyed.
    afterBuilding(world, slot, site);
    return;
  }
  const at = entityIndex(site);
  const near = withinReachOf(world, slot, at);
  const arrived = world.moveState[slot] === MoveState.Idle;
  if (world.job[slot] === Job.ToSite) {
    if (near) {
      // Close enough to start. It keeps walking to its place, so that it ends
      // up standing well within reach and a nudge does not put it out of work.
      world.job[slot] = Job.Constructing;
      world.jobTries[slot] = 0;
    } else if (arrived) {
      retryOrQuit(world, slot, () => {
        if (!walkToEdgeOf(world, slot, at, true)) stopWorking(world, slot);
      });
    }
    return;
  }
  if (arrived) face(world, slot, world.posX[at]!, world.posY[at]!);
  if (!near) {
    // Shoved out of reach and come to rest there: walk back.
    if (arrived && !walkToEdgeOf(world, slot, at, true)) stopWorking(world, slot);
    return;
  }
  const typeId = world.entityType[at]!;
  const type = world.typeOf(at);
  if (world.built[at] === 1) {
    // Mending is slow work: one villager would take six times as long to
    // restore a building from nothing as to build it, which is about what
    // one spearman hacking at the walls undoes. The villager's timer keeps
    // the fractions.
    const full = type.seconds * world.config.tickRate * MENDING_SLOWNESS;
    const work = world.jobTimer[slot]! + type.hp;
    const mended = idiv(work, full);
    world.jobTimer[slot] = work - mended * full;
    world.hp[at] = Math.min(type.hp, world.hp[at]! + mended);
    if (world.hp[at]! >= type.hp) afterBuilding(world, slot, site);
    return;
  }
  // The first builder to reach a site each tick does the most; each helper adds a little.
  const points = world.scratchBuilders[at] === 0 ? LONE_BUILDER_POINTS : 1;
  world.scratchBuilders[at] = world.scratchBuilders[at]! + 1;
  const needed = buildPointsNeeded(typeId, world.config.tickRate);
  const before = world.buildPoints[at]!;
  const after = Math.min(needed, before + points);
  world.buildPoints[at] = after;
  // The walls go up with the work: the rest of its hit points arrive in step with the building.
  const toCome = type.hp - siteHp(typeId);
  const gained = idiv(toCome * after, needed) - idiv(toCome * before, needed);
  world.hp[at] = Math.min(type.hp, world.hp[at]! + gained);
  if (after >= needed) {
    world.built[at] = 1;
    if (type.farm) world.tillFarm(at);
    afterBuilding(world, slot, site);
  }
}

/**
 * A builder's next move once its site is done: if it has just finished a camp
 * or mill, start gathering what that takes in; otherwise help at the nearest
 * other site; otherwise stand down.
 */
function afterBuilding(world: World, slot: number, finished: EntityId): void {
  const { map } = world;
  const owner = world.owner[slot]!;
  const px = world.posX[slot]!;
  const py = world.posY[slot]!;
  const region = map.region[map.tileAt(px, py)]!;
  if (world.isAlive(finished) && world.built[entityIndex(finished)] === 1) {
    const at = entityIndex(finished);
    const cx = world.posX[at]! >> 16;
    const cy = world.posY[at]! >> 16;
    // Whoever finishes a farm starts farming it, if nobody has beaten them to it.
    if (world.typeOf(at).farm && world.typeOf(slot).carries > 0) {
      const tile = cy * map.width + cx;
      if (freeSpot(world, slot, tile, region, spotsTakenExcept(world, [slot])) !== -1 && assignGather(world, slot, tile)) return;
    }
    let best = -1;
    let bestDistance = 0;
    for (const terrain of terrainsAccepted(world.entityType[at]!)) {
      const tile = map.nearestResource(cx, cy, terrain, region, CAMP_RADIUS);
      if (tile === -1) continue;
      const dx = (tile % map.width) - cx;
      const dy = idiv(tile, map.width) - cy;
      const distance = dx * dx + dy * dy;
      if (best === -1 || distance < bestDistance) {
        best = tile;
        bestDistance = distance;
      }
    }
    if (best !== -1 && world.typeOf(slot).carries > 0 && assignGather(world, slot, best)) return;
  }
  let next = -1;
  let nearest = NEXT_SITE_RADIUS * ONE;
  for (let other = 0; other < world.highWater; other++) {
    if (world.alive[other] === 0 || world.mobile[other] === 1) continue;
    if (world.owner[other] !== owner || world.built[other] === 1) continue;
    const distance = length(world.posX[other]! - px, world.posY[other]! - py);
    if (distance < nearest) {
      next = other;
      nearest = distance;
    }
  }
  if (next !== -1 && assignConstruction(world, slot, world.idAt(next))) return;
  stopWorking(world, slot);
}
