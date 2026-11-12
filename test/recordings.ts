/**
 * Reference matches and reference figures for the C# port.
 *
 * The TypeScript simulation is the reference: whatever it does, the C# one
 * must do exactly. So matches are played here and written down in full (the
 * settings, every command, and the world checksum after every tick), and the
 * C# tests play them back and compare, tick by tick.
 *
 * Two kinds of match are recorded. In a scripted match every player issues
 * random orders (playRandomMatch in helpers.ts), which reaches corners of the
 * rules a sensible player never would. In an AI match the skirmish AI plays
 * each side; the C# tests play those back from the commands, and also run
 * their own AI from the start and check that it gives the same orders.
 *
 * `npm run record` writes the files into recordings/. `npm run
 * check:recordings` plays everything again and compares it with what is on
 * disk. Record again only when a change in how matches play out is intended,
 * and port that change to C# at the same time.
 */

import { SkirmishAi, type Difficulty } from '../src/ai/skirmish';
import { LocalSession } from '../src/session/localSession';
import type { ScheduledCommand } from '../src/sim/commands';
import { abs, clamp, div, fromInt, fromRatio, idiv, isqrt, length, lerp, mul, mulDiv, sqrt } from '../src/sim/fixed';
import { hashHex, hashWorld } from '../src/sim/hash';
import { buildMap, type MapSpec } from '../src/sim/mapgen';
import { Rng } from '../src/sim/rng';
import { checksumBytes } from '../src/sim/routing';
import { AStarSearch, FieldSearch, SearchScratch } from '../src/sim/search';
import { defaultConfig, type SimConfig } from '../src/sim/world';
import { playRandomMatch } from './helpers';

// ---- Matches -----------------------------------------------------------------

export interface MatchSpec {
  readonly name: string;
  /** What the match is for, in a sentence. */
  readonly about: string;
  readonly config: SimConfig;
  readonly ticks: number;
  /** A scripted match: the seed of the random orders. Null for an AI match. */
  readonly scriptSeed: number | null;
  /** An AI match: the level of each player's AI, null for a player who is given no orders. Null for a scripted match. */
  readonly controllers: readonly (Difficulty | null)[] | null;
}

export interface Recording {
  readonly format: 1;
  readonly name: string;
  readonly about: string;
  readonly controllers: readonly (Difficulty | null)[] | null;
  readonly config: SimConfig;
  readonly ticks: number;
  readonly commands: readonly ScheduledCommand[];
  /**
   * The world checksum after every tick, eight hex digits each, run together
   * and cut into rows of CHECKSUMS_PER_ROW ticks.
   */
  readonly checksums: readonly string[];
}

export const CHECKSUMS_PER_ROW = 64;

const MINUTE = 30 * 60;

/** The match pinned in determinism.test.ts. Its last checksum is the reference checksum. */
const REFERENCE = defaultConfig({ seed: 20261111, playerCount: 2, map: { kind: 'generated' }, start: 'standard', startAge: 1 });
export const REFERENCE_TICKS = 2100;

const aiMatch = (seed: number): SimConfig =>
  defaultConfig({
    seed,
    playerCount: 2,
    mapWidth: 128,
    mapHeight: 128,
    map: { kind: 'generated' },
    start: 'standard',
    maxEntities: 2048,
  });

