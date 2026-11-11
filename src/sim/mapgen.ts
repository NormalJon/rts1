/**
 * Builds the map for a match from its settings.
 *
 * Generated maps are symmetric under a half turn about the centre: whatever
 * player 1 finds going out from their start, player 2 finds too. A river runs
 * between the two starts and can be crossed at three fords. Each start has
 * berries, a copse, gold and stone within a short walk, and more gold and stone
 * lie further out to be fought over. Everything is integer arithmetic, so the
 * same seed gives the same map on every machine.
 */

import { fromRatio, HALF, idiv, length, mul, mulDiv, ONE, type Fixed } from './fixed';
import { GameMap, Terrain, type StartPosition } from './map';

export type MapSpec =
  /** Open grass. For tests and debug pages. */
  | { readonly kind: 'flat' }
  /**
   * Drawn by hand, one string per row: . grass, T forest, ~ water, , shallows,
   * # rock, b berries, s stone, g gold, and digits 0 to 7 for player starts.
   */
  | { readonly kind: 'ascii'; readonly rows: readonly string[] }
  | { readonly kind: 'generated' };

export const MIN_GENERATED_SIZE = 48;

export function buildMap(width: number, height: number, seed: number, spec: MapSpec): GameMap {
  switch (spec.kind) {
    case 'flat':
      return new GameMap(
        width,
        height,
        new Uint8Array(width * height),
        new Int32Array((width + 1) * (height + 1)),
        ringStarts(width, height),
      );
    case 'ascii':
      return fromAscii(width, height, spec.rows);
    case 'generated':
      return generate(width, height, seed);
  }
}

function tileCentre(tx: number, ty: number): StartPosition {
  return { x: tx * ONE + HALF, y: ty * ONE + HALF };
}

/** Eight start points around the map, each opposite the one before it. */
function ringStarts(width: number, height: number): StartPosition[] {
  const offsets = [
    [-3, -3],
    [3, 3],
    [3, -3],
    [-3, 3],
    [0, -3],
    [0, 3],
    [-3, 0],
    [3, 0],
  ];
  return offsets.map(([ox, oy]) =>
    tileCentre(
      Math.min(width - 1, idiv(width * (5 + ox!), 10)),
      Math.min(height - 1, idiv(height * (5 + oy!), 10)),
    ),
  );
}

function fromAscii(width: number, height: number, rows: readonly string[]): GameMap {
  if (rows.length !== height || rows.some((row) => row.length !== width)) {
    throw new Error(`ascii map must be ${width} by ${height} to match mapWidth and mapHeight`);
  }
  const terrain = new Uint8Array(width * height);
  const starts: StartPosition[] = [];
  const legend: Record<string, number> = {
    '.': Terrain.Grass,
    T: Terrain.Forest,
    '~': Terrain.Water,
    ',': Terrain.Shallows,
    '#': Terrain.Rock,
    b: Terrain.Berries,
    s: Terrain.Stone,
    g: Terrain.Gold,
  };
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const ch = rows[ty]![tx]!;
      if (ch >= '0' && ch <= '7') {
        starts[ch.charCodeAt(0) - 48] = tileCentre(tx, ty);
        continue;
      }
      const id = legend[ch];
      if (id === undefined) throw new Error(`unknown map character "${ch}" at ${tx},${ty}`);
      terrain[ty * width + tx] = id;
    }
  }
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] === undefined) throw new Error(`ascii map is missing start ${i}`);
  }
  return new GameMap(width, height, terrain, new Int32Array((width + 1) * (height + 1)), starts);
}

// ---- Noise -----------------------------------------------------------------

