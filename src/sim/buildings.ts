/**
 * Putting buildings on the map and taking them off again.
 *
 * A building is paid for when it is founded and blocks its ground from that
 * moment, finished or not. Founding one is the only way an obstacle can
 * appear in the middle of a match, so this is also where routes laid across
 * that ground are sent back to be worked out again.
 */

import { ENTITY_TYPES, TRAIN_QUEUE_LENGTH } from './entityTypes';
import { queuedCost } from './tech';
import { Terrain } from './map';
import { chooseRoute, routesAfterObstacle } from './routing';
import { hasExplored } from './vision';
import { entityIndex, MoveState, NO_ENTITY, type EntityId, type World } from './world';

/**
 * Whether a building of this type could be founded with its centre on a tile.
 *
 * @param player  If given, the plot must also be ground that player's side
 *   has explored: nobody builds on land they have never seen.
 */
export function canPlace(world: World, entityType: number, tileX: number, tileY: number, player?: number): boolean {
  const type = ENTITY_TYPES[entityType];
  if (type === undefined || !type.building) return false;
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) return false;
  const { map } = world;
  const half = type.footprint >> 1;
  for (let ty = tileY - half; ty <= tileY + half; ty++) {
    for (let tx = tileX - half; tx <= tileX + half; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
      const tile = ty * map.width + tx;
      // Open grass only: not water, a ford, trees, rock, a deposit or another building.
      if (map.terrain[tile] !== Terrain.Grass || map.blocked[tile] === 1) return false;
      if (player !== undefined && !hasExplored(world, player, tile)) return false;
    }
  }
  return true;
}

/**
 * Founds a building: takes its cost from the player's stores and marks out the
 * site. Returns its handle, or NO_ENTITY if it cannot go there or cannot be
 * afforded. Units standing on the plot step off it.
 */
export function found(world: World, player: number, entityType: number, tileX: number, tileY: number): EntityId {
  const type = world.types[player]![entityType];
  if (type === undefined || !type.building || !type.buildable || world.age[player]! < type.age) return NO_ENTITY;
  if (!canPlace(world, entityType, tileX, tileY, player) || !world.canAfford(player, type.cost)) return NO_ENTITY;
  const id = world.spawnBuilding(player, entityType, tileX, tileY, false);
  if (id === NO_ENTITY) return NO_ENTITY;
  world.pay(player, type.cost);
  const half = type.footprint >> 1;
  clearThePlot(world, tileX - half, tileY - half, type.footprint);
  routesAfterObstacle(world);
  return id;
}

/** Moves units off ground that has just been built on, to the nearest open tile. */
function clearThePlot(world: World, left: number, top: number, size: number): void {
  const { map } = world;
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0 || world.mobile[slot] === 0) continue;
    const tx = world.posX[slot]! >> 16;
    const ty = world.posY[slot]! >> 16;
    if (tx < left || ty < top || tx >= left + size || ty >= top + size) continue;
    const refuge = map.nearestPassable(tx, ty);
    if (refuge === -1) continue;
    world.posX[slot] = map.centreX(refuge);
    world.posY[slot] = map.centreY(refuge);
    if (world.moveState[slot] === MoveState.Idle) {
      world.goalX[slot] = world.posX[slot]!;
      world.goalY[slot] = world.posY[slot]!;
    } else {
      chooseRoute(world, slot);
    }
  }
}

/**
 * Pulls down a player's own building. An unfinished one gives back what it
 * cost; units and research it had queued give back theirs either way.
 */
export function demolish(world: World, player: number, id: EntityId): boolean {
  if (!world.isAlive(id)) return false;
  const slot = entityIndex(id);
  if (world.mobile[slot] === 1 || world.owner[slot] !== player) return false;
  const type = world.typeOf(slot);
  if (world.built[slot] === 0) world.refund(player, type.cost);
  for (let k = 0; k < world.trainLength[slot]!; k++) {
    world.refund(player, queuedCost(world, player, world.trainQueue[slot * TRAIN_QUEUE_LENGTH + k]!));
  }
  world.destroy(id);
  return true;
}
