import { describe, expect, it } from 'vitest';
import { DIR_X, DIR_Y, STEP_DIAGONAL, STEP_ORTHOGONAL, type GameMap } from '../src/sim/map';
import { buildMap } from '../src/sim/mapgen';
import { Rng } from '../src/sim/rng';
import { AStarSearch, FIELD_GOAL, FIELD_UNKNOWN, FieldSearch, SearchScratch } from '../src/sim/search';

const ascii = (rows: string[]): GameMap =>
  buildMap(rows[0]!.length, rows.length, 1, { kind: 'ascii', rows });

/** A map with rock scattered over about a third of it. */
function randomMap(rng: Rng, size: number): GameMap {
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) row += rng.chance(3, 10) ? '#' : '.';
    rows.push(row);
  }
  return ascii(rows);
}

/**
 * Cheapest cost from every tile to the goal, worked out the slow, obvious
 * way: keep improving every tile from its neighbours until nothing changes.
 */
function referenceCosts(map: GameMap, goal: number): Float64Array {
  const cost = new Float64Array(map.tileCount).fill(Infinity);
  cost[goal] = 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (let tile = 0; tile < map.tileCount; tile++) {
      if (cost[tile] === Infinity) continue;
      const tx = tile % map.width;
      const ty = Math.floor(tile / map.width);
      for (let dir = 0; dir < 8; dir++) {
        if (!map.canStep(tx, ty, dir)) continue;
        const next = (ty + DIR_Y[dir]!) * map.width + tx + DIR_X[dir]!;
        const through = cost[tile]! + (dir % 2 === 0 ? STEP_ORTHOGONAL : STEP_DIAGONAL);
        if (through < cost[next]!) {
          cost[next] = through;
          changed = true;
        }
      }
    }
  }
  return cost;
}

/** Checks a tile path is made of legal steps and returns what it costs. */
function pathCost(map: GameMap, tiles: readonly number[]): number {
  let total = 0;
  for (let i = 1; i < tiles.length; i++) {
    const from = tiles[i - 1]!;
    const to = tiles[i]!;
    const dx = (to % map.width) - (from % map.width);
    const dy = Math.floor(to / map.width) - Math.floor(from / map.width);
    const dir = DIR_X.findIndex((x, d) => x === dx && DIR_Y[d] === dy);
    if (dir === -1) throw new Error(`step ${i} is not to a neighbouring tile`);
    if (!map.canStep(from % map.width, Math.floor(from / map.width), dir)) {
      throw new Error(`step ${i} is not allowed`);
    }
    total += dir % 2 === 0 ? STEP_ORTHOGONAL : STEP_DIAGONAL;
  }
  return total;
}

function runToEnd(search: { done: boolean; run(budget: number): number }, slice = 1 << 30): void {
  while (!search.done) search.run(slice);
}

