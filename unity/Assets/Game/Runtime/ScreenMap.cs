using Rts.Sim;
using UnityEngine;
using Terrain = Rts.Sim.Terrain;

namespace Rts.Game
{
    /// <summary>What a point on the screen is over.</summary>
    public enum PickKind
    {
        /// <summary>Off the map altogether.</summary>
        Nothing,
        /// <summary>A tree, bush or deposit: `tile` says which.</summary>
        Tile,
        /// <summary>A building the player knows of: `id` is its handle.</summary>
        Building,
        /// <summary>Bare ground at (x, y), in tiles.</summary>
        Ground,
    }

    public struct Pick
    {
        public PickKind kind;
        public int tile;
        public int id;
        public float x;
        public float y;
    }

    /// <summary>
    /// Answers questions about what is where on the screen: which patch of
    /// ground a pointer is over, what stands there as far as the player knows,
    /// and where on the screen something on the map appears.
    ///
    /// Screen positions are in pixels from the bottom left, as the engine
    /// gives them. Map positions are in tiles.
    /// </summary>
    public sealed class ScreenMap
    {
        /// <summary>How tall a building is taken to be, in metres, for clicking on it.</summary>
        const float BUILDING_HEIGHT = 6.5f;

        readonly Camera lens;
        readonly Ground ground;
        readonly GameMap map;
        readonly Sight sight;
        readonly TerrainView terrain;
        readonly BuildingViews buildings;

        public ScreenMap(Camera lens, Ground ground, Sight sight, TerrainView terrain, BuildingViews buildings)
        {
            this.lens = lens;
            this.ground = ground;
            this.sight = sight;
            this.terrain = terrain;
            this.buildings = buildings;
            map = ground.map;
        }

        public float Width => lens.pixelWidth;
        public float Height => lens.pixelHeight;

        /// <summary>How tall the thing standing on each kind of resource tile is, in metres, for clicking on it.</summary>
        static float PropHeight(int terrain)
        {
            switch (terrain)
            {
                case Terrain.Forest: return 6f;
                case Terrain.Berries: return 1.2f;
                case Terrain.Stone: return 1.5f;
                case Terrain.Gold: return 1.5f;
                default: return 0f;
            }
        }

        Ray Aim(Vector2 screen)
        {
            return lens.ScreenPointToRay(new Vector3(screen.x, screen.y, 0f));
        }

        /// <summary>How high a point along a ray is above the ground beneath it.</summary>
        float Above(Ray ray, float t)
        {
            Vector3 at = ray.origin + ray.direction * t;
            return at.y - ground.HeightAt(at.x / Ground.TILE, -at.z / Ground.TILE);
        }

        /// <summary>How far along a ray it meets the ground, or a negative number if it never comes down.</summary>
        float GroundDistance(Ray ray)
        {
            if (ray.direction.y >= -1e-4f) return -1f;
            // Walk down the ray until it dips below the ground, then narrow it down.
            float near = Mathf.Max(0f, (ray.origin.y - 14f) / -ray.direction.y);
            float far = (ray.origin.y + 3f) / -ray.direction.y;
            float stride = (far - near) / 40f;
            float hit = far;
            if (stride > 0f)
            {
                for (float t = near; t <= far; t += stride)
                {
                    if (Above(ray, t) <= 0f)
                    {
                        hit = t;
                        break;
                    }
                    near = t;
                }
            }
            for (int i = 0; i < 12; i++)
            {
                float mid = (near + hit) / 2f;
                if (Above(ray, mid) > 0f) near = mid;
                else hit = mid;
            }
            return hit;
        }

        /// <summary>The point on the ground under a screen position, in tiles. False if it misses the map.</summary>
        public bool ScreenToGround(Vector2 screen, out Vector2 tile)
        {
            tile = default;
            Ray ray = Aim(screen);
            float hit = GroundDistance(ray);
            if (hit < 0f) return false;
            Vector3 at = ray.origin + ray.direction * hit;
            float x = at.x / Ground.TILE;
            float y = -at.z / Ground.TILE;
            if (x < 0f || y < 0f || x >= map.width || y >= map.height) return false;
            tile = new Vector2(x, y);
            return true;
        }

