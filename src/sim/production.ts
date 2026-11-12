/**
 * Training units and researching technology, and the population that limits
 * the first.
 *
 * A building works through its queue one thing at a time. Whatever is queued
 * is paid for then, and refunded if cancelled. Training a unit does not begin
 * until there is room for it in the player's population, which is what houses
 * are for. Research (see tech.ts) waits in the same queue and needs no room.
 */

import { assignGather } from './economy';
import { POPULATION_LIMIT, resourceOfTerrain, TRAIN_QUEUE_LENGTH, trainingTicks } from './entityTypes';
import { finishResearch, QUEUED_TECH, queuedCost, researchTicks } from './tech';
import { HALF, length, ONE } from './fixed';
import { beginOrder } from './routing';
import { entityIndex, NO_ENTITY, type EntityId, type World } from './world';

export interface Population {
  /** Units alive, plus units being trained that have had room set aside. */
  readonly used: number[];
  /** Room the player's finished buildings provide, up to the limit. */
  readonly room: number[];
}

/** Each player's population, counted afresh from the world. */
export function countPopulation(world: World): Population {
  const used = new Array<number>(world.config.playerCount).fill(0);
  const room = new Array<number>(world.config.playerCount).fill(0);
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0) continue;
    const owner = world.owner[slot]!;
    const type = world.typeOf(slot);
    if (world.mobile[slot] === 1) {
      used[owner]! += type.population;
      continue;
    }
    if (world.built[slot] === 1) room[owner]! += type.housing;
    if (world.trainStarted[slot] === 1) {
      used[owner]! += world.types[owner]![world.trainQueue[slot * TRAIN_QUEUE_LENGTH]! - 1]!.population;
    }
  }
  for (let player = 0; player < room.length; player++) room[player] = Math.min(POPULATION_LIMIT, room[player]!);
  return { used, room };
}

/** Whether this is a finished building of the player's that can train the unit type, in the age the player has reached. */
function trainsHere(world: World, player: number, id: EntityId, unitType: number): boolean {
  if (!world.isAlive(id)) return false;
  const slot = entityIndex(id);
  return (
    world.mobile[slot] === 0 &&
    world.owner[slot] === player &&
    world.built[slot] === 1 &&
    world.typeOf(slot).trains.includes(unitType) &&
    world.age[player]! >= world.types[player]![unitType]!.age
  );
}

/** Adds a unit to a building's queue and takes its cost. Returns false if it cannot be done. */
export function queueTraining(world: World, player: number, building: EntityId, unitType: number): boolean {
  if (!trainsHere(world, player, building, unitType)) return false;
  const slot = entityIndex(building);
  const waiting = world.trainLength[slot]!;
  const cost = world.types[player]![unitType]!.cost;
  if (waiting >= TRAIN_QUEUE_LENGTH || !world.canAfford(player, cost)) return false;
  world.pay(player, cost);
  world.trainQueue[slot * TRAIN_QUEUE_LENGTH + waiting] = unitType + 1;
  world.trainLength[slot] = waiting + 1;
  return true;
}

/** Takes a unit or a technology out of a building's queue and gives its cost back. */
export function cancelTraining(world: World, player: number, building: EntityId, index: number): boolean {
  if (!world.isAlive(building)) return false;
  const slot = entityIndex(building);
  if (world.mobile[slot] === 1 || world.owner[slot] !== player) return false;
  const waiting = world.trainLength[slot]!;
  if (!Number.isInteger(index) || index < 0 || index >= waiting) return false;
  const base = slot * TRAIN_QUEUE_LENGTH;
  world.refund(player, queuedCost(world, player, world.trainQueue[base + index]!));
  for (let k = index + 1; k < waiting; k++) world.trainQueue[base + k - 1] = world.trainQueue[base + k]!;
  world.trainQueue[base + waiting - 1] = 0;
  world.trainLength[slot] = waiting - 1;
  if (index === 0) {
    // The one in training: its progress is lost and its place in the population freed.
    world.trainTicks[slot] = 0;
    world.trainStarted[slot] = 0;
  }
  return true;
}