function hash2(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Smoothly varying value in [0, 1) at a fixed-point lattice coordinate. */
function valueNoise(seed: number, x: Fixed, y: Fixed): Fixed {
  const xi = x >> 16;
  const yi = y >> 16;
  const fx = x & 0xffff;
  const fy = y & 0xffff;
  // Smoothstep, 3t^2 - 2t^3, so the lattice does not show as creases.
  const sx = mul(mul(fx, fx), 3 * ONE - 2 * fx);
  const sy = mul(mul(fy, fy), 3 * ONE - 2 * fy);
  const a = hash2(seed, xi, yi) >>> 16;
  const b = hash2(seed, xi + 1, yi) >>> 16;
  const c = hash2(seed, xi, yi + 1) >>> 16;
  const d = hash2(seed, xi + 1, yi + 1) >>> 16;
  const top = a + mul(b - a, sx);
  const bottom = c + mul(d - c, sx);
  return top + mul(bottom - top, sy);
}

// ---- Generator -------------------------------------------------------------

const START_CLEARING = 10; // tiles of open ground around each start
const FORD_CLEARING = 5;
const FOREST_SHARE = 20; // percent of tiles
const ROCK_SHARE = 3;
/** Nothing is placed this close to a start: the town centre and the ground round it. */
const TOWN_RESERVE = 4;
/** How far from any start the contested deposits lie, at least. */
const NEUTRAL_DISTANCE = 16;

type Cells = readonly (readonly [number, number])[];
const BLOCK_3X2: Cells = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [2, 1],
];
const BLOCK_2X2: Cells = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];
/** A rough disc about five tiles across. */
const COPSE: Cells = (() => {
  const cells: [number, number][] = [];
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) if (x * x + y * y <= 6) cells.push([x, y]);
  }
  return cells;
})();
/** What every start gets, and how many tiles away. */
const STARTING_RESOURCES: readonly (readonly [number, Cells, number])[] = [
  [Terrain.Berries, BLOCK_3X2, 6],
  [Terrain.Forest, COPSE, 8],
  [Terrain.Gold, BLOCK_3X2, 8],
  [Terrain.Stone, BLOCK_2X2, 9],
];
/** Sixteen compass directions, in 1024ths. */
const COMPASS: Cells = [
  [1024, 0],
  [946, 392],
  [724, 724],
  [392, 946],
  [0, 1024],
  [-392, 946],
  [-724, 724],
  [-946, 392],
  [-1024, 0],
  [-946, -392],
  [-724, -724],
  [-392, -946],
  [0, -1024],
  [392, -946],
  [724, -724],
  [946, -392],
];

