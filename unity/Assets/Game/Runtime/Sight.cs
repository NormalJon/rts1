using Rts.Sim;
using UnityEngine;

namespace Rts.Game
{
    /// <summary>
    /// What the viewer's side can see, and the fog drawn over what it cannot.
    ///
    /// The rules of the fog are the simulation's (Vision.cs): it counts who
    /// sees each tile and remembers every tile ever seen. This only reads
    /// that, for the display: which units to draw, what may be clicked, and
    /// how bright the ground is. Nothing here changes what happens in a match.
    /// </summary>
    public sealed class Sight
    {
        /// <summary>How bright the ground is drawn: never seen, seen before, and in sight now.</summary>
        public const float FOG_UNEXPLORED = 0f;
        public const float FOG_EXPLORED = 0.42f;
        public const float FOG_VISIBLE = 1f;
        /// <summary>How fast the fog rolls back and closes in, as a share of the way per second.</summary>
        const float FOG_EASE = 7f;

        static readonly int FOG_MAP = Shader.PropertyToID("_RtsFogMap");
        static readonly int FOG_SCALE = Shader.PropertyToID("_RtsFogScale");
        static readonly int FOG_DARK = Shader.PropertyToID("_RtsFogDark");

        readonly World world;
        readonly GameMap map;
        /// <summary>How bright each tile is drawn just now, easing toward what the viewer's side sees.</summary>
        readonly float[] shown;
        readonly byte[] pixels;
        readonly Texture2D picture;
        bool lifted;

        /// <summary>The player through whose eyes the match is shown.</summary>
        public readonly int viewer;

        public Sight(World world, int viewer, bool lifted)
        {
            this.world = world;
            this.viewer = viewer;
            this.lifted = lifted;
            map = world.map;
            shown = new float[map.tileCount];
            pixels = new byte[map.tileCount];
            // The fog is a picture of the map, a dot to a tile, saying how bright
            // to draw whatever stands there.
            picture = new Texture2D(map.width, map.height, TextureFormat.R8, false, true)
            {
                name = "Fog",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
            };
            Update(1000f);
            Shader.SetGlobalTexture(FOG_MAP, picture);
            Shader.SetGlobalVector(FOG_SCALE, new Vector4(1f / (map.width * Ground.TILE), 1f / (map.height * Ground.TILE), 0f, 0f));
            Shader.SetGlobalVector(FOG_DARK, Palette.BACKGROUND.linear);
        }

        /// <summary>Whether everything is being drawn regardless of the fog.</summary>
        public bool Lifted => lifted;

        /// <summary>
        /// Lifts the fog for a look round, or lets it fall again. A testing aid:
        /// the simulation's rules are unchanged either way.
        /// </summary>
        public void Lift(bool lift)
        {
            lifted = lift;
        }

        /// <summary>Whether there is any fog on the picture at the moment. When there is none, drawing it can be skipped.</summary>
        public bool AnyFog { get; private set; }

        public Texture2D Picture => picture;

        bool Everything => lifted || world.config.mapState == MapState.Revealed;

        public bool OnViewersSide(int owner)
        {
            return world.view[owner] == world.view[viewer];
        }

        /// <summary>Whether the viewer's side has anyone looking at a tile right now.</summary>
        public bool SeesTile(int tile)
        {
            return Everything || world.seen[world.view[viewer]][tile] > 0;
        }

        /// <summary>Whether the viewer's side has ever seen a tile.</summary>
        public bool KnowsTile(int tile)
        {
            return SeesTile(tile) || world.explored[world.view[viewer]][tile] == 1;
        }

        /// <summary>Whether a living unit or building is in the viewer's sight right now.</summary>
        public bool ShowsNow(int slot)
        {
            return lifted || OnViewersSide(world.owner[slot]) || Vision.CanSee(world, viewer, slot);
        }

        /// <summary>How bright a tile should be drawn once the fog has settled.</summary>
        public float Wanted(int tile)
        {
            if (Everything || world.seen[world.view[viewer]][tile] > 0) return FOG_VISIBLE;
            return world.explored[world.view[viewer]][tile] == 1 ? FOG_EXPLORED : FOG_UNEXPLORED;
        }

        /// <summary>How bright a tile is drawn just now, from 0 to 1.</summary>
        public float Shown(int tile) => shown[tile];

        /// <summary>Brings the drawn fog straight to what the viewer's side now sees, with no easing.</summary>
        public void Settle()
        {
            Update(1000f);
        }

        /// <summary>Eases the drawn fog toward what the viewer's side now sees.</summary>
        public void Update(float dt)
        {
            int view = world.view[viewer];
            ushort[] seen = world.seen[view];
            byte[] explored = world.explored[view];
            bool all = Everything;
            float ease = Mathf.Min(1f, dt * FOG_EASE);
            bool changed = false;
            bool any = false;
            for (int tile = 0; tile < shown.Length; tile++)
            {
                float want = all || seen[tile] > 0 ? FOG_VISIBLE : explored[tile] == 1 ? FOG_EXPLORED : FOG_UNEXPLORED;
                float now = shown[tile];
                if (now != want)
                {
                    now = Mathf.Abs(want - now) < 0.01f ? want : now + (want - now) * ease;
                    shown[tile] = now;
                    pixels[tile] = (byte)Mathf.RoundToInt(now * 255f);
                    changed = true;
                }
                if (now < 1f) any = true;
            }
            AnyFog = any;
            if (!changed) return;
            picture.SetPixelData(pixels, 0);
            picture.Apply(false);
        }

        public void Dispose()
        {
            Object.Destroy(picture);
        }
    }
}
