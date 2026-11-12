import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/commands';
import { Kind, Resource, ticksPerUnit } from '../src/sim/entityTypes';
import { toFloat } from '../src/sim/fixed';
import { hashWorld } from '../src/sim/hash';
import { Terrain } from '../src/sim/map';
import { step } from '../src/sim/sim';
import { restoreSnapshot, takeSnapshot } from '../src/sim/snapshot';
import { fromFloat } from '../src/sim/units';
import { defaultConfig, entityIndex, Job, MoveState, STARTING_VILLAGERS, World, type SimConfig } from '../src/sim/world';
import { brokenInvariant, regionsAreRight, resourceTotals } from './helpers';

function worldFrom(rows: string[], overrides: Partial<SimConfig> = {}): World {
  return new World(
    defaultConfig({ mapWidth: rows[0]!.length, mapHeight: rows.length, map: { kind: 'ascii', rows }, ...overrides }),
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

const villager = (world: World, x: number, y: number, player = 0): number =>
  world.spawnUnit(player, Kind.Villager, fromFloat(x), fromFloat(y));
const stock = (world: World, resource: number, player = 0): number => world.stock[player * 4 + resource]!;
const xOf = (world: World, id: number): number => toFloat(world.posX[entityIndex(id)]!);
const yOf = (world: World, id: number): number => toFloat(world.posY[entityIndex(id)]!);
const jobOf = (world: World, id: number): number => world.job[entityIndex(id)]!;
const carryOf = (world: World, id: number): number => world.carry[entityIndex(id)]!;

/** Gathers from a tile until only `left` units remain, so a test need not wait for the whole tile. */
function thinOut(world: World, tile: number, left: number): void {
  while (world.map.amount[tile]! > left) world.map.harvest(tile);
}

//   0123456789012345
const YARD = [
  '................',
  '................',
  '..T.............',
  '................',
  '................',
  '................',
  '..........bb....',
  '................',
  '................',
  '................',
];

/** The yard with a town centre at (8, 3). */
function yard(overrides: Partial<SimConfig> = {}): { world: World; hall: number; tree: number } {
  const world = worldFrom(YARD, overrides);
  const hall = world.spawnBuilding(0, Kind.TownCentre, 8, 3);
  return { world, hall, tree: world.map.index(2, 2) };
}

describe('gathering', () => {
  it('fills a load, hands it in at the town centre and goes back for more', () => {
    const { world, tree } = yard();
    const worker = villager(world, 4.5, 4.5);
    send(world, 0, { kind: 'gather', units: [worker], tile: tree });
    const stages: number[] = [];
    let mostCarried = 0;
    run(world, 2400, () => {
      const job = jobOf(world, worker);
      if (stages[stages.length - 1] !== job) stages.push(job);
      mostCarried = Math.max(mostCarried, carryOf(world, worker));
      return stock(world, Resource.Wood) >= 20;
    });
    expect(stock(world, Resource.Wood)).toBe(20);
    expect(mostCarried).toBe(10);
    // To the tree, chop, to the hall, and round again.
    expect(stages.slice(0, 6)).toEqual([
      Job.ToResource,
      Job.Harvesting,
      Job.ToDropOff,
      Job.ToResource,
      Job.Harvesting,
      Job.ToDropOff,
    ]);
    expect(world.map.amount[tree]).toBe(100 - 20 - carryOf(world, worker));
  });

  it('takes the stated time over each unit', () => {
    const { world, tree } = yard();
    const worker = villager(world, 3.4, 2.5);
    send(world, 0, { kind: 'gather', units: [worker], tile: tree });
    run(world, 600, () => jobOf(world, worker) === Job.Harvesting);
    const began = world.tick;
    run(world, 600, () => carryOf(world, worker) === 6);
    // Wood takes a second and a half a unit: 45 ticks at 30 ticks a second.
    expect(ticksPerUnit(Terrain.Forest, 30)).toBe(45);
    expect(world.tick - began).toBe(6 * 45);
    expect(ticksPerUnit(Terrain.Berries, 30)).toBe(38);
    expect(ticksPerUnit(Terrain.Gold, 30)).toBe(48);
    expect(ticksPerUnit(Terrain.Forest, 8)).toBe(12);
    // A farm is slower than a berry bush.
    expect(ticksPerUnit(Terrain.Field, 30)).toBe(48);
  });

  it('turns a worked-out tile into open ground and moves on to the next', () => {
    const world = worldFrom(['..........', '..TT......', '..........', '..........', '..........', '..........']);
    const hall = world.spawnBuilding(0, Kind.TownCentre, 7, 3);
    expect(hall).toBeGreaterThanOrEqual(0);
    const first = world.map.index(2, 1);
    const second = world.map.index(3, 1);
    thinOut(world, first, 4);
    thinOut(world, second, 3);
    const worker = villager(world, 1.5, 2.5);
    send(world, 0, { kind: 'gather', units: [worker], tile: first });
    run(world, 3000, () => jobOf(world, worker) === Job.None && carryOf(world, worker) === 0);
    // Both trees gone, every last unit in the stores, and the villager standing idle.
    expect(world.map.terrain[first]).toBe(Terrain.Grass);
    expect(world.map.terrain[second]).toBe(Terrain.Grass);
    expect(world.map.passable[first]).toBe(1);
    expect(stock(world, Resource.Wood)).toBe(7);
    expect(world.moveState[entityIndex(worker)]).toBe(MoveState.Idle);
    expect(regionsAreRight(world)).toBe(true);
  });

  it('opens a way through when the last tree in a wall comes down', () => {
    const world = worldFrom(['...T...', '...T...', '...T...']);
    const { map } = world;
    const west = map.region[map.index(2, 2)]!;
    const east = map.region[map.index(5, 1)]!;
    expect(west).not.toBe(east);
    const versionBefore = map.passVersion;
    thinOut(world, map.index(3, 1), 0);
    expect(map.terrain[map.index(3, 1)]).toBe(Terrain.Grass);
    expect(map.passVersion).toBeGreaterThan(versionBefore);
    expect(map.region[map.index(2, 2)]).toBe(map.region[map.index(5, 1)]);
    expect(regionsAreRight(world)).toBe(true);
  });

  it('gives each villager at a tree its own place to stand', () => {
    const { world, tree } = yard();
    const workers = [villager(world, 4.5, 1.5), villager(world, 4.5, 2.5), villager(world, 4.5, 3.5), villager(world, 5.5, 2.5)];
    send(world, 0, { kind: 'gather', units: workers, tile: tree });
    run(world, 900, () => workers.every((id) => jobOf(world, id) === Job.Harvesting));
    expect(workers.every((id) => jobOf(world, id) === Job.Harvesting)).toBe(true);
    const spots = new Set(workers.map((id) => world.jobSpot[entityIndex(id)]!));
    expect(spots.size).toBe(4);
    run(world, 200);
    for (const id of workers) expect(carryOf(world, id)).toBeGreaterThan(0);
  });

  it('spreads a crowd over neighbouring trees when one is full', () => {
    // A tree line with only its eastern face open: three tiles to stand on per tree at most.
    const world = worldFrom([
      'TTT.........',
      'TTT.........',
      'TTT.........',
      'TTT.........',
      'TTT.........',
      'TTT.........',
    ]);
    world.spawnBuilding(0, Kind.TownCentre, 8, 2);
    const workers: number[] = [];
    for (let i = 0; i < 12; i++) workers.push(villager(world, 4.2 + (i % 3) * 0.6, 0.6 + Math.floor(i / 3) * 0.6));
    const target = world.map.index(2, 2);
    send(world, 0, { kind: 'gather', units: workers, tile: target });
    run(world, 1200, () => workers.every((id) => jobOf(world, id) === Job.Harvesting || jobOf(world, id) === Job.ToDropOff));
    const onTarget = workers.filter((id) => world.jobTile[entityIndex(id)] === target).length;
    expect(onTarget).toBeLessThanOrEqual(6);
    expect(onTarget).toBeGreaterThan(0);
    // Everyone found work somewhere along the tree line.
    for (const id of workers) expect(jobOf(world, id)).not.toBe(Job.None);
    expect(new Set(workers.map((id) => world.jobSpot[entityIndex(id)]!)).size).toBe(12);
    run(world, 2500);
    expect(stock(world, Resource.Wood)).toBeGreaterThan(100);
  });

  it('hands in at the nearer of two drop-offs', () => {
    const world = worldFrom([
      '................................',
      '................................',
      '................................',
      '...............T................',
      '................................',
      '................................',
      '................................',
    ]);
    const near = world.spawnBuilding(0, Kind.TownCentre, 22, 3);
    world.spawnBuilding(0, Kind.TownCentre, 3, 3);
    world.spawnBuilding(1, Kind.TownCentre, 28, 3); // someone else's: not an option
    const worker = villager(world, 16.5, 3.5);
    send(world, 0, { kind: 'gather', units: [worker], tile: world.map.index(15, 3) });
    run(world, 1500, () => jobOf(world, worker) === Job.ToDropOff);
    expect(world.jobTarget[entityIndex(worker)]).toBe(near);
  });

  it('with nowhere to hand in, stops with its load until told where to take it', () => {
    const world = worldFrom(YARD);
    const tree = world.map.index(2, 2);
    const worker = villager(world, 3.5, 3.5);
    send(world, 0, { kind: 'gather', units: [worker], tile: tree });
    run(world, 1200, () => jobOf(world, worker) === Job.None);
    expect(carryOf(world, worker)).toBe(10);
    expect(stock(world, Resource.Wood)).toBe(0);

    const hall = world.spawnBuilding(0, Kind.TownCentre, 8, 3);
    send(world, 0, { kind: 'deliver', units: [worker], target: hall });
    run(world, 600, () => stock(world, Resource.Wood) === 10);
    expect(stock(world, Resource.Wood)).toBe(10);
    // And then straight back to the tree it was working.
    expect(world.jobTile[entityIndex(worker)]).toBe(tree);
    run(world, 600, () => jobOf(world, worker) === Job.Harvesting);
    expect(jobOf(world, worker)).toBe(Job.Harvesting);
  });

  it('hands in what it holds before starting on a different resource', () => {
    const { world, tree } = yard();
    const worker = villager(world, 3.5, 3.5);
    send(world, 0, { kind: 'gather', units: [worker], tile: tree });
    run(world, 600, () => carryOf(world, worker) === 3);
    const berries = world.map.index(10, 6);
    send(world, 0, { kind: 'gather', units: [worker], tile: berries });
    step(world);
    expect(jobOf(world, worker)).toBe(Job.ToDropOff);
    run(world, 900, () => jobOf(world, worker) === Job.Harvesting);
    expect(stock(world, Resource.Wood)).toBe(3);
    expect(world.jobTile[entityIndex(worker)]).toBe(berries);
    run(world, 120);
    expect(world.carryKind[entityIndex(worker)]).toBe(Resource.Food);
  });

  it('is taken off its work by a move or stop order, and keeps its load', () => {
    const { world, tree } = yard();
    const worker = villager(world, 3.5, 3.5);
    send(world, 0, { kind: 'gather', units: [worker], tile: tree });
    run(world, 600, () => carryOf(world, worker) === 4);
    send(world, 0, { kind: 'move', units: [worker], x: fromFloat(6.5), y: fromFloat(8.5) });
    run(world, 400, () => world.moveState[entityIndex(worker)] === MoveState.Idle);
    expect(jobOf(world, worker)).toBe(Job.None);
    expect(carryOf(world, worker)).toBe(4);
    expect(Math.hypot(xOf(world, worker) - 6.5, yOf(world, worker) - 8.5)).toBeLessThan(0.1);
    run(world, 200);
    expect(carryOf(world, worker)).toBe(4);

    send(world, 0, { kind: 'gather', units: [worker], tile: tree });
    run(world, 600, () => jobOf(world, worker) === Job.Harvesting);
    send(world, 0, { kind: 'stop', units: [worker] });
    step(world);
    expect(jobOf(world, worker)).toBe(Job.None);
  });

  it('sends units that cannot gather, or a gather order on bare ground, as a plain move', () => {
    const { world, tree } = yard();
    const spearman = world.spawnUnit(0, Kind.Spearman, fromFloat(6.5), fromFloat(8.5));
    const worker = villager(world, 7.5, 8.5);
    send(world, 0, { kind: 'gather', units: [spearman], tile: tree });
    send(world, 0, { kind: 'gather', units: [worker], tile: world.map.index(13, 8) });
    run(world, 900, () => world.moveState[entityIndex(spearman)] === MoveState.Idle && world.tick > 5);
    expect(jobOf(world, spearman)).toBe(Job.None);
    expect(Math.hypot(xOf(world, spearman) - 2.5, yOf(world, spearman) - 2.5)).toBeLessThan(1.6);
    expect(jobOf(world, worker)).toBe(Job.None);
    expect(Math.hypot(xOf(world, worker) - 13.5, yOf(world, worker) - 8.5)).toBeLessThan(0.1);
  });

  it('ignores gather and deliver orders that make no sense', () => {
    const { world } = yard();
    const worker = villager(world, 3.5, 3.5);
    const enemyHall = world.spawnBuilding(1, Kind.TownCentre, 12, 7);
    const before = hashWorld(world);
    const nonsense = [
      { kind: 'gather', units: [worker], tile: -1 },
      { kind: 'gather', units: [worker], tile: 1e9 },
      { kind: 'gather', units: [worker], tile: 2.5 },
      { kind: 'gather', units: [worker] },
      { kind: 'deliver', units: [worker], target: enemyHall },
      { kind: 'deliver', units: [worker], target: worker },
      { kind: 'deliver', units: [worker], target: 'hall' },
    ] as unknown as Command[];
    for (const command of nonsense) send(world, 0, command);
    const untouched = restoreSnapshot(takeSnapshot(world));
    step(world);
    step(untouched);
    expect(hashWorld(world)).toBe(hashWorld(untouched));
    expect(hashWorld(world)).not.toBe(before); // only because the tick moved on
    expect(jobOf(world, worker)).toBe(Job.None);
  });
});

describe('buildings', () => {
  it('block the ground they stand on and take no orders', () => {
    const { world, hall } = yard();
    const { map } = world;
    for (let ty = 1; ty <= 5; ty++) {
      for (let tx = 6; tx <= 10; tx++) expect(map.isPassable(tx, ty)).toBe(false);
    }
    expect(map.isPassable(5, 3)).toBe(true);
    expect(map.isPassable(11, 3)).toBe(true);
    send(world, 0, { kind: 'move', units: [hall], x: fromFloat(1.5), y: fromFloat(8.5) });
    send(world, 0, { kind: 'gather', units: [hall], tile: map.index(2, 2) });
    run(world, 60);
    expect(xOf(world, hall)).toBe(8.5);
    expect(world.livingUnits()).toEqual([]);
    expect(world.livingEntities()).toEqual([hall]);
  });

  it('are walked round, never through', () => {
    const { world } = yard();
    const walker = world.spawnUnit(0, Kind.Spearman, fromFloat(4.5), fromFloat(3.5));
    send(world, 0, { kind: 'move', units: [walker], x: fromFloat(12.5), y: fromFloat(3.5) });
    let furthestFromLine = 0;
    run(world, 900, () => {
      furthestFromLine = Math.max(furthestFromLine, Math.abs(yOf(world, walker) - 3.5));
      return world.moveState[entityIndex(walker)] === MoveState.Idle && world.tick > 5;
    });
    expect(xOf(world, walker)).toBeCloseTo(12.5, 1);
    expect(furthestFromLine).toBeGreaterThan(2.5);
  });

  it('give the ground back when they are gone', () => {
    const { world, hall } = yard();
    world.destroy(hall);
    expect(world.map.isPassable(8, 3)).toBe(true);
    expect(regionsAreRight(world)).toBe(true);
    expect(world.map.blocked.every((b) => b === 0)).toBe(true);
  });
});

describe('the standard start', () => {
  const config = defaultConfig({
    seed: 4,
    mapWidth: 96,
    mapHeight: 96,
    map: { kind: 'generated' },
    start: 'standard',
  });

  it('gives each player a town centre, villagers beside it and something in the stores', () => {
    const world = new World(config);
    for (let player = 0; player < 2; player++) {
      const mine = world.livingEntities(player);
      const units = world.livingUnits(player);
      expect(mine.length - units.length).toBe(1);
      expect(units).toHaveLength(STARTING_VILLAGERS);
      const hall = mine.find((id) => !units.includes(id))!;
      const start = world.map.starts[player]!;
      expect(world.posX[entityIndex(hall)]).toBe(start.x);
      expect(world.posY[entityIndex(hall)]).toBe(start.y);
      for (const id of units) {
        const slot = entityIndex(id);
        expect(world.entityType[slot]).toBe(Kind.Villager);
        expect(world.map.passable[world.map.tileAt(world.posX[slot]!, world.posY[slot]!)]).toBe(1);
        // Right beside the hall.
        expect(Math.abs(xOf(world, id) - toFloat(start.x))).toBe(3);
      }
      expect(Array.from(world.stock.subarray(player * 4, player * 4 + 4))).toEqual([200, 200, 0, 100]);
    }
    expect(brokenInvariant(world)).toBeNull();
  });

  it('is not placed a second time when a saved game is loaded', () => {
    const world = new World(config);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(takeSnapshot(world))));
    expect(restored.livingEntities()).toEqual(world.livingEntities());
    expect(hashWorld(restored)).toBe(hashWorld(world));
    expect(Array.from(restored.map.passable)).toEqual(Array.from(world.map.passable));
  });

  it('lets both players work every resource near home from the first tick', () => {
    const world = new World(config);
    const before = resourceTotals(world);
    for (let player = 0; player < 2; player++) {
      const start = world.map.starts[player]!;
      const units = world.livingUnits(player);
      [Terrain.Berries, Terrain.Forest, Terrain.Gold, Terrain.Stone].forEach((terrain, i) => {
        const tile = world.map.nearestTile(start.x >> 16, start.y >> 16, 14, (t) => world.map.terrain[t] === terrain);
        expect(tile, `player ${player} has terrain ${terrain} within 14 tiles`).toBeGreaterThanOrEqual(0);
        send(world, player, { kind: 'gather', units: [units[i]!], tile });
      });
    }
    run(world, 30 * 75);
    for (let player = 0; player < 2; player++) {
      const mine = Array.from(world.stock.subarray(player * 4, player * 4 + 4));
      expect(mine[0], 'food').toBeGreaterThan(200);
      expect(mine[1], 'wood').toBeGreaterThan(200);
      expect(mine[2], 'stone').toBeGreaterThan(0);
      expect(mine[3], 'gold').toBeGreaterThan(100);
    }
    // The map is symmetric and so were the orders, so the two economies match exactly.
    expect(Array.from(world.stock.subarray(0, 4))).toEqual(Array.from(world.stock.subarray(4, 8)));
    expect(resourceTotals(world)).toEqual(before);
  });
});

