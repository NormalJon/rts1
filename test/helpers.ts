import { fromInt } from '../src/sim/fixed';
import { hashWorld } from '../src/sim/hash';
import { Rng } from '../src/sim/rng';
import type { SimConfig } from '../src/sim/world';
import { LocalSession } from '../src/session/localSession';

export interface PlayedMatch {
  readonly session: LocalSession;
  /** The world checksum after each tick; hashes[t] is the state after tick t ran. */
  readonly hashes: number[];
}

/**
 * Plays a match in which every player issues random commands, the way a
 * fuzzer would: spawning, moving random groups, stopping them, with a random
 * input delay each time. The "decisions" come from their own seeded generator,
 * so a given (config, scriptSeed) always produces the same match.
 */
export function playRandomMatch(config: SimConfig, scriptSeed: number, ticks: number): PlayedMatch {
  const session = new LocalSession(config);
  const script = new Rng(scriptSeed);
  const { world } = session;
  const randomX = (): number => fromInt(script.nextInt(config.mapWidth));
  const randomY = (): number => fromInt(script.nextInt(config.mapHeight));
  const randomGroup = (player: number): number[] =>
    world.livingEntities(player).filter(() => script.chance(1, 2));

  for (let player = 0; player < config.playerCount; player++) {
    session.issue(player, {
      kind: 'spawn',
      x: randomX(),
      y: randomY(),
      count: 20,
      speed: fromInt(2 + script.nextInt(5)),
    });
  }

  const hashes: number[] = [];
  while (world.tick < ticks) {
    for (let player = 0; player < config.playerCount; player++) {
      session.inputDelayTicks = script.nextInt(7);
      if (script.chance(1, 12)) {
        session.issue(player, {
          kind: 'move',
          units: randomGroup(player),
          x: randomX(),
          y: randomY(),
        });
      }
      if (script.chance(1, 90)) {
        session.issue(player, { kind: 'stop', units: randomGroup(player) });
      }
      if (script.chance(1, 150)) {
        session.issue(player, {
          kind: 'spawn',
          x: randomX(),
          y: randomY(),
          count: 1 + script.nextInt(6),
          speed: fromInt(1 + script.nextInt(8)),
        });
      }
    }
    session.step();
    hashes.push(hashWorld(world));
  }
  return { session, hashes };
}
