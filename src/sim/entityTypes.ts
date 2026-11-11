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
  /** Units: tiles per second. One tile is two metres. */
  readonly speed: Fixed;
  /** Units: the space one takes up, in tiles. Two units keep at least the sum of theirs apart. */
  readonly radius: Fixed;
  /** Buildings: tiles along each side. Odd, so the building has a centre tile. */
  readonly footprint: number;
  /** Units: how much of a resource one can carry, or 0 if it does not gather. */
  readonly carries: number;
  /** Buildings: whether gatherers can hand in what they carry here. */
  readonly dropOff: boolean;
}

const unit = (name: string, speed: Fixed, radius: Fixed, carries = 0): EntityType => ({
  name,
  building: false,
  speed,
  radius,
  footprint: 0,
  carries,
  dropOff: false,
});

const building = (name: string, footprint: number, dropOff: boolean): EntityType => ({
  name,
  building: true,
  speed: 0,
  radius: 0,
  footprint,
  carries: 0,
  dropOff,
});

export const ENTITY_TYPES: readonly EntityType[] = [
  unit('spearman', fromRatio(8, 5), fromRatio(1, 4)),
  unit('villager', fromRatio(5, 4), fromRatio(9, 40), 10),
  building('town centre', 5, true),
];

export const Kind = { Spearman: 0, Villager: 1, TownCentre: 2 } as const;
