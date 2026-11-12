import { describe, expect, it } from 'vitest';
import { damageOf } from '../src/sim/combat';
import type { Command } from '../src/sim/commands';
import { ENTITY_TYPES, Kind, Resource, siteHp } from '../src/sim/entityTypes';
import { ONE, toFloat } from '../src/sim/fixed';
import { hashWorld } from '../src/sim/hash';
import { countPopulation } from '../src/sim/production';
import { step } from '../src/sim/sim';
import { restoreSnapshot, takeSnapshot, type WorldSnapshot } from '../src/sim/snapshot';
import { fromFloat } from '../src/sim/units';
import {
  defaultConfig,
  entityIndex,
  MoveState,
  NO_ENTITY,
  OrderKind,
  SHOT_FIELDS,
  World,
  type SimConfig,
} from '../src/sim/world';
import { brokenInvariant } from './helpers';

const S = Kind.Spearman;
const A = Kind.Archer;
const H = Kind.Horseman;
const V = Kind.Villager;

// These tests are about fighting, not about seeing, so the map is revealed:
// everyone can see everything. test/vision.test.ts covers the fog.
function flatWorld(size = 40, overrides: Partial<SimConfig> = {}): World {
  return new World(defaultConfig({ mapWidth: size, mapHeight: size, mapState: 'revealed', ...overrides }));
}

function worldFrom(rows: string[], overrides: Partial<SimConfig> = {}): World {
  return new World(
    defaultConfig({
      mapWidth: rows[0]!.length,
      mapHeight: rows.length,
      map: { kind: 'ascii', rows },
      mapState: 'revealed',
      ...overrides,
    }),
  );
}

let seq = 0;
function send(world: World, player: number, command: Command): void {
  world.commands.schedule({ tick: world.tick, player, seq: seq++, command }, world.tick);
}

/** Runs ticks, checking after each that nothing is broken. Stops early once done() is true. */
function run(world: World, ticks: number, done?: () => boolean): number {
  for (let i = 0; i < ticks; i++) {
    step(world);
    const broken = brokenInvariant(world);
    if (broken !== null) throw new Error(`tick ${world.tick}: ${broken}`);
    if (done?.()) return i + 1;
  }
  return ticks;
}

const place = (world: World, player: number, kind: number, x: number, y: number): number =>
  world.spawnUnit(player, kind, fromFloat(x), fromFloat(y));
const slotOf = entityIndex;
const hp = (world: World, id: number): number => (world.isAlive(id) ? world.hp[slotOf(id)]! : 0);
const xOf = (world: World, id: number): number => toFloat(world.posX[slotOf(id)]!);
const yOf = (world: World, id: number): number => toFloat(world.posY[slotOf(id)]!);
const distanceTo = (world: World, id: number, x: number, y: number): number =>
  Math.hypot(xOf(world, id) - x, yOf(world, id) - y);
const atRest = (world: World, id: number): boolean =>
  world.moveState[slotOf(id)] === MoveState.Idle && world.engaged[slotOf(id)] === 0;
const seconds = (world: World, s: number): number => Math.round(s * world.config.tickRate);

/** A line of units running north to south. */
function line(world: World, player: number, kind: number, count: number, x: number, y: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(place(world, player, kind, x, y + (i - (count - 1) / 2) * 0.7));
  return ids;
}

describe('the arithmetic of a blow', () => {
  const world = flatWorld();
  const one = (kind: number, player: number): number => slotOf(place(world, player, kind, 5 + kind, 5 + player * 3));
  const spear = one(S, 0);
  const archer = one(A, 0);
  const horse = one(H, 0);
  const villager = one(V, 1);
  const house = slotOf(world.spawnBuilding(1, Kind.House, 30, 30));

  it('is the weapon, plus its bonus against that kind of target, less armour', () => {
    expect(damageOf(world, spear, villager, 0)).toBe(8);
    expect(damageOf(world, spear, horse, 0)).toBe(8 + 16);
    expect(damageOf(world, archer, spear, 0)).toBe(5 + 5);
    expect(damageOf(world, archer, horse, 0)).toBe(5 - 2); // the rider's padding against arrows
    expect(damageOf(world, horse, archer, 0)).toBe(9 + 9);
    expect(damageOf(world, horse, spear, 0)).toBe(9);
    expect(damageOf(world, horse, archer, 10)).toBe(9 + 9 + 10);
  });

  it('never does less than 1, however thick the walls', () => {
    expect(damageOf(world, archer, house, 0)).toBe(1);
    expect(damageOf(world, villager, house, 0)).toBe(1);
    expect(damageOf(world, spear, house, 0)).toBe(4);
  });

  it('gives a quarter more to arrows shot from high ground, and nothing to blades', () => {
    const hill = flatWorld();
    const up = slotOf(place(hill, 0, A, 10.5, 10.5));
    const down = slotOf(place(hill, 1, V, 14.5, 10.5));
    const spearUp = slotOf(place(hill, 0, S, 10.5, 10.5));
    expect(damageOf(hill, up, down, 0)).toBe(5);
    // Raise the four corners of the archer's tile by a whole tile's height.
    for (const [cx, cy] of [[10, 10], [11, 10], [10, 11], [11, 11]] as const) hill.map.elevation[cy * 41 + cx] = ONE;
    expect(damageOf(hill, up, down, 0)).toBe(6);
    expect(damageOf(hill, down, up, 0)).toBe(3);
    expect(damageOf(hill, spearUp, down, 0)).toBe(8);
  });
});