/** A small map drawn by hand: three towns, a river with two fords, and a little of everything. */
function handDrawnMap(): { width: number; height: number; rows: string[] } {
  const width = 40;
  const height = 30;
  const grid = Array.from({ length: height }, () => new Array<string>(width).fill('.'));
  const put = (left: number, top: number, wide: number, high: number, ch: string): void => {
    for (let y = top; y < top + high; y++) for (let x = left; x < left + wide; x++) grid[y]![x] = ch;
  };
  put(19, 0, 2, height, '~');
  put(19, 6, 2, 3, ',');
  put(19, 21, 2, 3, ',');
  put(9, 14, 3, 2, '#');
  put(28, 14, 3, 2, '#');
  put(1, 12, 5, 6, 'T');
  put(34, 12, 5, 6, 'T');
  put(10, 0, 6, 2, 'T');
  put(24, 28, 6, 2, 'T');
  put(13, 20, 3, 4, 'T');
  put(24, 6, 3, 4, 'T');
  put(10, 3, 3, 2, 'b');
  put(27, 25, 3, 2, 'b');
  put(27, 3, 3, 2, 'b');
  put(3, 9, 3, 2, 'g');
  put(34, 19, 3, 2, 'g');
  put(36, 9, 3, 2, 'g');
  put(11, 8, 2, 2, 's');
  put(27, 20, 2, 2, 's');
  put(30, 10, 2, 2, 's');
  grid[5]![6] = '0';
  grid[24]![33] = '1';
  grid[5]![33] = '2';
  return { width, height, rows: grid.map((row) => row.join('')) };
}

const HAND_DRAWN = handDrawnMap();

export const MATCHES: readonly MatchSpec[] = [
  {
    name: 'reference',
    about: 'The reference match of test/determinism.test.ts: random orders on a generated map, starting in the second age.',
    config: REFERENCE,
    ticks: REFERENCE_TICKS,
    scriptSeed: 77,
    controllers: null,
  },
  {
    name: 'reference-starved',
    about: 'The reference match with pathfinding starved, so that route searches run across many ticks.',
    config: { ...REFERENCE, pathBudget: 150 },
    ticks: REFERENCE_TICKS,
    scriptSeed: 77,
    controllers: null,
  },
  {
    name: 'random-first-age',
    about: 'Random orders from the first age on a larger generated map, with the lie of the land known from the start.',
    config: defaultConfig({
      seed: 4242,
      playerCount: 2,
      mapWidth: 96,
      mapHeight: 96,
      map: { kind: 'generated' },
      start: 'standard',
      mapState: 'explored',
    }),
    ticks: 2400,
    scriptSeed: 78,
    controllers: null,
  },
  {
    name: 'random-hand-drawn',
    about: 'Random orders on a hand-drawn map: three players each for themselves, nothing hidden, 60 ticks a second, starting in the third age.',
    config: defaultConfig({
      seed: 31,
      tickRate: 60,
      playerCount: 3,
      mapWidth: HAND_DRAWN.width,
      mapHeight: HAND_DRAWN.height,
      map: { kind: 'ascii', rows: HAND_DRAWN.rows },
      start: 'standard',
      mapState: 'revealed',
      startAge: 2,
    }),
    ticks: 3600,
    scriptSeed: 79,
    controllers: null,
  },
  {
    name: 'random-teams',
    about: 'Random orders on open grass: four players in two teams, 20 ticks a second, starting in the last age.',
    config: defaultConfig({
      seed: 909,
      tickRate: 20,
      playerCount: 4,
      teams: [0, 1, 0, 1],
      mapWidth: 72,
      mapHeight: 72,
      map: { kind: 'flat' },
      start: 'standard',
      mapState: 'explored',
      startAge: 3,
    }),
    ticks: 1600,
    scriptSeed: 80,
    controllers: null,
  },
  {
    name: 'random-crowded',
    about: 'Random orders with no towns on a small field that fills up: the world runs out of room for units, and pathfinding is starved.',
    config: defaultConfig({
      seed: 5,
      tickRate: 15,
      playerCount: 2,
      mapWidth: 48,
      mapHeight: 48,
      map: { kind: 'flat' },
      start: 'empty',
      maxEntities: 48,
      pathBudget: 400,
    }),
    ticks: 1500,
    scriptSeed: 81,
    controllers: null,
  },
  {
    name: 'ai-hard-all-ages',
    about: 'Two hard AIs for 36 minutes: both climb through all four ages, field every kind of soldier, and one town falls.',
    config: aiMatch(7),
    ticks: 36 * MINUTE,
    scriptSeed: null,
    controllers: ['hard', 'hard'],
  },
  {
    name: 'ai-hard-vs-easy',
    about: 'A hard AI against an easy one for 25 minutes: the easy one is overrun and wiped out.',
    config: aiMatch(1066),
    ticks: 25 * MINUTE,
    scriptSeed: null,
    controllers: ['hard', 'easy'],
  },
  {
    name: 'ai-standard-vs-idle',
    about: 'A standard AI against a player who does nothing for 17 minutes: it finds the town, destroys it and hunts down what is left.',
    config: aiMatch(1066),
    ticks: 17 * MINUTE,
    scriptSeed: null,
    controllers: [null, 'standard'],
  },
];

