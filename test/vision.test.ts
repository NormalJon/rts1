import { describe, expect, it } from 'vitest';
import { canPlace } from '../src/sim/buildings';
import type { Command } from '../src/sim/commands';
import { ENTITY_TYPES, Kind } from '../src/sim/entityTypes';
import { toFloat } from '../src/sim/fixed';
import { hashWorld } from '../src/sim/hash';
import { step } from '../src/sim/sim';
import { restoreSnapshot, takeSnapshot, type WorldSnapshot } from '../src/sim/snapshot';
import { fromFloat } from '../src/sim/units';
import { canSee, hasExplored, sees } from '../src/sim/vision';
import { defaultConfig, entityIndex, MoveState, NO_ENTITY, OrderKind, World, type SimConfig } from '../src/sim/world';
import { brokenInvariant, brokenVision } from './helpers';

const S = Kind.Spearman;
const A = Kind.Archer;
const H = Kind.Horseman;
const V = Kind.Villager;

/** A flat map with the fog on, as in a real match. */
function foggy(size = 48, overrides: Partial<SimConfig> = {}): World {
  return new World(defaultConfig({ mapWidth: size, mapHeight: size, mapState: 'concealed', ...overrides }));
}

let seq = 0;
function send(world: World, player: number, command: Command): void {
  world.commands.schedule({ tick: world.tick, player, seq: seq++, command }, world.tick);
}

function run(world: World, ticks: number, done?: () => boolean): number {
  for (let i = 0; i < ticks; i++) {
    step(world);
    const broken = brokenInvariant(world) ?? brokenVision(world);
    if (broken !== null) throw new Error(`tick ${world.tick}: ${broken}`);
    if (done?.()) return i + 1;
  }
  return ticks;
}

const place = (world: World, player: number, kind: number, x: number, y: number): number =>
  world.spawnUnit(player, kind, fromFloat(x), fromFloat(y));
const slotOf = entityIndex;
const tileOf = (world: World, x: number, y: number): number => Math.floor(y) * world.map.width + Math.floor(x);
const xOf = (world: World, id: number): number => toFloat(world.posX[slotOf(id)]!);
const atRest = (world: World, id: number): boolean =>
  world.moveState[slotOf(id)] === MoveState.Idle && world.engaged[slotOf(id)] === 0;
const count = (cells: ArrayLike<number>): number => {
  let n = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i]! > 0) n++;
  return n;
};
/** How many tiles have their centre within r and a half tiles of a tile's centre. */
const discSize = (r: number): number => {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.hypot(dx, dy) <= r + 0.5) n++;
  return n;
};

