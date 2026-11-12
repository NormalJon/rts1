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
        /// <summary>Selection rings, the outline of a selected building and the drag box.</summary>
        public static readonly Color PARCHMENT = Hex(0xf4f1e4);
        public static readonly Color POLE = Hex(0x6b4a2b);
        /// <summary>The marks left where an order was given, in the order of MarkerKind: move, waypoint, work, attack.</summary>
        public static readonly Color[] MARKER = { Hex(0xbfe38a), Hex(0xe9c46a), Hex(0xf0d9a0), Hex(0xf08a7a) };
        public static readonly Color PLOT_ALLOWED = Hex(0x9fdc6b);
        public static readonly Color PLOT_REFUSED = Hex(0xe0584a);
        /// <summary>The ring that flashes on the minimap where the player's attention is wanted.</summary>
        public static readonly Color PING = Hex(0xffd678);
        /// <summary>Ground never seen, on the minimap.</summary>
        public static readonly Color32 MINIMAP_DARK = new Color32(14, 18, 16, 255);

        static readonly Color32 UNKNOWN_ON_MINIMAP = new Color32(255, 0, 255, 255);
        static readonly Color32[] MINIMAP = new Color32[Terrain.Field + 1];

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

            MINIMAP[Terrain.Grass] = new Color32(118, 146, 84, 255);
            MINIMAP[Terrain.Forest] = new Color32(56, 84, 52, 255);
            MINIMAP[Terrain.Shallows] = new Color32(150, 178, 170, 255);
            MINIMAP[Terrain.Water] = new Color32(52, 96, 124, 255);
            MINIMAP[Terrain.Rock] = new Color32(128, 126, 120, 255);
            MINIMAP[Terrain.Berries] = new Color32(150, 72, 96, 255);
            MINIMAP[Terrain.Stone] = new Color32(196, 194, 186, 255);
            MINIMAP[Terrain.Gold] = new Color32(226, 186, 60, 255);
            MINIMAP[Terrain.Field] = new Color32(158, 138, 84, 255);
        }

        /// <summary>The colour of each kind of terrain on the minimap, where it has to be told apart at a glance.</summary>
        public static Color32 OnMinimap(int terrain)
        {
            return terrain >= 0 && terrain < MINIMAP.Length ? MINIMAP[terrain] : UNKNOWN_ON_MINIMAP;
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