/** Plays a match from its description and writes down everything needed to check a replay of it. */
export function record(spec: MatchSpec): Recording {
  let session: LocalSession;
  let hashes: number[];
  if (spec.controllers === null) {
    if (spec.scriptSeed === null) throw new Error(`${spec.name} has neither a script nor controllers`);
    ({ session, hashes } = playRandomMatch(spec.config, spec.scriptSeed, spec.ticks));
  } else {
    session = new LocalSession(spec.config);
    for (let player = 0; player < spec.controllers.length; player++) {
      const level = spec.controllers[player];
      if (level !== null && level !== undefined) session.control(player, new SkirmishAi(player, level));
    }
    hashes = [];
    while (session.world.tick < spec.ticks) {
      session.step();
      hashes.push(hashWorld(session.world));
    }
  }
  const replay = session.replay();
  const checksums: string[] = [];
  for (let i = 0; i < hashes.length; i += CHECKSUMS_PER_ROW) {
    checksums.push(hashes.slice(i, i + CHECKSUMS_PER_ROW).map(hashHex).join(''));
  }
  return {
    format: 1,
    name: spec.name,
    about: spec.about,
    controllers: spec.controllers,
    config: replay.config,
    ticks: replay.ticks,
    commands: replay.commands,
    checksums,
  };
}

/** A recording as the text of its file: JSON, laid out one command and one row of checksums to a line. */
export function formatRecording(recording: Recording): string {
  const list = (items: readonly unknown[]): string => items.map((item) => JSON.stringify(item)).join(',\n');
  return [
    '{',
    `"format": ${recording.format},`,
    `"name": ${JSON.stringify(recording.name)},`,
    `"about": ${JSON.stringify(recording.about)},`,
    `"controllers": ${JSON.stringify(recording.controllers)},`,
    `"config": ${JSON.stringify(recording.config)},`,
    `"ticks": ${recording.ticks},`,
    '"commands": [',
    list(recording.commands),
    '],',
    '"checksums": [',
    list(recording.checksums),
    ']',
    '}',
    '',
  ].join('\n');
}

/** The checksum a recording holds for the state after a tick has run (tick 0 is the first). */
export function checksumAfter(recording: Recording, tick: number): string {
  const row = recording.checksums[Math.floor(tick / CHECKSUMS_PER_ROW)]!;
  const at = (tick % CHECKSUMS_PER_ROW) * 8;
  return row.slice(at, at + 8);
}

// ---- Figures -------------------------------------------------------------------
//
// Smaller things the C# port can be checked against before a whole match will
// run: the arithmetic, the random numbers, the maps and the route searches.

/** Folds a run of numbers into one, 32 bits at a time. */
export class Fold {
  private h = 0x811c9dc5;

  add(value: number): void {
    this.h = Math.imul(this.h ^ (value | 0), 0x01000193);
    this.h = (this.h << 13) | (this.h >>> 19);
  }

  get value(): number {
    return this.h >>> 0;
  }
}

function fold(values: ArrayLike<number>): number {
  const f = new Fold();
  for (let i = 0; i < values.length; i++) f.add(values[i]!);
  return f.value;
}