describe('what a side sees', () => {
  it('is a disc round each of its units, as wide as the unit sees', () => {
    const world = foggy();
    place(world, 0, S, 20.5, 20.5);
    expect(ENTITY_TYPES[S]!.sight).toBe(8);
    expect(count(world.seen[0]!)).toBe(discSize(8));
    expect(sees(world, 0, tileOf(world, 20, 20))).toBe(true);
    expect(sees(world, 0, tileOf(world, 28, 20))).toBe(true);
    expect(sees(world, 0, tileOf(world, 29, 20))).toBe(false);
    expect(sees(world, 0, tileOf(world, 26, 26))).toBe(true);
    expect(sees(world, 0, tileOf(world, 27, 27))).toBe(false);
    expect(brokenVision(world)).toBeNull();
  });

  it('is cut off at the edge of the map and nothing goes wrong there', () => {
    const world = foggy();
    place(world, 0, H, 0.5, 0.5);
    place(world, 0, H, 47.5, 47.5);
    expect(brokenVision(world)).toBeNull();
    expect(sees(world, 0, 0)).toBe(true);
    expect(sees(world, 0, world.map.tileCount - 1)).toBe(true);
    expect(sees(world, 0, tileOf(world, 24, 24))).toBe(false);
  });

  it('moves with them, and what they leave behind stays explored but out of sight', () => {
    const world = foggy();
    const scout = place(world, 0, H, 8.5, 24.5);
    const start = tileOf(world, 8, 24);
    const ahead = tileOf(world, 34, 24);
    expect(hasExplored(world, 0, ahead)).toBe(false);
    send(world, 0, { kind: 'move', units: [scout], x: fromFloat(34.5), y: fromFloat(24.5) });
    run(world, 900, () => atRest(world, scout));
    expect(xOf(world, scout)).toBeGreaterThan(34);
    expect(sees(world, 0, ahead)).toBe(true);
    expect(sees(world, 0, start)).toBe(false);
    expect(hasExplored(world, 0, start)).toBe(true);
    // A band twenty-one tiles deep along the whole ride, and nothing far from it.
    expect(hasExplored(world, 0, tileOf(world, 22, 15))).toBe(true);
    expect(hasExplored(world, 0, tileOf(world, 22, 36))).toBe(false);
    expect(count(world.seen[0]!)).toBe(discSize(10));
    expect(count(world.explored[0]!)).toBeGreaterThan(discSize(10) + 500);
  });

  it('is its own: the enemy sees none of it', () => {
    const world = foggy();
    const mine = place(world, 0, S, 10.5, 10.5);
    const theirs = place(world, 1, S, 40.5, 40.5);
    expect(world.view[0]).not.toBe(world.view[1]);
    expect(canSee(world, 0, slotOf(mine))).toBe(true);
    expect(canSee(world, 0, slotOf(theirs))).toBe(false);
    expect(canSee(world, 1, slotOf(mine))).toBe(false);
    expect(hasExplored(world, 1, tileOf(world, 10, 10))).toBe(false);
  });

  it('is shared with allies', () => {
    const world = foggy(48, { playerCount: 3, teams: [0, 1, 0] });
    const friend = place(world, 2, S, 40.5, 8.5);
    const foe = place(world, 1, S, 42.5, 8.5);
    expect(world.view[2]).toBe(world.view[0]);
    expect(world.seen.length).toBe(2);
    expect(canSee(world, 0, slotOf(foe))).toBe(true);
    expect(sees(world, 0, tileOf(world, 40, 8))).toBe(true);
    expect(canSee(world, 1, slotOf(friend))).toBe(true);
  });

  it('ends with the unit: the dead see nothing, though what they saw stays explored', () => {
    const world = foggy();
    const scout = place(world, 0, S, 20.5, 20.5);
    world.destroy(scout);
    expect(count(world.seen[0]!)).toBe(0);
    expect(count(world.explored[0]!)).toBe(discSize(8));
    expect(brokenVision(world)).toBeNull();
  });

  it('is little for a building site and its full range once the building is finished', () => {
    const world = foggy();
    world.stock.set([0, 500, 500, 0], 0);
    const builder = place(world, 0, V, 20.5, 20.5);
    send(world, 0, { kind: 'build', units: [builder], buildingType: Kind.Watchtower, tileX: 24, tileY: 20 });
    run(world, 30);
    const far = tileOf(world, 36, 20);
    expect(sees(world, 0, far)).toBe(false);
    const tower = world.livingEntities(0).find((id) => world.mobile[slotOf(id)] === 0)!;
    expect(world.sightRadius[slotOf(tower)]).toBe(3);
    run(world, 3000, () => world.built[slotOf(tower)] === 1);
    run(world, 2);
    expect(world.sightRadius[slotOf(tower)]).toBe(13);
    expect(sees(world, 0, far)).toBe(true);
  });

  it('takes in a building when any part of it is in view', () => {
    const world = foggy();
    const barracks = world.spawnBuilding(1, Kind.Barracks, 30, 20);
    place(world, 0, S, 19.5, 20.5); // sees as far as x = 27; the barracks covers 28 to 32
    expect(canSee(world, 0, slotOf(barracks))).toBe(false);
    place(world, 0, S, 20.5, 20.5); // sees as far as x = 28: one edge
    expect(canSee(world, 0, slotOf(barracks))).toBe(true);
  });
});

