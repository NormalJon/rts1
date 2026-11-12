/**
 * A 32-bit checksum of the whole world.
 *
 * Two simulations with the same checksum on the same tick are, for practical
 * purposes, in the same state. Multiplayer compares checksums every few ticks
 * to catch a divergence the moment it happens; the tests use it to prove that
 * replays and saved games reproduce a match exactly.
 */

import { SHOT_FIELDS, type RouteRequest, type World } from './world';

/** One round of MurmurHash3 (32-bit). */
function mix(h: number, value: number): number {
  let k = Math.imul(value | 0, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

function finish(h: number, length: number): number {
  h ^= length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashWorld(world: World): number {
  let h = 0x2f0b4a1d;
  let words = 0;
  const add = (value: number): void => {
    h = mix(h, value);
    words++;
  };
  const addRequest = (request: RouteRequest): void => {
    if (request.kind === 'path') {
      add(1);
      add(request.slot);
      add(request.seq);
    } else {
      add(2);
      add(request.group);
    }
  };

  add(world.tick);
  add(world.map.checksum);
  add(world.map.stateHash);
  for (let i = 0; i < world.stock.length; i++) add(world.stock[i]!);
  for (let i = 0; i < world.spent.length; i++) add(world.spent[i]!);
  for (let i = 0; i < world.lost.length; i++) add(world.lost[i]!);
  add(world.exploredHash);
  add(world.shotCount);
  for (let i = 0; i < world.shotCount * SHOT_FIELDS; i++) add(world.shots[i]!);
  for (const word of world.rng.getState()) add(word);
  add(world.highWater);
  add(world.freeSlots.length);
  for (const slot of world.freeSlots) add(slot);

  const columns = world.columns;
  for (let slot = 0; slot < world.highWater; slot++) {
    add(world.alive[slot]!);
    add(world.generation[slot]!);
    // A dead slot's leftover values affect nothing, so they are not state.
    if (world.alive[slot] === 0) continue;
    for (const { data, stride } of columns) {
      for (let k = slot * stride; k < (slot + 1) * stride; k++) add(data[k]!);
    }
    const path = world.paths[slot];
    add(path === undefined ? -1 : path.length);
    if (path !== undefined) for (let k = 0; k < path.length; k++) add(path[k]!);
  }

  // Groups are created with rising ids and kept in that order.
  add(world.nextGroupId);
  add(world.groups.size);
  for (const group of world.groups.values()) {
    add(group.id);
    add(group.goalTile);
    add(group.faceX);
    add(group.faceY);
    add(group.refs);
    add(group.status);
    add(group.fieldChecksum);
  }

  add(world.routeQueue.length);
  for (const request of world.routeQueue) addRequest(request);
  const active = world.activeSearch;
  add(active === null ? 0 : 1);
  if (active !== null) {
    addRequest(active.request);
    add(active.start);
    add(active.goal);
    add(active.targets.length);
    for (const tile of active.targets) add(tile);
    add(active.search.expansions);
  }
  return finish(h, words);
}

/** The checksum as eight hex digits, for logs and debug displays. */
export function hashHex(hash: number): string {
  return hash.toString(16).padStart(8, '0');
}