function generate(width: number, height: number, seed: number): GameMap {
  if (width < MIN_GENERATED_SIZE || height < MIN_GENERATED_SIZE) {
    throw new RangeError(`generated maps must be at least ${MIN_GENERATED_SIZE} tiles each way`);
  }
  const tileCount = width * height;
  const terrain = new Uint8Array(tileCount);
  const mirror = (tile: number): number => tileCount - 1 - tile;
  const setBoth = (tx: number, ty: number, id: number): void => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return;
    const tile = ty * width + tx;
    terrain[tile] = id;
    terrain[mirror(tile)] = id;
  };
  /** Sets every tile whose centre lies within radius of (px, py), and its mirror. */
  const stamp = (px: Fixed, py: Fixed, radius: Fixed, id: number, only = -1): void => {
    const reach = (radius >> 16) + 1;
    const cx = px >> 16;
    const cy = py >> 16;
    for (let ty = cy - reach; ty <= cy + reach; ty++) {
      for (let tx = cx - reach; tx <= cx + reach; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const dx = tx * ONE + HALF - px;
        const dy = ty * ONE + HALF - py;
        if (dx * dx + dy * dy > radius * radius) continue;
        if (only !== -1 && terrain[ty * width + tx] !== only) continue;
        setBoth(tx, ty, id);
      }
    }
  };

  const startTiles = [
    [idiv(width, 5), idiv(height, 5)],
    [width - 1 - idiv(width, 5), height - 1 - idiv(height, 5)],
  ];
  const starts = startTiles.map(([tx, ty]) => tileCentre(tx!, ty!));

  // The river runs corner to corner across the line between the starts,
  // through the centre. It is traced outward from the centre in one direction
  // and mirrored, so both halves match exactly.
  const centreX = idiv(width * ONE, 2);
  const centreY = idiv(height * ONE, 2);
  const diagonal = length(width * ONE, height * ONE);
  const alongX = mulDiv(width * ONE, ONE, diagonal);
  const alongY = -mulDiv(height * ONE, ONE, diagonal);
  const acrossX = mulDiv(height * ONE, ONE, diagonal);
  const acrossY = mulDiv(width * ONE, ONE, diagonal);
  const halfLength = diagonal >> 1;
  const swing = idiv(Math.min(width, height) * ONE, 9);
  const riverSeed = seed ^ 0x51ed270b;
  const riverPoint = (s: Fixed): { x: Fixed; y: Fixed; halfWidth: Fixed } => {
    // The bends grow from nothing at the centre, keeping the middle ford put.
    const ease = Math.min(ONE, idiv(s, 12));
    const bend = mul(mul(valueNoise(riverSeed, idiv(s, 14), 0) - HALF, 2 * ONE), mul(swing, ease));
    return {
      x: centreX + mul(alongX, s) + mul(acrossX, bend),
      y: centreY + mul(alongY, s) + mul(acrossY, bend),
      halfWidth: fromRatio(3, 2) + valueNoise(riverSeed + 1, idiv(s, 9), 0),
    };
  };
  for (let s = 0; s <= halfLength + 3 * ONE; s += HALF) {
    const p = riverPoint(s);
    stamp(p.x, p.y, p.halfWidth, Terrain.Water);
  }
  const fordAt = [0, mul(halfLength, fromRatio(1, 2))];
  const fordCentres: { x: Fixed; y: Fixed }[] = [];
  for (const centre of fordAt) {
    for (let s = Math.max(0, centre - 3 * ONE); s <= centre + 3 * ONE; s += HALF) {
      const p = riverPoint(s);
      stamp(p.x, p.y, p.halfWidth + ONE, Terrain.Shallows, Terrain.Water);
    }
    const p = riverPoint(centre);
    fordCentres.push(p, { x: width * ONE - p.x, y: height * ONE - p.y });
  }

  // Forest and rock come from noise fields, each averaged with its own mirror
  // image. The thresholds are taken from the values themselves, so the share
  // of the map each covers is the same on every seed.
  const symmetric = (noiseSeed: number, tx: number, ty: number, scale: number): Fixed =>
    (valueNoise(noiseSeed, idiv(tx * ONE, scale), idiv(ty * ONE, scale)) +
      valueNoise(noiseSeed, idiv((width - 1 - tx) * ONE, scale), idiv((height - 1 - ty) * ONE, scale))) >>
    1;
  const forestValue = new Int32Array(tileCount);
  const rockValue = new Int32Array(tileCount);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const tile = ty * width + tx;
      forestValue[tile] =
        symmetric(seed ^ 0x3c6ef372, tx, ty, 9) + (symmetric(seed ^ 0x1b873593, tx, ty, 4) >> 1);
      rockValue[tile] = symmetric(seed ^ 0x7f4a7c15, tx, ty, 6);
    }
  }
  const threshold = (values: Int32Array, sharePercent: number): number => {
    const sorted = Int32Array.from(values).sort((a, b) => a - b);
    return sorted[Math.min(tileCount - 1, idiv(tileCount * (100 - sharePercent), 100))]!;
  };
  const forestFrom = threshold(forestValue, FOREST_SHARE);
  const rockFrom = threshold(rockValue, ROCK_SHARE);
  const near = (tx: number, ty: number, points: readonly { x: Fixed; y: Fixed }[], tiles: number): boolean => {
    const limit = tiles * ONE;
    for (const p of points) {
      const dx = tx * ONE + HALF - p.x;
      const dy = ty * ONE + HALF - p.y;
      if (dx * dx + dy * dy < limit * limit) return true;
    }
    return false;
  };
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const tile = ty * width + tx;
      if (terrain[tile] !== Terrain.Grass) continue;
      if (near(tx, ty, starts, START_CLEARING) || near(tx, ty, fordCentres, FORD_CLEARING)) continue;
      if (rockValue[tile]! > rockFrom) terrain[tile] = Terrain.Rock;
      else if (forestValue[tile]! > forestFrom) terrain[tile] = Terrain.Forest;
    }
  }

  // Resources. A cluster goes down only on open grass with open grass all
  // round it, so there is always somewhere to stand and work it.
  const openGrass = (tx: number, ty: number): boolean => {
    if (tx < 1 || ty < 1 || tx >= width - 1 || ty >= height - 1) return false;
    if (terrain[ty * width + tx] !== Terrain.Grass) return false;
    for (const [sx, sy] of startTiles) {
      const dx = tx < sx! ? sx! - tx : tx - sx!;
      const dy = ty < sy! ? sy! - ty : ty - sy!;
      if (dx <= TOWN_RESERVE && dy <= TOWN_RESERVE) return false;
    }
    return true;
  };
  const placeCluster = (
    cells: Cells,
    ox: number,
    oy: number,
    id: number,
    alsoNeeds?: (tx: number, ty: number) => boolean,
  ): boolean => {
    for (const [cx, cy] of cells) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = ox + cx + dx;
          const ty = oy + cy + dy;
          if (!openGrass(tx, ty) || (alsoNeeds !== undefined && !alsoNeeds(tx, ty))) return false;
        }
      }
    }
    for (const [cx, cy] of cells) setBoth(ox + cx, oy + cy, id);
    return true;
  };
  // Round the first start; the mirror image lands round the second.
  const [homeX, homeY] = startTiles[0]!;
  STARTING_RESOURCES.forEach(([id, cells, distance], i) => {
    const first = hash2(seed ^ 0x6b43a9b5, i, 0) & 15;
    for (let turn = 0; turn < 16; turn++) {
      const [ux, uy] = COMPASS[(first + turn) & 15]!;
      const ox = homeX! + idiv(ux * distance + 512, 1024) - (cells === COPSE ? 0 : 1);
      const oy = homeY! + idiv(uy * distance + 512, 1024);
      if (placeCluster(cells, ox, oy, id)) return;
    }
  });
  // The straight line between the starts passes through the middle ford. If
  // forest or rock has cut the starts off from each other, open that line.
  const elevation = new Int32Array((width + 1) * (height + 1));
  let map = new GameMap(width, height, terrain, elevation, starts);
  const regionOf = (m: GameMap, start: StartPosition): number => m.region[m.tileAt(start.x, start.y)]!;
  if (regionOf(map, starts[0]!) !== regionOf(map, starts[1]!)) {
    const steps = Math.max(width, height) * 2;
    for (let i = 0; i <= steps; i++) {
      const x = starts[0]!.x + mulDiv(starts[1]!.x - starts[0]!.x, i, steps);
      const y = starts[0]!.y + mulDiv(starts[1]!.y - starts[0]!.y, i, steps);
      stamp(x, y, fromRatio(3, 2), Terrain.Grass, Terrain.Forest);
      stamp(x, y, fromRatio(3, 2), Terrain.Grass, Terrain.Rock);
    }
    map = new GameMap(width, height, terrain, elevation, starts);
    if (regionOf(map, starts[0]!) !== regionOf(map, starts[1]!)) {
      throw new Error(`map seed ${seed} could not connect the two starts`);
    }
  }

  // Further out, deposits neither player starts with. They go only where
  // both players can already walk, not in some clearing sealed off by trees.
  {
    const reachable = regionOf(map, starts[0]!);
    const walkable = (tx: number, ty: number): boolean => map.region[ty * width + tx] === reachable;
    const neutral = idiv(Math.min(width, height), 40);
    for (const [id, cells, salt] of [
      [Terrain.Gold, BLOCK_3X2, 0x3f84d5b5],
      [Terrain.Stone, BLOCK_2X2, 0x5a827999],
    ] as const) {
      let placed = 0;
      for (let attempt = 0; attempt < 120 && placed < neutral; attempt++) {
        const ox = hash2(seed ^ salt, attempt, 1) % width;
        const oy = hash2(seed ^ salt, attempt, 2) % height;
        const farFromStarts = startTiles.every(([sx, sy]) => {
          const dx = ox - sx!;
          const dy = oy - sy!;
          return dx * dx + dy * dy >= NEUTRAL_DISTANCE * NEUTRAL_DISTANCE;
        });
        // Kept off the very middle, where a cluster would run into its own mirror image.
        const dx = ox * 2 - width;
        const dy = oy * 2 - height;
        if (!farFromStarts || dx * dx + dy * dy < 16 * 16) continue;
        if (placeCluster(cells, ox, oy, id, walkable)) placed++;
      }
    }
    map = new GameMap(width, height, terrain, elevation, starts);
  }

  // Ground nobody can walk to is only confusing: a clearing ringed by trees
  // becomes more trees, a cut-off stretch of ford becomes river.
  const home = regionOf(map, starts[0]!);
  for (let tile = 0; tile < tileCount; tile++) {
    if (map.passable[tile] === 0 || map.region[tile] === home) continue;
    terrain[tile] = terrain[tile] === Terrain.Shallows ? Terrain.Water : Terrain.Forest;
  }
  map = new GameMap(width, height, terrain, elevation, starts);

  fillElevation(map, seed, starts);
  return new GameMap(width, height, terrain, elevation, starts);
}