/** How many of each function's first results are written out in full, so a mismatch can be pinned down. */
const SAMPLES = 24;
export const FIXED_ROUNDS = 4000;
export const FIXED_SEED = 12345;

export interface FunctionFigures {
  /** The first few calls: the arguments, then the result. */
  readonly samples: number[][];
  /** Every result, folded. */
  readonly folded: number;
  readonly calls: number;
}

class Tally {
  private readonly samples: number[][] = [];
  private readonly fold = new Fold();
  private calls = 0;

  note(args: readonly number[], result: number): void {
    if (this.samples.length < SAMPLES) this.samples.push([...args, result]);
    this.fold.add(result);
    this.calls++;
  }

  figures(): FunctionFigures {
    return { samples: this.samples, folded: this.fold.value, calls: this.calls };
  }
}

/**
 * Runs the fixed-point functions over a long run of inputs. Each round draws
 * three numbers of mixed sizes, a, b and c, from Rng(FIXED_SEED): a 32-bit
 * number shifted right by 0 to 23 places. The C# test draws the same numbers
 * the same way.
 */
export function fixedFigures(): Record<string, FunctionFigures> {
  const rng = new Rng(FIXED_SEED);
  const draw = (): number => (rng.nextU32() | 0) >> rng.nextInt(24);
  const names = ['mul', 'div', 'idiv', 'mulDiv', 'isqrt', 'sqrt', 'length', 'abs', 'clamp', 'lerp', 'fromInt', 'fromRatio'] as const;
  const tallies = Object.fromEntries(names.map((name) => [name, new Tally()])) as Record<(typeof names)[number], Tally>;
  for (let round = 0; round < FIXED_ROUNDS; round++) {
    const a = draw();
    const b = draw();
    const c = draw();
    tallies.mul.note([a, b], mul(a, b));
    if (b !== 0) {
      tallies.div.note([a, b], div(a, b));
      tallies.idiv.note([a, b], idiv(a, b));
    }
    if (c !== 0 && Math.abs(a * b) <= Number.MAX_SAFE_INTEGER) tallies.mulDiv.note([a, b, c], mulDiv(a, b, c));
    const positive = Math.abs(a);
    // Up to 2^53 - 1, the largest number isqrt is asked for.
    const big = positive * 4194303 + Math.abs(b >> 10);
    tallies.isqrt.note([positive, b >> 10], isqrt(big));
    tallies.sqrt.note([positive], sqrt(positive));
    tallies.length.note([a, b], length(a, b));
    tallies.abs.note([a], abs(a));
    tallies.clamp.note([a, b, c], clamp(a, Math.min(b, c), Math.max(b, c)));
    tallies.lerp.note([a, b, c & 0xffff], lerp(a, b, c & 0xffff));
    tallies.fromInt.note([a >> 12], fromInt(a >> 12));
    if (c >> 8 !== 0) tallies.fromRatio.note([a >> 12, c >> 8], fromRatio(a >> 12, c >> 8));
  }
  return Object.fromEntries(names.map((name) => [name, tallies[name].figures()]));
}

export interface RngFigures {
  readonly seed: number;
  /** The first eight numbers from nextU32. */
  readonly first: number[];
  /** A thousand more, folded. */
  readonly folded: number;
  /** After those: nextInt for each of RNG_BOUNDS in turn, then rangeFixed(-2, 2) and chance(1, 3) as 0 or 1. */
  readonly bounded: number[];
  readonly state: number[];
}

export const RNG_BOUNDS = [1, 2, 3, 7, 100, 65536, 0x80000000, 0xffffffff, 0x100000000];

export function rngFigures(): RngFigures[] {
  return [0, 1, 2, 12345, 20261111, -1, 0xdeadbeef].map((seed) => {
    const rng = new Rng(seed);
    const first: number[] = [];
    for (let i = 0; i < 8; i++) first.push(rng.nextU32());
    const f = new Fold();
    for (let i = 0; i < 1000; i++) f.add(rng.nextU32());
    const bounded = RNG_BOUNDS.map((bound) => rng.nextInt(bound));
    bounded.push(rng.rangeFixed(fromInt(-2), fromInt(2)), rng.chance(1, 3) ? 1 : 0);
    return { seed, first, folded: f.value, bounded, state: [...rng.getState()] };
  });
}

