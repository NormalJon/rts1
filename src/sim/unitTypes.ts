/**
 * What each kind of unit can do. This table will move to data files once
 * there is enough of it to be worth editing outside the code; the simulation
 * only ever reads it through UNIT_TYPES.
 */

import { fromRatio, type Fixed } from './fixed';

export interface UnitType {
  readonly name: string;
  /** Tiles per second. One tile is two metres. */
  readonly speed: Fixed;
  /** The space a unit takes up, in tiles. Two units keep at least the sum of theirs apart. */
  readonly radius: Fixed;
}

export const UNIT_TYPES: readonly UnitType[] = [
  { name: 'spearman', speed: fromRatio(8, 5), radius: fromRatio(1, 4) },
  { name: 'villager', speed: fromRatio(5, 4), radius: fromRatio(9, 40) },
];

export const UnitKind = { Spearman: 0, Villager: 1 } as const;
