/**
 * What each kind of unit and building is and can do, and the rules of the
 * four resources. These tables will move to data files once there is enough
 * of them to be worth editing outside the code; the simulation only ever
 * reads them from here.
 */

import { fromRatio, HALF, idiv, ONE, type Fixed } from './fixed';
import { Terrain } from './map';

export const Resource = { Food: 0, Wood: 1, Stone: 2, Gold: 3 } as const;
export const RESOURCE_COUNT = 4;
export const RESOURCE_NAMES = ['food', 'wood', 'stone', 'gold'] as const;

/** Which resource a terrain yields, or -1 if it yields none. */
export function resourceOfTerrain(terrain: number): number {
  switch (terrain) {
    case Terrain.Berries:
      return Resource.Food;
    case Terrain.Forest:
      return Resource.Wood;
    case Terrain.Stone:
      return Resource.Stone;
    case Terrain.Gold:
      return Resource.Gold;
    default:
      return -1;
  }
}

/** Seconds of work to gather one unit of each resource, as a fraction. */
const SECONDS_PER_UNIT: readonly (readonly [number, number])[] = [
  [5, 4], // food, from bushes
  [3, 2], // wood
  [8, 5], // stone
  [8, 5], // gold
];

/** Ticks of work to gather one unit of a resource. */
export function ticksPerUnit(resource: number, tickRate: number): number {
  const [seconds, per] = SECONDS_PER_UNIT[resource]!;
  return Math.max(1, idiv(tickRate * seconds * 2 + per, per * 2));
}

/** What a thing is, for the purposes of who hits it hardest. One bit each. */
export const Tag = {
  Infantry: 1,
  Cavalry: 2,
  Ranged: 4,
  /** Foot soldiers with long weapons and little armour. */
  Spear: 8,
  Villager: 16,
  Building: 32,
} as const;

export interface EntityType {
  readonly name: string;
  readonly building: boolean;
  /** What it costs to train or to found: food, wood, stone, gold. */
  readonly cost: readonly [number, number, number, number];
  /** Seconds to train a unit, or for one villager to put up a building. */
  readonly seconds: number;

  /** How much damage it can take. */
  readonly hp: number;
  /** How far it sees, in tiles. Whatever is further off is hidden unless someone else on its side sees it. */
  readonly sight: number;
  /** Taken off every blow, and off every arrow. A hit always does at least 1. */
  readonly meleeArmor: number;
  readonly rangedArmor: number;
  /** Tag bits: what it counts as when something has a bonus against it. */
  readonly tags: number;

  /** Damage per hit before armour, or 0 if it cannot attack. */
  readonly damage: number;
  /** Whether it shoots. Shots fly over anything and always find their mark. */
  readonly ranged: boolean;
  /** How far it can strike, in tiles, measured between the edges of attacker and target. */
  readonly range: Fixed;
  /** Seconds from starting an attack to the blow landing, and from one attack to the next. */
  readonly windup: Fixed;
  readonly cycle: Fixed;
  /** Extra damage against anything carrying one of these tags. */
  readonly bonuses: readonly (readonly [tags: number, extra: number])[];
  /** Extra damage on the first blow after a run, or 0. */
  readonly charge: number;
  /** Whether, standing still, it stops a charge and wounds the charger. */
  readonly braces: boolean;
  /** Whether it goes for enemies that come near without being told to. */
  readonly aggressive: boolean;

  /** Units: tiles per second. One tile is two metres. */
  readonly speed: Fixed;
  /** Units: the space one takes up, in tiles. Two units keep at least the sum of theirs apart. */
  readonly radius: Fixed;
  /** Units: how much of a resource one can carry, or 0 if it does not gather. */
  readonly carries: number;
  /** Units: whether it can put up buildings. */
  readonly builds: boolean;
  /** Units: how much room it takes up in the population. */
  readonly population: number;

  /** Buildings: tiles along each side. Odd, so the building has a centre tile. */
  readonly footprint: number;
  /** Buildings: which resources gatherers can hand in here, one bit per resource. */
  readonly accepts: number;
  /** Buildings: how many more units the player can have for owning it. */
  readonly housing: number;
  /** Buildings: the unit types it trains. */
  readonly trains: readonly number[];
  /** Buildings: whether villagers can be told to build one. */
  readonly buildable: boolean;
}

type Cost = readonly [number, number, number, number];
const ALL_RESOURCES = (1 << RESOURCE_COUNT) - 1;

interface Weapon {
  readonly damage: number;
  readonly ranged?: boolean;
  readonly range: Fixed;
  readonly windup: Fixed;
  readonly cycle: Fixed;
  readonly bonuses?: readonly (readonly [number, number])[];
  readonly charge?: number;
}