describe('a fight', () => {
  it('between two equal spearmen kills both at the same moment, ten blows each', () => {
    const world = flatWorld();
    const a = place(world, 0, S, 18, 20);
    const b = place(world, 1, S, 22, 20);
    const hpSeen = new Set<number>();
    const ticks = run(world, 1200, () => {
      hpSeen.add(hp(world, a));
      return !world.isAlive(a) || !world.isAlive(b);
    });
    expect(world.isAlive(a)).toBe(false);
    expect(world.isAlive(b)).toBe(false);
    expect([...hpSeen].sort((x, y) => y - x)).toEqual([80, 72, 64, 56, 48, 40, 32, 24, 16, 8, 0]);
    // Ten blows 1.75 seconds apart, the first landing half a second after they meet.
    expect(ticks).toBeGreaterThan(seconds(world, 9 * 1.75));
    expect(ticks).toBeLessThan(seconds(world, 9 * 1.75 + 4));
    expect(world.livingEntities()).toEqual([]);
  });

  it('takes a blow half a second to land and the next 1.75 seconds to follow', () => {
    const world = flatWorld();
    const a = place(world, 0, S, 20, 20);
    const victim = place(world, 1, V, 20.8, 20);
    const landed: number[] = [];
    let last = hp(world, victim);
    run(world, 200, () => {
      if (hp(world, victim) < last) landed.push(world.tick);
      last = hp(world, victim);
      return landed.length === 3;
    });
    expect(world.isAlive(a)).toBe(true);
    expect(landed[1]! - landed[0]!).toBe(seconds(world, 1.75));
    expect(landed[2]! - landed[1]!).toBe(seconds(world, 1.75));
  });

  /** Two sides march at each other. Returns how many of each are left when one side is gone. */
  function battle(kindA: number, countA: number, kindB: number, countB: number): { a: number; b: number } {
    const world = flatWorld(48);
    const a = line(world, 0, kindA, countA, 18, 24);
    const b = line(world, 1, kindB, countB, 30, 24);
    send(world, 0, { kind: 'attackMove', units: a, x: fromFloat(30), y: fromFloat(24) });
    send(world, 1, { kind: 'attackMove', units: b, x: fromFloat(18), y: fromFloat(24) });
    run(world, 3600, () => world.livingUnits(0).length === 0 || world.livingUnits(1).length === 0);
    return { a: world.livingUnits(0).length, b: world.livingUnits(1).length };
  }

  it('goes to the spearmen against the same cost in horsemen', () => {
    // 480 resources a side.
    const left = battle(S, 6, H, 4);
    expect(left.b).toBe(0);
    expect(left.a).toBeGreaterThanOrEqual(4);
  });

  it('goes to the horsemen against more than their cost in archers', () => {
    // 600 against 640.
    const left = battle(H, 5, A, 8);
    expect(left.b).toBe(0);
    expect(left.a).toBeGreaterThanOrEqual(4);
  });

  it('goes to the archers against the same cost in spearmen', () => {
    // 640 a side.
    const left = battle(A, 8, S, 8);
    expect(left.b).toBe(0);
    expect(left.a).toBeGreaterThanOrEqual(3);
  });

  it('is even between equal numbers of the same troops', () => {
    const left = battle(S, 20, S, 20);
    expect(Math.min(left.a, left.b)).toBe(0);
    expect(Math.max(left.a, left.b)).toBeLessThan(12);
  });
});

