/**
 * Saving and restoring the whole world.
 *
 * A snapshot is plain data, so JSON.stringify turns it straight into a save
 * file, and the same thing lets a player who dropped out of a multiplayer
 * match rejoin: load the snapshot, then run the commands issued since.
 */

import type { ScheduledCommand } from './commands';
import type { RngState } from './rng';
import { World, type SimConfig } from './world';

export interface WorldSnapshot {
  readonly version: 1;
  readonly config: SimConfig;
  readonly tick: number;
  readonly rng: RngState;
  readonly highWater: number;
  readonly freeSlots: readonly number[];
  /** Each entity property by name, holding slots 0 to highWater - 1. */
  readonly columns: Readonly<Record<string, readonly number[]>>;
  /** Commands issued but not yet run. */
  readonly pending: readonly ScheduledCommand[];
}

export function takeSnapshot(world: World): WorldSnapshot {
  const columns: Record<string, number[]> = {};
  for (const { name, data } of world.columns) {
    columns[name] = Array.from(data.subarray(0, world.highWater));
  }
  return {
    version: 1,
    config: { ...world.config },
    tick: world.tick,
    rng: world.rng.getState(),
    highWater: world.highWater,
    freeSlots: [...world.freeSlots],
    columns,
    pending: world.commands.pending(),
  };
}

export function restoreSnapshot(snapshot: WorldSnapshot): World {
  if (snapshot.version !== 1) {
    throw new Error(`unsupported snapshot version ${String(snapshot.version)}`);
  }
  const world = new World(snapshot.config);
  if (snapshot.highWater > world.config.maxEntities) {
    throw new Error('snapshot holds more entities than its config allows');
  }
  world.tick = snapshot.tick;
  world.rng.setState(snapshot.rng);
  world.highWater = snapshot.highWater;
  world.freeSlots.push(...snapshot.freeSlots);
  for (const { name, data } of world.columns) {
    const saved = snapshot.columns[name];
    if (saved === undefined) throw new Error(`snapshot is missing column "${name}"`);
    if (saved.length !== snapshot.highWater) {
      throw new Error(`snapshot column "${name}" has the wrong length`);
    }
    data.set(saved);
  }
  for (const entry of snapshot.pending) world.commands.schedule(entry, world.tick);
  return world;
}
