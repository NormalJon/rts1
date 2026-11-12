/**
 * What each side can see: the fog of war.
 *
 * Every unit and building sees a disc of tiles around itself. Allies see as
 * one. For each side the world keeps two things about every tile: how many of
 * its own are looking at it right now, and whether it has ever been seen.
 * That gives the three states a player knows:
 *
 *   unexplored   never seen: nothing is known, not even the ground
 *   explored     seen once, not now: the ground is known, what stands on it is a memory
 *   visible      someone is looking: everything there is known
 *
 * The simulation needs this, not just the screen, because it decides what a
 * side may do: soldiers go only for enemies their side can see, an attack
 * cannot be ordered on a unit that is out of sight, and nothing can be built
 * on ground that has never been seen.
 *
 * The counts are kept up to date as things move: when a unit crosses into a
 * new tile its old disc is taken away and a new one laid down. They always
 * equal what counting from scratch would give, so a saved game stores only
 * what has been explored and counts the rest again on loading.
 */

import { ENTITY_TYPES, SITE_SIGHT } from './entityTypes';
import { idiv, isqrt } from './fixed';
import type { World } from './world';

/** The furthest anything can see, in tiles. */
export const MAX_SIGHT = 20;

/**
 * For each sight radius, how far its disc reaches either side of the middle
 * on each row: SPANS[r][dy + r]. A tile is inside if its centre is within
 * r + 1/2 tiles, which makes small discs round instead of diamond-shaped.
 */
const SPANS: Int8Array[] = [];
for (let r = 0; r <= MAX_SIGHT; r++) {
  const rows = new Int8Array(2 * r + 1);
  for (let dy = -r; dy <= r; dy++) rows[dy + r] = isqrt((2 * r + 1) * (2 * r + 1) - 4 * dy * dy) >> 1;
  SPANS.push(rows);
}

/** A number that stands for one side having explored one tile, for the running checksum. */
function exploredMark(view: number, tile: number): number {
  let h = Math.imul(tile + 1, 0x9e3779b1) ^ Math.imul(view + 1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return h ^ (h >>> 12);
}

/** Lays a disc of sight down on a side's view, or takes one away. */
function look(world: World, view: number, tile: number, radius: number, add: boolean): void {
  const { width, height } = world.map;
  const seen = world.seen[view]!;
  const explored = world.explored[view]!;
  const spans = SPANS[radius]!;
  const cx = tile % width;
  const cy = idiv(tile, width);
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= height) continue;
    const half = spans[dy + radius]!;
    const from = y * width + Math.max(0, cx - half);
    const to = y * width + Math.min(width - 1, cx + half);
    if (!add) {
      for (let i = from; i <= to; i++) seen[i] = seen[i]! - 1;
      continue;
    }
    for (let i = from; i <= to; i++) {
      seen[i] = seen[i]! + 1;
      if (explored[i] === 0) {
        explored[i] = 1;
        world.exploredHash ^= exploredMark(view, i);
      }
    }
  }
}

/** How far an entity sees just now. A building site sees little until it is finished. */
function sightOf(world: World, slot: number): number {
  const type = ENTITY_TYPES[world.entityType[slot]!]!;
  if (type.building && world.built[slot] === 0) return Math.min(type.sight, SITE_SIGHT);
  return Math.min(type.sight, MAX_SIGHT);
}

/** Brings what one entity sees up to date with where it now stands. */
export function lookAround(world: World, slot: number): void {
  const tile = world.map.tileAt(world.posX[slot]!, world.posY[slot]!);
  const radius = sightOf(world, slot);
  const was = world.sightTile[slot]!;
  if (was === tile && world.sightRadius[slot] === radius) return;
  const view = world.view[world.owner[slot]!]!;
  // The new disc goes down before the old comes up, so ground under both is never left unwatched.
  look(world, view, tile, radius, true);
  if (was >= 0) look(world, view, was, world.sightRadius[slot]!, false);
  world.sightTile[slot] = tile;
  world.sightRadius[slot] = radius;
}

