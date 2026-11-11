import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/commands';
import { length, toFloat } from '../src/sim/fixed';
import { AStarSearch, SearchScratch } from '../src/sim/search';
import { step } from '../src/sim/sim';
import { fromFloat } from '../src/sim/units';
import { Kind } from '../src/sim/entityTypes';
import { defaultConfig, entityIndex, MoveState, World, type SimConfig } from '../src/sim/world';
import { brokenInvariant, smallestGap } from './helpers';

function worldFrom(rows: string[], overrides: Partial<SimConfig> = {}): World {
  return new World(
    defaultConfig({
      mapWidth: rows[0]!.length,
      mapHeight: rows.length,
      map: { kind: 'ascii', rows },
      ...overrides,
    }),
  );
}

function flatWorld(size: number, overrides: Partial<SimConfig> = {}): World {
  return new World(defaultConfig({ mapWidth: size, mapHeight: size, ...overrides }));
}

let seq = 0;
function send(world: World, player: number, command: Command): void {
  world.commands.schedule({ tick: world.tick, player, seq: seq++, command }, world.tick);
}

function move(world: World, player: number, units: number[], x: number, y: number, queue = false): void {
  send(world, player, { kind: 'move', units, x: fromFloat(x), y: fromFloat(y), queue });
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

const place = (world: World, player: number, x: number, y: number, kind: number = Kind.Spearman): number =>
  world.spawnUnit(player, kind, fromFloat(x), fromFloat(y));

const xOf = (world: World, id: number): number => toFloat(world.posX[entityIndex(id)]!);
const yOf = (world: World, id: number): number => toFloat(world.posY[entityIndex(id)]!);
const idle = (world: World, id: number): boolean =>
  world.moveState[entityIndex(id)] === MoveState.Idle && world.queueLength[entityIndex(id)] === 0;
const allIdle = (world: World, ids: number[]): boolean => ids.every((id) => idle(world, id));
const distanceTo = (world: World, id: number, x: number, y: number): number =>
  Math.hypot(xOf(world, id) - x, yOf(world, id) - y);

/** A block of units, half a tile and a bit apart. */
function block(world: World, player: number, x: number, y: number, columns: number, rows: number): number[] {
  const ids: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) ids.push(place(world, player, x + c * 0.6, y + r * 0.6));
  }
  return ids;
}

