/**
 * A 32-bit checksum of the whole world.
 *
 * Two simulations with the same checksum on the same tick are, for practical
 * purposes, in the same state. Multiplayer compares checksums every few ticks
 * to catch a divergence the moment it happens; the tests use it to prove that
 * replays and saved games reproduce a match exactly.
 */

import type { World } from './world';

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

  add(world.tick);
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
    for (const { data } of columns) add(data[slot]!);
  }
  return finish(h, words);
}

/** The checksum as eight hex digits, for logs and debug displays. */
export function hashHex(hash: number): string {
  return hash.toString(16).padStart(8, '0');
}
