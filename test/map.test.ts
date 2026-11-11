import { describe, expect, it } from 'vitest';
import { fromFloat } from '../src/sim/units';
import { fromInt, fromRatio } from '../src/sim/fixed';
import { GameMap, Terrain } from '../src/sim/map';
import { buildMap } from '../src/sim/mapgen';

const ascii = (rows: string[]): GameMap =>
  buildMap(rows[0]!.length, rows.length, 1, { kind: 'ascii', rows });

describe('hand-drawn maps', () => {
  const map = ascii([
    '0.....#...',
    '......#...',
    '..TT..#...',
    '..TT......',
    '~~~~,,~~~~',
    '.........1',
  ]);

  it('reads terrain and starts', () => {
    expect(map.width).toBe(10);
    expect(map.height).toBe(6);
    expect(map.terrain[map.index(6, 0)]).toBe(Terrain.Rock);
    expect(map.terrain[map.index(2, 2)]).toBe(Terrain.Forest);
    expect(map.terrain[map.index(0, 4)]).toBe(Terrain.Water);
    expect(map.terrain[map.index(4, 4)]).toBe(Terrain.Shallows);
    expect(map.starts).toEqual([
      { x: fromFloat(0.5), y: fromFloat(0.5) },
      { x: fromFloat(9.5), y: fromFloat(5.5) },
    ]);
  });

  it('knows what can be walked on', () => {
    expect(map.isPassable(0, 0)).toBe(true);
    expect(map.isPassable(4, 4)).toBe(true); // the ford
    expect(map.isPassable(6, 1)).toBe(false);
    expect(map.isPassable(2, 2)).toBe(false);
    expect(map.isPassable(0, 4)).toBe(false);
    expect(map.isPassable(-1, 0)).toBe(false);
    expect(map.isPassable(10, 0)).toBe(false);
  });

  it('labels ground joined by a ford as one region', () => {
    const north = map.region[map.index(0, 0)];
    expect(north).toBeGreaterThan(0);
    expect(map.region[map.index(9, 5)]).toBe(north);
    expect(map.region[map.index(8, 0)]).toBe(north); // round the end of the rock wall
    expect(map.region[map.index(6, 0)]).toBe(0);
  });

  it('separates ground that cannot be reached', () => {
    const island = ascii(['....~...', '....~...', '....~...']);
    expect(island.region[island.index(0, 0)]).not.toBe(island.region[island.index(7, 0)]);
  });

  it('does not let anything squeeze between obstacles that touch at a corner', () => {
    const pinch = ascii(['..#', '.#.', '#..']);
    expect(pinch.canStep(1, 0, 1)).toBe(false); // south-east, between the two rocks
    expect(pinch.region[pinch.index(0, 0)]).not.toBe(pinch.region[pinch.index(2, 2)]);
  });

  it('traces lines of sight', () => {
    const at = (x: number, y: number) => [fromFloat(x), fromFloat(y)] as const;
    const see = (a: readonly [number, number], b: readonly [number, number]): boolean =>
      map.lineOfSight(a[0], a[1], b[0], b[1]);
    expect(see(at(0.5, 0.5), at(5.5, 0.5))).toBe(true);
    expect(see(at(0.5, 0.5), at(7.5, 0.5))).toBe(false); // through the rock wall
    expect(see(at(7.5, 0.5), at(0.5, 0.5))).toBe(false); // and the other way
    expect(see(at(0.5, 3.5), at(5.5, 3.5))).toBe(false); // through the wood
    expect(see(at(4.5, 3.5), at(4.5, 5.5))).toBe(true); // across the ford
    expect(see(at(2.5, 3.9), at(2.5, 5.5))).toBe(false); // from the wood
    expect(see(at(5.2, 0.2), at(5.2, 3.8))).toBe(true); // straight down a column
    expect(see(at(4.2, 1.2), at(4.2, 1.2))).toBe(true); // a point sees itself
  });

  it('agrees with a brute-force check on random lines', () => {
    // Sample each line densely and compare with the exact traversal. A line
    // the sampling finds blocked must be reported blocked.
    const big = buildMap(64, 64, 7, { kind: 'generated' });
    let state = 12345;
    const next = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    let clear = 0;
    let blocked = 0;
    for (let i = 0; i < 4000; i++) {
      const x0 = 0.1 + next() * 63.8;
      const y0 = 0.1 + next() * 63.8;
      const x1 = Math.min(63.9, Math.max(0.1, x0 + (next() - 0.5) * 20));
      const y1 = Math.min(63.9, Math.max(0.1, y0 + (next() - 0.5) * 20));
      let sampledBlocked = false;
      for (let s = 0; s <= 400; s++) {
        const x = x0 + ((x1 - x0) * s) / 400;
        const y = y0 + ((y1 - y0) * s) / 400;
        if (!big.isPassable(Math.floor(x), Math.floor(y))) sampledBlocked = true;
      }
      const result = big.lineOfSight(fromFloat(x0), fromFloat(y0), fromFloat(x1), fromFloat(y1));
      if (sampledBlocked) expect(result, `line ${i}`).toBe(false);
      if (result) clear++;
      else blocked++;
    }
    expect(clear).toBeGreaterThan(300);
    expect(blocked).toBeGreaterThan(300);
  });

  it('allows for a unit\'s width when checking a straight walk', () => {
    const lane = ascii(['......', '.####.', '......']);
    const r = fromRatio(1, 4);
    // Walking along the top lane close to the wall: the centre line is clear,
    // but hugging it this tightly is not.
    expect(lane.lineOfSight(fromFloat(0.5), fromFloat(0.95), fromFloat(5.5), fromFloat(0.95))).toBe(true);
    expect(lane.clearPath(fromFloat(0.5), fromFloat(0.95), fromFloat(5.5), fromFloat(0.95), r)).toBe(false);
    expect(lane.clearPath(fromFloat(0.5), fromFloat(0.5), fromFloat(5.5), fromFloat(0.5), r)).toBe(true);
  });

  it('finds the nearest open ground', () => {
    expect(map.nearestPassable(0, 0)).toBe(map.index(0, 0));
    expect(map.nearestPassable(6, 0)).toBe(map.index(5, 0));
    // From the middle of the wood, any of the tiles just outside it.
    const near = map.nearestPassable(2, 2);
    expect(map.passable[near]).toBe(1);
    const dx = (near % map.width) - 2;
    const dy = Math.floor(near / map.width) - 2;
    expect(dx * dx + dy * dy).toBeLessThanOrEqual(2);
    // Restricted to a region it is not in.
    const island = ascii(['....~...', '....~...', '....~...']);
    const east = island.region[island.index(7, 1)]!;
    expect(island.nearestPassable(0, 1, east)).toBe(island.index(5, 1));
    expect(ascii(['~~', '~~']).nearestPassable(0, 0)).toBe(-1);
  });

  it('rejects maps it cannot read', () => {
    expect(() => ascii(['..', '.'])).toThrow();
    expect(() => ascii(['.x'])).toThrow(/unknown map character/);
    expect(() => ascii(['1.'])).toThrow(/missing start 0/);
  });
});

