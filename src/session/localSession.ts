/**
 * A match running on one machine: the world, plus the bookkeeping that turns
 * "the player clicked" into a tick-stamped command and records it.
 *
 * Multiplayer will add a sibling of this class that sends each command to the
 * other players before it runs. The simulation itself does not change.
 */

import type { Controller } from '../ai/skirmish';
import type { Command, ScheduledCommand } from '../sim/commands';
import type { Replay } from '../sim/replay';
import { step } from '../sim/sim';
import { World, type SimConfig } from '../sim/world';

export class LocalSession {
  readonly world: World;
  /**
   * Extra whole ticks between issuing a command and running it. Zero means the
   * command runs on the very next tick, which is right for local play. Online
   * play needs a few ticks so the command can reach every player first.
   */
  inputDelayTicks: number;

  private readonly nextSeq: number[];
  private readonly log: ScheduledCommand[] = [];
  /** Players run by something other than a person at this machine: an AI, say. */
  private readonly controllers: (Controller | undefined)[] = [];

  constructor(config: SimConfig, inputDelayTicks = 0) {
    this.world = new World(config);
    this.inputDelayTicks = inputDelayTicks;
    this.nextSeq = new Array<number>(config.playerCount).fill(0);
  }

  /** Schedules a command for a player and returns it with its tick filled in. */
  issue(player: number, command: Command): ScheduledCommand {
    const seq = this.nextSeq[player];
    if (seq === undefined) throw new RangeError(`no such player: ${player}`);
    this.nextSeq[player] = seq + 1;
    const entry: ScheduledCommand = {
      tick: this.world.tick + Math.max(0, Math.floor(this.inputDelayTicks)),
      player,
      seq,
      command,
    };
    this.world.commands.schedule(entry, this.world.tick);
    this.log.push(entry);
    return entry;
  }

  /**
   * Hands a player over to a controller, which is asked for its commands
   * before every tick. They are issued and recorded like anyone else's, so a
   * replay of the match plays back without the controller.
   */
  control(player: number, controller: Controller | undefined): void {
    if (player < 0 || player >= this.nextSeq.length) throw new RangeError(`no such player: ${player}`);
    this.controllers[player] = controller;
  }

  step(): void {
    for (let player = 0; player < this.controllers.length; player++) {
      const controller = this.controllers[player];
      if (controller === undefined) continue;
      for (const command of controller.act(this.world)) this.issue(player, command);
    }
    step(this.world);
  }

  /** Everything needed to re-run the match so far. */
  replay(): Replay {
    return {
      version: 1,
      config: { ...this.world.config },
      ticks: this.world.tick,
      commands: [...this.log],
    };
  }
}
