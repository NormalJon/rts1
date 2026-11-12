// Ported from src/sim/sim.ts. Keep the two in step.

namespace Rts.Sim
{
    /// <summary>
    /// The tick: one fixed step of simulated time.
    ///
    /// Each tick does the same things in the same order: run the commands
    /// stamped for this tick, then run every system. Nothing here reads a clock;
    /// how often Step() is called is the caller's business.
    /// </summary>
    public static class Simulation
    {
        public static void Step(World world)
        {
            foreach (ScheduledCommand entry in world.commands.TakeDue(world.tick)) Orders.ApplyCommand(world, entry);
            Production.ProductionSystem(world);
            Economy.EconomySystem(world);
            Combat.CombatSystem(world);
            Routing.RoutingSystem(world);
            Movement.MovementSystem(world);
            Vision.VisionSystem(world);
            world.tick++;
        }
    }
}