describe('the map to begin with', () => {
  it('is unknown in the usual game, apart from what the starting units see', () => {
    const world = new World(defaultConfig({ seed: 3, map: { kind: 'generated' }, start: 'standard' }));
    expect(world.config.mapState).toBe('concealed');
    const home = world.map.starts[0]!;
    const there = world.map.starts[1]!;
    expect(sees(world, 0, world.map.tileAt(home.x, home.y))).toBe(true);
    expect(hasExplored(world, 0, world.map.tileAt(there.x, there.y))).toBe(false);
    expect(hasExplored(world, 1, world.map.tileAt(there.x, there.y))).toBe(true);
    expect(count(world.explored[0]!)).toBeLessThan(world.map.tileCount >> 2);
  });

  it('can be explored from the start, with only the enemy still hidden', () => {
    const world = foggy(48, { mapState: 'explored' });
    const theirs = place(world, 1, S, 40.5, 40.5);
    place(world, 0, S, 8.5, 8.5);
    expect(hasExplored(world, 0, tileOf(world, 40, 40))).toBe(true);
    expect(sees(world, 0, tileOf(world, 40, 40))).toBe(false);
    expect(canSee(world, 0, slotOf(theirs))).toBe(false);
    expect(canPlace(world, Kind.House, 40, 30, 0)).toBe(true);
  });

  it('can be revealed, and then nothing is hidden from anyone', () => {
    const world = foggy(48, { mapState: 'revealed' });
    const theirs = place(world, 1, S, 40.5, 40.5);
    expect(sees(world, 0, tileOf(world, 40, 40))).toBe(true);
    expect(hasExplored(world, 0, 0)).toBe(true);
    expect(canSee(world, 0, slotOf(theirs))).toBe(true);
  });
});

describe('what the fog forbids', () => {
  it('an attack cannot be ordered on a unit nobody on the side can see', () => {
    const world = foggy();
    const archer = place(world, 0, A, 8.5, 24.5);
    const prey = place(world, 1, V, 30.5, 24.5);
    send(world, 0, { kind: 'attack', units: [archer], target: prey });
    run(world, 60);
    expect(world.orderKind[slotOf(archer)]).toBe(OrderKind.None);
    expect(xOf(world, archer)).toBe(8.5);
    // A scout who can see the villager makes all the difference.
    place(world, 0, H, 24.5, 30.5);
    send(world, 0, { kind: 'attack', units: [archer], target: prey });
    run(world, 5);
    expect(world.orderKind[slotOf(archer)]).toBe(OrderKind.AttackTarget);
    expect(world.target[slotOf(archer)]).toBe(prey);
  });

  it('a building can be attacked from memory, but not one on ground never seen', () => {
    const world = foggy(64);
    const seenOnce = world.spawnBuilding(1, Kind.House, 30, 20);
    const neverSeen = world.spawnBuilding(1, Kind.House, 55, 55);
    const spear = place(world, 0, S, 24.5, 20.5);
    send(world, 0, { kind: 'move', units: [spear], x: fromFloat(8.5), y: fromFloat(20.5) });
    run(world, 900, () => atRest(world, spear));
    expect(canSee(world, 0, slotOf(seenOnce))).toBe(false);
    send(world, 0, { kind: 'attack', units: [spear], target: neverSeen });
    run(world, 5);
    expect(world.target[slotOf(spear)]).toBe(NO_ENTITY);
    send(world, 0, { kind: 'attack', units: [spear], target: seenOnce });
    run(world, 5);
    expect(world.target[slotOf(spear)]).toBe(seenOnce);
    run(world, 6000, () => !world.isAlive(seenOnce));
    expect(world.isAlive(seenOnce)).toBe(false);
  });

  it('a soldier gives up a quarry that gets clean out of sight', () => {
    const world = foggy(100);
    const spear = place(world, 0, S, 10.5, 50.5);
    const rider = place(world, 1, H, 14.5, 50.5);
    send(world, 1, { kind: 'move', units: [rider], x: fromFloat(95.5), y: fromFloat(50.5) });
    send(world, 0, { kind: 'attack', units: [spear], target: rider });
    let chased = false;
    run(world, 2400, () => {
      chased ||= world.target[slotOf(spear)] === rider;
      return chased && atRest(world, spear) && world.target[slotOf(spear)] === NO_ENTITY;
    });
    expect(chased).toBe(true);
    expect(world.isAlive(rider)).toBe(true);
    expect(world.orderKind[slotOf(spear)]).toBe(OrderKind.None);
    // It stopped where it lost sight of him, far short of where he went.
    expect(xOf(world, spear)).toBeLessThan(60);
    expect(xOf(world, spear)).toBeGreaterThan(12);
  });

  it('nothing can be founded on ground the side has never seen', () => {
    const world = foggy();
    world.stock.set([0, 500, 0, 0], 0);
    const builder = place(world, 0, V, 10.5, 10.5);
    expect(canPlace(world, Kind.House, 36, 36)).toBe(true); // the ground itself is fine
    expect(canPlace(world, Kind.House, 36, 36, 0)).toBe(false);
    send(world, 0, { kind: 'build', units: [builder], buildingType: Kind.House, tileX: 36, tileY: 36 });
    run(world, 5);
    expect(world.livingEntities().length).toBe(1);
    expect(world.stock[1]).toBe(500);
    // One corner of the plot unseen is enough to refuse it.
    expect(canPlace(world, Kind.House, 16, 10, 0)).toBe(true);
    expect(canPlace(world, Kind.House, 17, 10, 0)).toBe(false);
    send(world, 0, { kind: 'build', units: [builder], buildingType: Kind.House, tileX: 16, tileY: 10 });
    run(world, 5);
    expect(world.livingEntities().length).toBe(2);
  });

  it('guards still deal with whatever comes into view', () => {
    const world = foggy();
    const guard = place(world, 0, S, 10.5, 24.5);
    const raider = place(world, 1, V, 30.5, 24.5);
    send(world, 1, { kind: 'move', units: [raider], x: fromFloat(13.5), y: fromFloat(24.5) });
    run(world, 2400, () => !world.isAlive(raider));
    expect(world.isAlive(raider)).toBe(false);
    expect(world.isAlive(guard)).toBe(true);
  });
});

