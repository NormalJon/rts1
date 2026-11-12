using Rts.Sim;
using UnityEngine;

namespace Rts.Game
{
    /// <summary>
    /// Where things are in the scene. The simulation works in tiles, with x
    /// running east and y running south; the scene works in metres, two to a
    /// tile, so models made at real scale need no adjusting.
    ///
    /// A tile position (x, y) is drawn at (x * 2, height, -y * 2). South is
    /// toward the camera, which keeps the map the way round it is in the
    /// browser version and on any minimap: north at the top, east on the right.
    /// </summary>
    public sealed class Ground
    {
        /// <summary>Metres per tile.</summary>
        public const float TILE = 2f;

        public readonly GameMap map;
        /// <summary>Height in metres at each tile corner, (width + 1) to a row.</summary>
        readonly float[] heights;

        public Ground(GameMap map)
        {
            this.map = map;
            heights = new float[map.elevation.Length];
            for (int i = 0; i < heights.Length; i++) heights[i] = (float)Fixed.ToFloat(map.elevation[i]) * TILE;
        }

        /// <summary>Height in metres at a tile corner.</summary>
        public float CornerHeight(int cx, int cy)
        {
            return heights[cy * (map.width + 1) + cx];
        }

        /// <summary>Ground height in metres at a position in tiles. Matches the drawn triangles exactly.</summary>
        public float HeightAt(float x, float y)
        {
            float cx = Mathf.Clamp(x, 0f, map.width - 1e-4f);
            float cy = Mathf.Clamp(y, 0f, map.height - 1e-4f);
            int tx = (int)cx;
            int ty = (int)cy;
            float fx = cx - tx;
            float fy = cy - ty;
            int row = map.width + 1;
            float h00 = heights[ty * row + tx];
            float h10 = heights[ty * row + tx + 1];
            float h01 = heights[(ty + 1) * row + tx];
            float h11 = heights[(ty + 1) * row + tx + 1];
            // Each tile is two triangles split along the diagonal from its first corner.
            return fx > fy
                ? h00 + (h10 - h00) * fx + (h11 - h10) * fy
                : h00 + (h11 - h01) * fx + (h01 - h00) * fy;
        }

        /// <summary>The point in the scene on the ground at a position in tiles.</summary>
        public Vector3 Place(float x, float y, float lift = 0f)
        {
            return new Vector3(x * TILE, HeightAt(x, y) + lift, -y * TILE);
        }

        /// <summary>A scene point's position in tiles.</summary>
        public static Vector2 TileOf(Vector3 scene)
        {
            return new Vector2(scene.x / TILE, -scene.z / TILE);
        }

        /// <summary>The way a simulation direction points in the scene, along the ground.</summary>
        public static Vector3 Direction(float dx, float dy)
        {
            return new Vector3(dx, 0f, -dy);
        }

        /// <summary>A simulation number (16.16 fixed point) as a float, for drawing only.</summary>
        public static float F(int value)
        {
            return value / 65536f;
        }
    }
}
