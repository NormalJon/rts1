import { describe, expect, it } from 'vitest';
import { canPlace } from '../src/sim/buildings';
import type { Command } from '../src/sim/commands';
import { ENTITY_TYPES, Kind, Resource } from '../src/sim/entityTypes';
import { toFloat } from '../src/sim/fixed';
import { hashWorld } from '../src/sim/hash';
import { countPopulation } from '../src/sim/production';
import { step } from '../src/sim/sim';
import { restoreSnapshot, takeSnapshot } from '../src/sim/snapshot';
import { fromFloat } from '../src/sim/units';
import { defaultConfig, entityIndex, Job, MoveState, World, type SimConfig } from '../src/sim/world';
import { brokenInvariant } from './helpers';

function worldFrom(rows: string[], overrides: Partial<SimConfig> = {}): World {
  return new World(
    defaultConfig({ mapWidth: rows[0]!.length, mapHeight: rows.length, map: { kind: 'ascii', rows }, ...overrides }),
  );
}

let seq = 0;
function send(world: World, player: number, command: Command): void {
  world.commands.schedule({ tick: world.tick, player, seq: seq++, command }, world.tick);
}

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
const stock = (world: World, player = 0): number[] => Array.from(world.stock.subarray(player * 4, player * 4 + 4));
const give = (world: World, amounts: number[], player = 0): void => world.stock.set(amounts, player * 4);
const xOf = (world: World, id: number): number => toFloat(world.posX[entityIndex(id)]!);
const yOf = (world: World, id: number): number => toFloat(world.posY[entityIndex(id)]!);
const jobOf = (world: World, id: number): number => world.job[entityIndex(id)]!;
/** The player's buildings of a type, finished or not. */
const buildingsOf = (world: World, kind: number, player = 0): number[] =>
  world.livingEntities(player).filter((id) => world.entityType[entityIndex(id)] === kind);
const isBuilt = (world: World, id: number): boolean => world.built[entityIndex(id)] === 1;

//   0         1         2
//   0123456789012345678901234
const FIELD = [
  '.........................',
  '.........................',
  '..TTT....................',
  '..TTT....................',
  '..TTT....................',
  '.........................',
  '.........................',
  '....................bb...',
  '.........................',
  '.........................',
  '.........................',
  '.........................',
];

/** The field with a town centre at (12, 5) and stores to spend. */
function settlement(overrides: Partial<SimConfig> = {}): { world: World; hall: number } {
  const world = worldFrom(FIELD, overrides);
  const hall = world.spawnBuilding(0, Kind.TownCentre, 12, 5);
  give(world, [500, 500, 100, 100]);
  return { world, hall };
}

