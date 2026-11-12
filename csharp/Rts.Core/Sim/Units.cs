// Ported from src/sim/units.ts. Keep the two in step.

using System;

namespace Rts.Sim
{
    /// <summary>
    /// Conversion of authored values into simulation values.
    ///
    /// Designers write stats in familiar units: tiles, seconds, tiles per second.
    /// The simulation works in fixed-point and ticks. Everything is converted
    /// once, when data is loaded or a command is applied, so the tick rate can
    /// change without touching any stats.
    ///
    /// The first two functions take decimals and are for the edges of the
    /// program (data files, the display layer). The simulation itself calls only
    /// <see cref="PerSecondToPerTick"/>, which is whole-number arithmetic.
    /// </summary>
    public static class Units
    {
        /// <summary>
        /// A decimal from a data file (for example 1.25) as fixed-point. The same
        /// decimal gives the same result on every machine.
        /// </summary>
        public static int FromFloat(double x)
        {
            // Math.round in the TypeScript: halves go up.
            return unchecked((int)(long)Math.Floor(x * Fixed.ONE + 0.5));
        }

        /// <summary>A duration in seconds as a whole number of ticks, at least one.</summary>
        public static int SecondsToTicks(double seconds, int tickRate)
        {
            return Math.Max(1, (int)Math.Floor(seconds * tickRate + 0.5));
        }

        /// <summary>A fixed-point rate per second (speed, regeneration) as a rate per tick.</summary>
        public static int PerSecondToPerTick(int ratePerSecond, int tickRate)
        {
            return Fixed.Idiv(ratePerSecond, tickRate);
        }
    }
}