describe('a soldier left to itself', () => {
  it('goes for an enemy that comes near, and then walks back to its post', () => {
    const world = flatWorld();
    const guard = place(world, 0, S, 10, 20);
    const intruder = place(world, 1, V, 14, 20);
    run(world, 900, () => !world.isAlive(intruder));
    expect(world.isAlive(intruder)).toBe(false);
    expect(distanceTo(world, guard, 10, 20)).toBeGreaterThan(2);
    run(world, 300, () => atRest(world, guard));
    expect(distanceTo(world, guard, 10, 20)).toBeLessThan(0.1);
    expect(world.orderKind[slotOf(guard)]).toBe(OrderKind.None);
    expect(hp(world, guard)).toBe(80); // villagers do not fight back unless told to
  });

  it('does not notice an enemy further off than eight tiles', () => {
    const world = flatWorld();
    const guard = place(world, 0, S, 10, 20);
    place(world, 1, V, 19, 20);
    run(world, 200);
    expect(distanceTo(world, guard, 10, 20)).toBe(0);
    expect(world.target[slotOf(guard)]).toBe(NO_ENTITY);
  });

  it('gives up the chase twelve tiles from its post and comes home', () => {
    const world = flatWorld(60);
    const guard = place(world, 0, S, 10, 30);
    // A rider trots past and away, too fast to catch.
    const rider = place(world, 1, H, 13, 26);
    send(world, 1, { kind: 'move', units: [rider], x: fromFloat(50), y: fromFloat(30) });
    let furthest = 0;
    let chased = false;
    run(world, 900, () => {
      furthest = Math.max(furthest, distanceTo(world, guard, 10, 30));
      chased ||= world.engaged[slotOf(guard)] === 1;
      return chased && atRest(world, guard);
    });
    expect(chased).toBe(true);
    expect(furthest).toBeGreaterThan(1);
    expect(furthest).toBeLessThan(13);
    expect(distanceTo(world, guard, 10, 30)).toBeLessThan(0.1);
    expect(world.isAlive(rider)).toBe(true);
  });

  it('closes with an archer that comes up and shoots at it', () => {
    const world = flatWorld();
    const guard = place(world, 0, S, 10, 20);
    const archer = place(world, 1, A, 24, 20);
    send(world, 1, { kind: 'attack', units: [archer], target: guard });
    run(world, 1500, () => !world.isAlive(archer) || !world.isAlive(guard));
    // It closes with the archer and gets some blows in before it falls.
    expect(world.isAlive(guard)).toBe(false);
    expect(hp(world, archer)).toBeLessThan(60);
  });

  it('comes to the aid of a building of its side attacked beyond its notice, then goes home', () => {
    const world = flatWorld(48);
    const guard = place(world, 0, S, 11.5, 20.5);
    world.spawnBuilding(0, Kind.House, 20, 20);
    // The raider comes at the house from the far side, ten tiles from the guard.
    const raider = place(world, 1, S, 30, 20.5);
    send(world, 1, { kind: 'attack', units: [raider], target: world.livingEntities(0)[1]! });
    let wentOut = 0;
    run(world, 2400, () => {
      wentOut = Math.max(wentOut, distanceTo(world, guard, 11.5, 20.5));
      return !world.isAlive(raider);
    });
    expect(world.isAlive(raider)).toBe(false);
    expect(wentOut).toBeGreaterThan(5);
    run(world, 600, () => atRest(world, guard));
    expect(distanceTo(world, guard, 11.5, 20.5)).toBeLessThan(0.1);
  });

  it('does not hear a cry for help from further off than eight tiles', () => {
    const world = flatWorld(48);
    const guard = place(world, 0, S, 8.5, 20.5);
    const house = world.spawnBuilding(0, Kind.House, 20, 20);
    const raider = place(world, 1, S, 30, 20.5);
    send(world, 1, { kind: 'attack', units: [raider], target: house });
    run(world, 600, () => hp(world, house) < 380);
    expect(hp(world, house)).toBeLessThan(380);
    expect(distanceTo(world, guard, 8.5, 20.5)).toBe(0);
  });

  it('is not a soldier if it is a villager: it ignores enemies and does not hit back', () => {
    const world = flatWorld();
    const villager = place(world, 0, V, 10, 20);
    const enemy = place(world, 1, V, 11, 20);
    send(world, 1, { kind: 'attack', units: [enemy], target: villager });
    run(world, 400, () => hp(world, villager) < 30);
    expect(hp(world, villager)).toBeLessThan(30);
    expect(hp(world, enemy)).toBe(50);
    expect(world.target[slotOf(villager)]).toBe(NO_ENTITY);
  });
});