describe('route searches and a changing map', () => {
  it('starts a search again when a tree falls part-way through it', () => {
    const rows = ['............', '.....T......', '.....T......', '.....T......', '.....T......', '............'];
    const world = worldFrom(rows, { pathBudget: 3 });
    const walker = world.spawnUnit(0, Kind.Spearman, fromFloat(1.5), fromFloat(2.5));
    send(world, 0, { kind: 'move', units: [walker], x: fromFloat(9.5), y: fromFloat(2.5) });
    run(world, 4);
    const before = world.activeSearch!;
    expect(before.search.expansions).toBeGreaterThan(6);
    // The tree in the walker's way comes down.
    thinOut(world, world.map.index(5, 2), 0);
    step(world);
    const after = world.activeSearch;
    // Either it has begun again on the new map, or the way is now clear and no search is needed.
    if (after !== null) {
      expect(after.mapVersion).toBe(world.map.passVersion);
      expect(after.search.expansions).toBeLessThanOrEqual(3);
    }
    // A save taken now carries on exactly as the original does.
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(takeSnapshot(world))));
    for (let i = 0; i < 400; i++) {
      step(world);
      step(restored);
      expect(hashWorld(restored)).toBe(hashWorld(world));
    }
    expect(xOf(world, walker)).toBeCloseTo(9.5, 1);
  });
});