        /// <summary>
        /// What a screen position is over: a tree or deposit, a building, or bare
        /// ground. Tall things are hit where they are seen, not where the ground
        /// behind them is. It answers from what the player believes is there:
        /// the terrain as last seen, and the buildings known of.
        /// </summary>
        public Pick Pick(Vector2 screen)
        {
            Ray ray = Aim(screen);
            float hit = GroundDistance(ray);
            if (hit < 0f) return default;
            // Come down the last stretch of the ray a quarter of a metre at a time.
            for (float t = Mathf.Max(0f, hit - 16f); t < hit; t += 0.25f)
            {
                Vector3 at = ray.origin + ray.direction * t;
                float x = at.x / Ground.TILE;
                float y = -at.z / Ground.TILE;
                if (Classify(x, y, at.y - ground.HeightAt(x, y), out Pick found)) return found;
            }
            Vector3 end = ray.origin + ray.direction * hit;
            float gx = end.x / Ground.TILE;
            float gy = -end.z / Ground.TILE;
            if (gx < 0f || gy < 0f || gx >= map.width || gy >= map.height) return default;
            if (Classify(gx, gy, 0f, out Pick onGround)) return onGround;
            return new Pick { kind = PickKind.Ground, x = gx, y = gy };
        }

        bool Classify(float x, float y, float lift, out Pick found)
        {
            found = default;
            if (x < 0f || y < 0f || x >= map.width || y >= map.height) return false;
            int tile = (int)y * map.width + (int)x;
            if (!sight.KnowsTile(tile)) return false;
            int believed = terrain.SeenTerrain(tile);
            // A farm is clicked as a building, not as nine tiles of crop.
            if (believed != Terrain.Field && EntityTypes.ResourceOfTerrain(believed) != -1 && lift <= PropHeight(believed))
            {
                found = new Pick { kind = PickKind.Tile, tile = tile, x = x, y = y };
                return true;
            }
            int id = buildings.BuildingOn(tile);
            if (id != World.NO_ENTITY)
            {
                // A farm lies flat: only a click on the ground it covers is a click on it.
                bool flat = EntityTypes.ENTITY_TYPES[buildings.Known(id).entityType].farm;
                if (lift <= (flat ? 0.5f : BUILDING_HEIGHT))
                {
                    found = new Pick { kind = PickKind.Building, id = id, x = x, y = y };
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Where a point above the ground appears on screen, in pixels from the
        /// bottom left. The third number is positive when it is in front of the camera.
        /// </summary>
        public Vector3 ToScreen(float x, float y, float lift)
        {
            return lens.WorldToScreenPoint(ground.Place(x, y, lift));
        }

        /// <summary>Whether a point returned by ToScreen is in front of the camera and within its reach.</summary>
        public bool InFront(Vector3 screen)
        {
            return screen.z > lens.nearClipPlane && screen.z < lens.farClipPlane;
        }

        /// <summary>The ground under the four corners of the screen, in tiles, clockwise from top left.</summary>
        public void ViewCorners(Vector2[] corners)
        {
            float w = Width;
            float h = Height;
            Corner(new Vector2(0f, h), out corners[0]);
            Corner(new Vector2(w, h), out corners[1]);
            Corner(new Vector2(w, 0f), out corners[2]);
            Corner(new Vector2(0f, 0f), out corners[3]);
        }

        void Corner(Vector2 screen, out Vector2 tile)
        {
            Ray ray = Aim(screen);
            float t = ray.direction.y < -1e-4f ? ray.origin.y / -ray.direction.y : 0f;
            Vector3 at = ray.origin + ray.direction * t;
            tile = new Vector2(at.x / Ground.TILE, -at.z / Ground.TILE);
        }
    }
}