describe('orders', () => {
  it('a plain move ignores the enemy altogether', () => {
    const world = flatWorld();
    const rider = place(world, 0, H, 5, 20);
    const enemy = place(world, 1, V, 15, 20.5);
    send(world, 0, { kind: 'move', units: [rider], x: fromFloat(30), y: fromFloat(20) });
    let distracted = false;
    run(world, 600, () => {
      distracted ||= world.target[slotOf(rider)] !== NO_ENTITY;
      return world.moveState[slotOf(rider)] === MoveState.Idle;
    });
    expect(distracted).toBe(false);
    expect(distanceTo(world, rider, 30, 20)).toBeLessThan(0.1);
    expect(hp(world, enemy)).toBe(50);
  });

  it('an attack-move fights what it meets and then carries on to where it was sent', () => {
    const world = flatWorld(48);
    const band = line(world, 0, S, 4, 6, 24);
    const first = place(world, 1, V, 18, 24);
    const second = place(world, 1, V, 19, 26);
    send(world, 0, { kind: 'attackMove', units: band, x: fromFloat(36), y: fromFloat(24) });
    run(world, 2400, () => band.every((id) => atRest(world, id) && world.orderKind[slotOf(id)] === OrderKind.None));
    expect(world.isAlive(first)).toBe(false);
    expect(world.isAlive(second)).toBe(false);
    for (const id of band) expect(distanceTo(world, id, 36, 24)).toBeLessThan(1.5);
    // The shared marching order has been let go of.
    expect(world.groups.size).toBe(0);
  });

  it('an attack-move pulls down buildings in its way, which a guard leaves alone', () => {
    const world = flatWorld(48);
    const house = world.spawnBuilding(1, Kind.House, 24, 24);
    const guard = place(world, 0, S, 24.5, 20.5);
    run(world, 120);
    expect(world.target[slotOf(guard)]).toBe(NO_ENTITY);
    const band = line(world, 0, S, 6, 10, 24);
    send(world, 0, { kind: 'attackMove', units: band, x: fromFloat(38), y: fromFloat(24) });
    run(world, 3600, () => !world.isAlive(house) && band.every((id) => atRest(world, id)));
    expect(world.isAlive(house)).toBe(false);
    for (const id of band) expect(distanceTo(world, id, 38, 24)).toBeLessThan(1.5);
    expect(world.map.isPassable(24, 24)).toBe(true);
  });

  it('a patrol walks its beat to and fro, dealing with intruders on the way', () => {
    const world = flatWorld(48);
    const sentry = place(world, 0, S, 10, 24);
    send(world, 0, { kind: 'patrol', units: [sentry], x: fromFloat(20), y: fromFloat(24) });
    const visits: string[] = [];
    const note = (): void => {
      const end = distanceTo(world, sentry, 10, 24) < 0.3 ? 'near' : distanceTo(world, sentry, 20, 24) < 0.3 ? 'far' : '';
      if (end !== '' && visits[visits.length - 1] !== end) visits.push(end);
    };
    note();
    run(world, 300, () => (note(), visits.length === 2));
    const intruder = place(world, 1, V, 15, 27);
    run(world, 1800, () => (note(), visits.length >= 5 && !world.isAlive(intruder)));
    expect(visits.slice(0, 5)).toEqual(['near', 'far', 'near', 'far', 'near']);
    expect(world.isAlive(intruder)).toBe(false);
    expect(world.orderKind[slotOf(sentry)]).toBe(OrderKind.Patrol);
    // Any other order ends the patrol.
    send(world, 0, { kind: 'stop', units: [sentry] });
    run(world, 5);
    expect(world.orderKind[slotOf(sentry)]).toBe(OrderKind.None);
  });

  it('a unit told to hold strikes at what comes within reach and never gives chase', () => {
    const world = flatWorld();
    const holder = place(world, 0, S, 10, 20);
    const enemy = place(world, 1, V, 12.5, 20);
    send(world, 0, { kind: 'hold', units: [holder] });
    run(world, 150);
    expect(distanceTo(world, holder, 10, 20)).toBe(0);
    expect(hp(world, enemy)).toBe(50);
    send(world, 1, { kind: 'attack', units: [enemy], target: holder });
    run(world, 900, () => !world.isAlive(enemy));
    expect(world.isAlive(enemy)).toBe(false);
    expect(distanceTo(world, holder, 10, 20)).toBeLessThan(0.05);
    expect(world.orderKind[slotOf(holder)]).toBe(OrderKind.Hold);
  });

  it('an attack order follows its quarry, kills it, and goes on to the next order in the queue', () => {
    const world = flatWorld(48);
    const hunter = place(world, 0, S, 10, 24);
    const quarry = place(world, 1, V, 20, 24);
    send(world, 1, { kind: 'move', units: [quarry], x: fromFloat(40), y: fromFloat(30) });
    send(world, 0, { kind: 'attack', units: [hunter], target: quarry });
    run(world, 2);
    send(world, 0, { kind: 'move', units: [hunter], x: fromFloat(8), y: fromFloat(8), queue: true });
    run(world, 30);
    expect(world.orderKind[slotOf(hunter)]).toBe(OrderKind.AttackTarget);
    expect(world.queueLength[slotOf(hunter)]).toBe(1);
    run(world, 3000, () => !world.isAlive(quarry) && atRest(world, hunter));
    expect(world.isAlive(quarry)).toBe(false);
    expect(distanceTo(world, hunter, 8, 8)).toBeLessThan(0.1);
  });

  it('villagers fight when ordered to, and stand down when the job is done', () => {
    const world = flatWorld();
    const mob = line(world, 0, V, 3, 10, 20);
    const victim = place(world, 1, V, 14, 20);
    const bystander = place(world, 1, V, 15, 21);
    send(world, 0, { kind: 'attack', units: mob, target: victim });
    run(world, 1200, () => !world.isAlive(victim) && mob.every((id) => atRest(world, id)));
    expect(world.isAlive(victim)).toBe(false);
    run(world, 200);
    expect(hp(world, bystander)).toBe(50);
    for (const id of mob) expect(world.target[slotOf(id)]).toBe(NO_ENTITY);
  });

  it('nobody can be ordered to attack their own side or an ally', () => {
    const world = flatWorld(40, { playerCount: 3, teams: [0, 1, 0] });
    const mine = place(world, 0, S, 10, 20);
    const friend = place(world, 0, S, 11, 20);
    const ally = place(world, 2, S, 10, 21);
    const allyHouse = world.spawnBuilding(2, Kind.House, 14, 20);
    for (const target of [friend, ally, allyHouse, mine, 123456, -1]) {
      send(world, 0, { kind: 'attack', units: [mine], target });
    }
    run(world, 300);
    for (const id of [mine, friend, ally]) expect(hp(world, id)).toBe(80);
    expect(hp(world, allyHouse)).toBe(400);
    expect(world.target[slotOf(mine)]).toBe(NO_ENTITY);
    // The third player is an enemy of both.
    const foe = place(world, 1, V, 12, 22);
    run(world, 900, () => !world.isAlive(foe));
    expect(world.isAlive(foe)).toBe(false);
  });

  it('a new order cancels a blow that has not landed yet', () => {
    const world = flatWorld();
    const spear = place(world, 0, S, 20, 20);
    const victim = place(world, 1, V, 20.8, 20);
    run(world, 60, () => world.windup[slotOf(spear)]! > 0);
    expect(world.windup[slotOf(spear)]).toBeGreaterThan(0);
    send(world, 0, { kind: 'move', units: [spear], x: fromFloat(30), y: fromFloat(20) });
    run(world, 20);
    expect(hp(world, victim)).toBe(50);
    expect(world.windup[slotOf(spear)]).toBe(0);
  });
});