describe('founding a building', () => {
  it('needs open grass under every tile of its plot', () => {
    const world = worldFrom(['.......', '.T..~..', '....,..', '.#.....', '.....g.', '.......', '.......']);
    world.spawnBuilding(0, Kind.House, 5, 1 - 1 + 6 - 1); // a house at (5, 5), covering (4..6, 4..6)
    expect(canPlace(world, Kind.House, 3, 5)).toBe(false); // overlaps that house
    expect(canPlace(world, Kind.House, 2, 5)).toBe(true);
    expect(canPlace(world, Kind.House, 1, 1)).toBe(false); // a tree
    expect(canPlace(world, Kind.House, 3, 1)).toBe(false); // the river and the ford
    expect(canPlace(world, Kind.House, 2, 3)).toBe(false); // rock
    expect(canPlace(world, Kind.House, 0, 5)).toBe(false); // hangs off the map
    expect(canPlace(world, Kind.House, 2.5, 5)).toBe(false);
    expect(canPlace(world, Kind.Villager, 2, 5)).toBe(false); // not a building
  });

  it('takes the cost at once and marks out a site that blocks the ground', () => {
    const { world } = settlement();
    const worker = villager(world, 16.5, 9.5);
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: 20, tileY: 3 });
    step(world);
    const [house] = buildingsOf(world, Kind.House);
    expect(house).toBeDefined();
    expect(isBuilt(world, house!)).toBe(false);
    expect(stock(world)).toEqual([500, 450, 100, 100]);
    expect(Array.from(world.spent.subarray(0, 4))).toEqual([0, 50, 0, 0]);
    for (let ty = 2; ty <= 4; ty++) for (let tx = 19; tx <= 21; tx++) expect(world.map.isPassable(tx, ty)).toBe(false);
    expect(world.map.isPassable(18, 3)).toBe(true);
    expect(jobOf(world, worker)).toBe(Job.ToSite);
  });

  it('is refused when it cannot be afforded, cannot stand there, or is not for villagers to build', () => {
    const { world } = settlement();
    const worker = villager(world, 16.5, 9.5);
    give(world, [500, 40, 100, 100]);
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: 20, tileY: 3 });
    step(world);
    expect(stock(world)).toEqual([500, 40, 100, 100]);
    give(world, [500, 500, 100, 100]);
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: 3, tileY: 3 }); // in the trees
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: 12, tileY: 5 }); // on the hall
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.TownCentre, tileX: 20, tileY: 9 });
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.Spearman, tileX: 20, tileY: 9 });
    send(world, 0, { kind: 'build', units: [worker], buildingType: 99, tileX: 20, tileY: 9 });
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: NaN, tileY: 9 } as Command);
    step(world);
    expect(world.livingEntities(0).filter((id) => world.mobile[entityIndex(id)] === 0)).toHaveLength(1);
    expect(stock(world)).toEqual([500, 500, 100, 100]);
    expect(jobOf(world, worker)).toBe(Job.None);
  });

  it('moves units standing on the plot off it', () => {
    const { world } = settlement();
    const bystanders = [villager(world, 20.5, 3.5), villager(world, 19.5, 2.5), villager(world, 21.4, 4.4)];
    send(world, 0, { kind: 'build', units: [], buildingType: Kind.House, tileX: 20, tileY: 3 });
    run(world, 30);
    for (const id of bystanders) {
      const x = xOf(world, id);
      const y = yOf(world, id);
      expect(x < 19 || x > 22 || y < 2 || y > 5).toBe(true);
      expect(world.moveState[entityIndex(id)]).toBe(MoveState.Idle);
    }
  });
});

