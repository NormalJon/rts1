// Ported from src/sim/fixed.ts. Keep the two in step.

using System;

namespace Rts.Sim
{
    /// <summary>
    /// Q16.16 fixed-point arithmetic.
    ///
    /// Every number the simulation computes with is an integer in the signed
    /// 32-bit range, where 65536 stands for 1.0. Integer arithmetic gives
    /// bit-identical results on every machine, which is what lets players'
    /// computers stay in sync by exchanging only commands.
    ///
    /// A fixed-point value is a plain <c>int</c>. Where the TypeScript relies on
    /// its numbers holding every integer up to 2^53 exactly, the working here is
    /// done in <c>long</c>, and cut back to 32 bits wherever the TypeScript
    /// writes <c>| 0</c>.
    ///
    /// Range: about -32768 to +32768, in steps of 1/65536. Results that leave
    /// the range wrap around, as 32-bit integers do. All rounding is toward
    /// negative infinity (floor).
    /// </summary>
    public static class Fixed
    {
        public const int FRAC_BITS = 16;
        public const int ONE = 1 << FRAC_BITS;
        public const int HALF = ONE >> 1;
        public const int FIXED_MAX = 0x7fffffff;
        public const int FIXED_MIN = unchecked((int)0x80000000);

        const int FRAC_MASK = ONE - 1;
        /// <summary>Below this magnitude, the sum of two squares is still an exact integer in the TypeScript.</summary>
        const long EXACT_SQUARE_LIMIT = 1L << 26;
        /// <summary>The largest integer a TypeScript number holds exactly: 2^53 - 1.</summary>
        public const long MAX_SAFE_INTEGER = 9007199254740991L;

        /// <summary>floor(a / b) for whole numbers, whatever their signs.</summary>
        static long FloorDiv(long a, long b)
        {
            long q = a / b;
            if (a % b != 0 && (a < 0) != (b < 0)) q--;
            return q;
        }

        public static int FromInt(long n)
        {
            return unchecked((int)(n * ONE));
        }

        /// <summary>The fraction n/d as fixed-point, for writing constants such as 3/4 without floats.</summary>
        public static int FromRatio(long n, long d)
        {
            if (d == 0) throw new ArgumentOutOfRangeException(nameof(d), "fromRatio division by zero");
            return unchecked((int)FloorDiv(n * ONE, d));
        }

        /// <summary>Whole part, rounded down.</summary>
        public static int FloorToInt(int a)
        {
            return a >> FRAC_BITS;
        }

        /// <summary>
        /// For the display layer only (drawing, UI). Never feed the result back
        /// into the simulation.
        /// </summary>
        public static double ToFloat(int a)
        {
            return a / (double)ONE;
        }

        /// <summary>
        /// a times b. As in the TypeScript, a is taken as it comes and b is cut to
        /// 32 bits, then split into its whole and fractional halves.
        /// </summary>
        public static int Mul(long a, int b)
        {
            return unchecked((int)(a * (b >> FRAC_BITS) + ((a * (b & FRAC_MASK)) >> FRAC_BITS)));
        }

        public static int Div(long a, long b)
        {
            if (b == 0) throw new DivideByZeroException("fixed-point division by zero");
            return unchecked((int)FloorDiv(a * ONE, b));
        }

        /// <summary>floor(a / b) for plain integers.</summary>
        public static long Idiv(long a, long b)
        {
            if (b == 0) throw new DivideByZeroException("integer division by zero");
            return FloorDiv(a, b);
        }

        /// <summary>floor(a / b) for plain 32-bit integers.</summary>
        public static int Idiv(int a, int b)
        {
            if (b == 0) throw new DivideByZeroException("integer division by zero");
            return unchecked((int)FloorDiv(a, b));
        }

        /// <summary>
        /// floor(a * b / c) without losing the precision that mul-then-div would.
        /// Works on any integers (fixed or not) as long as a*b stays below 2^53.
        /// </summary>
        public static int MulDiv(long a, long b, long c)
        {
            if (c == 0) throw new DivideByZeroException("mulDiv division by zero");
            long product = checked(a * b);
            if (product > MAX_SAFE_INTEGER || product < -MAX_SAFE_INTEGER)
            {
                throw new OverflowException("mulDiv intermediate product exceeds the exact integer range");
            }
            return unchecked((int)FloorDiv(product, c));
        }

        /// <summary>floor(sqrt(n)) for a non-negative integer below 2^53.</summary>
        public static int Isqrt(long n)
        {
            if (n < 0) throw new ArgumentOutOfRangeException(nameof(n), "square root of a negative number");
            // Math.Sqrt gets within one of the answer; the two loops settle it
            // exactly, so the result never depends on floating-point rounding.
            long r = (long)Math.Sqrt((double)n);
            while (r * r > n) r--;
            while ((r + 1) * (r + 1) <= n) r++;
            return (int)r;
        }

        public static int Sqrt(long a)
        {
            return Isqrt(a * ONE);
        }

        /// <summary>Length of the vector (x, y).</summary>
        public static int Length(long x, long y)
        {
            long ax = x < 0 ? -x : x;
            long ay = y < 0 ? -y : y;
            long scale = 1;
            // Vectors longer than 1024 units are halved until their squares are exact.
            // Nothing on a map is that far apart, so this is a safety net.
            while (ax >= EXACT_SQUARE_LIMIT || ay >= EXACT_SQUARE_LIMIT)
            {
                ax >>= 1;
                ay >>= 1;
                scale *= 2;
            }
            long length = Isqrt(ax * ax + ay * ay) * scale;
            return length < FIXED_MAX ? (int)length : FIXED_MAX;
        }

        public static int Abs(int a)
        {
            return a < 0 ? unchecked(-a) : a;
        }

        public static int Clamp(int a, int lo, int hi)
        {
            return a < lo ? lo : a > hi ? hi : a;
        }

        /// <summary>a + (b - a) * t, with t in fixed-point (0 to ONE).</summary>
        public static int Lerp(int a, int b, int t)
        {
            return unchecked((int)(a + Mul((long)b - a, t)));
        }
    }
}