describe('arrows', () => {
  it('leave the bow half a second after the archer sets to, and land after their flight', () => {
    const world = flatWorld();
    const archer = place(world, 0, A, 10, 20);
    const target = place(world, 1, V, 14, 20);
    send(world, 0, { kind: 'hold', units: [archer] });
    let loosed = -1;
    let lands = -1;
    const ticks = run(world, 200, () => {
      if (loosed === -1 && world.shotCount > 0) {
        loosed = world.tick;
        lands = world.shots[6]!;
        expect(world.shots[2]).toBe(archer);
        expect(world.shots[3]).toBe(target);
        expect(world.shots[4]).toBe(5);
      }
      return hp(world, target) < 50;
    });
    expect(ticks).toBeLessThan(200);
    // Fourteen tiles a second over four tiles: nine ticks in the air.
    expect(lands - (loosed - 1)).toBe(9);
    expect(world.tick - 1).toBe(lands);
    expect(hp(world, target)).toBe(45);
  });

  it('shoot once every second and a half', () => {
    const world = flatWorld();
    const archer = place(world, 0, A, 10, 20);
    place(world, 1, Kind.Horseman, 13, 20);
    send(world, 0, { kind: 'hold', units: [archer] });
    send(world, 1, { kind: 'hold', units: world.livingUnits(1) });
    const loosed: number[] = [];
    let before = 0;
    run(world, 400, () => {
      if (world.shotCount > before) loosed.push(world.tick);
      before = world.shotCount;
      return loosed.length === 4;
    });
    expect(loosed.length).toBe(4);
    for (let i = 1; i < loosed.length; i++) expect(loosed[i]! - loosed[i - 1]!).toBe(seconds(world, 1.5));
  });

  it('do nothing if the target is dead by the time they arrive', () => {
    const world = flatWorld();
    const archer = place(world, 0, A, 10, 20);
    const target = place(world, 1, V, 14, 20);
    run(world, 200, () => world.shotCount > 0);
    expect(world.shotCount).toBe(1);
    world.destroy(target);
    // Someone else moves into the dead unit's slot. The arrow is not for them.
    const newcomer = place(world, 1, V, 14, 20);
    expect(slotOf(newcomer)).toBe(slotOf(target));
    send(world, 0, { kind: 'stop', units: [archer] });
    send(world, 0, { kind: 'move', units: [archer], x: fromFloat(2), y: fromFloat(2) });
    run(world, 30);
    expect(world.shotCount).toBe(0);
    expect(hp(world, newcomer)).toBe(50);
  });

  it('cross a river that a spearman cannot', () => {
    const rows = Array.from({ length: 20 }, () => '..........~~..........');
    const world = worldFrom(rows);
    const archer = place(world, 0, A, 8.5, 10.5);
    const spear = place(world, 1, S, 13.5, 10.5);
    run(world, 1500, () => !world.isAlive(spear));
    expect(world.isAlive(spear)).toBe(false);
    expect(hp(world, archer)).toBe(60);
  });

  it('a spearman does not go after a soldier across the river whom he cannot reach', () => {
    const rows = Array.from({ length: 20 }, () => '..........~~..........');
    const world = worldFrom(rows);
    const spear = place(world, 0, S, 8.5, 10.5);
    const other = place(world, 1, S, 13.5, 10.5);
    run(world, 300);
    for (const id of [spear, other]) {
      expect(world.target[slotOf(id)]).toBe(NO_ENTITY);
      expect(world.moveState[slotOf(id)]).toBe(MoveState.Idle);
    }
    expect(distanceTo(world, spear, 8.5, 10.5)).toBe(0);
  });
});