export interface SearchFigures {
  readonly kind: 'path' | 'field';
  readonly start: number;
  readonly goal: number;
  readonly targets: number[];
  readonly found: boolean;
  readonly expansions: number;
  /** A path: how many tiles long, and the tiles folded. A field: 0, and the checksum of its directions. */
  readonly length: number;
  readonly folded: number;
}

export interface MapFigures {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly map: MapSpec;
  readonly checksum: number;
  readonly stateHash: number;
  readonly starts: number[];
  readonly terrain: number;
  readonly amount: number;
  readonly elevation: number;
  readonly passable: number;
  readonly region: number;
  readonly searches: SearchFigures[];
}

export function mapFigures(): MapFigures[] {
  const maps: [number, number, number, MapSpec][] = [
    [64, 64, 1, { kind: 'flat' }],
    [HAND_DRAWN.width, HAND_DRAWN.height, 31, { kind: 'ascii', rows: HAND_DRAWN.rows }],
    [64, 64, 20261111, { kind: 'generated' }],
    [48, 48, 3, { kind: 'generated' }],
    [96, 80, 99, { kind: 'generated' }],
    [128, 128, 1066, { kind: 'generated' }],
    [128, 128, 7, { kind: 'generated' }],
    [200, 160, 5, { kind: 'generated' }],
  ];
  return maps.map(([width, height, seed, spec]) => {
    const map = buildMap(width, height, seed, spec);
    const scratch = new SearchScratch(map.tileCount);
    const rng = new Rng(seed ^ 0x5eed);
    const passableTile = (): number => {
      for (;;) {
        const tile = rng.nextInt(map.tileCount);
        if (map.passable[tile] === 1) return tile;
      }
    };
    const searches: SearchFigures[] = [];
    for (let i = 0; i < 6; i++) {
      const start = passableTile();
      const goal = passableTile();
      // In slices of 37 tiles, as a starved match would run it.
      const astar = new AStarSearch(map, scratch, start, goal);
      while (!astar.done) astar.run(37);
      const path = astar.found ? astar.path() : [];
      searches.push({
        kind: 'path',
        start,
        goal,
        targets: [],
        found: astar.found,
        expansions: astar.expansions,
        length: path.length,
        folded: fold(path),
      });
    }
    for (let i = 0; i < 3; i++) {
      const goal = passableTile();
      // The last one has no targets, and so covers everything that can reach the goal.
      const targets = i === 2 ? [] : [passableTile(), passableTile(), passableTile(), passableTile()];
      const field = new FieldSearch(map, scratch, goal, targets);
      while (!field.done) field.run(53);
      searches.push({
        kind: 'field',
        start: goal,
        goal: -1,
        targets,
        found: true,
        expansions: field.expansions,
        length: 0,
        folded: checksumBytes(field.directions),
      });
    }
    return {
      width,
      height,
      seed,
      map: spec,
      checksum: map.checksum,
      stateHash: map.stateHash,
      starts: map.starts.flatMap((start) => [start.x, start.y]),
      terrain: fold(map.terrain),
      amount: fold(map.amount),
      elevation: fold(map.elevation),
      passable: fold(map.passable),
      region: fold(map.region),
      searches,
    };
  });
}

export interface Figures {
  readonly format: 1;
  readonly fixed: Record<string, FunctionFigures>;
  readonly rng: RngFigures[];
  readonly maps: MapFigures[];
}

export function figures(): Figures {
  return { format: 1, fixed: fixedFigures(), rng: rngFigures(), maps: mapFigures() };
}

export function formatFigures(all: Figures): string {
  return `${JSON.stringify(all, null, 1)}\n`;
}
