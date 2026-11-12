using Rts.Sim;

namespace Rts.Tests.Rules
{
    /// <summary>
    /// What the rule-by-rule tests share: small worlds drawn by hand, a way to
    /// give orders, and a way to run ticks while checking after every one that
    /// nothing that must always hold has been broken. Each TypeScript test file
    /// has its own copy of these few helpers at the top; here they are written
    /// once.
    ///
    /// xUnit makes a new object for every test, so each test numbers its
    /// commands from nought. (The TypeScript numbers them through a whole file.
    /// The number only decides the order of one player's commands within one
    /// tick, so it comes to the same thing.)
    /// </summary>
    public abstract class Scenario
    {
        int seq = 0;

        /// <summary>A world on a hand-drawn map, with any other settings changed by `overrides`.</summary>
        protected static World WorldFrom(string[] rows, Action<SimConfig> overrides = null)
        {
            var config = new SimConfig { mapWidth = rows[0].Length, mapHeight = rows.Length, map = MapSpec.Ascii(rows) };
            overrides?.Invoke(config);
            return new World(config);
        }

        /// <summary>A square world of open grass.</summary>
        protected static World FlatWorld(int size, Action<SimConfig> overrides = null)
        {
            var config = new SimConfig { mapWidth = size, mapHeight = size };
            overrides?.Invoke(config);
            return new World(config);
        }

        /// <summary>Gives a command, to run on the next tick.</summary>
        protected void Send(World world, int player, Command command)
        {
            world.commands.Schedule(new ScheduledCommand(world.tick, player, seq++, command), world.tick);
        }

        protected void Move(World world, int player, int[] units, double x, double y, bool queue = false)
        {
            Send(world, player, Command.Move(units, F(x), F(y), queue));
        }

        /// <summary>Runs ticks, checking after each that nothing is broken. Stops early once done() is true.</summary>
        protected static int Run(World world, int ticks, Func<bool> done = null)
        {
            for (int i = 0; i < ticks; i++)
            {
                Simulation.Step(world);
                string broken = Helpers.BrokenInvariant(world);
                if (broken != null) Assert.Fail($"tick {world.tick}: {broken}");
                if (done != null && done()) return i + 1;
            }
            return ticks;
        }

        /// <summary>A decimal number of tiles as the simulation's fixed-point.</summary>
        protected static int F(double x) => Units.FromFloat(x);

        protected static int SlotOf(int id) => World.EntityIndex(id);

        protected static double XOf(World world, int id) => Fixed.ToFloat(world.posX[SlotOf(id)]);

        protected static double YOf(World world, int id) => Fixed.ToFloat(world.posY[SlotOf(id)]);

        /// <summary>The length of the vector (x, y): Math.hypot in the TypeScript.</summary>
        protected static double Hypot(double x, double y) => Math.Sqrt(x * x + y * y);

        protected static double DistanceTo(World world, int id, double x, double y)
        {
            return Hypot(XOf(world, id) - x, YOf(world, id) - y);
        }

        /// <summary>Whether two numbers agree to a number of decimal places, as toBeCloseTo does in the TypeScript.</summary>
        protected static void AssertCloseTo(double expected, double actual, int digits)
        {
            Assert.True(Math.Abs(expected - actual) < Math.Pow(10, -digits) / 2, $"expected about {expected}, got {actual}");
        }

        /// <summary>A unit's handle list for a command.</summary>
        protected static int[] Ids(params int[] ids) => ids;
    }
}