export function productionSystem(world: World): void {
  let population: Population | null = null;
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0 || world.trainLength[slot] === 0 || world.built[slot] === 0) continue;
    const owner = world.owner[slot]!;
    const head = world.trainQueue[slot * TRAIN_QUEUE_LENGTH]!;
    if (head >= QUEUED_TECH) {
      // Research: nothing to wait for, and nobody to turn out at the end.
      world.trainTicks[slot] = world.trainTicks[slot]! + 1;
      if (world.trainTicks[slot]! < researchTicks(head - QUEUED_TECH, world.config.tickRate)) continue;
      finishResearch(world, slot, head - QUEUED_TECH);
      // Its effects may have changed how much room units take or buildings give.
      population = null;
    } else {
      population ??= countPopulation(world);
      const unitType = head - 1;
      const type = world.types[owner]![unitType]!;
      if (world.trainStarted[slot] === 0) {
        // Waits here, costing nothing more, until there is room.
        if (population.used[owner]! + type.population > population.room[owner]!) continue;
        world.trainStarted[slot] = 1;
        population.used[owner]! += type.population;
      }
      world.trainTicks[slot] = world.trainTicks[slot]! + 1;
      if (world.trainTicks[slot]! < trainingTicks(type, world.config.tickRate)) continue;
      if (!turnOut(world, slot, unitType)) continue; // nowhere to stand yet; try again next tick
    }
    const base = slot * TRAIN_QUEUE_LENGTH;
    const waiting = world.trainLength[slot]!;
    for (let k = 1; k < waiting; k++) world.trainQueue[base + k - 1] = world.trainQueue[base + k]!;
    world.trainQueue[base + waiting - 1] = 0;
    world.trainLength[slot] = waiting - 1;
    world.trainTicks[slot] = 0;
    world.trainStarted[slot] = 0;
  }
}

/**
 * Brings a trained unit into the world beside its building, on the side
 * nearest the rally point, and sends it there. Returns false if there is no
 * open ground beside the building or the world is full.
 */
function turnOut(world: World, building: number, unitType: number): boolean {
  const { map } = world;
  const hasRally = world.rallyX[building]! >= 0;
  // With no rally point set, units come out of the front, which faces down the screen.
  const towardX = hasRally ? world.rallyX[building]! : world.posX[building]!;
  const towardY = hasRally ? world.rallyY[building]! : world.posY[building]! + 64 * ONE;
  const reach = (world.typeOf(building).footprint >> 1) + 1;
  const cx = world.posX[building]! >> 16;
  const cy = world.posY[building]! >> 16;
  let bestX = 0;
  let bestY = 0;
  let bestDistance = -1;
  for (let oy = -reach; oy <= reach; oy++) {
    for (let ox = -reach; ox <= reach; ox++) {
      if (ox !== -reach && ox !== reach && oy !== -reach && oy !== reach) continue;
      if (!map.isPassable(cx + ox, cy + oy)) continue;
      const x = (cx + ox) * ONE + HALF;
      const y = (cy + oy) * ONE + HALF;
      const distance = length(x - towardX, y - towardY);
      if (bestDistance === -1 || distance < bestDistance) {
        bestX = x;
        bestY = y;
        bestDistance = distance;
      }
    }
  }
  if (bestDistance === -1) return false;
  const id = world.spawnUnit(world.owner[building]!, unitType, bestX, bestY);
  if (id === NO_ENTITY) return false;
  const slot = entityIndex(id);
  const tile = world.rallyTile[building]!;
  if (tile >= 0 && world.typeOf(slot).carries > 0 && resourceOfTerrain(map.terrain[tile]!) !== -1) {
    // Rallied onto a resource: start work at once.
    if (assignGather(world, slot, tile)) return true;
  }
  if (hasRally) beginOrder(world, slot, 0, world.rallyX[building]!, world.rallyY[building]!);
  return true;
}
