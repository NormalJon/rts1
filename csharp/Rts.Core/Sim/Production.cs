// Ported from src/sim/production.ts. Keep the two in step.

using System;
using static Rts.Sim.EntityTypes;
using static Rts.Sim.Fixed;

namespace Rts.Sim
{
    public sealed class Population
    {
        /// <summary>Units alive, plus units being trained that have had room set aside.</summary>
        public readonly int[] used;
        /// <summary>Room the player's finished buildings provide, up to the limit.</summary>
        public readonly int[] room;

        public Population(int[] used, int[] room)
        {
            this.used = used;
            this.room = room;
        }
    }

    /// <summary>
    /// Training units and researching technology, and the population that
    /// limits the first.
    ///
    /// A building works through its queue one thing at a time. Whatever is
    /// queued is paid for then, and refunded if cancelled. Training a unit does
    /// not begin until there is room for it in the player's population, which is
    /// what houses are for. Research (see Tech.cs) waits in the same queue and
    /// needs no room.
    /// </summary>
    public static class Production
    {
        /// <summary>Each player's population, counted afresh from the world.</summary>
        public static Population CountPopulation(World world)
        {
            var used = new int[world.config.playerCount];
            var room = new int[world.config.playerCount];
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0) continue;
                int owner = world.owner[slot];
                EntityType type = world.TypeOf(slot);
                if (world.mobile[slot] == 1)
                {
                    used[owner] += type.population;
                    continue;
                }
                if (world.built[slot] == 1) room[owner] += type.housing;
                if (world.trainStarted[slot] == 1)
                {
                    used[owner] += world.types[owner][world.trainQueue[slot * TRAIN_QUEUE_LENGTH] - 1].population;
                }
            }
            for (int player = 0; player < room.Length; player++) room[player] = Math.Min(POPULATION_LIMIT, room[player]);
            return new Population(used, room);
        }

        /// <summary>Whether this is a finished building of the player's that can train the unit type, in the age the player has reached.</summary>
        static bool TrainsHere(World world, int player, int id, int unitType)
        {
            if (!world.IsAlive(id)) return false;
            int slot = World.EntityIndex(id);
            return world.mobile[slot] == 0 &&
                world.owner[slot] == player &&
                world.built[slot] == 1 &&
                Array.IndexOf(world.TypeOf(slot).trains, unitType) >= 0 &&
                world.age[player] >= world.types[player][unitType].age;
        }

        /// <summary>Adds a unit to a building's queue and takes its cost. Returns false if it cannot be done.</summary>
        public static bool QueueTraining(World world, int player, int building, int unitType)
        {
            if (!TrainsHere(world, player, building, unitType)) return false;
            int slot = World.EntityIndex(building);
            int waiting = world.trainLength[slot];
            int[] cost = world.types[player][unitType].cost;
            if (waiting >= TRAIN_QUEUE_LENGTH || !world.CanAfford(player, cost)) return false;
            world.Pay(player, cost);
            world.trainQueue[slot * TRAIN_QUEUE_LENGTH + waiting] = (byte)(unitType + 1);
            world.trainLength[slot] = (byte)(waiting + 1);
            return true;
        }

        /// <summary>Takes a unit or a technology out of a building's queue and gives its cost back.</summary>
        public static bool CancelTraining(World world, int player, int building, int index)
        {
            if (!world.IsAlive(building)) return false;
            int slot = World.EntityIndex(building);
            if (world.mobile[slot] == 1 || world.owner[slot] != player) return false;
            int waiting = world.trainLength[slot];
            if (index < 0 || index >= waiting) return false;
            int start = slot * TRAIN_QUEUE_LENGTH;
            world.Refund(player, Techs.QueuedCost(world, player, world.trainQueue[start + index]));
            for (int k = index + 1; k < waiting; k++) world.trainQueue[start + k - 1] = world.trainQueue[start + k];
            world.trainQueue[start + waiting - 1] = 0;
            world.trainLength[slot] = (byte)(waiting - 1);
            if (index == 0)
            {
                // The one in training: its progress is lost and its place in the population freed.
                world.trainTicks[slot] = 0;
                world.trainStarted[slot] = 0;
            }
            return true;
        }

        public static void ProductionSystem(World world)
        {
            Population population = null;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.trainLength[slot] == 0 || world.built[slot] == 0) continue;
                int owner = world.owner[slot];
                int head = world.trainQueue[slot * TRAIN_QUEUE_LENGTH];
                if (head >= Techs.QUEUED_TECH)
                {
                    // Research: nothing to wait for, and nobody to turn out at the end.
                    world.trainTicks[slot] = world.trainTicks[slot] + 1;
                    if (world.trainTicks[slot] < Techs.ResearchTicks(head - Techs.QUEUED_TECH, world.config.tickRate)) continue;
                    Techs.FinishResearch(world, slot, head - Techs.QUEUED_TECH);
                    // Its effects may have changed how much room units take or buildings give.
                    population = null;
                }
                else
                {
                    if (population == null) population = CountPopulation(world);
                    int unitType = head - 1;
                    EntityType type = world.types[owner][unitType];
                    if (world.trainStarted[slot] == 0)
                    {
                        // Waits here, costing nothing more, until there is room.
                        if (population.used[owner] + type.population > population.room[owner]) continue;
                        world.trainStarted[slot] = 1;
                        population.used[owner] += type.population;
                    }
                    world.trainTicks[slot] = world.trainTicks[slot] + 1;
                    if (world.trainTicks[slot] < TrainingTicks(type, world.config.tickRate)) continue;
                    if (!TurnOut(world, slot, unitType)) continue; // nowhere to stand yet; try again next tick
                }
                int start = slot * TRAIN_QUEUE_LENGTH;
                int waiting = world.trainLength[slot];
                for (int k = 1; k < waiting; k++) world.trainQueue[start + k - 1] = world.trainQueue[start + k];
                world.trainQueue[start + waiting - 1] = 0;
                world.trainLength[slot] = (byte)(waiting - 1);
                world.trainTicks[slot] = 0;
                world.trainStarted[slot] = 0;
            }
        }

        /// <summary>
        /// Brings a trained unit into the world beside its building, on the side
        /// nearest the rally point, and sends it there. Returns false if there is
        /// no open ground beside the building or the world is full.
        /// </summary>
        static bool TurnOut(World world, int building, int unitType)
        {
            GameMap map = world.map;
            bool hasRally = world.rallyX[building] >= 0;
            // With no rally point set, units come out of the front, which faces down the screen.
            int towardX = hasRally ? world.rallyX[building] : world.posX[building];
            int towardY = hasRally ? world.rallyY[building] : world.posY[building] + 64 * ONE;
            int reach = (world.TypeOf(building).footprint >> 1) + 1;
            int cx = world.posX[building] >> 16;
            int cy = world.posY[building] >> 16;
            int bestX = 0;
            int bestY = 0;
            int bestDistance = -1;
            for (int oy = -reach; oy <= reach; oy++)
            {
                for (int ox = -reach; ox <= reach; ox++)
                {
                    if (ox != -reach && ox != reach && oy != -reach && oy != reach) continue;
                    if (!map.IsPassable(cx + ox, cy + oy)) continue;
                    int x = (cx + ox) * ONE + HALF;
                    int y = (cy + oy) * ONE + HALF;
                    int distance = Length(x - towardX, y - towardY);
                    if (bestDistance == -1 || distance < bestDistance)
                    {
                        bestX = x;
                        bestY = y;
                        bestDistance = distance;
                    }
                }
            }
            if (bestDistance == -1) return false;
            int id = world.SpawnUnit(world.owner[building], unitType, bestX, bestY);
            if (id == World.NO_ENTITY) return false;
            int slot = World.EntityIndex(id);
            int tile = world.rallyTile[building];
            if (tile >= 0 && world.TypeOf(slot).carries > 0 && ResourceOfTerrain(map.terrain[tile]) != -1)
            {
                // Rallied onto a resource: start work at once.
                if (Economy.AssignGather(world, slot, tile)) return true;
            }
            if (hasRally) Routing.BeginOrder(world, slot, 0, world.rallyX[building], world.rallyY[building]);
            return true;
        }
    }
}