describe('a charge', () => {
  it('adds ten to a rider\'s first blow after a run, and only the first', () => {
    const world = flatWorld(48);
    const rider = place(world, 0, H, 8, 24);
    const archer = place(world, 1, A, 20, 24);
    send(world, 1, { kind: 'hold', units: [archer] });
    send(world, 0, { kind: 'attack', units: [rider], target: archer });
    const seen: number[] = [60];
    run(world, 900, () => {
      const now = hp(world, archer);
      if (now !== seen[seen.length - 1]) seen.push(now);
      return now === 0;
    });
    // 9 + 9 against archers + 10 for the charge, then 18 a blow.
    expect(seen).toEqual([60, 32, 14, 0]);
  });

  it('is not ready without room to run', () => {
    const world = flatWorld();
    const rider = place(world, 0, H, 20, 20);
    const archer = place(world, 1, A, 21, 20);
    send(world, 1, { kind: 'hold', units: [archer] });
    send(world, 0, { kind: 'attack', units: [rider], target: archer });
    run(world, 300, () => hp(world, archer) < 60);
    expect(hp(world, archer)).toBe(42);
  });

  it('fades if the rider stands about before striking', () => {
    const world = flatWorld(48);
    const rider = place(world, 0, H, 8, 24);
    send(world, 0, { kind: 'move', units: [rider], x: fromFloat(20), y: fromFloat(24) });
    run(world, 600, () => atRest(world, rider));
    expect(world.momentum[slotOf(rider)]).toBeGreaterThan(30);
    run(world, 60);
    expect(world.momentum[slotOf(rider)]).toBe(0);
  });

  it('onto a spearman who is standing ready comes to nothing and costs the rider a wound', () => {
    const world = flatWorld(48);
    const rider = place(world, 0, H, 8, 24);
    const spear = place(world, 1, S, 20, 24);
    send(world, 1, { kind: 'hold', units: [spear] });
    send(world, 0, { kind: 'attack', units: [rider], target: spear });
    run(world, 900, () => hp(world, spear) < 80);
    expect(hp(world, spear)).toBe(80 - 9);
    expect(hp(world, rider)).toBe(120 - 24);
  });

  it('catches a spearman on the move unbraced', () => {
    const world = flatWorld(100);
    const rider = place(world, 0, H, 8, 24);
    const spear = place(world, 1, S, 20, 24);
    send(world, 1, { kind: 'move', units: [spear], x: fromFloat(95), y: fromFloat(24) });
    send(world, 0, { kind: 'attack', units: [rider], target: spear });
    run(world, 900, () => hp(world, spear) < 80);
    expect(world.moveState[slotOf(spear)]).not.toBe(MoveState.Idle);
    expect(hp(world, spear)).toBe(80 - 9 - 10);
    expect(hp(world, rider)).toBe(120);
  });

  it('or any blow, once begun, is not dodged by running away', () => {
    const world = flatWorld(100);
    const hunter = place(world, 0, S, 10, 24);
    const quarry = place(world, 1, V, 12, 24);
    send(world, 1, { kind: 'move', units: [quarry], x: fromFloat(95), y: fromFloat(24) });
    send(world, 0, { kind: 'attack', units: [hunter], target: quarry });
    // The spearman is the faster by a little, so it catches up, strikes, falls behind, and catches up again.
    run(world, 2400, () => !world.isAlive(quarry));
    expect(world.isAlive(quarry)).toBe(false);
  });
});

