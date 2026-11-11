/**
 * Applying commands to the world.
 *
 * Commands come from outside (a player, the network, a file), so nothing in
 * them is trusted. Anything invalid is skipped, identically on every machine.
 */

import type { Command, ScheduledCommand } from './commands';
import { demolish, found } from './buildings';
import { acceptsDeliveries, assignConstruction, assignDelivery, assignGather, spotsTakenExcept } from './economy';
import { ENTITY_TYPES, resourceOfTerrain } from './entityTypes';
import { clamp, fromRatio, HALF, idiv, isqrt, length, mul, mulDiv, ONE, type Fixed } from './fixed';
import { cancelTraining, queueTraining } from './production';
import { beginOrder } from './routing';
import { entityIndex, MoveState, NO_ENTITY, ORDER_QUEUE_LENGTH, type World } from './world';

/** Limits on what a single command may ask for, whoever sent it. */
const MAX_UNITS_PER_COMMAND = 1024;
const MAX_SPAWN_PER_COMMAND = 256;

const SPAWN_SCATTER: Fixed = 2 * ONE;
/** Gap between neighbours in a formation, centre to centre. */
const FORMATION_SPACING: Fixed = fromRatio(3, 5);
/** How far a formation place may be moved to find open ground. */
const SLOT_SEARCH_RADIUS = 12;
/** Where the second, third and fourth units sharing a relocated place stand within the tile. */
const SHARED_TILE_OFFSETS = [
  [0, 0],
  [-1, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
];

export function applyCommand(world: World, entry: ScheduledCommand): void {
  const { player, command } = entry;
  if (!Number.isInteger(player) || player < 0 || player >= world.config.playerCount) return;
  if (command === null || typeof command !== 'object') return;
  switch (command.kind) {
    case 'spawn':
      applySpawn(world, player, command);
      break;
    case 'move':
      applyMove(world, player, command);
      break;
    case 'stop':
      for (const slot of ownedSlots(world, player, command.units)) {
        world.clearOrders(slot);
        world.clearJob(slot);
      }
      break;
    case 'gather':
      applyGather(world, player, command);
      break;
    case 'deliver':
      applyDeliver(world, player, command);
      break;
    case 'build': {
      const site = found(world, player, command.buildingType | 0, command.tileX, command.tileY);
      if (site !== NO_ENTITY) sendBuilders(world, player, command.units, site);
      break;
    }
    case 'construct':
      sendBuilders(world, player, command.units, command.target);
      break;
    case 'train':
      queueTraining(world, player, command.building, command.unitType | 0);
      break;
    case 'cancelTrain':
      cancelTraining(world, player, command.building, command.index);
      break;
    case 'rally':
      applyRally(world, player, command);
      break;
    case 'demolish':
      if (Array.isArray(command.targets)) {
        for (const target of command.targets.slice(0, MAX_UNITS_PER_COMMAND)) demolish(world, player, target);
      }
      break;
  }
}

/** Sets the listed villagers to work on a site. Units that cannot build walk over to it instead. */
function sendBuilders(world: World, player: number, units: readonly number[], site: number): void {
  if (!world.isAlive(site)) return;
  const at = entityIndex(site);
  if (world.mobile[at] === 1 || world.owner[at] !== player) return;
  const walkers: number[] = [];
  for (const slot of ownedSlots(world, player, units)) {
    if (!assignConstruction(world, slot, site)) walkers.push(world.idAt(slot));
  }
  if (walkers.length > 0) {
    applyMove(world, player, { kind: 'move', units: walkers, x: world.posX[at]!, y: world.posY[at]! });
  }
}

function applyRally(world: World, player: number, command: Extract<Command, { kind: 'rally' }>): void {
  const { map } = world;
  if (!Array.isArray(command.buildings)) return;
  const x = clamp(command.x | 0, 0, map.maxX);
  const y = clamp(command.y | 0, 0, map.maxY);
  const tile = map.tileAt(x, y);
  for (const id of command.buildings.slice(0, MAX_UNITS_PER_COMMAND)) {
    if (!world.isAlive(id)) continue;
    const slot = entityIndex(id);
    if (world.mobile[slot] === 1 || world.owner[slot] !== player) continue;
    world.rallyX[slot] = x;
    world.rallyY[slot] = y;
    world.rallyTile[slot] = resourceOfTerrain(map.terrain[tile]!) !== -1 ? tile : -1;
  }
}

function applyGather(world: World, player: number, command: Extract<Command, { kind: 'gather' }>): void {
  const { map } = world;
  const tile = command.tile;
  if (!Number.isInteger(tile) || tile < 0 || tile >= map.tileCount) return;
  // Units that cannot gather, and everyone if there is nothing there, just walk over.
  const walkers: number[] = [];
  const slots = ownedSlots(world, player, command.units);
  // Everyone in the order gives up their old place; they share out the free ones between them.
  const taken = spotsTakenExcept(world, slots);
  for (const slot of slots) {
    const gathers = ENTITY_TYPES[world.entityType[slot]!]!.carries > 0;
    if (!gathers || !assignGather(world, slot, tile, taken)) walkers.push(world.idAt(slot));
  }
  if (walkers.length > 0) {
    applyMove(world, player, { kind: 'move', units: walkers, x: map.centreX(tile), y: map.centreY(tile) });
  }
}

function applyDeliver(world: World, player: number, command: Extract<Command, { kind: 'deliver' }>): void {
  const target = command.target;
  if (!acceptsDeliveries(world, target, player)) return;
  const at = entityIndex(target);
  const walkers: number[] = [];
  for (const slot of ownedSlots(world, player, command.units)) {
    if (world.carry[slot]! > 0) assignDelivery(world, slot, target);
    else walkers.push(world.idAt(slot));
  }
  if (walkers.length > 0) {
    applyMove(world, player, { kind: 'move', units: walkers, x: world.posX[at]!, y: world.posY[at]! });
  }
}

function applySpawn(world: World, player: number, command: Extract<Command, { kind: 'spawn' }>): void {
  const { map } = world;
  const unitType = command.unitType | 0;
  const type = ENTITY_TYPES[unitType];
  if (type === undefined || type.building) return;
  const count = clamp(command.count | 0, 0, MAX_SPAWN_PER_COMMAND);
  const centreX = clamp(command.x | 0, 0, map.maxX);
  const centreY = clamp(command.y | 0, 0, map.maxY);
  // Everyone in the batch appears on the same connected piece of ground.
  const anchor = map.nearestPassable(centreX >> 16, centreY >> 16);
  if (anchor === -1) return;
  const region = map.region[anchor]!;
  for (let i = 0; i < count; i++) {
    let x = clamp(centreX + world.rng.rangeFixed(-SPAWN_SCATTER, SPAWN_SCATTER), 0, map.maxX);
    let y = clamp(centreY + world.rng.rangeFixed(-SPAWN_SCATTER, SPAWN_SCATTER), 0, map.maxY);
    if (map.region[map.tileAt(x, y)] !== region) {
      const tile = map.nearestPassable(x >> 16, y >> 16, region);
      x = map.centreX(tile);
      y = map.centreY(tile);
    }
    world.spawnUnit(player, unitType, x, y);
  }
}

function applyMove(world: World, player: number, command: Extract<Command, { kind: 'move' }>): void {
  const { map } = world;
  const slots = ownedSlots(world, player, command.units);
  if (slots.length === 0) return;
  const queue = command.queue === true;

  let destX = clamp(command.x | 0, 0, map.maxX);
  let destY = clamp(command.y | 0, 0, map.maxY);
  let destTile = map.tileAt(destX, destY);
  if (map.passable[destTile] === 0) {
    // Ordered onto water, trees or rock: go to the nearest ground instead.
    destTile = map.nearestPassable(destX >> 16, destY >> 16);
    if (destTile === -1) return;
    destX = map.centreX(destTile);
    destY = map.centreY(destTile);
  }
  const destRegion = map.region[destTile]!;

  // A queued order starts from wherever the unit's previous orders leave it.
  const fromX: number[] = [];
  const fromY: number[] = [];
  for (const slot of slots) {
    const waiting = world.queueLength[slot]!;
    if (queue && waiting > 0) {
      fromX.push(world.queueX[slot * ORDER_QUEUE_LENGTH + waiting - 1]!);
      fromY.push(world.queueY[slot * ORDER_QUEUE_LENGTH + waiting - 1]!);
    } else if (queue && world.moveState[slot] !== MoveState.Idle) {
      fromX.push(world.goalX[slot]!);
      fromY.push(world.goalY[slot]!);
    } else {
      fromX.push(world.posX[slot]!);
      fromY.push(world.posY[slot]!);
    }
  }

  // Units that cannot reach the destination at all (the far side of a river
  // with no ford, say) each go as near as they can get.
  const members: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const region = map.region[map.tileAt(fromX[i]!, fromY[i]!)]!;
    if (region === destRegion) {
      members.push(i);
      continue;
    }
    const tile = map.nearestPassable(destX >> 16, destY >> 16, region, Math.max(map.width, map.height));
    if (tile !== -1) giveOrder(world, slot, 0, map.centreX(tile), map.centreY(tile), queue);
  }
  if (members.length === 0) return;
  if (members.length === 1) {
    giveOrder(world, slots[members[0]!]!, 0, destX, destY, queue);
    return;
  }

  // The formation faces the way the group is travelling.
  let sumX = 0;
  let sumY = 0;
  for (const i of members) {
    sumX += fromX[i]!;
    sumY += fromY[i]!;
  }
  const centroidX = idiv(sumX, members.length);
  const centroidY = idiv(sumY, members.length);
  let forwardX = destX - centroidX;
  let forwardY = destY - centroidY;
  const travel = length(forwardX, forwardY);
  if (travel < HALF) {
    const lead = slots[members[0]!]!;
    forwardX = world.dirX[lead]!;
    forwardY = world.dirY[lead]!;
  } else {
    forwardX = mulDiv(forwardX, ONE, travel);
    forwardY = mulDiv(forwardY, ONE, travel);
  }
  const rightX = -forwardY;
  const rightY = forwardX;

  // A block about twice as wide as it is deep.
  const n = members.length;
  let columns = isqrt(2 * n);
  if (columns * columns < 2 * n) columns++;
  if (columns > n) columns = n;
  const rows = idiv(n + columns - 1, columns);

  // Front rank to the units already furthest forward, and within each rank
  // left to right, so the group reshuffles as little as possible.
  const ahead = (i: number): number => mul(fromX[i]! - centroidX, forwardX) + mul(fromY[i]! - centroidY, forwardY);
  const across = (i: number): number => mul(fromX[i]! - centroidX, rightX) + mul(fromY[i]! - centroidY, rightY);
  const ordered = [...members].sort((a, b) => ahead(b) - ahead(a) || slots[a]! - slots[b]!);

  const group = world.createGroup(destTile, forwardX, forwardY);
  const sharing = new Map<number, number>();
  const half = FORMATION_SPACING >> 1;
  for (let row = 0; row < rows; row++) {
    const rank = ordered.slice(row * columns, (row + 1) * columns);
    rank.sort((a, b) => across(a) - across(b) || slots[a]! - slots[b]!);
    const depth = (rows - 1 - 2 * row) * half;
    for (let k = 0; k < rank.length; k++) {
      const side = (2 * k - (rank.length - 1)) * half;
      let x = destX + mul(rightX, side) + mul(forwardX, depth);
      let y = destY + mul(rightY, side) + mul(forwardY, depth);
      const inBounds = x >= 0 && y >= 0 && x <= map.maxX && y <= map.maxY;
      if (!inBounds || map.region[map.tileAt(x, y)] !== destRegion) {
        // This place in the block is in the trees or the river. Stand on the
        // nearest ground that can be reached, a few to a tile if need be.
        const tile = inBounds
          ? map.nearestPassable(x >> 16, y >> 16, destRegion, SLOT_SEARCH_RADIUS)
          : -1;
        const stand = tile === -1 ? destTile : tile;
        const already = sharing.get(stand) ?? 0;
        sharing.set(stand, already + 1);
        const offset = SHARED_TILE_OFFSETS[already % SHARED_TILE_OFFSETS.length]!;
        x = map.centreX(stand) + offset[0]! * (ONE >> 2);
        y = map.centreY(stand) + offset[1]! * (ONE >> 2);
      }
      giveOrder(world, slots[rank[k]!]!, group.id, x, y, queue);
    }
  }
  if (group.refs === 0) world.groups.delete(group.id);
}

