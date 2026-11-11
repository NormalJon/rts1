/**
 * What each kind of unit and building is and can do, and the rules of the
 * four resources. These tables will move to data files once there is enough
 * of them to be worth editing outside the code; the simulation only ever
 * reads them from here.
 */

import { fromRatio, idiv, type Fixed } from './fixed';
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

export interface EntityType {
  readonly name: string;
  readonly building: boolean;
  /** What it costs to train or to found: food, wood, stone, gold. */
  readonly cost: readonly [number, number, number, number];
  /** Seconds to train a unit, or for one villager to put up a building. */
  readonly seconds: number;

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

function unit(
  name: string,
  cost: Cost,
  seconds: number,
  speed: Fixed,
  radius: Fixed,
  extras: { carries?: number; builds?: boolean } = {},
): EntityType {
  return {
    name,
    building: false,
    cost,
    seconds,
    speed,
    radius,
    carries: extras.carries ?? 0,
    builds: extras.builds ?? false,
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
  extras: { accepts?: number; housing?: number; trains?: readonly number[]; buildable?: boolean } = {},
): EntityType {
  return {
    name,
    building: true,
    cost,
    seconds,
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
} as const;

//                                    food wood stone gold  seconds
export const ENTITY_TYPES: readonly EntityType[] = [
  unit('spearman', [60, 20, 0, 0], 15, fromRatio(8, 5), fromRatio(1, 4)),
  unit('villager', [50, 0, 0, 0], 20, fromRatio(5, 4), fromRatio(9, 40), { carries: 10, builds: true }),
  building('town centre', [0, 400, 300, 0], 150, 5, {
    accepts: ALL_RESOURCES,
    housing: 10,
    trains: [Kind.Villager],
    buildable: false,
  }),
  building('house', [0, 50, 0, 0], 20, 3, { housing: 10 }),
  building('mill', [0, 50, 0, 0], 25, 3, { accepts: 1 << Resource.Food }),
  building('lumber camp', [0, 50, 0, 0], 25, 3, { accepts: 1 << Resource.Wood }),
  building('mining camp', [0, 50, 0, 0], 25, 3, { accepts: (1 << Resource.Stone) | (1 << Resource.Gold) }),
  building('barracks', [0, 150, 0, 0], 40, 5, { trains: [Kind.Spearman] }),
];

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
