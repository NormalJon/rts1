/**
 * Reference matches and reference figures for the C# port.
 *
 * The TypeScript simulation is the reference: whatever it does, the C# one
 * must do exactly. So matches are played here and written down in full (the
 * settings, every command, and the world checksum after every tick), and the
 * C# tests play them back and compare, tick by tick.
 *
 * Three kinds of match are recorded. In a random match every player issues
 * random orders (playRandomMatch in helpers.ts), which reaches corners of the
 * rules a sensible player never would. In an AI match the skirmish AI plays
 * each side; the C# tests play those back from the commands, and also run
 * their own AI from the start and check that it gives the same orders. A
 * scenario is a short script written to do particular things that neither of
 * the others happens to.
 *
 * `npm run record` writes the files into recordings/. `npm run
 * check:recordings` plays everything again and compares it with what is on
 * disk. Record again only when a change in how matches play out is intended,
 * and port that change to C# at the same time.
 */

import { SkirmishAi, type Difficulty } from '../src/ai/skirmish';
import { LocalSession } from '../src/session/localSession';
import { canPlace } from '../src/sim/buildings';
import type { ScheduledCommand } from '../src/sim/commands';
import {
  buildPointsNeeded,
  chargeReadyTicks,
  ENTITY_TYPES,
  Kind,
  siteHp,
  ticksOf,
  ticksPerUnit,
  trainingTicks,
} from '../src/sim/entityTypes';
import { abs, clamp, div, fromInt, fromRatio, HALF, idiv, isqrt, length, lerp, mul, mulDiv, sqrt } from '../src/sim/fixed';
import { hashHex, hashWorld } from '../src/sim/hash';
import { Terrain } from '../src/sim/map';
import { buildMap, type MapSpec } from '../src/sim/mapgen';
import { Rng } from '../src/sim/rng';
import { checksumBytes } from '../src/sim/routing';
import { AStarSearch, FieldSearch, SearchScratch } from '../src/sim/search';
import { rebuildTypes, researchTicks, TECHS, TERRAINS } from '../src/sim/tech';
import { defaultConfig, Job, World, type SimConfig } from '../src/sim/world';
import { playRandomMatch } from './helpers';

// ---- Matches -----------------------------------------------------------------