describe('buildings', () => {
  it('start as a site with a tenth of their strength and gain the rest as they go up', () => {
    const world = flatWorld();
    world.stock.set([0, 500, 0, 0], 0);
    const builder = place(world, 0, V, 10, 10);
    send(world, 0, { kind: 'build', units: [builder], buildingType: Kind.House, tileX: 14, tileY: 10 });
    run(world, 1);
    const house = world.livingEntities(0).find((id) => world.mobile[slotOf(id)] === 0)!;
    expect(hp(world, house)).toBe(siteHp(Kind.House));
    expect(siteHp(Kind.House)).toBe(40);
    let last = 40;
    run(world, 1200, () => {
      expect(hp(world, house)).toBeGreaterThanOrEqual(last);
      last = hp(world, house);
      return world.built[slotOf(house)] === 1;
    });
    expect(world.built[slotOf(house)]).toBe(1);
    expect(hp(world, house)).toBe(400);
  });

  it('can be destroyed, which frees the ground and takes away the room they gave', () => {
    const world = flatWorld();
    const house = world.spawnBuilding(1, Kind.House, 20, 20);
    expect(countPopulation(world).room[1]).toBe(10);
    const band = line(world, 0, S, 6, 14, 20);
    send(world, 0, { kind: 'attack', units: band, target: house });
    const ticks = run(world, 3600, () => !world.isAlive(house));
    expect(world.isAlive(house)).toBe(false);
    // 400 hit points at 4 a blow from six spearmen: about 17 rounds of 1.75 seconds.
    expect(ticks).toBeGreaterThan(seconds(world, 25));
    expect(ticks).toBeLessThan(seconds(world, 60));
    expect(countPopulation(world).room[1]).toBe(0);
    for (let ty = 19; ty <= 21; ty++) for (let tx = 19; tx <= 21; tx++) expect(world.map.isPassable(tx, ty)).toBe(true);
    run(world, 200, () => band.every((id) => atRest(world, id)));
    for (const id of band) expect(world.orderKind[slotOf(id)]).toBe(OrderKind.None);
  });

  it('take a unit queued for training down with them, unrefunded', () => {
    const world = flatWorld();
    world.stock.set([500, 100, 0, 0], 4);
    const barracks = world.spawnBuilding(1, Kind.Barracks, 20, 20);
    world.spawnBuilding(1, Kind.House, 30, 30);
    send(world, 1, { kind: 'train', building: barracks, unitType: S });
    run(world, 5);
    expect(world.stock[4]).toBe(440);
    world.hp[slotOf(barracks)] = 4;
    const spear = place(world, 0, S, 16.5, 20);
    send(world, 0, { kind: 'attack', units: [spear], target: barracks });
    run(world, 300, () => !world.isAlive(barracks));
    expect(world.isAlive(barracks)).toBe(false);
    expect(world.stock[4]).toBe(440);
    expect(countPopulation(world).used[1]).toBe(0);
  });

  it('are mended by villagers, slowly, back to full strength and no further', () => {
    const world = flatWorld();
    const house = world.spawnBuilding(0, Kind.House, 20, 20);
    const idler = place(world, 0, V, 15, 20);
    // Nothing to do at a sound building: the villager just walks over.
    send(world, 0, { kind: 'construct', units: [idler], target: house });
    run(world, 300);
    expect(world.job[slotOf(idler)]).toBe(0);
    world.hp[slotOf(house)] = 100;
    const mender = place(world, 0, V, 15, 22);
    send(world, 0, { kind: 'construct', units: [mender], target: house });
    const ticks = run(world, 3600, () => hp(world, house) === 400);
    expect(hp(world, house)).toBe(400);
    // Three quarters of the house, at a full house every two minutes.
    expect(ticks).toBeGreaterThan(seconds(world, 90));
    expect(ticks).toBeLessThan(seconds(world, 100));
    run(world, 100);
    expect(hp(world, house)).toBe(400);
    expect(world.job[slotOf(mender)]).toBe(0);
  });

  it('with arrows shoot the nearest enemy in range, but not before they are finished', () => {
    const world = flatWorld(48);
    world.stock.set([0, 500, 500, 0], 0);
    const builder = place(world, 0, V, 20, 20);
    send(world, 0, { kind: 'build', units: [builder], buildingType: Kind.Watchtower, tileX: 24, tileY: 24 });
    run(world, 1);
    const tower = world.livingEntities(0).find((id) => world.mobile[slotOf(id)] === 0)!;
    const near = place(world, 1, V, 29, 24);
    const far = place(world, 1, V, 24, 33.5);
    run(world, 200);
    expect(hp(world, near)).toBe(50);
    run(world, 3000, () => world.built[slotOf(tower)] === 1);
    expect(world.built[slotOf(tower)]).toBe(1);
    const ticks = run(world, 900, () => !world.isAlive(near));
    expect(world.isAlive(near)).toBe(false);
    // Seven blows of 8 at one every two seconds.
    expect(ticks).toBeGreaterThan(seconds(world, 11));
    expect(ticks).toBeLessThan(seconds(world, 15));
    // Eight tiles from the wall is out of range.
    expect(hp(world, far)).toBe(50);
  });

  it('are fought back against: a guard shot at by a tower goes and pulls it down', () => {
    const world = flatWorld(48);
    const tower = world.spawnBuilding(1, Kind.Watchtower, 24, 24);
    const band = line(world, 0, S, 8, 24, 30.5);
    run(world, 5400, () => !world.isAlive(tower));
    expect(world.isAlive(tower)).toBe(false);
    expect(band.some((id) => world.isAlive(id))).toBe(true);
  });
});

