/**
 * The tick: one fixed step of simulated time.
 *
 * Each tick does the same things in the same order: run the commands stamped
 * for this tick, then run every system. Nothing here reads a clock; how often
 * step() is called is the caller's business (see session/stepper.ts).
 */

import type { Command, ScheduledCommand } from './commands';
import { clamp, fromInt, idiv, isqrt, length, mulDiv, ONE, type Fixed } from './fixed';
import { perSecondToPerTick } from './units';
import { entityIndex, type World } from './world';

/** Limits on what a single command may ask for, whoever sent it. */
const MAX_UNITS_PER_COMMAND = 1024;
const MAX_SPAWN_PER_COMMAND = 256;
/** Fastest speed a spawn command may request, in tiles per second. */
const MAX_SPEED: Fixed = 64 * ONE;

const SPAWN_SCATTER: Fixed = 3 * ONE;
const FORMATION_SPACING: Fixed = (ONE * 3) >> 2;

export function step(world: World): void {
  for (const entry of world.commands.takeDue(world.tick)) applyCommand(world, entry);
  movementSystem(world);
  world.tick++;
}

/**
 * Commands come from outside (a player, the network, a file), so nothing in
 * them is trusted. Anything invalid is skipped, identically on every machine.
 */
function applyCommand(world: World, entry: ScheduledCommand): void {
  const { player, command } = entry;
  if (!Number.isInteger(player) || player < 0 || player >= world.config.playerCount) return;
  switch (command.kind) {
    case 'spawn':
      applySpawn(world, player, command);
      break;
    case 'move':
      applyMove(world, player, command);
      break;
    case 'stop':
      for (const slot of ownedSlots(world, player, command.units)) {
        world.targetX[slot] = world.posX[slot]!;
        world.targetY[slot] = world.posY[slot]!;
        world.moving[slot] = 0;
      }
      break;
  }
}

function applySpawn(
  world: World,
  player: number,
  command: Extract<Command, { kind: 'spawn' }>,
): void {
  const count = clamp(command.count | 0, 0, MAX_SPAWN_PER_COMMAND);
  const speed = perSecondToPerTick(clamp(command.speed | 0, 0, MAX_SPEED), world.config.tickRate);
  const maxX = fromInt(world.config.mapWidth);
  const maxY = fromInt(world.config.mapHeight);
  for (let i = 0; i < count; i++) {
    const x = (command.x | 0) + world.rng.rangeFixed(-SPAWN_SCATTER, SPAWN_SCATTER);
    const y = (command.y | 0) + world.rng.rangeFixed(-SPAWN_SCATTER, SPAWN_SCATTER);
    world.spawn(player, clamp(x, 0, maxX), clamp(y, 0, maxY), speed);
  }
}

function applyMove(world: World, player: number, command: Extract<Command, { kind: 'move' }>): void {
  const slots = ownedSlots(world, player, command.units);
  const n = slots.length;
  if (n === 0) return;
  const maxX = fromInt(world.config.mapWidth);
  const maxY = fromInt(world.config.mapHeight);
  const centreX = clamp(command.x | 0, 0, maxX);
  const centreY = clamp(command.y | 0, 0, maxY);

  // Placeholder for real formations (step 2): spread the group over a square
  // grid centred on the destination so units do not pile onto one point.
  let columns = isqrt(n);
  if (columns * columns < n) columns++;
  const rows = idiv(n + columns - 1, columns);
  const halfSpacing = FORMATION_SPACING >> 1;
  for (let k = 0; k < n; k++) {
    const slot = slots[k]!;
    const column = k % columns;
    const row = idiv(k, columns);
    const offsetX = (column * 2 - (columns - 1)) * halfSpacing;
    const offsetY = (row * 2 - (rows - 1)) * halfSpacing;
    world.targetX[slot] = clamp(centreX + offsetX, 0, maxX);
    world.targetY[slot] = clamp(centreY + offsetY, 0, maxY);
    world.moving[slot] = 1;
  }
}

/**
 * The slots of the listed units that are alive and belong to the player, in
 * the order listed, each at most once.
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
    if (world.owner[slot] !== player || seen.has(slot)) continue;
    seen.add(slot);
    slots.push(slot);
  }
  return slots;
}

/**
 * Placeholder movement for the core build: straight toward the target at a
 * constant speed. Pathfinding and collision replace it in step 2.
 */
function movementSystem(world: World): void {
  const { alive, moving, posX, posY, targetX, targetY, speed } = world;
  for (let slot = 0; slot < world.highWater; slot++) {
    if (alive[slot] === 0 || moving[slot] === 0) continue;
    const dx = targetX[slot]! - posX[slot]!;
    const dy = targetY[slot]! - posY[slot]!;
    const distance = length(dx, dy);
    const stride = speed[slot]!;
    if (distance <= stride) {
      posX[slot] = targetX[slot]!;
      posY[slot] = targetY[slot]!;
      moving[slot] = 0;
    } else {
      posX[slot] = posX[slot]! + mulDiv(dx, stride, distance);
      posY[slot] = posY[slot]! + mulDiv(dy, stride, distance);
    }
  }
}