describe('the fog and the record', () => {
  it('is part of the checksum: the same world with more explored is a different world', () => {
    const concealed = foggy();
    const explored = foggy(48, { mapState: 'explored' });
    for (const world of [concealed, explored]) place(world, 0, S, 20.5, 20.5);
    expect(hashWorld(concealed)).not.toBe(hashWorld(explored));
  });

  it('comes back from a saved game exactly, seen and explored both', () => {
    const world = foggy(64, { playerCount: 3, teams: [0, 1, 0] });
    const riders = [place(world, 0, H, 8.5, 8.5), place(world, 1, H, 56.5, 56.5), place(world, 2, H, 8.5, 56.5)];
    send(world, 0, { kind: 'move', units: [riders[0]!], x: fromFloat(50.5), y: fromFloat(12.5) });
    send(world, 1, { kind: 'move', units: [riders[1]!], x: fromFloat(12.5), y: fromFloat(40.5) });
    send(world, 2, { kind: 'move', units: [riders[2]!], x: fromFloat(30.5), y: fromFloat(30.5) });
    run(world, 200);
    const saved = JSON.parse(JSON.stringify(takeSnapshot(world))) as WorldSnapshot;
    // Runs of unexplored and explored tiles, far shorter than a number per tile.
    expect(saved.explored.length).toBe(2);
    expect(saved.explored[0]!.length).toBeLessThan(400);
    expect(saved.explored[0]!.reduce((a, b) => a + b, 0)).toBe(world.map.tileCount);
    const restored = restoreSnapshot(saved);
    expect(hashWorld(restored)).toBe(hashWorld(world));
    for (let view = 0; view < 2; view++) {
      expect(Array.from(restored.seen[view]!)).toEqual(Array.from(world.seen[view]!));
      expect(Array.from(restored.explored[view]!)).toEqual(Array.from(world.explored[view]!));
    }
    for (let i = 0; i < 400; i++) {
      step(world);
      step(restored);
      if (hashWorld(restored) !== hashWorld(world)) throw new Error(`diverged ${i + 1} ticks after loading`);
    }
    expect(brokenVision(restored)).toBeNull();
  });

  it('keeps count through a crowd on the move, births and deaths', () => {
    const world = foggy(64);
    world.spawnBuilding(0, Kind.TownCentre, 12, 12);
    world.spawnBuilding(1, Kind.TownCentre, 52, 52);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 12; i++) {
      a.push(place(world, 0, [S, A, H][i % 3]!, 16.5 + (i % 4), 16.5 + (i >> 2)));
      b.push(place(world, 1, [S, A, H][i % 3]!, 46.5 + (i % 4), 46.5 + (i >> 2)));
    }
    send(world, 0, { kind: 'attackMove', units: a, x: fromFloat(48.5), y: fromFloat(48.5) });
    send(world, 1, { kind: 'attackMove', units: b, x: fromFloat(16.5), y: fromFloat(16.5) });
    // run() checks the counts against a fresh count after every tick.
    run(world, 1500);
    expect(world.livingUnits().length).toBeLessThan(24);
  });
});
