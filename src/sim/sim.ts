/**
 * The tick: one fixed step of simulated time.
 *
 * Each tick does the same things in the same order: run the commands stamped
 * for this tick, then run every system. Nothing here reads a clock; how often
 * step() is called is the caller's business (see session/stepper.ts).
 */

import { movementSystem } from './movement';
import { applyCommand } from './orders';
import { routingSystem } from './routing';
import type { World } from './world';

export function step(world: World): void {
  for (const entry of world.commands.takeDue(world.tick)) applyCommand(world, entry);
  routingSystem(world);
  movementSystem(world);
  world.tick++;
}