/**
 * Rolling hills, flattened around the starts, sunk under water and raised
 * into outcrops under rock. Heights are symmetric like everything else.
 */
function fillElevation(map: GameMap, seed: number, starts: readonly StartPosition[]): void {
  const { width, height, terrain, elevation } = map;
  // How many tiles each tile is from water, up to 5.
  const FAR = 5;
  const fromWater = new Uint8Array(map.tileCount).fill(FAR);
  let frontier: number[] = [];
  for (let tile = 0; tile < map.tileCount; tile++) {
    if (terrain[tile] === Terrain.Water || terrain[tile] === Terrain.Shallows) {
      fromWater[tile] = 0;
      frontier.push(tile);
    }
  }
  for (let d = 1; d < FAR && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const tile of frontier) {
      const tx = tile % width;
      const ty = idiv(tile, width);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = tx + ox;
          const ny = ty + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const other = ny * width + nx;
          if (fromWater[other]! <= d) continue;
          fromWater[other] = d;
          next.push(other);
        }
      }
    }
    frontier = next;
  }

  const hills = (cx: number, cy: number): Fixed => {
    const at = (x: number, y: number): Fixed =>
      mul(valueNoise(seed ^ 0x2545f491, idiv(x * ONE, 26), idiv(y * ONE, 26)), 3 * ONE) +
      valueNoise(seed ^ 0x6a09e667, idiv(x * ONE, 9), idiv(y * ONE, 9));
    const raw = ((at(cx, cy) + at(width - cx, height - cy)) >> 1) - fromRatio(6, 5);
    return raw > 0 ? raw : 0;
  };

  for (let cy = 0; cy <= height; cy++) {
    for (let cx = 0; cx <= width; cx++) {
      let water = 0;
      let shallows = 0;
      let rock = 0;
      let nearestWater = FAR;
      // The four tiles that share this corner.
      for (let oy = -1; oy <= 0; oy++) {
        for (let ox = -1; ox <= 0; ox++) {
          const tx = cx + ox;
          const ty = cy + oy;
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
          const tile = ty * width + tx;
          const id = terrain[tile];
          if (id === Terrain.Water) water++;
          else if (id === Terrain.Shallows) shallows++;
          else if (id === Terrain.Rock) rock++;
          if (fromWater[tile]! < nearestWater) nearestWater = fromWater[tile]!;
        }
      }
      let h: Fixed;
      if (water > 0) h = -fromRatio(9, 20);
      else if (shallows > 0) h = -fromRatio(1, 8);
      else {
        h = hills(cx, cy);
        // Level ground around each start, easing back into the hills.
        let flat = ONE;
        for (const start of starts) {
          const d = length(cx * ONE - start.x, cy * ONE - start.y);
          const ease = d <= 9 * ONE ? 0 : d >= 18 * ONE ? ONE : idiv(d - 9 * ONE, 9);
          if (ease < flat) flat = ease;
        }
        h = mul(h, flat);
        // Banks slope down to the water.
        h = mulDiv(h, nearestWater, FAR);
        if (rock > 0) {
          h += rock * fromRatio(2, 5);
          if (rock === 4) {
            h +=
              (valueNoise(seed ^ 0x510e527f, cx * HALF, cy * HALF) +
                valueNoise(seed ^ 0x510e527f, (width - cx) * HALF, (height - cy) * HALF)) >>
              2;
          }
        }
      }
      elevation[cy * (width + 1) + cx] = h;
    }
  }
}