describe('farms', () => {
  /** An open field with a town centre, a villager, and wood enough for a few farms. */
  function homestead(): { world: World; farmer: number } {
    const world = new World(defaultConfig({ mapWidth: 40, mapHeight: 40, mapState: 'revealed' }));
    world.spawnBuilding(0, Kind.TownCentre, 10, 10);
    world.stock.set([0, 300, 0, 0], 0);
    return { world, farmer: villager(world, 14.5, 10.5) };
  }
  const farmOf = (world: World): number =>
    world.livingEntities(0).find((id) => world.entityType[entityIndex(id)] === Kind.Farm)!;

  it('are built like any building, and then become tilled ground that can be walked over', () => {
    const { world, farmer } = homestead();
    send(world, 0, { kind: 'build', units: [farmer], buildingType: Kind.Farm, tileX: 18, tileY: 10 });
    run(world, 5);
    expect(stock(world, Resource.Wood)).toBe(225);
    // While it is a site it is in the way, like any other.
    expect(world.map.isPassable(18, 10)).toBe(false);
    const farm = farmOf(world);
    run(world, 900, () => world.built[entityIndex(farm)] === 1);
    expect(world.built[entityIndex(farm)]).toBe(1);
    for (let ty = 9; ty <= 11; ty++) {
      for (let tx = 17; tx <= 19; tx++) {
        expect(world.map.terrain[ty * 40 + tx]).toBe(Terrain.Field);
        expect(world.map.isPassable(tx, ty)).toBe(true);
      }
    }
    // Nothing else can be built on it.
    send(world, 0, { kind: 'build', units: [farmer], buildingType: Kind.House, tileX: 18, tileY: 10 });
    run(world, 5);
    expect(world.livingEntities(0).filter((id) => world.mobile[entityIndex(id)] === 0).length).toBe(2);
    // A soldier marches straight across.
    const spear = world.spawnUnit(0, Kind.Spearman, fromFloat(18.5), fromFloat(6.5));
    send(world, 0, { kind: 'move', units: [spear], x: fromFloat(18.5), y: fromFloat(14.5) });
    let crossed = false;
    run(world, 600, () => {
      crossed ||= Math.abs(yOf(world, spear) - 10.5) < 0.3 && Math.abs(xOf(world, spear) - 18.5) < 0.6;
      return world.moveState[entityIndex(spear)] === MoveState.Idle;
    });
    expect(crossed).toBe(true);
  });

  it('are farmed at once by whoever built them, and the food never runs out', () => {
    const { world, farmer } = homestead();
    send(world, 0, { kind: 'build', units: [farmer], buildingType: Kind.Farm, tileX: 18, tileY: 10 });
    run(world, 900, () => jobOf(world, farmer) === Job.Harvesting);
    expect(jobOf(world, farmer)).toBe(Job.Harvesting);
    // The farmer stands on the farm itself, just south of the middle.
    expect(Math.floor(xOf(world, farmer))).toBe(18);
    expect(Math.floor(yOf(world, farmer))).toBe(11);
    const before = resourceTotals(world);
    run(world, 30 * 240);
    // Four minutes of farming: about 150 units grown at one every 1.6 seconds, less the walking.
    expect(stock(world, Resource.Food)).toBeGreaterThan(90);
    expect(stock(world, Resource.Food)).toBeLessThan(150);
    expect(world.grown[Resource.Food]).toBeGreaterThanOrEqual(stock(world, Resource.Food));
    expect(world.map.amount[10 * 40 + 18]).toBe(1);
    expect(resourceTotals(world)).toEqual(before);
  });

  it('take one farmer each: a second villager sent to the same farm finds another, or stands down', () => {
    const { world, farmer } = homestead();
    const second = villager(world, 14.5, 12.5);
    send(world, 0, { kind: 'build', units: [farmer], buildingType: Kind.Farm, tileX: 18, tileY: 10 });
    run(world, 900, () => jobOf(world, farmer) === Job.Harvesting);
    const middle = 10 * 40 + 18;
    send(world, 0, { kind: 'gather', units: [second], tile: middle });
    run(world, 300);
    expect(jobOf(world, second)).toBe(Job.None);
    expect(jobOf(world, farmer)).toBe(Job.Harvesting);
    // With a second farm near by, the same order sends them there instead.
    world.spawnBuilding(0, Kind.Farm, 18, 14);
    send(world, 0, { kind: 'gather', units: [second], tile: middle });
    run(world, 600, () => jobOf(world, second) === Job.Harvesting);
    expect(world.jobTile[entityIndex(second)]).toBe(14 * 40 + 18);
    // Only the middle of a farm can be worked.
    const third = villager(world, 14.5, 8.5);
    send(world, 0, { kind: 'gather', units: [third], tile: 9 * 40 + 17 });
    run(world, 200);
    expect(jobOf(world, third)).toBe(Job.None);
  });

  it('go back to grass when destroyed, and the farmer looks for other work', () => {
    const { world, farmer } = homestead();
    send(world, 0, { kind: 'build', units: [farmer], buildingType: Kind.Farm, tileX: 18, tileY: 10 });
    run(world, 900, () => jobOf(world, farmer) === Job.Harvesting);
    send(world, 0, { kind: 'demolish', targets: [farmOf(world)] });
    run(world, 120);
    for (let ty = 9; ty <= 11; ty++) for (let tx = 17; tx <= 19; tx++) expect(world.map.terrain[ty * 40 + tx]).toBe(Terrain.Grass);
    expect(jobOf(world, farmer)).not.toBe(Job.Harvesting);
    expect(regionsAreRight(world)).toBe(true);
  });

  it('come back from a saved game as fields, not walls', () => {
    const { world, farmer } = homestead();
    send(world, 0, { kind: 'build', units: [farmer], buildingType: Kind.Farm, tileX: 18, tileY: 10 });
    run(world, 1200, () => stock(world, Resource.Food) >= 10);
    world.spawnBuilding(0, Kind.Farm, 25, 25, false); // and a second, still a site
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(takeSnapshot(world))));
    expect(hashWorld(restored)).toBe(hashWorld(world));
    expect(restored.map.isPassable(18, 10)).toBe(true);
    expect(restored.map.isPassable(25, 25)).toBe(false);
    expect(Array.from(restored.grown)).toEqual(Array.from(world.grown));
    for (let i = 0; i < 300; i++) {
      step(world);
      step(restored);
    }
    expect(hashWorld(restored)).toBe(hashWorld(world));
    expect(brokenInvariant(restored)).toBeNull();
  });
});