export interface MatchSpec {
  readonly name: string;
  /** What the match is for, in a sentence. */
  readonly about: string;
  readonly config: SimConfig;
  readonly ticks: number;
  /** A random match: the seed of the random orders. Null otherwise. */
  readonly scriptSeed: number | null;
  /** An AI match: the level of each player's AI, null for a player who is given no orders. Null otherwise. */
  readonly controllers: readonly (Difficulty | null)[] | null;
  /** A scenario: plays the match, issuing its own orders, and returns the checksum after every tick. Null otherwise. */
  readonly scenario: ((session: LocalSession, ticks: number) => number[]) | null;
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
  // One tile of grass walled off by the trees: felling the tree north of it joins two regions.
  grid[13]![3] = '.';
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

/**
 * Two towns on the hand-drawn map, doing things the other matches never
 * happen to: new villagers rallied straight onto berries; a tree felled that
 * was the wall between two pieces of ground; and a mill pulled down while a
 * villager is on the way to it with a load.
 */
function townScenario(session: LocalSession, ticks: number): number[] {
  const { world } = session;
  const { map } = world;
  const tileOf = (x: number, y: number): number => y * map.width + x;
  const slotOf = (id: number): number => id & 0xfffff;
  const hall = world.livingEntities(0).find((id) => world.entityType[slotOf(id)] === Kind.TownCentre)!;

  session.issue(0, { kind: 'gather', units: world.livingUnits(0), tile: tileOf(3, 12) });
  session.issue(0, { kind: 'rally', buildings: [hall], x: fromInt(10) + HALF, y: fromInt(3) + HALF });
  for (let i = 0; i < 3; i++) session.issue(0, { kind: 'train', building: hall, unitType: Kind.Villager });

  const pickers = world.livingUnits(1);
  session.issue(1, { kind: 'gather', units: pickers, tile: tileOf(28, 25) });
  const plot = map.nearestTile(27, 24, 8, (tile) => canPlace(world, Kind.Mill, tile % map.width, Math.floor(tile / map.width), 1));
  if (plot === -1) throw new Error('the scenario found nowhere for its mill');
  session.issue(1, {
    kind: 'build',
    units: pickers.slice(0, 1),
    buildingType: Kind.Mill,
    tileX: plot % map.width,
    tileY: Math.floor(plot / map.width),
  });

  const regionsAtStart = new Set(map.region).size;
  let pulledDown = false;
  let sentToBerries = 0;
  const hashes: number[] = [];
  while (world.tick < ticks) {
    const mill = world.livingEntities(1).find((id) => world.entityType[slotOf(id)] === Kind.Mill);
    if (!pulledDown && mill !== undefined) {
      const onTheWay = world.livingUnits(1).some((id) => world.job[slotOf(id)] === Job.ToDropOff && world.jobTarget[slotOf(id)] === mill);
      if (onTheWay) {
        session.issue(1, { kind: 'demolish', targets: [mill] });
        pulledDown = true;
      }
    }
    session.step();
    hashes.push(hashWorld(world));
    sentToBerries = Math.max(
      sentToBerries,
      world.livingUnits(0).filter((id) => world.jobTerrain[slotOf(id)] === Terrain.Berries && world.job[slotOf(id)] !== Job.None).length,
    );
  }
  // The scenario is only worth recording if it did what it is for.
  if (!pulledDown) throw new Error('the scenario never pulled its mill down');
  if (sentToBerries < 3) throw new Error('the scenario never rallied its new villagers onto the berries');
  if (new Set(map.region).size >= regionsAtStart) throw new Error('the scenario never joined the walled-off clearing to the rest');
  return hashes;
}

export const MATCHES: readonly MatchSpec[] = [
  {
    name: 'reference',
    about: 'The reference match of test/determinism.test.ts: random orders on a generated map, starting in the second age.',
    config: REFERENCE,
    ticks: REFERENCE_TICKS,
    scriptSeed: 77,
    controllers: null,
    scenario: null,
  },
  {
    name: 'reference-starved',
    about: 'The reference match with pathfinding starved, so that route searches run across many ticks.',
    config: { ...REFERENCE, pathBudget: 150 },
    ticks: REFERENCE_TICKS,
    scriptSeed: 77,
    controllers: null,
    scenario: null,
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
    scenario: null,
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
    scenario: null,
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
    scenario: null,
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
    scenario: null,
  },
  {
    name: 'scenario-town',
    about: 'A script on the hand-drawn map: new villagers rallied onto berries, a tree felled that joins two pieces of ground, a mill pulled down while a villager is carrying a load to it.',
    config: defaultConfig({
      seed: 12,
      playerCount: 2,
      mapWidth: HAND_DRAWN.width,
      mapHeight: HAND_DRAWN.height,
      map: { kind: 'ascii', rows: HAND_DRAWN.rows },
      start: 'standard',
    }),
    ticks: 3000,
    scriptSeed: null,
    controllers: null,
    scenario: townScenario,
  },
  {
    name: 'ai-hard-all-ages',
    about: 'Two hard AIs for 36 minutes: both climb through all four ages, field every kind of soldier, and one town falls.',
    config: aiMatch(7),
    ticks: 36 * MINUTE,
    scriptSeed: null,
    controllers: ['hard', 'hard'],
    scenario: null,
  },
  {
    name: 'ai-hard-vs-easy',
    about: 'A hard AI against an easy one for 25 minutes: the easy one is overrun and wiped out.',
    config: aiMatch(1066),
    ticks: 25 * MINUTE,
    scriptSeed: null,
    controllers: ['hard', 'easy'],
    scenario: null,
  },
  {
    name: 'ai-standard-vs-idle',
    about: 'A standard AI against a player who does nothing for 17 minutes: it finds the town, destroys it and hunts down what is left.',
    config: aiMatch(1066),
    ticks: 17 * MINUTE,
    scriptSeed: null,
    controllers: [null, 'standard'],
    scenario: null,
  },
];

/** Plays a match from its description and writes down everything needed to check a replay of it. */
export function record(spec: MatchSpec): Recording {
  let session: LocalSession;
  let hashes: number[];
  if (spec.scenario !== null) {
    session = new LocalSession(spec.config);
    hashes = spec.scenario(session, spec.ticks);
  } else if (spec.controllers === null) {
    if (spec.scriptSeed === null) throw new Error(`${spec.name} has no script, no controllers and no scenario`);
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
    // On these two seeds forest or rock cuts the starts off from each other, and the generator opens a line between them.
    [64, 64, 110, { kind: 'generated' }],
    [72, 56, 166, { kind: 'generated' }],
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

function addText(f: Fold, text: string): void {
  f.add(text.length);
  for (let i = 0; i < text.length; i++) f.add(text.charCodeAt(i));
}

export interface TechFigures {
  /** Each technology as it is written down: name, description, cost, time, where, when, and what it needs. */
  readonly table: { readonly name: string; readonly folded: number }[];
  /**
   * What research makes of the units and buildings. Each case is a list of
   * technologies taken as researched; the figure is every unit's and
   * building's every number (and name) for that player, folded, then the
   * player's gathering speeds.
   */
  readonly cases: { readonly researched: number[]; readonly folded: number }[];
}

export function techFigures(): TechFigures {
  const table = TECHS.map((tech) => {
    const f = new Fold();
    addText(f, tech.name);
    addText(f, tech.about);
    for (const amount of tech.cost) f.add(amount);
    f.add(tech.seconds);
    f.add(tech.at);
    f.add(tech.age);
    f.add(tech.requires.length);
    for (const id of tech.requires) f.add(id);
    f.add(tech.reform ? 1 : 0);
    f.add(tech.needs);
    f.add(tech.among.length);
    for (const kind of tech.among) f.add(kind);
    f.add(tech.effects.length);
    return { name: tech.name, folded: f.value };
  });
  const everything = TECHS.map((_, id) => id);
  const cases = [[], ...everything.map((id) => [id]), everything].map((researched) => {
    const world = new World(defaultConfig());
    for (const id of researched) world.researched[id] = 1;
    rebuildTypes(world, 0);
    const f = new Fold();
    for (const type of world.types[0]!) {
      addText(f, type.name);
      f.add(type.building ? 1 : 0);
      for (const amount of type.cost) f.add(amount);
      f.add(type.seconds);
      f.add(type.age);
      f.add(type.hp);
      f.add(type.sight);
      f.add(type.meleeArmor);
      f.add(type.rangedArmor);
      f.add(type.tags);
      f.add(type.damage);
      f.add(type.ranged ? 1 : 0);
      f.add(type.range);
      f.add(type.windup);
      f.add(type.cycle);
      f.add(type.bonuses.length);
      for (const [tags, extra] of type.bonuses) {
        f.add(tags);
        f.add(extra);
      }
      f.add(type.charge);
      f.add(type.braces ? 1 : 0);
      f.add(type.aggressive ? 1 : 0);
      f.add(type.speed);
      f.add(type.radius);
      f.add(type.carries);
      f.add(type.builds ? 1 : 0);
      f.add(type.population);
      f.add(type.footprint);
      f.add(type.accepts);
      f.add(type.housing);
      f.add(type.trains.length);
      for (const kind of type.trains) f.add(kind);
      f.add(type.buildable ? 1 : 0);
      f.add(type.farm ? 1 : 0);
    }
    for (let terrain = 0; terrain < TERRAINS; terrain++) f.add(world.gatherBonus[terrain]!);
    return { researched, folded: f.value };
  });
  return { table, cases };
}

/**
 * How long things take at every tick rate from 1 to 120: gathering from each
 * terrain (plain, and 35 per cent faster), each weapon's wind-up and cycle,
 * the charge, training and building each kind of thing, and each technology.
 * One folded figure per tick rate.
 */
export function timingFigures(): number[] {
  const out: number[] = [];
  for (let tickRate = 1; tickRate <= 120; tickRate++) {
    const f = new Fold();
    for (const terrain of [Terrain.Forest, Terrain.Berries, Terrain.Stone, Terrain.Gold, Terrain.Field]) {
      f.add(ticksPerUnit(terrain, tickRate));
      f.add(ticksPerUnit(terrain, tickRate, 35));
    }
    f.add(chargeReadyTicks(tickRate));
    ENTITY_TYPES.forEach((type, kind) => {
      f.add(ticksOf(type.windup, tickRate));
      f.add(ticksOf(type.cycle, tickRate));
      f.add(trainingTicks(type, tickRate));
      f.add(buildPointsNeeded(kind, tickRate));
      f.add(siteHp(kind));
    });
    TECHS.forEach((_, id) => f.add(researchTicks(id, tickRate)));
    out.push(f.value);
  }
  return out;
}

export interface Figures {
  readonly format: 1;
  readonly fixed: Record<string, FunctionFigures>;
  readonly rng: RngFigures[];
  readonly maps: MapFigures[];
  readonly techs: TechFigures;
  readonly timings: number[];
}

export function figures(): Figures {
  return { format: 1, fixed: fixedFigures(), rng: rngFigures(), maps: mapFigures(), techs: techFigures(), timings: timingFigures() };
}

export function formatFigures(all: Figures): string {
  return `${JSON.stringify(all, null, 1)}\n`;
}