describe('building work', () => {
  const buildHouse = (builders: number): number => {
    const { world } = settlement();
    const workers = Array.from({ length: builders }, (_, i) => villager(world, 17.5, 2.5 + i * 0.6));
    send(world, 0, { kind: 'build', units: workers, buildingType: Kind.House, tileX: 20, tileY: 3 });
    step(world);
    const [house] = buildingsOf(world, Kind.House);
    run(world, 300, () => workers.every((id) => jobOf(world, id) === Job.Constructing));
    const began = world.tick;
    run(world, 2000, () => isBuilt(world, house!));
    expect(isBuilt(world, house!)).toBe(true);
    return world.tick - began;
  };

  it('takes one villager the stated time', () => {
    // A house is 20 seconds of one villager's work: 600 ticks.
    expect(ENTITY_TYPES[Kind.House]!.seconds).toBe(20);
    expect(buildHouse(1)).toBe(600);
  });

  it('goes faster with more hands, but less so each time', () => {
    // One builder adds three points a tick, each helper one more: 1,800 points
    // take two builders 450 ticks, three 360 and six 225. A tick or two is
    // lost or gained as the helpers arrive.
    expect(Math.abs(buildHouse(2) - 450)).toBeLessThanOrEqual(2);
    expect(Math.abs(buildHouse(3) - 360)).toBeLessThanOrEqual(2);
    expect(Math.abs(buildHouse(6) - 225)).toBeLessThanOrEqual(3);
  });

  it('leaves the builders idle when there is nothing else to do', () => {
    const { world } = settlement();
    const worker = villager(world, 17.5, 3.5);
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: 20, tileY: 9 });
    run(world, 1500, () => jobOf(world, worker) === Job.None);
    expect(isBuilt(world, buildingsOf(world, Kind.House)[0]!)).toBe(true);
    expect(world.moveState[entityIndex(worker)]).toBe(MoveState.Idle);
  });

  it('sends the builders on to the next site nearby', () => {
    const { world } = settlement();
    const worker = villager(world, 17.5, 3.5);
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: 20, tileY: 9 });
    send(world, 0, { kind: 'build', units: [], buildingType: Kind.House, tileX: 16, tileY: 9 });
    run(world, 3000, () => buildingsOf(world, Kind.House).every((id) => isBuilt(world, id)));
    expect(buildingsOf(world, Kind.House)).toHaveLength(2);
    expect(buildingsOf(world, Kind.House).every((id) => isBuilt(world, id))).toBe(true);
  });

  it('sets the builders of a lumber camp to felling, and they hand in at the camp', () => {
    const { world, hall } = settlement();
    const workers = [villager(world, 8.5, 8.5), villager(world, 8.5, 9.5)];
    send(world, 0, { kind: 'build', units: workers, buildingType: Kind.LumberCamp, tileX: 7, tileY: 4 });
    step(world);
    const [camp] = buildingsOf(world, Kind.LumberCamp);
    run(world, 1500, () => isBuilt(world, camp!));
    run(world, 30);
    for (const id of workers) {
      expect([Job.ToResource, Job.Harvesting]).toContain(jobOf(world, id));
      expect(world.jobTerrain[entityIndex(id)]).toBe(1); // forest
    }
    const targets = new Set<number>();
    run(world, 2400, () => {
      for (const id of workers) if (jobOf(world, id) === Job.ToDropOff) targets.add(world.jobTarget[entityIndex(id)]!);
      return stock(world)[Resource.Wood]! >= 450 + 40;
    });
    expect(stock(world)[Resource.Wood]).toBeGreaterThanOrEqual(490);
    // The camp is two tiles from the trees; the hall is further. They never walk to the hall.
    expect([...targets]).toEqual([camp]);
    expect(targets.has(hall)).toBe(false);
  });

  it('lets other villagers join a site, and ignores a site that is not theirs', () => {
    const { world } = settlement();
    const first = villager(world, 17.5, 3.5);
    const second = villager(world, 17.5, 8.5);
    const stranger = villager(world, 23.5, 10.5, 1);
    send(world, 0, { kind: 'build', units: [first], buildingType: Kind.House, tileX: 20, tileY: 3 });
    step(world);
    const [house] = buildingsOf(world, Kind.House);
    send(world, 0, { kind: 'construct', units: [second], target: house! });
    send(world, 1, { kind: 'construct', units: [stranger], target: house! });
    step(world);
    expect(jobOf(world, second)).toBe(Job.ToSite);
    expect(jobOf(world, stranger)).toBe(Job.None);
    run(world, 1000, () => isBuilt(world, house!));
    expect(isBuilt(world, house!)).toBe(true);
  });

  it('only accepts at a drop-off what that building is for', () => {
    const world = worldFrom(FIELD);
    const mill = world.spawnBuilding(0, Kind.Mill, 20, 3);
    const woodcutter = villager(world, 5.5, 5.5);
    send(world, 0, { kind: 'gather', units: [woodcutter], tile: world.map.index(3, 4) });
    run(world, 900, () => world.carry[entityIndex(woodcutter)] === 10 && jobOf(world, woodcutter) === Job.None);
    // A mill takes food, not wood: with nowhere else to go, the villager stops with its load.
    expect(world.carry[entityIndex(woodcutter)]).toBe(10);
    expect(stock(world)[Resource.Wood]).toBe(0);
    send(world, 0, { kind: 'deliver', units: [woodcutter], target: mill });
    run(world, 300);
    expect(stock(world)[Resource.Wood]).toBe(0);

    const forager = villager(world, 19.5, 8.5);
    send(world, 0, { kind: 'gather', units: [forager], tile: world.map.index(20, 7) });
    run(world, 1200, () => stock(world)[Resource.Food]! >= 10);
    expect(stock(world)[Resource.Food]).toBe(10);
  });

  it('does not accept deliveries until it is finished', () => {
    const world = worldFrom(FIELD);
    give(world, [0, 100, 0, 0]);
    const woodcutter = villager(world, 5.5, 5.5);
    send(world, 0, { kind: 'build', units: [], buildingType: Kind.LumberCamp, tileX: 7, tileY: 4 });
    send(world, 0, { kind: 'gather', units: [woodcutter], tile: world.map.index(3, 4) });
    run(world, 900, () => world.carry[entityIndex(woodcutter)] === 10 && jobOf(world, woodcutter) === Job.None);
    expect(stock(world)[Resource.Wood]).toBe(50);
  });
});

