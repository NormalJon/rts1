/**
 * Conversion of authored values into simulation values.
 *
 * Designers write stats in familiar units: tiles, seconds, tiles per second.
 * The simulation works in fixed-point and ticks. Everything is converted once,
 * when data is loaded or a command is applied, so the tick rate can change
 * without touching any stats.
 *
 * Along with fixed.ts, this is the only file in src/sim allowed to use
 * floating-point operations.
 */

import { ONE, type Fixed } from './fixed';

/**
 * A decimal from a data file (for example 1.25) as fixed-point. The same
 * decimal gives the same result on every machine.
 */
export function fromFloat(x: number): Fixed {
  return Math.round(x * ONE) | 0;
}

/** A duration in seconds as a whole number of ticks, at least one. */
export function secondsToTicks(seconds: number, tickRate: number): number {
  return Math.max(1, Math.round(seconds * tickRate));
}

/** A fixed-point rate per second (speed, regeneration) as a rate per tick. */
export function perSecondToPerTick(ratePerSecond: Fixed, tickRate: number): Fixed {
  return Math.floor(ratePerSecond / tickRate);
}
