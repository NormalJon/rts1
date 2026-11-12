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
   * Scaffolding for tests and debug pages: drops units on the map without
   * their being trained or paid for.
   */
  | {
      readonly kind: 'spawn';
      readonly x: Fixed;
      readonly y: Fixed;
      readonly count: number;
      /** Index into ENTITY_TYPES. */
      readonly unitType: number;
    }
  | {
      readonly kind: 'move';
      readonly units: readonly EntityId[];
      readonly x: Fixed;
      readonly y: Fixed;
      /** Add to the units' waypoints instead of replacing what they are doing. */
      readonly queue?: boolean;
    }
  | {
      /** Like move, but the units fight whatever they meet on the way and then carry on. */
      readonly kind: 'attackMove';
      readonly units: readonly EntityId[];
      readonly x: Fixed;
      readonly y: Fixed;
      readonly queue?: boolean;
    }
  | {
      /** Walk to and fro between where each unit stands and this point, fighting whatever comes near. */
      readonly kind: 'patrol';
      readonly units: readonly EntityId[];
      readonly x: Fixed;
      readonly y: Fixed;
    }
  | {
      /** Go after one enemy unit or building until it is destroyed. */
      readonly kind: 'attack';
      readonly units: readonly EntityId[];
      readonly target: EntityId;
    }
  | {
      readonly kind: 'stop';
      readonly units: readonly EntityId[];
    }
  | {
      /** Stand fast: strike at what comes within reach, but never give chase. */
      readonly kind: 'hold';
      readonly units: readonly EntityId[];
    }
  | {
      /** Work a resource tile: gather from it, carry the load to a drop-off, and repeat. */
      readonly kind: 'gather';
      readonly units: readonly EntityId[];
      /** The tile's index: row * map width + column. */
      readonly tile: number;
    }
  | {
      /** Hand in whatever is being carried at a drop-off building. */
      readonly kind: 'deliver';
      readonly units: readonly EntityId[];
      readonly target: EntityId;
    }
  | {
      /** Found a building with its centre on a tile, and set these villagers to building it. */
      readonly kind: 'build';
      readonly units: readonly EntityId[];
      /** Index into ENTITY_TYPES. */
      readonly buildingType: number;
      readonly tileX: number;
      readonly tileY: number;
    }
  | {
      /** Work on a building site that already exists, or mend a damaged building. */
      readonly kind: 'construct';
      readonly units: readonly EntityId[];
      readonly target: EntityId;
    }
  | {
      /** Add a unit to a building's training queue. */
      readonly kind: 'train';
      readonly building: EntityId;
      readonly unitType: number;
    }
  | {
      /** Add a technology (or a reform, at the town centre) to a building's queue. See tech.ts. */
      readonly kind: 'research';
      readonly building: EntityId;
      /** Index into TECHS. */
      readonly tech: number;
    }
  | {
      /** Take a unit or a technology out of a building's queue; 0 is the one under way. */
      readonly kind: 'cancelTrain';
      readonly building: EntityId;
      readonly index: number;
    }
  | {
      /** Set where units trained at these buildings go. On a resource, villagers start gathering it. */
      readonly kind: 'rally';
      readonly buildings: readonly EntityId[];
      readonly x: Fixed;
      readonly y: Fixed;
    }
  | {
      /** Pull down the player's own buildings. Unfinished ones are refunded. */
      readonly kind: 'demolish';
      readonly targets: readonly EntityId[];
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
