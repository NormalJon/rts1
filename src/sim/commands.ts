/**
 * Commands are the only way anything outside the simulation changes it.
 *
 * A player's click, an AI decision, a line in a replay file and a packet from
 * another player all become the same thing: a command stamped with the tick it
 * runs on. Two simulations given the same commands on the same ticks end up in
 * exactly the same state.
 */

import type { EntityId } from './world';
import type { Fixed } from './fixed';

export type Command =
  /**
   * Scaffolding for the core build: drops units on the map so there is
   * something to move. Production buildings replace it in step 4.
   */
  | {
      readonly kind: 'spawn';
      readonly x: Fixed;
      readonly y: Fixed;
      readonly count: number;
      /** Tiles per second. */
      readonly speed: Fixed;
    }
  | {
      readonly kind: 'move';
      readonly units: readonly EntityId[];
      readonly x: Fixed;
      readonly y: Fixed;
    }
  | {
      readonly kind: 'stop';
      readonly units: readonly EntityId[];
    };

export interface ScheduledCommand {
  /** The command runs at the start of this tick. */
  readonly tick: number;
  readonly player: number;
  /** The player's own running count of commands; orders commands within a tick. */
  readonly seq: number;
  readonly command: Command;
}

function byPlayerThenSeq(a: ScheduledCommand, b: ScheduledCommand): number {
  return a.player - b.player || a.seq - b.seq;
}

export class CommandQueue {
  private readonly byTick = new Map<number, ScheduledCommand[]>();
  private count = 0;

  /**
   * Adds a command for a tick that has not run yet. A command for a tick that
   * has already run can never be applied consistently, so it is an error.
   */
  schedule(entry: ScheduledCommand, nextTick: number): void {
    if (!Number.isInteger(entry.tick) || entry.tick < nextTick) {
      throw new RangeError(
        `command for tick ${entry.tick} arrived too late; the next tick to run is ${nextTick}`,
      );
    }
    let list = this.byTick.get(entry.tick);
    if (list === undefined) {
      list = [];
      this.byTick.set(entry.tick, list);
    }
    for (const other of list) {
      if (other.player === entry.player && other.seq === entry.seq) {
        throw new Error(
          `duplicate command: player ${entry.player}, seq ${entry.seq}, tick ${entry.tick}`,
        );
      }
    }
    list.push(entry);
    this.count++;
  }

  /**
   * Removes and returns the commands for a tick, ordered by player and then by
   * each player's own sequence. The order never depends on arrival order.
   */
  takeDue(tick: number): ScheduledCommand[] {
    const list = this.byTick.get(tick);
    if (list === undefined) return [];
    this.byTick.delete(tick);
    this.count -= list.length;
    return list.sort(byPlayerThenSeq);
  }

  /** Every command still waiting, in the order it will run. */
  pending(): ScheduledCommand[] {
    const ticks = [...this.byTick.keys()].sort((a, b) => a - b);
    const out: ScheduledCommand[] = [];
    for (const tick of ticks) {
      out.push(...[...this.byTick.get(tick)!].sort(byPlayerThenSeq));
    }
    return out;
  }

  get size(): number {
    return this.count;
  }
}