/** Takes away what an entity sees, as when it dies. */
export function stopLooking(world: World, slot: number): void {
  const was = world.sightTile[slot]!;
  if (was < 0) return;
  look(world, world.view[world.owner[slot]!]!, was, world.sightRadius[slot]!, false);
  world.sightTile[slot] = -1;
}

/** Every tick, after everything has moved: everyone looks around from where they now stand. */
export function visionSystem(world: World): void {
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 1) lookAround(world, slot);
  }
}

/** Marks the whole map as explored by every side, for matches that start with the land known. */
export function exploreEverything(world: World): void {
  for (let view = 0; view < world.explored.length; view++) {
    const explored = world.explored[view]!;
    for (let tile = 0; tile < explored.length; tile++) {
      if (explored[tile] === 1) continue;
      explored[tile] = 1;
      world.exploredHash ^= exploredMark(view, tile);
    }
  }
}

/**
 * Puts a side's view back as it was saved: what it had explored, and from
 * that the checksum; then what everyone alive can see, counted afresh.
 */
export function restoreVision(world: World, explored: readonly (readonly number[])[]): void {
  world.exploredHash = 0;
  for (let view = 0; view < world.explored.length; view++) {
    const mine = world.explored[view]!;
    const runs = explored[view] ?? [];
    // Saved as runs: so many unexplored, so many explored, and so on in turn.
    let tile = 0;
    let value = 0;
    for (const run of runs) {
      if (value === 1) {
        for (let i = tile; i < tile + run && i < mine.length; i++) {
          mine[i] = 1;
          world.exploredHash ^= exploredMark(view, i);
        }
      }
      tile += run;
      value = 1 - value;
    }
    world.seen[view]!.fill(0);
  }
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0 || world.sightTile[slot]! < 0) continue;
    look(world, world.view[world.owner[slot]!]!, world.sightTile[slot]!, world.sightRadius[slot]!, true);
  }
}

/** What a side has explored, as runs of unexplored and explored tiles in turn, for saving. */
export function exploredRuns(world: World, view: number): number[] {
  const explored = world.explored[view]!;
  const runs: number[] = [];
  let value = 0;
  let length = 0;
  for (let tile = 0; tile < explored.length; tile++) {
    if (explored[tile] === value) {
      length++;
      continue;
    }
    runs.push(length);
    value = 1 - value;
    length = 1;
  }
  runs.push(length);
  return runs;
}

// ---- Questions ---------------------------------------------------------------

/** Whether a player's side has anyone looking at a tile right now. */
export function sees(world: World, player: number, tile: number): boolean {
  return world.config.mapState === 'revealed' || world.seen[world.view[player]!]![tile]! > 0;
}

/** Whether a player's side has ever seen a tile. */
export function hasExplored(world: World, player: number, tile: number): boolean {
  return world.config.mapState === 'revealed' || world.explored[world.view[player]!]![tile] === 1;
}

/**
 * Whether a player's side can see an entity right now. A unit is seen where
 * it stands; a building if any part of it is.
 */
export function canSee(world: World, player: number, slot: number): boolean {
  if (world.config.mapState === 'revealed') return true;
  const { map } = world;
  const seen = world.seen[world.view[player]!]!;
  if (world.mobile[slot] === 1) return seen[map.tileAt(world.posX[slot]!, world.posY[slot]!)]! > 0;
  // Its corners, the middles of its sides, and its centre.
  const half = ENTITY_TYPES[world.entityType[slot]!]!.footprint >> 1;
  const cx = world.posX[slot]! >> 16;
  const cy = world.posY[slot]! >> 16;
  for (let oy = -half; oy <= half; oy += Math.max(1, half)) {
    for (let ox = -half; ox <= half; ox += Math.max(1, half)) {
      if (seen[(cy + oy) * map.width + cx + ox]! > 0) return true;
    }
  }
  return false;
}