const UNARMED: Weapon = { damage: 0, range: 0, windup: 0, cycle: ONE };

function unit(
  name: string,
  cost: Cost,
  seconds: number,
  body: {
    hp: number;
    sight: number;
    speed: Fixed;
    radius: Fixed;
    tags: number;
    meleeArmor?: number;
    rangedArmor?: number;
    carries?: number;
    builds?: boolean;
    braces?: boolean;
    aggressive?: boolean;
  },
  weapon: Weapon,
): EntityType {
  return {
    name,
    building: false,
    cost,
    seconds,
    hp: body.hp,
    sight: body.sight,
    meleeArmor: body.meleeArmor ?? 0,
    rangedArmor: body.rangedArmor ?? 0,
    tags: body.tags,
    damage: weapon.damage,
    ranged: weapon.ranged ?? false,
    range: weapon.range,
    windup: weapon.windup,
    cycle: weapon.cycle,
    bonuses: weapon.bonuses ?? [],
    charge: weapon.charge ?? 0,
    braces: body.braces ?? false,
    aggressive: body.aggressive ?? true,
    speed: body.speed,
    radius: body.radius,
    carries: body.carries ?? 0,
    builds: body.builds ?? false,
    population: 1,
    footprint: 0,
    accepts: 0,
    housing: 0,
    trains: [],
    buildable: false,
  };
}

function building(
  name: string,
  cost: Cost,
  seconds: number,
  footprint: number,
  hp: number,
  extras: { accepts?: number; housing?: number; trains?: readonly number[]; buildable?: boolean; sight?: number } = {},
  weapon: Weapon = UNARMED,
): EntityType {
  return {
    name,
    building: true,
    cost,
    seconds,
    hp,
    sight: extras.sight ?? 6,
    // Timber and stone shrug off blades, and arrows all but bounce off.
    meleeArmor: 4,
    rangedArmor: 8,
    tags: Tag.Building,
    damage: weapon.damage,
    ranged: weapon.ranged ?? false,
    range: weapon.range,
    windup: 0,
    cycle: weapon.cycle,
    bonuses: weapon.bonuses ?? [],
    charge: 0,
    braces: false,
    aggressive: weapon.damage > 0,
    speed: 0,
    radius: 0,
    carries: 0,
    builds: false,
    population: 0,
    footprint,
    accepts: extras.accepts ?? 0,
    housing: extras.housing ?? 0,
    trains: extras.trains ?? [],
    buildable: extras.buildable ?? true,
  };
}

export const Kind = {
  Spearman: 0,
  Villager: 1,
  TownCentre: 2,
  House: 3,
  Mill: 4,
  LumberCamp: 5,
  MiningCamp: 6,
  Barracks: 7,
  Archer: 8,
  Horseman: 9,
  ArcheryRange: 10,
  Stable: 11,
  Watchtower: 12,
} as const;

/**
 * The counter triangle: spears stop horses, horses ride down archers, and
 * archers shoot spearmen full of holes before they can close.
 *
 *              hp  hit  every  armour  and
 *   spearman   80    8  1.75s   0 / 0  +16 against cavalry; braces against a charge
 *   archer     60    5  1.5s    0 / 0  +5 against spearmen; shoots 5 tiles
 *   horseman  120    9  1.75s   0 / 2  +9 against archers; +10 on a charge; half as fast again
 */
const ARROWS_FROM_A_BUILDING: Weapon = {
  damage: 8,
  ranged: true,
  range: 6 * ONE,
  windup: 0,
  cycle: 2 * ONE,
};