describe('the dead', () => {
  it('take what they were carrying with them, and the books still balance', () => {
    const world = flatWorld();
    const villager = place(world, 1, V, 20, 20);
    world.carry[slotOf(villager)] = 7;
    world.carryKind[slotOf(villager)] = Resource.Wood;
    const spear = place(world, 0, S, 19, 20);
    run(world, 900, () => !world.isAlive(villager));
    expect(world.isAlive(villager)).toBe(false);
    expect(Array.from(world.lost)).toEqual([0, 7, 0, 0]);
    expect(world.isAlive(spear)).toBe(true);
  });

  it('leave their slots to newcomers, whom old orders do not touch', () => {
    const world = flatWorld();
    const spear = place(world, 0, S, 10, 20);
    const victim = place(world, 1, V, 11, 20);
    run(world, 900, () => !world.isAlive(victim));
    const newcomer = place(world, 0, V, 30, 30);
    expect(slotOf(newcomer)).toBe(slotOf(victim));
    send(world, 0, { kind: 'attack', units: [spear], target: victim });
    run(world, 200);
    expect(hp(world, newcomer)).toBe(50);
    expect(world.target[slotOf(spear)]).toBe(NO_ENTITY);
  });
});

describe('a battle', () => {
  function drawnUp(): World {
    const world = flatWorld(48);
    const a = [...line(world, 0, A, 8, 14, 24), ...line(world, 0, S, 8, 16, 24), ...line(world, 0, H, 4, 15, 18)];
    const b = [...line(world, 1, A, 8, 34, 24), ...line(world, 1, S, 8, 32, 24), ...line(world, 1, H, 4, 33, 30)];
    world.spawnBuilding(0, Kind.Watchtower, 8, 24);
    send(world, 0, { kind: 'attackMove', units: a, x: fromFloat(33), y: fromFloat(24) });
    send(world, 1, { kind: 'attackMove', units: b, x: fromFloat(15), y: fromFloat(24) });
    return world;
  }

  it('picks up exactly where it left off after being saved with arrows in the air', () => {
    const world = drawnUp();
    run(world, 400, () => world.shotCount >= 3);
    expect(world.shotCount).toBeGreaterThanOrEqual(3);
    const saved = JSON.parse(JSON.stringify(takeSnapshot(world))) as WorldSnapshot;
    expect(saved.shots.length).toBe(world.shotCount * SHOT_FIELDS);
    const restored = restoreSnapshot(saved);
    expect(hashWorld(restored)).toBe(hashWorld(world));
    for (let i = 0; i < 900; i++) {
      step(world);
      step(restored);
      if (hashWorld(restored) !== hashWorld(world)) throw new Error(`diverged ${i + 1} ticks after loading`);
    }
    expect(world.livingUnits().length).toBeLessThan(40);
  });

  it('ends with one side gone and the survivors standing where they were sent', () => {
    const world = drawnUp();
    run(world, 5400, () => world.livingUnits(0).length === 0 || world.livingUnits(1).length === 0);
    const winner = world.livingUnits(0).length > 0 ? 0 : 1;
    const left = world.livingUnits(winner);
    expect(left.length).toBeGreaterThan(0);
    run(world, 1500, () => left.every((id) => atRest(world, id)));
    expect(left.every((id) => atRest(world, id))).toBe(true);
    expect(world.groups.size).toBe(0);
    expect(world.shotCount).toBe(0);
    for (const id of left) expect(ENTITY_TYPES[world.entityType[slotOf(id)]!]!.building).toBe(false);
  });
});