describe('pulling a building down', () => {
  it('refunds a site in full and a finished building not at all, and reopens the ground', () => {
    const { world } = settlement();
    const worker = villager(world, 17.5, 3.5);
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: 20, tileY: 3 });
    run(world, 200);
    const [site] = buildingsOf(world, Kind.House);
    expect(stock(world)[Resource.Wood]).toBe(450);
    send(world, 0, { kind: 'demolish', targets: [site!] });
    run(world, 5);
    expect(world.isAlive(site!)).toBe(false);
    expect(stock(world)[Resource.Wood]).toBe(500);
    expect(world.map.isPassable(20, 3)).toBe(true);
    expect(jobOf(world, worker)).toBe(Job.None);

    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: 20, tileY: 3 });
    run(world, 1200, () => buildingsOf(world, Kind.House).some((id) => isBuilt(world, id)));
    send(world, 0, { kind: 'demolish', targets: buildingsOf(world, Kind.House) });
    run(world, 5);
    expect(buildingsOf(world, Kind.House)).toHaveLength(0);
    expect(stock(world)[Resource.Wood]).toBe(450);
  });

  it("leaves other players' buildings, and units, alone", () => {
    const { world, hall } = settlement();
    const worker = villager(world, 17.5, 3.5);
    send(world, 1, { kind: 'demolish', targets: [hall] });
    send(world, 0, { kind: 'demolish', targets: [worker, -1, 1e12] });
    run(world, 3);
    expect(world.isAlive(hall)).toBe(true);
    expect(world.isAlive(worker)).toBe(true);
  });
});

