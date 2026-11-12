using UnityEngine;
using Terrain = Rts.Sim.Terrain;

namespace Rts.Game
{
    /// <summary>The game's colours, as in the browser version (src/client/game/view.ts).</summary>
    public static class Palette
    {
        /// <summary>Player colours, named for the heraldic tinctures: azure, gules, or, vert.</summary>
        public static readonly Color[] TEAM =
        {
            Hex(0x2c5aa8), Hex(0xb3312c), Hex(0xd6a21e), Hex(0x2f7d46),
            Hex(0x7a4aa0), Hex(0xd07a2a), Hex(0x3aa6a0), Hex(0x8a8f98),
        };

        public static readonly string[] TEAM_NAMES = { "Blue", "Red", "Gold", "Green", "Purple", "Orange", "Teal", "Grey" };

        public static readonly Color BACKGROUND = Hex(0x141a17);
        public static readonly Color WATER = Hex(0x2a6788);
        public static readonly Color PLOT = Hex(0x8a7556);
        public static readonly Color ARROW = Hex(0xefe6cf);
        public static readonly Color SUN = Hex(0xfff1dc);
        public static readonly Color GROUND_LIGHT = Hex(0x59604f);
        public static readonly Color BAR_BACK = Hex(0x10140f);
        public static readonly Color[] BAR = { Hex(0x7cc65a), Hex(0xe2b23c), Hex(0xdc5a45) };

        static readonly Color UNKNOWN_TERRAIN = Hex(0xff00ff);
        static readonly Color[] TERRAIN = new Color[Terrain.Field + 1];

        static Palette()
        {
            TERRAIN[Terrain.Grass] = Hex(0x7f9b58);
            TERRAIN[Terrain.Forest] = Hex(0x566f43);
            TERRAIN[Terrain.Shallows] = Hex(0xc4bb8f);
            TERRAIN[Terrain.Water] = Hex(0x3f5557);
            TERRAIN[Terrain.Rock] = Hex(0x8d8b85);
            TERRAIN[Terrain.Berries] = Hex(0x6f8c50);
            TERRAIN[Terrain.Stone] = Hex(0x8f8a78);
            TERRAIN[Terrain.Gold] = Hex(0x8d8263);
            TERRAIN[Terrain.Field] = Hex(0x8a7a4e);
        }

        /// <summary>The ground under each kind of terrain.</summary>
        public static Color Ground(int terrain)
        {
            return terrain >= 0 && terrain < TERRAIN.Length ? TERRAIN[terrain] : UNKNOWN_TERRAIN;
        }

        public static Color Hex(int rgb)
        {
            return new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f, 1f);
        }

        /// <summary>
        /// A number from 0 to 1 that is always the same for the same tile, for
        /// giving the ground and what stands on it a little variety. The same
        /// sum as tileNoise in the browser version, so both draw the same map.
        /// </summary>
        public static float TileNoise(int x, int y)
        {
            unchecked
            {
                int h = (x * 0x27d4eb2d) ^ (y * 0x165667b1);
                h = (h ^ (int)((uint)h >> 15)) * 0x2c1b3c6d;
                return (float)((uint)(h ^ (int)((uint)h >> 13)) / 4294967295.0);
            }
        }
    }
}