describe('a single unit', () => {
  it('walks round a wall to reach the other side', () => {
    const world = worldFrom([
      '............',
      '.....#......',
      '.....#......',
      '.....#......',
      '.....#......',
      '............',
    ]);
    const unit = place(world, 0, 1.5, 2.5);
    move(world, 0, [unit], 9.5, 2.5);
    const states = new Set<number>();
    const ticks = run(world, 400, () => {
      states.add(world.moveState[entityIndex(unit)]!);
      return idle(world, unit);
    });
    expect(idle(world, unit)).toBe(true);
    expect(distanceTo(world, unit, 9.5, 2.5)).toBeLessThan(0.07);
    expect(states.has(MoveState.Path)).toBe(true);
    // Round the end of the wall is about 9 tiles; at 1.6 tiles a second that is about 170 ticks.
    expect(ticks).toBeGreaterThan(150);
    expect(ticks).toBeLessThan(200);
  });

  it('walks straight there when nothing is in the way, without a search', () => {
    const world = flatWorld(32);
    const unit = place(world, 0, 4.5, 4.5);
    move(world, 0, [unit], 20.5, 12.5);
    step(world);
    expect(world.moveState[entityIndex(unit)]).toBe(MoveState.Direct);
    expect(world.routeQueue).toHaveLength(0);
    run(world, 400, () => idle(world, unit));
    expect(distanceTo(world, unit, 20.5, 12.5)).toBeLessThan(0.07);
  });

  it('takes a route close to the shortest one through a maze', () => {
    const world = worldFrom([
      '..........#.........',
      '.########.#.#######.',
      '.#......#.#.#.....#.',
      '.#.####.#.#.#.###.#.',
      '.#.#..#.#...#.#...#.',
      '.#.#.##.#####.#.###.',
      '.#.#..........#.....',
      '.#.############.###.',
      '.#..................',
      '.##################.',
      '....................',
    ]);
    const unit = place(world, 0, 0.5, 0.5);
    move(world, 0, [unit], 15.5, 4.5);
    let walked = 0;
    let lastX = 0.5;
    let lastY = 0.5;
    run(world, 3000, () => {
      walked += Math.hypot(xOf(world, unit) - lastX, yOf(world, unit) - lastY);
      lastX = xOf(world, unit);
      lastY = yOf(world, unit);
      return idle(world, unit);
    });
    expect(distanceTo(world, unit, 15.5, 4.5)).toBeLessThan(0.07);
    // Compare with the cheapest tile-to-tile route. Cutting corners makes the
    // real walk a little shorter, never longer.
    const { map } = world;
    const search = new AStarSearch(map, new SearchScratch(map.tileCount), map.index(0, 0), map.index(15, 4));
    while (!search.done) search.run(1000);
    const byTiles = search.path().reduce((sum, tile, i, tiles) => {
      if (i === 0) return 0;
      const straight = tile % map.width === tiles[i - 1]! % map.width || Math.abs(tile - tiles[i - 1]!) === 1;
      return sum + (straight ? 1 : Math.SQRT2);
    }, 0);
    expect(byTiles).toBeGreaterThan(30);
    expect(walked).toBeLessThanOrEqual(byTiles + 0.5);
    expect(walked).toBeGreaterThan(byTiles * 0.85);
  });

  it('goes as near as it can to a place it cannot reach', () => {
    const world = worldFrom([
      '.....~~.....',
      '.....~~.....',
      '.....~~.....',
      '.....~~.....',
    ]);
    const unit = place(world, 0, 1.5, 1.5);
    move(world, 0, [unit], 10.5, 1.5);
    run(world, 400, () => idle(world, unit));
    expect(idle(world, unit)).toBe(true);
    expect(xOf(world, unit)).toBeGreaterThan(4);
    expect(xOf(world, unit)).toBeLessThan(5);
    expect(world.routeQueue).toHaveLength(0);
    expect(world.activeSearch).toBeNull();
  });

  it('stands beside an obstacle it is ordered onto', () => {
    const world = worldFrom(['........', '....##..', '....##..', '........']);
    const unit = place(world, 0, 0.5, 1.5);
    move(world, 0, [unit], 5.2, 1.8);
    run(world, 300, () => idle(world, unit));
    expect(idle(world, unit)).toBe(true);
    expect(distanceTo(world, unit, 5.0, 2.0)).toBeLessThan(2);
  });

  it('visits queued waypoints in the order they were given', () => {
    const world = flatWorld(24);
    const unit = place(world, 0, 2.5, 2.5);
    const stops: [number, number][] = [
      [12.5, 2.5],
      [12.5, 12.5],
      [2.5, 12.5],
    ];
    move(world, 0, [unit], ...stops[0]!);
    move(world, 0, [unit], ...stops[1]!, true);
    move(world, 0, [unit], ...stops[2]!, true);
    const reachedAt: number[] = [];
    run(world, 1500, () => {
      const next = stops[reachedAt.length];
      if (next && distanceTo(world, unit, next[0], next[1]) < 0.2) reachedAt.push(world.tick);
      return idle(world, unit);
    });
    expect(reachedAt).toHaveLength(3);
    expect(distanceTo(world, unit, 2.5, 12.5)).toBeLessThan(0.07);
  });

  it('drops waypoints beyond what it can remember, and none it was given before that', () => {
    const world = flatWorld(24);
    const unit = place(world, 0, 2.5, 2.5);
    move(world, 0, [unit], 20.5, 2.5);
    for (let i = 0; i < 12; i++) move(world, 0, [unit], 3.5 + i, 10.5, true);
    step(world);
    expect(world.queueLength[entityIndex(unit)]).toBe(8);
    expect(toFloat(world.queueX[entityIndex(unit) * 8 + 7]!)).toBe(10.5);
  });

  it('waits when pathfinding is short of time, and still gets there', () => {
    const rows = ['............', '.....#......', '.....#......', '.....#......', '.....#......', '............'];
    const world = worldFrom(rows, { pathBudget: 3 });
    const unit = place(world, 0, 1.5, 2.5);
    move(world, 0, [unit], 9.5, 2.5);
    run(world, 3);
    expect(world.moveState[entityIndex(unit)]).toBe(MoveState.Awaiting);
    expect(world.activeSearch).not.toBeNull();
    run(world, 600, () => idle(world, unit));
    expect(distanceTo(world, unit, 9.5, 2.5)).toBeLessThan(0.07);
  });

  it('drops a route that was being worked out for an order since replaced', () => {
    const rows = ['............', '.....#......', '.....#......', '.....#......', '.....#......', '............'];
    const world = worldFrom(rows, { pathBudget: 3 });
    const unit = place(world, 0, 1.5, 2.5);
    move(world, 0, [unit], 9.5, 2.5);
    run(world, 2);
    move(world, 0, [unit], 2.5, 4.5); // in plain sight: no search needed
    run(world, 200, () => idle(world, unit));
    expect(distanceTo(world, unit, 2.5, 4.5)).toBeLessThan(0.07);
    run(world, 60);
    expect(distanceTo(world, unit, 2.5, 4.5)).toBeLessThan(0.07);
    expect(world.activeSearch).toBeNull();
  });
});