/** Hands a unit a destination, either replacing what it is doing or adding to its queue. */
function giveOrder(world: World, slot: number, groupId: number, x: Fixed, y: Fixed, queue: boolean): void {
  // Being sent somewhere takes a villager off its work.
  world.clearJob(slot);
  const busy = world.moveState[slot] !== MoveState.Idle || world.queueLength[slot]! > 0;
  if (queue && busy) {
    const waiting = world.queueLength[slot]!;
    if (waiting >= ORDER_QUEUE_LENGTH) return;
    const at = slot * ORDER_QUEUE_LENGTH + waiting;
    world.queueGroup[at] = groupId;
    world.queueX[at] = x;
    world.queueY[at] = y;
    world.queueLength[slot] = waiting + 1;
    world.retainGroup(groupId);
    return;
  }
  world.clearOrders(slot);
  world.retainGroup(groupId);
  beginOrder(world, slot, groupId, x, y);
}

/**
 * The slots of the listed units that are alive, mobile and belong to the
 * player, in the order listed, each at most once.
 */
function ownedSlots(world: World, player: number, units: readonly number[]): number[] {
  const slots: number[] = [];
  if (!Array.isArray(units)) return slots;
  const seen = new Set<number>();
  const limit = Math.min(units.length, MAX_UNITS_PER_COMMAND);
  for (let i = 0; i < limit; i++) {
    const id = units[i]!;
    if (!world.isAlive(id)) continue;
    const slot = entityIndex(id);
    // Buildings take no orders.
    if (world.owner[slot] !== player || world.mobile[slot] === 0 || seen.has(slot)) continue;
    seen.add(slot);
    slots.push(slot);
  }
  return slots;
}