//                                    food wood stone gold  seconds
export const ENTITY_TYPES: readonly EntityType[] = [
  unit(
    'spearman',
    [60, 20, 0, 0],
    15,
    { hp: 80, sight: 8, speed: fromRatio(8, 5), radius: fromRatio(1, 4), tags: Tag.Infantry | Tag.Spear, braces: true },
    { damage: 8, range: fromRatio(2, 5), windup: fromRatio(1, 2), cycle: fromRatio(7, 4), bonuses: [[Tag.Cavalry, 16]] },
  ),
  unit(
    'villager',
    [50, 0, 0, 0],
    20,
    {
      hp: 50,
      sight: 7,
      speed: fromRatio(5, 4),
      radius: fromRatio(9, 40),
      tags: Tag.Villager,
      carries: 10,
      builds: true,
      aggressive: false,
    },
    { damage: 3, range: fromRatio(1, 4), windup: fromRatio(1, 2), cycle: 2 * ONE },
  ),
  building(
    'town centre',
    [0, 400, 300, 0],
    150,
    5,
    2400,
    { accepts: ALL_RESOURCES, housing: 10, trains: [Kind.Villager], buildable: false, sight: 11 },
    ARROWS_FROM_A_BUILDING,
  ),
  building('house', [0, 50, 0, 0], 20, 3, 400, { housing: 10 }),
  building('mill', [0, 50, 0, 0], 25, 3, 500, { accepts: 1 << Resource.Food }),
  building('lumber camp', [0, 50, 0, 0], 25, 3, 500, { accepts: 1 << Resource.Wood }),
  building('mining camp', [0, 50, 0, 0], 25, 3, 500, { accepts: (1 << Resource.Stone) | (1 << Resource.Gold) }),
  building('barracks', [0, 150, 0, 0], 40, 5, 1000, { trains: [Kind.Spearman] }),
  unit(
    'archer',
    [30, 50, 0, 0],
    15,
    { hp: 60, sight: 9, speed: fromRatio(8, 5), radius: fromRatio(1, 4), tags: Tag.Infantry | Tag.Ranged },
    {
      damage: 5,
      ranged: true,
      range: 5 * ONE,
      windup: fromRatio(1, 2),
      cycle: fromRatio(3, 2),
      bonuses: [[Tag.Spear, 5]],
    },
  ),
  unit(
    'horseman',
    [100, 20, 0, 0],
    22,
    { hp: 120, sight: 10, speed: fromRatio(12, 5), radius: fromRatio(7, 20), tags: Tag.Cavalry, rangedArmor: 2 },
    {
      damage: 9,
      range: fromRatio(2, 5),
      windup: fromRatio(2, 5),
      cycle: fromRatio(7, 4),
      bonuses: [[Tag.Ranged, 9]],
      charge: 10,
    },
  ),
  building('archery range', [0, 150, 0, 0], 40, 5, 1000, { trains: [Kind.Archer] }),
  building('stable', [0, 150, 0, 0], 40, 5, 1000, { trains: [Kind.Horseman] }),
  building('watchtower', [0, 100, 50, 0], 45, 3, 700, { sight: 13 }, { ...ARROWS_FROM_A_BUILDING, range: 7 * ONE }),
];

/** How fast an arrow flies, in tiles per second. */
export const SHOT_SPEED: Fixed = 14 * ONE;
/** How long a rider must keep moving before a charge is ready, in seconds, and how long the readiness lasts. */
export const CHARGE_RUN_SECONDS: Fixed = fromRatio(3, 2);
/** A rider who has run for two thirds of that has a charge ready. */
export function chargeReadyTicks(tickRate: number): number {
  return Math.max(1, idiv(ticksOf(CHARGE_RUN_SECONDS, tickRate) * 2, 3));
}
/** A shooter this much higher than its target (in tiles of height) hits a quarter harder. */
export const HIGH_GROUND: Fixed = fromRatio(1, 2);

/** A span of seconds, as a fixed-point number, in whole ticks. Zero stays zero. */
export function ticksOf(seconds: Fixed, tickRate: number): number {
  if (seconds <= 0) return 0;
  return Math.max(1, (seconds * tickRate + HALF) >> 16);
}

/** A building site sees only its own surroundings until it is finished. */
export const SITE_SIGHT = 3;

/** A building site starts with this share of its hit points and gains the rest as it is built. */
export function siteHp(entityType: number): number {
  return Math.max(1, idiv(ENTITY_TYPES[entityType]!.hp, 10));
}

/** No player may have more units than this, however many houses they build. */
export const POPULATION_LIMIT = 200;
/** Units a building can have waiting to be trained. */
export const TRAIN_QUEUE_LENGTH = 8;

/** Ticks to train a unit. */
export function trainingTicks(entityType: number, tickRate: number): number {
  return Math.max(1, ENTITY_TYPES[entityType]!.seconds * tickRate);
}

/**
 * Work needed to finish a building. A lone builder adds three points a tick
 * and each helper one more, so two build half as fast again as one, and extra
 * hands help less and less.
 */
export function buildPointsNeeded(entityType: number, tickRate: number): number {
  return Math.max(1, ENTITY_TYPES[entityType]!.seconds * tickRate * LONE_BUILDER_POINTS);
}
export const LONE_BUILDER_POINTS = 3;

/** The terrain a drop-off building's gatherers would work, nearest first choice first. */
export function terrainsAccepted(entityType: number): number[] {
  const accepts = ENTITY_TYPES[entityType]!.accepts;
  const out: number[] = [];
  if ((accepts & (1 << Resource.Food)) !== 0) out.push(Terrain.Berries);
  if ((accepts & (1 << Resource.Wood)) !== 0) out.push(Terrain.Forest);
  if ((accepts & (1 << Resource.Stone)) !== 0) out.push(Terrain.Stone);
  if ((accepts & (1 << Resource.Gold)) !== 0) out.push(Terrain.Gold);
  return out;
}