describe('flat maps', () => {
  it('are open grass with eight start points on the map', () => {
    const map = buildMap(40, 30, 1, { kind: 'flat' });
    expect(map.passable.every((p) => p === 1)).toBe(true);
    expect(map.starts).toHaveLength(8);
    for (const start of map.starts) {
      expect(start.x).toBeGreaterThan(0);
      expect(start.x).toBeLessThan(fromInt(40));
      expect(start.y).toBeGreaterThan(0);
      expect(start.y).toBeLessThan(fromInt(30));
    }
  });
});

describe('generated maps', () => {
  const sizes: [number, number][] = [
    [48, 48],
    [64, 64],
    [96, 64],
    [128, 128],
  ];

  it('are the same every time for the same seed', () => {
    const a = buildMap(96, 96, 42, { kind: 'generated' });
    const b = buildMap(96, 96, 42, { kind: 'generated' });
    expect(b.checksum).toBe(a.checksum);
    expect(Array.from(b.terrain)).toEqual(Array.from(a.terrain));
    expect(buildMap(96, 96, 43, { kind: 'generated' }).checksum).not.toBe(a.checksum);
  });

  it('match a recorded map, so a change to the generator is noticed', () => {
    // The lie of the land, then what stands on it.
    const map = buildMap(64, 64, 20261111, { kind: 'generated' });
    expect(`${map.checksum.toString(16)} ${(map.stateHash >>> 0).toString(16)}`).toBe('93db42d2 fe982e0e');
  });

  it('are fair: identical under a half turn, in terrain and in height', () => {
    for (const [width, height] of sizes) {
      for (let seed = 1; seed <= 12; seed++) {
        const map = buildMap(width, height, seed, { kind: 'generated' });
        for (let tile = 0; tile < map.tileCount; tile++) {
          if (map.terrain[tile] !== map.terrain[map.tileCount - 1 - tile]) {
            throw new Error(`terrain differs at tile ${tile}, ${width}x${height} seed ${seed}`);
          }
        }
        const corners = map.elevation.length;
        for (let c = 0; c < corners; c++) {
          if (map.elevation[c] !== map.elevation[corners - 1 - c]) {
            throw new Error(`height differs at corner ${c}, ${width}x${height} seed ${seed}`);
          }
        }
        const [a, b] = map.starts;
        expect(a!.x + b!.x).toBe(fromInt(width));
        expect(a!.y + b!.y).toBe(fromInt(height));
      }
    }
  });

  it('always let the two players reach each other', () => {
    for (const [width, height] of sizes) {
      for (let seed = 1; seed <= 40; seed++) {
        const map = buildMap(width, height, seed, { kind: 'generated' });
        const [a, b] = map.starts;
        const regionA = map.region[map.tileAt(a!.x, a!.y)];
        expect(regionA, `${width}x${height} seed ${seed}`).toBeGreaterThan(0);
        expect(map.region[map.tileAt(b!.x, b!.y)], `${width}x${height} seed ${seed}`).toBe(regionA);
      }
    }
  });

  it('have a river with fords, forest, rock and open starts', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const map = buildMap(128, 128, seed, { kind: 'generated' });
      const share = (id: number): number =>
        map.terrain.reduce((n, t) => n + (t === id ? 1 : 0), 0) / map.tileCount;
      expect(share(Terrain.Water)).toBeGreaterThan(0.015);
      expect(share(Terrain.Shallows)).toBeGreaterThan(0.002);
      expect(share(Terrain.Forest)).toBeGreaterThan(0.12);
      // A fifth of the map is sown with forest; cut-off clearings then fill in with more.
      expect(share(Terrain.Forest)).toBeLessThan(0.3);
      expect(share(Terrain.Rock)).toBeGreaterThan(0.01);
      expect(share(Terrain.Rock)).toBeLessThan(0.035);
      // Open, level ground around each start.
      for (const start of map.starts) {
        const tx = start.x >> 16;
        const ty = start.y >> 16;
        for (let oy = -5; oy <= 5; oy++) {
          for (let ox = -5; ox <= 5; ox++) {
            expect(map.terrain[map.index(tx + ox, ty + oy)]).toBe(Terrain.Grass);
            expect(map.elevation[(ty + oy) * (map.width + 1) + tx + ox]).toBe(0);
          }
        }
      }
      // Water lies below the ground around it; the highest hills stay modest.
      const highest = map.elevation.reduce((m, h) => Math.max(m, h), 0);
      expect(highest).toBeGreaterThan(fromInt(1));
      expect(highest).toBeLessThan(fromInt(6));
    }
  });

  it('leave no ground that cannot be walked to', () => {
    for (const [width, height] of sizes) {
      for (let seed = 1; seed <= 20; seed++) {
        const map = buildMap(width, height, seed, { kind: 'generated' });
        const regions = new Set(Array.from(map.region).filter((r) => r !== 0));
        expect(regions.size, `${width}x${height} seed ${seed}`).toBe(1);
      }
    }
  });

  it('give both starts the same resources within a short walk', () => {
    for (const [width, height] of sizes) {
      for (let seed = 1; seed <= 25; seed++) {
        const map = buildMap(width, height, seed, { kind: 'generated' });
        const home = map.region[map.tileAt(map.starts[0]!.x, map.starts[0]!.y)]!;
        const counts = map.starts.map((start) => {
          const near = [0, 0, 0, 0, 0, 0, 0, 0];
          const sx = start.x >> 16;
          const sy = start.y >> 16;
          for (let ty = sy - 13; ty <= sy + 13; ty++) {
            for (let tx = sx - 13; tx <= sx + 13; tx++) {
              if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
              near[map.terrain[map.index(tx, ty)]!]!++;
            }
          }
          return near;
        });
        const label = `${width}x${height} seed ${seed}`;
        expect(counts[0]![Terrain.Berries], label).toBeGreaterThanOrEqual(6);
        expect(counts[0]![Terrain.Gold], label).toBeGreaterThanOrEqual(6);
        expect(counts[0]![Terrain.Stone], label).toBeGreaterThanOrEqual(4);
        expect(counts[0]![Terrain.Forest], label).toBeGreaterThanOrEqual(15);
        expect(counts[1], label).toEqual(counts[0]);
        // Every berry, stone and gold tile can be stood beside and worked.
        for (let tile = 0; tile < map.tileCount; tile++) {
          const terrain = map.terrain[tile]!;
          if (terrain === Terrain.Berries || terrain === Terrain.Stone || terrain === Terrain.Gold) {
            expect(map.canBeWorkedFrom(tile, home), `${label} tile ${tile}`).toBe(true);
            expect(map.amount[tile]).toBeGreaterThan(0);
          }
        }
        // The town centre's ground and the ring round it stay clear.
        const sx = map.starts[0]!.x >> 16;
        const sy = map.starts[0]!.y >> 16;
        for (let oy = -4; oy <= 4; oy++) {
          for (let ox = -4; ox <= 4; ox++) expect(map.terrain[map.index(sx + ox, sy + oy)], label).toBe(Terrain.Grass);
        }
      }
    }
  });

  it('put more gold and stone out in contested ground', () => {
    const map = buildMap(128, 128, 3, { kind: 'generated' });
    const far = (tile: number): boolean =>
      map.starts.every((start) => {
        const dx = (tile % map.width) - (start.x >> 16);
        const dy = Math.floor(tile / map.width) - (start.y >> 16);
        return dx * dx + dy * dy >= 15 * 15;
      });
    let gold = 0;
    let stone = 0;
    for (let tile = 0; tile < map.tileCount; tile++) {
      if (!far(tile)) continue;
      if (map.terrain[tile] === Terrain.Gold) gold++;
      if (map.terrain[tile] === Terrain.Stone) stone++;
    }
    expect(gold).toBe(36);
    expect(stone).toBe(24);
  });

  it('keep count of what each tile holds', () => {
    const map = ascii(['.Tbsg#~,']);
    expect(Array.from(map.amount)).toEqual([0, 100, 250, 500, 700, 0, 0, 0]);
    const before = map.stateHash;
    expect(map.harvest(1)).toBe(false);
    expect(map.amount[1]).toBe(99);
    expect(map.stateHash).not.toBe(before);
    expect(map.harvest(0)).toBe(false); // nothing to take from grass
    expect(map.amount[0]).toBe(0);
  });

  it('refuse sizes too small to hold a river and two bases', () => {
    expect(() => buildMap(32, 32, 1, { kind: 'generated' })).toThrow(RangeError);
  });
});
