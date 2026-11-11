/**
 * Gathering: the round trip a villager makes between a resource and the
 * nearest place to hand it in.
 *
 *   walk to a free place beside the resource  ->  work until loaded
 *        ^                                              |
 *        |                                              v
 *   hand in at the drop-off  <-  carry the load to the nearest one
 *
 * When a tile runs out the villager moves to the nearest tile of the same
 * kind. Everything taken from the map ends up either on a villager's back or
 * in a stockpile; nothing is created or lost along the way.
 */

import { ENTITY_TYPES, RESOURCE_COUNT, resourceOfTerrain, ticksPerUnit } from './entityTypes';
import { fromRatio, HALF, idiv, length, mulDiv, ONE, type Fixed } from './fixed';
import { DIR_X, DIR_Y } from './map';
import { beginOrder } from './routing';
import { entityIndex, Job, MoveState, NO_ENTITY, type EntityId, type World } from './world';

/** How close a villager must stand to a tile or building to work on it or hand in. */
const REACH: Fixed = fromRatio(4, 5);
/** How far it will look for another tile of the same resource. */
const SEARCH_RADIUS = 14;
/** How many times it tries to reach a place before giving up on it. */
const MAX_TRIES = 3;
/** Two villagers share a tile beside a resource, standing this far either side of its middle. */
const SIDE_STEP: Fixed = ONE >> 2;
const LEAN_IN: Fixed = fromRatio(3, 20);

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
  const capacity = ENTITY_TYPES[world.entityType[slot]!]!.carries;
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

export function economySystem(world: World): void {
  const { map } = world;
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0) continue;
    const job = world.job[slot]!;
    if (job === Job.None) continue;

    if (job === Job.ToDropOff) {
      const target = world.jobTarget[slot]!;
      if (!isDropOff(world, target, world.owner[slot]!)) {
        // The building has gone. Try another.
        startDelivery(world, slot);
        continue;
      }
      const at = entityIndex(target);
      const half = ENTITY_TYPES[world.entityType[at]!]!.footprint >> 1;
      const left = (world.posX[at]! >> 16) - half;
      const top = (world.posY[at]! >> 16) - half;
      if (withinReach(world, slot, left, top, half * 2 + 1)) {
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

    // Harvesting. A villager jostled out of reach waits to drift back before carrying on.
    if (!near) continue;
    const resource = resourceOfTerrain(map.terrain[tile]!);
    world.jobTimer[slot] = world.jobTimer[slot]! + 1;
    if (world.jobTimer[slot]! < ticksPerUnit(resource, world.config.tickRate)) continue;
    world.jobTimer[slot] = 0;
    map.harvest(tile);
    world.carryKind[slot] = resource;
    world.carry[slot] = world.carry[slot]! + 1;
    if (world.carry[slot]! >= ENTITY_TYPES[world.entityType[slot]!]!.carries) startDelivery(world, slot);
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
  for (let dir = 0; dir < 8; dir++) {
    const nx = tx + DIR_X[dir]!;
    const ny = ty + DIR_Y[dir]!;
    if (!map.isPassable(nx, ny)) continue;
    const stand = ny * map.width + nx;
    if (map.region[stand] !== region) continue;
    for (let side = 0; side < 2; side++) {
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

function isDropOff(world: World, id: EntityId, owner: number): boolean {
  if (!world.isAlive(id)) return false;
  const slot = entityIndex(id);
  return world.owner[slot] === owner && ENTITY_TYPES[world.entityType[slot]!]!.dropOff;
}

/** Whether a player owns this building and gatherers can hand in there. */
export function acceptsDeliveries(world: World, id: EntityId, owner: number): boolean {
  return isDropOff(world, id, owner);
}

/**
 * Sends a loaded villager to a drop-off: the one given, or the nearest. With
 * none standing it stops and keeps its load.
 */
function startDelivery(world: World, slot: number, building: EntityId = NO_ENTITY): void {
  const { map } = world;
  const owner = world.owner[slot]!;
  const px = world.posX[slot]!;
  const py = world.posY[slot]!;
  let target = isDropOff(world, building, owner) ? entityIndex(building) : -1;
  if (target === -1) {
    let nearest = 0;
    for (let other = 0; other < world.highWater; other++) {
      if (world.alive[other] === 0 || world.mobile[other] === 1 || world.owner[other] !== owner) continue;
      if (!ENTITY_TYPES[world.entityType[other]!]!.dropOff) continue;
      const distance = length(world.posX[other]! - px, world.posY[other]! - py);
      if (target === -1 || distance < nearest) {
        target = other;
        nearest = distance;
      }
    }
  }
  if (target === -1) {
    const tile = world.jobTile[slot]!;
    const terrain = world.jobTerrain[slot]!;
    stopWorking(world, slot);
    // Remember the work, so it can be picked up when there is somewhere to deliver to.
    world.jobTile[slot] = tile;
    world.jobTerrain[slot] = terrain;
    return;
  }

  // Walk to the nearest open tile on the ring just outside the building.
  const region = map.region[map.tileAt(px, py)]!;
  const reach = (ENTITY_TYPES[world.entityType[target]!]!.footprint >> 1) + 1;
  const cx = world.posX[target]! >> 16;
  const cy = world.posY[target]! >> 16;
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
      const distance = length(x - px, y - py);
      if (bestDistance === -1 || distance < bestDistance) {
        bestX = x;
        bestY = y;
        bestDistance = distance;
      }
    }
  }
  if (bestDistance === -1) {
    stopWorking(world, slot);
    return;
  }
  walkTo(world, slot, bestX, bestY);
  world.jobTarget[slot] = world.idAt(target);
  world.job[slot] = Job.ToDropOff;
}