describe('a group', () => {
  it('forms up at its destination without anyone overlapping', () => {
    const world = flatWorld(40);
    const units = block(world, 0, 5, 5, 6, 5);
    move(world, 0, units, 28.5, 22.5);
    run(world, 1200, () => allIdle(world, units));
    expect(allIdle(world, units)).toBe(true);
    run(world, 60); // let any last shuffling finish
    for (const id of units) expect(distanceTo(world, id, 28.5, 22.5)).toBeLessThan(3);
    // Radii sum to half a tile; a hair of overlap is tolerated.
    expect(toFloat(smallestGap(world))).toBeGreaterThan(-0.02);
    expect(world.groups.size).toBe(0);
  });

  it('ends up facing the way it was sent', () => {
    const world = flatWorld(40);
    const units = block(world, 0, 20, 30, 4, 3);
    move(world, 0, units, 20.9, 8.5);
    run(world, 1200, () => allIdle(world, units));
    for (const id of units) {
      expect(toFloat(world.dirY[entityIndex(id)]!)).toBeLessThan(-0.99);
    }
  });

  it('gets everyone through a gap one tile wide', () => {
    const wall = '..........#..........';
    const gap = '.....................';
    const world = worldFrom([wall, wall, wall, wall, gap, wall, wall, wall, wall]);
    const units = block(world, 0, 2, 3, 4, 4);
    move(world, 0, units, 16.5, 4.5);
    run(world, 2500, () => allIdle(world, units));
    expect(allIdle(world, units)).toBe(true);
    for (const id of units) {
      expect(xOf(world, id), 'every unit is past the wall').toBeGreaterThan(11);
      expect(distanceTo(world, id, 16.5, 4.5)).toBeLessThan(3.5);
    }
    run(world, 60);
    expect(toFloat(smallestGap(world))).toBeGreaterThan(-0.02);
  });

  it('crosses a river by the ford', () => {
    const world = worldFrom([
      '................',
      '................',
      '................',
      '~~~~~~~~~~~,,~~~',
      '~~~~~~~~~~~,,~~~',
      '................',
      '................',
      '................',
    ]);
    const units = block(world, 0, 1, 0.5, 4, 3);
    move(world, 0, units, 3.5, 6.5);
    let wet = 0;
    run(world, 2500, () => {
      for (const id of units) {
        const y = yOf(world, id);
        if (y > 3 && y < 5) {
          wet++;
          expect(xOf(world, id)).toBeGreaterThan(11);
          expect(xOf(world, id)).toBeLessThan(13);
        }
      }
      return allIdle(world, units);
    });
    expect(wet).toBeGreaterThan(0);
    for (const id of units) expect(yOf(world, id)).toBeGreaterThan(5);
  });

  it('shares one flow field rather than searching once per unit', () => {
    const world = worldFrom([
      '............',
      '.....#......',
      '.....#......',
      '.....#......',
      '.....#......',
      '............',
    ]);
    const units = block(world, 0, 1, 2, 3, 3);
    move(world, 0, units, 9.5, 2.5);
    step(world);
    expect(world.groups.size).toBe(1);
    const group = [...world.groups.values()][0]!;
    expect(group.refs).toBe(9);
    expect(group.field).not.toBeNull();
    for (const id of units) expect(world.moveState[entityIndex(id)]).toBe(MoveState.Field);
    run(world, 800, () => allIdle(world, units));
    for (const id of units) expect(xOf(world, id)).toBeGreaterThan(7);
    expect(world.groups.size).toBe(0);
  });

  it('follows queued waypoints together and tidies up after itself', () => {
    const world = flatWorld(30);
    const units = block(world, 0, 3, 3, 3, 2);
    move(world, 0, units, 20.5, 4.5);
    move(world, 0, units, 20.5, 20.5, true);
    move(world, 0, units, 5.5, 20.5, true);
    step(world);
    expect(world.groups.size).toBe(3);
    let furthestEast = 0;
    run(world, 3000, () => {
      for (const id of units) furthestEast = Math.max(furthestEast, xOf(world, id));
      return allIdle(world, units);
    });
    expect(furthestEast).toBeGreaterThan(19.5);
    for (const id of units) expect(distanceTo(world, id, 5.5, 20.5)).toBeLessThan(2);
    expect(world.groups.size).toBe(0);
  });

  it('sends each unit as near as it can get when some cannot reach the place', () => {
    const world = worldFrom([
      '......~~......',
      '......~~......',
      '......~~......',
      '......~~......',
    ]);
    const west = [place(world, 0, 1.5, 1.5), place(world, 0, 1.5, 2.5)];
    const east = [place(world, 0, 12.5, 1.5), place(world, 0, 12.5, 2.5)];
    move(world, 0, [...west, ...east], 10.5, 2.0);
    run(world, 600, () => allIdle(world, [...west, ...east]));
    for (const id of west) {
      expect(xOf(world, id)).toBeGreaterThan(4.5);
      expect(xOf(world, id)).toBeLessThan(6);
    }
    for (const id of east) expect(distanceTo(world, id, 10.5, 2.0)).toBeLessThan(1);
  });
});

