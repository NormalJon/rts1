// Ported from src/sim/buildings.ts. Keep the two in step.

using static Rts.Sim.EntityTypes;

namespace Rts.Sim
{
    /// <summary>
    /// Putting buildings on the map and taking them off again.
    ///
    /// A building is paid for when it is founded and blocks its ground from that
    /// moment, finished or not. Founding one is the only way an obstacle can
    /// appear in the middle of a match, so this is also where routes laid across
    /// that ground are sent back to be worked out again.
    /// </summary>
    public static class Buildings
    {
        /// <summary>
        /// Whether a building of this type could be founded with its centre on a tile.
        /// </summary>
        /// <param name="player">
        /// If given (not -1), the plot must also be ground that player's side has
        /// explored: nobody builds on land they have never seen.
        /// </param>
        public static bool CanPlace(World world, int entityType, int tileX, int tileY, int player = -1)
        {
            if (entityType < 0 || entityType >= ENTITY_TYPES.Length) return false;
            EntityType type = ENTITY_TYPES[entityType];
            if (!type.building) return false;
            GameMap map = world.map;
            int half = type.footprint >> 1;
            for (int ty = tileY - half; ty <= tileY + half; ty++)
            {
                for (int tx = tileX - half; tx <= tileX + half; tx++)
                {
                    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
                    int tile = ty * map.width + tx;
                    // Open grass only: not water, a ford, trees, rock, a deposit or another building.
                    if (map.terrain[tile] != Terrain.Grass || map.blocked[tile] == 1) return false;
                    if (player != -1 && !Vision.HasExplored(world, player, tile)) return false;
                }
            }
            return true;
        }

        /// <summary>
        /// Founds a building: takes its cost from the player's stores and marks
        /// out the site. Returns its handle, or NO_ENTITY if it cannot go there or
        /// cannot be afforded. Units standing on the plot step off it.
        /// </summary>
        public static int Found(World world, int player, int entityType, int tileX, int tileY)
        {
            EntityType[] types = world.types[player];
            if (entityType < 0 || entityType >= types.Length) return World.NO_ENTITY;
            EntityType type = types[entityType];
            if (!type.building || !type.buildable || world.age[player] < type.age) return World.NO_ENTITY;
            if (!CanPlace(world, entityType, tileX, tileY, player) || !world.CanAfford(player, type.cost)) return World.NO_ENTITY;
            int id = world.SpawnBuilding(player, entityType, tileX, tileY, false);
            if (id == World.NO_ENTITY) return World.NO_ENTITY;
            world.Pay(player, type.cost);
            int half = type.footprint >> 1;
            ClearThePlot(world, tileX - half, tileY - half, type.footprint);
            Routing.RoutesAfterObstacle(world);
            return id;
        }

        /// <summary>Moves units off ground that has just been built on, to the nearest open tile.</summary>
        static void ClearThePlot(World world, int left, int top, int size)
        {
            GameMap map = world.map;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0) continue;
                int tx = world.posX[slot] >> 16;
                int ty = world.posY[slot] >> 16;
                if (tx < left || ty < top || tx >= left + size || ty >= top + size) continue;
                int refuge = map.NearestPassable(tx, ty);
                if (refuge == -1) continue;
                world.posX[slot] = map.CentreX(refuge);
                world.posY[slot] = map.CentreY(refuge);
                if (world.moveState[slot] == MoveState.Idle)
                {
                    world.goalX[slot] = world.posX[slot];
                    world.goalY[slot] = world.posY[slot];
                }
                else
                {
                    Routing.ChooseRoute(world, slot);
                }
            }
        }

        /// <summary>
        /// Pulls down a player's own building. An unfinished one gives back what
        /// it cost; units and research it had queued give back theirs either way.
        /// </summary>
        public static bool Demolish(World world, int player, int id)
        {
            if (!world.IsAlive(id)) return false;
            int slot = World.EntityIndex(id);
            if (world.mobile[slot] == 1 || world.owner[slot] != player) return false;
            EntityType type = world.TypeOf(slot);
            if (world.built[slot] == 0) world.Refund(player, type.cost);
            for (int k = 0; k < world.trainLength[slot]; k++)
            {
                world.Refund(player, Techs.QueuedCost(world, player, world.trainQueue[slot * TRAIN_QUEUE_LENGTH + k]));
            }
            world.Destroy(id);
            return true;
        }
    }
}