describe('A* path search', () => {
  it('finds the cheapest route, checked against a brute-force reference', () => {
    const rng = new Rng(11);
    let checked = 0;
    for (let m = 0; m < 25; m++) {
      const map = randomMap(rng, 22);
      const scratch = new SearchScratch(map.tileCount);
      for (let trial = 0; trial < 12; trial++) {
        const start = rng.nextInt(map.tileCount);
        const goal = rng.nextInt(map.tileCount);
        if (map.passable[start] === 0 || map.passable[goal] === 0) continue;
        const reference = referenceCosts(map, goal)[start]!;
        const search = new AStarSearch(map, scratch, start, goal);
        runToEnd(search);
        if (reference === Infinity) {
          expect(search.found).toBe(false);
          expect(map.region[start]).not.toBe(map.region[goal]);
          continue;
        }
        expect(search.found).toBe(true);
        const tiles = search.path();
        expect(tiles[0]).toBe(start);
        expect(tiles[tiles.length - 1]).toBe(goal);
        expect(pathCost(map, tiles), `map ${m}, ${start} to ${goal}`).toBe(reference);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('goes straight across open ground', () => {
    const map = buildMap(40, 40, 1, { kind: 'flat' });
    const search = new AStarSearch(map, new SearchScratch(map.tileCount), map.index(3, 5), map.index(30, 20));
    runToEnd(search);
    // 27 across and 15 down: 15 diagonal steps and 12 straight ones.
    expect(search.path()).toHaveLength(28);
    // With nothing in the way it should barely look beyond the route itself.
    expect(search.expansions).toBeLessThan(60);
  });

  it('gives the same answer whether run in one go or a few tiles at a time', () => {
    const rng = new Rng(21);
    for (let m = 0; m < 10; m++) {
      const map = randomMap(rng, 30);
      const start = map.nearestPassable(2, 2);
      const goal = map.nearestPassable(27, 27, map.region[start]!);
      if (goal === -1) continue;
      const whole = new AStarSearch(map, new SearchScratch(map.tileCount), start, goal);
      runToEnd(whole);
      const sliced = new AStarSearch(map, new SearchScratch(map.tileCount), start, goal);
      let slices = 0;
      while (!sliced.done) {
        expect(sliced.run(5)).toBeLessThanOrEqual(5);
        slices++;
      }
      expect(sliced.path()).toEqual(whole.path());
      expect(sliced.expansions).toBe(whole.expansions);
      if (whole.expansions > 5) expect(slices).toBeGreaterThan(1);
    }
  });

  it('can be re-run to an exact point, as loading a saved game does', () => {
    const map = randomMap(new Rng(31), 30);
    const start = map.nearestPassable(1, 1);
    const goal = map.nearestPassable(28, 28, map.region[start]!);
    const a = new AStarSearch(map, new SearchScratch(map.tileCount), start, goal);
    a.run(17);
    const b = new AStarSearch(map, new SearchScratch(map.tileCount), start, goal);
    expect(b.run(a.expansions)).toBe(a.expansions);
    runToEnd(a, 3);
    runToEnd(b, 1000);
    expect(b.path()).toEqual(a.path());
  });
});

describe('flow field search', () => {
  it('points every tile it reaches along a cheapest route to the goal', () => {
    const rng = new Rng(41);
    for (let m = 0; m < 12; m++) {
      const map = randomMap(rng, 22);
      const goal = map.nearestPassable(11, 11);
      const search = new FieldSearch(map, new SearchScratch(map.tileCount), goal, []);
      runToEnd(search);
      const reference = referenceCosts(map, goal);
      const field = search.directions;
      expect(field[goal]).toBe(FIELD_GOAL);
      for (let tile = 0; tile < map.tileCount; tile++) {
        if (reference[tile] === Infinity) {
          expect(field[tile]).toBe(FIELD_UNKNOWN);
          continue;
        }
        // Walk the field from here and add up the steps.
        const walked = [tile];
        for (let at = tile; at !== goal; ) {
          const dir = field[at]!;
          expect(dir).toBeLessThan(8);
          at += DIR_Y[dir]! * map.width + DIR_X[dir]!;
          walked.push(at);
          if (walked.length > map.tileCount) throw new Error('the field loops');
        }
        expect(pathCost(map, walked), `map ${m}, tile ${tile}`).toBe(reference[tile]);
      }
    }
  });

  it('stops soon after covering the tiles it was asked for', () => {
    const map = buildMap(120, 120, 1, { kind: 'flat' });
    const goal = map.index(60, 60);
    const targets = [map.index(55, 58), map.index(52, 61), map.index(57, 66)];
    const near = new FieldSearch(map, new SearchScratch(map.tileCount), goal, targets);
    runToEnd(near);
    for (const tile of targets) expect(near.directions[tile]).toBeLessThan(8);
    // A good margin around the group is covered too, so a unit jostled off
    // course still finds the field under its feet.
    expect(near.directions[map.index(45, 60)]).toBeLessThan(8);
    expect(near.directions[map.index(5, 5)]).toBe(FIELD_UNKNOWN);
    expect(near.expansions).toBeLessThan(2500);

    const everything = new FieldSearch(map, new SearchScratch(map.tileCount), goal, []);
    runToEnd(everything);
    expect(everything.expansions).toBe(map.tileCount);
  });

  it('gives the same field whether run in one go or a few tiles at a time', () => {
    const map = randomMap(new Rng(51), 40);
    const goal = map.nearestPassable(20, 20);
    const targets = [map.nearestPassable(3, 3, map.region[goal]!), map.nearestPassable(36, 30, map.region[goal]!)];
    const whole = new FieldSearch(map, new SearchScratch(map.tileCount), goal, targets);
    runToEnd(whole);
    const sliced = new FieldSearch(map, new SearchScratch(map.tileCount), goal, targets);
    runToEnd(sliced, 7);
    expect(Array.from(sliced.directions)).toEqual(Array.from(whole.directions));
    expect(sliced.expansions).toBe(whole.expansions);
  });

  it('routes through a ford rather than through the river', () => {
    const map = ascii([
      '........',
      '........',
      '~~~~~,~~',
      '~~~~~,~~',
      '........',
      '........',
    ]);
    const goal = map.index(1, 5);
    const search = new FieldSearch(map, new SearchScratch(map.tileCount), goal, []);
    runToEnd(search);
    // From the far bank, the walk must pass over the ford at x = 5.
    const visited = new Set<number>();
    for (let at = map.index(1, 0); at !== goal; ) {
      visited.add(at);
      const dir = search.directions[at]!;
      at += DIR_Y[dir]! * map.width + DIR_X[dir]!;
    }
    expect(visited.has(map.index(5, 2))).toBe(true);
    expect(visited.has(map.index(5, 3))).toBe(true);
  });
});