describe('units getting in each other\'s way', () => {
  it('pass through a standing comrade, who then returns to their post', () => {
    const world = flatWorld(30);
    const sentry = place(world, 0, 15.0, 15.0);
    const column = block(world, 0, 14.0, 5, 4, 3);
    move(world, 0, column, 15.0, 25.5);
    let furthestPushed = 0;
    run(world, 1200, () => {
      furthestPushed = Math.max(furthestPushed, distanceTo(world, sentry, 15.0, 15.0));
      return allIdle(world, column);
    });
    expect(allIdle(world, column)).toBe(true);
    expect(furthestPushed, 'the column walked through the sentry').toBeGreaterThan(0.1);
    run(world, 90);
    expect(distanceTo(world, sentry, 15.0, 15.0)).toBeLessThan(0.05);
  });

  it('go round a standing unit of another player, who does not give way', () => {
    // Allies, so that this is about getting past and not about fighting.
    const world = flatWorld(30, { teams: [0, 0] });
    const enemy = place(world, 1, 15.0, 15.0);
    const unit = place(world, 0, 15.0, 8.0);
    move(world, 0, [unit], 15.0, 22.0);
    run(world, 600, () => idle(world, unit));
    expect(distanceTo(world, unit, 15.0, 22.0)).toBeLessThan(0.07);
    expect(distanceTo(world, enemy, 15.0, 15.0)).toBe(0);
  });

  it('two columns marching through each other both arrive', () => {
    const lane = '........................';
    const wall = '########################';
    const world = worldFrom([wall, lane, lane, lane, lane, wall]);
    const east = block(world, 0, 1, 1.4, 4, 5);
    const west = block(world, 1, 20.5, 1.4, 4, 5);
    move(world, 0, east, 21.5, 3.0);
    move(world, 1, west, 2.5, 3.0);
    run(world, 3500, () => allIdle(world, east) && allIdle(world, west));
    expect(allIdle(world, east) && allIdle(world, west)).toBe(true);
    for (const id of east) expect(xOf(world, id)).toBeGreaterThan(18);
    for (const id of west) expect(xOf(world, id)).toBeLessThan(6);
  });

  it('settle nearby when another group already holds the spot', () => {
    const world = flatWorld(30);
    const first = block(world, 0, 3, 3, 3, 3);
    const second = block(world, 0, 3, 24, 3, 3);
    move(world, 0, first, 15.5, 15.5);
    run(world, 900, () => allIdle(world, first));
    move(world, 0, second, 15.5, 15.5);
    run(world, 1200, () => allIdle(world, second));
    expect(allIdle(world, second)).toBe(true);
    run(world, 120);
    for (const id of [...first, ...second]) expect(distanceTo(world, id, 15.5, 15.5)).toBeLessThan(3.5);
    expect(toFloat(smallestGap(world))).toBeGreaterThan(-0.03);
    // And everyone has come to rest: nobody is still shuffling.
    const before = [...first, ...second].map((id) => [xOf(world, id), yOf(world, id)]);
    run(world, 60);
    [...first, ...second].forEach((id, i) => {
      expect(Math.hypot(xOf(world, id) - before[i]![0]!, yOf(world, id) - before[i]![1]!)).toBeLessThan(0.02);
    });
  });

  it('spawned on top of one another, spread out and stand still', () => {
    const world = flatWorld(20);
    const units = Array.from({ length: 12 }, () => place(world, 0, 10.0, 10.0));
    run(world, 300);
    expect(toFloat(smallestGap(world))).toBeGreaterThan(-0.02);
    const before = units.map((id) => [xOf(world, id), yOf(world, id)]);
    run(world, 60);
    units.forEach((id, i) => {
      expect(Math.hypot(xOf(world, id) - before[i]![0]!, yOf(world, id) - before[i]![1]!)).toBeLessThan(0.02);
    });
  });
});