describe('training', () => {
  it('turns out a villager after the stated time, beside the building', () => {
    const { world, hall } = settlement();
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    step(world);
    expect(stock(world)).toEqual([450, 500, 100, 100]);
    expect(world.trainLength[entityIndex(hall)]).toBe(1);
    expect(countPopulation(world).used[0]).toBe(1); // room is set aside as training starts
    // 20 seconds is 600 ticks, of which the tick that queued it was the first.
    const ticks = 1 + run(world, 2000, () => world.livingUnits(0).length === 1);
    expect(ticks).toBe(600);
    const [recruit] = world.livingUnits(0);
    expect(world.entityType[entityIndex(recruit!)]).toBe(Kind.Villager);
    // Out of the front of the hall, which faces down the map.
    expect(xOf(world, recruit!)).toBe(12.5);
    expect(yOf(world, recruit!)).toBe(8.5);
    expect(world.trainLength[entityIndex(hall)]).toBe(0);
    expect(countPopulation(world)).toEqual({ used: [1, 0], room: [10, 0] });
  });

  it('works through a queue in order and refuses a ninth', () => {
    const { world, hall } = settlement();
    for (let i = 0; i < 9; i++) send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    step(world);
    expect(world.trainLength[entityIndex(hall)]).toBe(8);
    expect(stock(world)[Resource.Food]).toBe(500 - 8 * 50);
    run(world, 600 * 3 + 10);
    expect(world.livingUnits(0)).toHaveLength(3);
    expect(world.trainLength[entityIndex(hall)]).toBe(5);
  });

  it('gives the cost back when a unit is cancelled, and starts the one in training afresh', () => {
    const { world, hall } = settlement();
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    run(world, 300);
    send(world, 0, { kind: 'cancelTrain', building: hall, index: 1 });
    step(world);
    expect(stock(world)[Resource.Food]).toBe(450);
    expect(world.trainTicks[entityIndex(hall)]).toBeGreaterThan(290);
    send(world, 0, { kind: 'cancelTrain', building: hall, index: 0 });
    step(world);
    expect(stock(world)[Resource.Food]).toBe(500);
    expect(world.trainLength[entityIndex(hall)]).toBe(0);
    expect(world.trainTicks[entityIndex(hall)]).toBe(0);
    expect(countPopulation(world).used[0]).toBe(0);
    send(world, 0, { kind: 'cancelTrain', building: hall, index: 0 }); // nothing there: no refund
    send(world, 0, { kind: 'cancelTrain', building: hall, index: 2.5 } as Command);
    step(world);
    expect(stock(world)[Resource.Food]).toBe(500);
  });

  it('only trains what the building trains, for its owner, once it is built', () => {
    const { world, hall } = settlement();
    give(world, [500, 500, 0, 0], 1);
    const barracksSite = world.spawnBuilding(0, Kind.Barracks, 20, 3, false);
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Spearman }); // halls train villagers
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.House });
    send(world, 0, { kind: 'train', building: hall, unitType: 42 });
    send(world, 1, { kind: 'train', building: hall, unitType: Kind.Villager }); // not theirs
    send(world, 0, { kind: 'train', building: barracksSite, unitType: Kind.Spearman }); // not built
    send(world, 0, { kind: 'train', building: 12345, unitType: Kind.Villager });
    step(world);
    expect(stock(world)).toEqual([500, 500, 100, 100]);
    expect(stock(world, 1)).toEqual([500, 500, 0, 0]);
    expect(world.trainLength[entityIndex(hall)]).toBe(0);
  });

  it('trains spearmen at a barracks', () => {
    const { world } = settlement();
    const barracks = world.spawnBuilding(0, Kind.Barracks, 20, 3);
    send(world, 0, { kind: 'train', building: barracks, unitType: Kind.Spearman });
    step(world);
    expect(stock(world)).toEqual([440, 480, 100, 100]);
    run(world, 15 * 30);
    const [recruit] = world.livingUnits(0);
    expect(world.entityType[entityIndex(recruit!)]).toBe(Kind.Spearman);
  });

  it('refuses a unit that cannot be afforded', () => {
    const { world, hall } = settlement();
    give(world, [49, 500, 0, 0]);
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    step(world);
    expect(world.trainLength[entityIndex(hall)]).toBe(0);
    expect(stock(world)[Resource.Food]).toBe(49);
  });
});

describe('population', () => {
  it('counts room from finished buildings only', () => {
    const { world } = settlement();
    expect(countPopulation(world).room[0]).toBe(10);
    world.spawnBuilding(0, Kind.House, 20, 3, false);
    expect(countPopulation(world).room[0]).toBe(10);
    world.spawnBuilding(0, Kind.House, 20, 9);
    expect(countPopulation(world).room[0]).toBe(20);
    world.spawnBuilding(1, Kind.House, 3, 9);
    expect(countPopulation(world)).toEqual({ used: [0, 0], room: [20, 10] });
  });

  it('holds training until there is room, then carries on', () => {
    const { world, hall } = settlement();
    for (let i = 0; i < 10; i++) villager(world, 4.5 + i, 9.5);
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    run(world, 900);
    // Ten of ten: paid for, but not begun.
    expect(world.livingUnits(0)).toHaveLength(10);
    expect(world.trainTicks[entityIndex(hall)]).toBe(0);
    expect(world.trainStarted[entityIndex(hall)]).toBe(0);
    expect(stock(world)[Resource.Food]).toBe(450);

    const builder = world.livingUnits(0)[0]!;
    send(world, 0, { kind: 'build', units: [builder], buildingType: Kind.House, tileX: 20, tileY: 3 });
    run(world, 1500, () => buildingsOf(world, Kind.House).some((id) => isBuilt(world, id)));
    const ticks = run(world, 1000, () => world.livingUnits(0).length === 11);
    expect(world.livingUnits(0)).toHaveLength(11);
    expect(ticks).toBeGreaterThan(590);
    expect(ticks).toBeLessThan(605);
    expect(countPopulation(world)).toEqual({ used: [11, 0], room: [20, 0] });
  });

  it('never goes past the limit however many houses there are', () => {
    const world = new World(defaultConfig({ mapWidth: 128, mapHeight: 128 }));
    for (let i = 0; i < 30; i++) world.spawnBuilding(0, Kind.House, 4 + (i % 10) * 4, 4 + Math.floor(i / 10) * 4);
    expect(countPopulation(world).room[0]).toBe(200);
  });
});

