/**
 * A replay is the match settings plus every command and the tick it ran on.
 * Running it again rebuilds the match exactly, which is also how the tests
 * check that the simulation is deterministic.
 */

import type { ScheduledCommand } from './commands';
import { step } from './sim';
import { World, type SimConfig } from './world';

export interface Replay {
  readonly version: 1;
  readonly config: SimConfig;
  /** How many ticks the recorded match ran. */
  readonly ticks: number;
  readonly commands: readonly ScheduledCommand[];
}

/**
 * Re-runs a replay from the start and returns the resulting world. onTick, if
 * given, is called after every tick.
 */
export function runReplay(
  replay: Replay,
  onTick?: (world: World) => void,
  untilTick: number = replay.ticks,
): World {
  if (replay.version !== 1) throw new Error(`unsupported replay version ${String(replay.version)}`);
  const world = new World(replay.config);
  for (const entry of replay.commands) world.commands.schedule(entry, 0);
  while (world.tick < untilTick) {
    step(world);
    onTick?.(world);
  }
  return world;
}