describe('a large battle\'s worth of movement', () => {
  it('moves 400 units across a generated map and brings nearly all of them home', () => {
    const world = new World(
      defaultConfig({ seed: 5, mapWidth: 128, mapHeight: 128, map: { kind: 'generated' }, maxEntities: 1024 }),
    );
    const [a, b] = world.map.starts;
    send(world, 0, { kind: 'spawn', x: a!.x, y: a!.y, count: 200, unitType: 0 });
    send(world, 1, { kind: 'spawn', x: b!.x, y: b!.y, count: 200, unitType: 0 });
    run(world, 30);
    // Each army marches on the other's start, straight through the oncoming one.
    send(world, 0, { kind: 'move', units: world.livingEntities(0), x: b!.x, y: b!.y });
    send(world, 1, { kind: 'move', units: world.livingEntities(1), x: a!.x, y: a!.y });
    const everyone = world.livingEntities();
    run(world, 9000, () => allIdle(world, everyone));
    const home = (id: number): boolean => {
      const target = world.owner[entityIndex(id)] === 0 ? b! : a!;
      const slot = entityIndex(id);
      return toFloat(length(world.posX[slot]! - target.x, world.posY[slot]! - target.y)) < 14;
    };
    const arrived = everyone.filter(home).length;
    expect(arrived, 'units within 14 tiles of their destination').toBeGreaterThan(380);
    expect(allIdle(world, everyone)).toBe(true);
  }, 120_000);
});
