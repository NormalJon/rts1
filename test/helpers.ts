import { fromInt, length } from '../src/sim/fixed';
import { hashWorld } from '../src/sim/hash';
import { Rng } from '../src/sim/rng';
import { UNIT_TYPES } from '../src/sim/unitTypes';
import { ORDER_QUEUE_LENGTH, type SimConfig, type World } from '../src/sim/world';
import { LocalSession } from '../src/session/localSession';

export interface PlayedMatch {
  readonly session: LocalSession;
  /** The world checksum after each tick; hashes[t] is the state after tick t ran. */
  readonly hashes: number[];
}

/**
 * Plays a match in which every player issues random commands, the way a
 * fuzzer would: spawning, moving random groups (sometimes as queued
 * waypoints), stopping them, with a random input delay each time. The
 * "decisions" come from their own seeded generator, so a given
 * (config, scriptSeed) always produces the same match.
 */
export function playRandomMatch(
  config: SimConfig,
  scriptSeed: number,
  ticks: number,
  afterTick?: (world: World) => void,
): PlayedMatch {
  const session = new LocalSession(config);
  const script = new Rng(scriptSeed);
  const { world } = session;
  const randomX = (): number => fromInt(script.nextInt(config.mapWidth));
  const randomY = (): number => fromInt(script.nextInt(config.mapHeight));
  const randomGroup = (player: number): number[] => {
    const mine = world.livingEntities(player);
    // Sometimes everyone, sometimes one unit, usually about half.
    const pick = script.nextInt(6);
    if (pick === 0) return mine;
    if (pick === 1) return mine.length > 0 ? [mine[script.nextInt(mine.length)]!] : [];
    return mine.filter(() => script.chance(1, 2));
  };

  for (let player = 0; player < config.playerCount; player++) {
    const start = world.map.starts[player];
    session.issue(player, {
      kind: 'spawn',
      x: start?.x ?? randomX(),
      y: start?.y ?? randomY(),
      count: 20,
      unitType: script.nextInt(UNIT_TYPES.length),
    });
  }

  const hashes: number[] = [];
  while (world.tick < ticks) {
    for (let player = 0; player < config.playerCount; player++) {
      session.inputDelayTicks = script.nextInt(7);
      if (script.chance(1, 14)) {
        session.issue(player, {
          kind: 'move',
          units: randomGroup(player),
          x: randomX(),
          y: randomY(),
          queue: script.chance(1, 3),
        });
      }
      if (script.chance(1, 120)) {
        session.issue(player, { kind: 'stop', units: randomGroup(player) });
      }
      if (script.chance(1, 200)) {
        session.issue(player, {
          kind: 'spawn',
          x: randomX(),
          y: randomY(),
          count: 1 + script.nextInt(6),
          unitType: script.nextInt(UNIT_TYPES.length),
        });
      }
    }
    session.step();
    hashes.push(hashWorld(world));
    afterTick?.(world);
  }
  return { session, hashes };
}

/**
 * Things that must hold after every tick, whatever orders were given. Returns
 * a description of the first one broken, or null.
 */
export function brokenInvariant(world: World): string | null {
  const { map } = world;
  const claims = new Map<number, number>();
  const claim = (group: number): void => {
    if (group !== 0) claims.set(group, (claims.get(group) ?? 0) + 1);
  };
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0) continue;
    const x = world.posX[slot]!;
    const y = world.posY[slot]!;
    if (x < 0 || y < 0 || x > map.maxX || y > map.maxY) return `unit ${slot} is off the map`;
    if (map.passable[map.tileAt(x, y)] === 0) return `unit ${slot} is standing in an obstacle`;
    claim(world.group[slot]!);
    for (let k = 0; k < world.queueLength[slot]!; k++) claim(world.queueGroup[slot * ORDER_QUEUE_LENGTH + k]!);
  }
  for (const group of world.groups.values()) {
    if (group.refs !== (claims.get(group.id) ?? 0)) {
      return `group ${group.id} counts ${group.refs} units but ${claims.get(group.id) ?? 0} refer to it`;
    }
  }
  for (const id of claims.keys()) {
    if (!world.groups.has(id)) return `units refer to group ${id}, which no longer exists`;
  }
  return null;
}

/** The smallest gap between any two living units, less their radii. Negative means overlap. */
export function smallestGap(world: World): number {
  let smallest = Infinity;
  for (let a = 0; a < world.highWater; a++) {
    if (world.alive[a] === 0) continue;
    for (let b = a + 1; b < world.highWater; b++) {
      if (world.alive[b] === 0) continue;
      const gap =
        length(world.posX[a]! - world.posX[b]!, world.posY[a]! - world.posY[b]!) -
        world.radius[a]! -
        world.radius[b]!;
      if (gap < smallest) smallest = gap;
    }
  }
  return smallest;
}