describe('rally points', () => {
  it('send new units to a place', () => {
    const { world, hall } = settlement();
    send(world, 0, { kind: 'rally', buildings: [hall], x: fromFloat(20.5), y: fromFloat(9.5) });
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    run(world, 605);
    const [recruit] = world.livingUnits(0);
    // It comes out on the side nearest the rally point and walks there.
    expect(xOf(world, recruit!)).toBeGreaterThan(14.5);
    run(world, 300, () => world.moveState[entityIndex(recruit!)] === MoveState.Idle);
    expect(Math.hypot(xOf(world, recruit!) - 20.5, yOf(world, recruit!) - 9.5)).toBeLessThan(0.1);
  });

  it('on a resource, put new villagers straight to work on it', () => {
    const { world, hall } = settlement();
    const berries = world.map.index(20, 7);
    send(world, 0, { kind: 'rally', buildings: [hall], x: world.map.centreX(berries), y: world.map.centreY(berries) });
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    run(world, 605);
    const [recruit] = world.livingUnits(0);
    expect(world.rallyTile[entityIndex(hall)]).toBe(berries);
    expect(jobOf(world, recruit!)).toBe(Job.ToResource);
    run(world, 2000, () => stock(world)[Resource.Food]! > 450);
    expect(stock(world)[Resource.Food]).toBe(460);
  });

  it("cannot be set on someone else's building", () => {
    const { world, hall } = settlement();
    send(world, 1, { kind: 'rally', buildings: [hall], x: fromFloat(2.5), y: fromFloat(9.5) });
    send(world, 0, { kind: 'rally', buildings: 'all', x: 0, y: 0 } as unknown as Command);
    step(world);
    expect(world.rallyX[entityIndex(hall)]).toBe(-1);
  });
});

describe('routes and new buildings', () => {
  it('a unit on its way goes round a building founded across its path', () => {
    const { world } = settlement();
    const walker = world.spawnUnit(0, Kind.Spearman, fromFloat(2.5), fromFloat(9.5));
    send(world, 0, { kind: 'move', units: [walker], x: fromFloat(23.5), y: fromFloat(9.5) });
    run(world, 60);
    expect(world.moveState[entityIndex(walker)]).toBe(MoveState.Direct);
    send(world, 0, { kind: 'build', units: [], buildingType: Kind.Barracks, tileX: 14, tileY: 9 });
    const ticks = run(world, 900, () => world.moveState[entityIndex(walker)] === MoveState.Idle);
    expect(Math.hypot(xOf(world, walker) - 23.5, yOf(world, walker) - 9.5)).toBeLessThan(0.1);
    // About 21 tiles straight, a few more for the detour, at 1.6 tiles a second.
    expect(ticks).toBeLessThan(470);
  });

  it('a group following a flow field does too', () => {
    const world = worldFrom([
      '..............................',
      '..............................',
      '.....#........................',
      '.....#........................',
      '.....#........................',
      '.....#........................',
      '.....#........................',
      '.....#........................',
      '..............................',
      '..............................',
    ]);
    give(world, [0, 500, 0, 0]);
    const group: number[] = [];
    for (let i = 0; i < 9; i++) group.push(world.spawnUnit(0, Kind.Spearman, fromFloat(1.5 + (i % 3) * 0.6), fromFloat(4 + Math.floor(i / 3) * 0.6)));
    send(world, 0, { kind: 'move', units: group, x: fromFloat(27.5), y: fromFloat(4.5) });
    run(world, 20);
    expect(group.every((id) => world.moveState[entityIndex(id)] === MoveState.Field)).toBe(true);
    run(world, 40);
    send(world, 0, { kind: 'build', units: [], buildingType: Kind.Barracks, tileX: 16, tileY: 4 });
    send(world, 0, { kind: 'build', units: [], buildingType: Kind.House, tileX: 16, tileY: 8 });
    run(world, 1500, () => group.every((id) => world.moveState[entityIndex(id)] === MoveState.Idle));
    for (const id of group) expect(Math.hypot(xOf(world, id) - 27.5, yOf(world, id) - 4.5)).toBeLessThan(2);
  });

  it('a destination that gets built over moves to the nearest open ground', () => {
    const { world } = settlement();
    const walker = world.spawnUnit(0, Kind.Spearman, fromFloat(2.5), fromFloat(9.5));
    send(world, 0, { kind: 'move', units: [walker], x: fromFloat(20.5), y: fromFloat(3.5) });
    send(world, 0, { kind: 'move', units: [walker], x: fromFloat(16.5), y: fromFloat(9.5), queue: true });
    run(world, 60);
    send(world, 0, { kind: 'build', units: [], buildingType: Kind.House, tileX: 20, tileY: 3 });
    send(world, 0, { kind: 'build', units: [], buildingType: Kind.House, tileX: 16, tileY: 9 });
    run(world, 1500, () => world.moveState[entityIndex(walker)] === MoveState.Idle && world.queueLength[entityIndex(walker)] === 0);
    // It ends beside the second house, having first gone to stand beside the first.
    expect(Math.hypot(xOf(world, walker) - 16.5, yOf(world, walker) - 9.5)).toBeLessThan(2.4);
    expect(world.map.passable[world.map.tileAt(world.posX[entityIndex(walker)]!, world.posY[entityIndex(walker)]!)]).toBe(1);
  });

  it('a villager whose place at a tree is built over finds another', () => {
    const { world } = settlement();
    const worker = villager(world, 6.5, 3.5);
    send(world, 0, { kind: 'gather', units: [worker], tile: world.map.index(4, 3) });
    run(world, 300, () => jobOf(world, worker) === Job.Harvesting);
    expect(Math.floor(xOf(world, worker))).toBe(5);
    send(world, 0, { kind: 'build', units: [], buildingType: Kind.House, tileX: 6, tileY: 3 });
    run(world, 600, () => jobOf(world, worker) === Job.Harvesting && world.tick > 320);
    expect(jobOf(world, worker)).toBe(Job.Harvesting);
    const before = world.carry[entityIndex(worker)]!;
    run(world, 100);
    expect(world.carry[entityIndex(worker)]! > before || jobOf(world, worker) === Job.ToDropOff).toBe(true);
  });
});

describe('saved games', () => {
  it('carry sites, queues and rally points across', () => {
    const { world, hall } = settlement();
    const worker = villager(world, 17.5, 3.5);
    send(world, 0, { kind: 'build', units: [worker], buildingType: Kind.House, tileX: 20, tileY: 3 });
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    send(world, 0, { kind: 'train', building: hall, unitType: Kind.Villager });
    send(world, 0, { kind: 'rally', buildings: [hall], x: fromFloat(20.5), y: fromFloat(7.5) });
    run(world, 250);
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(takeSnapshot(world))));
    expect(hashWorld(restored)).toBe(hashWorld(world));
    for (let i = 0; i < 1500; i++) {
      step(world);
      step(restored);
      if (hashWorld(restored) !== hashWorld(world)) throw new Error(`diverged at tick ${world.tick}`);
    }
    expect(world.livingUnits(0)).toHaveLength(3);
    expect(isBuilt(world, buildingsOf(world, Kind.House)[0]!)).toBe(true);
  });
});
