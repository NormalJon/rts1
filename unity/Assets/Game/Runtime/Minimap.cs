using System;
using System.Collections.Generic;
using Rts.Sim;
using UnityEngine;
using UnityEngine.UIElements;

namespace Rts.Game
{
    /// <summary>
    /// The minimap: the map from straight above as far as the player knows it,
    /// with every unit in sight as a dot, the outline of what the main view is
    /// showing, and a ring that flashes where the player's attention is wanted.
    /// Click it to move the view; right-click it to send the selection there.
    ///
    /// Display only: it reads the world and what the player believes of it.
    /// </summary>
    public sealed class Minimap
    {
        /// <summary>Dots of the picture along one side of a tile.</summary>
        const int DOTS = 2;
        const float PING_SECONDS = 3.6f;
        /// <summary>How dark the veil over ground seen before is, out of 255.</summary>
        const int VEIL = 120;

        struct Flash
        {
            public float x;
            public float y;
            public float born;
        }

        readonly World world;
        readonly GameMap map;
        readonly Sight sight;
        readonly TerrainView terrain;
        readonly BuildingViews buildings;
        readonly ScreenMap screen;
        readonly RtsCamera view;
        readonly Texture2D picture;
        readonly Color32[] dots;
        readonly Color32[] team;
        readonly List<Flash> pings = new List<Flash>();
        readonly Vector2[] corners = new Vector2[4];
        readonly VisualElement lines;
        float seconds;
        bool dragging;
        /// <summary>What the picture was last painted for, so that it is painted again only when that has changed.</summary>
        int paintedTick = -1;
        bool paintedLifted;
        float sincePainted;

        /// <summary>What goes in the display: the picture with the lines drawn over it.</summary>
        public readonly VisualElement element;
        /// <summary>Told when the player right-clicks the map: where, in tiles, and whether shift was held.</summary>
        public Action<float, float, bool> onOrder;

        public Minimap(World world, Sight sight, TerrainView terrain, BuildingViews buildings, ScreenMap screen, RtsCamera view)
        {
            this.world = world;
            this.sight = sight;
            this.terrain = terrain;
            this.buildings = buildings;
            this.screen = screen;
            this.view = view;
            map = world.map;

            picture = new Texture2D(map.width * DOTS, map.height * DOTS, TextureFormat.RGBA32, false)
            {
                name = "Minimap",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Point,
            };
            dots = new Color32[picture.width * picture.height];
            team = new Color32[Palette.TEAM.Length];
            for (int i = 0; i < team.Length; i++) team[i] = Palette.TEAM[i];

            element = new VisualElement { name = "minimap" };
            element.AddToClassList("minimap");
            element.style.backgroundImage = new StyleBackground(picture);
            lines = new VisualElement { name = "minimap-lines" };
            lines.AddToClassList("minimap-lines");
            lines.generateVisualContent += DrawLines;
            element.Add(lines);

            lines.RegisterCallback<PointerDownEvent>(down =>
            {
                Vector2 at = ToTiles(down.localPosition);
                if (down.button == 0)
                {
                    dragging = true;
                    lines.CapturePointer(down.pointerId);
                }
                Press(at.x, at.y, down.button, down.shiftKey);
                down.StopPropagation();
            });
            lines.RegisterCallback<PointerMoveEvent>(move =>
            {
                if (!dragging || !lines.HasPointerCapture(move.pointerId)) return;
                Vector2 at = ToTiles(move.localPosition);
                view.LookAt(at.x, at.y);
            });
            lines.RegisterCallback<PointerUpEvent>(up =>
            {
                dragging = false;
                if (lines.HasPointerCapture(up.pointerId)) lines.ReleasePointer(up.pointerId);
            });
            lines.RegisterCallback<PointerCaptureOutEvent>(_ => dragging = false);
        }

        Vector2 ToTiles(Vector2 local)
        {
            float width = Mathf.Max(1f, lines.layout.width);
            float height = Mathf.Max(1f, lines.layout.height);
            return new Vector2(
                Mathf.Clamp(local.x / width * map.width, 0f, map.width - 0.01f),
                Mathf.Clamp(local.y / height * map.height, 0f, map.height - 0.01f));
        }

        /// <summary>
        /// A press on the map at a place, in tiles. The left button (0) moves the
        /// view there; the right (1) sends the selection.
        /// </summary>
        public void Press(float x, float y, int button, bool shift)
        {
            if (button == 1) onOrder?.Invoke(x, y, shift);
            else if (button == 0) view.LookAt(x, y);
        }

        /// <summary>Flashes a ring on the map, to draw the eye to a place.</summary>
        public void Ping(float x, float y)
        {
            pings.Add(new Flash { x = x, y = y, born = seconds });
        }

        public int Pings => pings.Count;

        /// <summary>The colour of the dot of the picture at the middle of a tile, for checking what is shown.</summary>
        public Color32 DotAt(int tileX, int tileY)
        {
            return dots[(picture.height - 1 - tileY * DOTS) * picture.width + tileX * DOTS];
        }

        /// <param name="selected">Says whether a unit, by its handle, is selected: those show white. May be null.</param>
        public void Draw(float dt, Func<int, bool> selected)
        {
            seconds += dt;
            for (int i = pings.Count - 1; i >= 0; i--)
            {
                if (seconds - pings[i].born >= PING_SECONDS) pings.RemoveAt(i);
            }
            // The lines move with the view and the rings with the clock, so they are drawn every frame.
            screen.ViewCorners(corners);
            lines.MarkDirtyRepaint();
            // The picture under them changes only when the match moves on, the fog is lifted or let
            // fall, or the selection changes; a tenth of a second is soon enough for the last.
            sincePainted += dt;
            if (world.tick == paintedTick && sight.Lifted == paintedLifted && sincePainted < 0.1f) return;
            paintedTick = world.tick;
            paintedLifted = sight.Lifted;
            sincePainted = 0f;

            int wide = picture.width;
            int tall = picture.height;
            Color32 dark = Palette.MINIMAP_DARK;

            // The ground as the player knows it: dark where never seen, veiled where seen before.
            for (int ty = 0; ty < map.height; ty++)
            {
                for (int tx = 0; tx < map.width; tx++)
                {
                    int tile = ty * map.width + tx;
                    Color32 colour;
                    if (sight.SeesTile(tile)) colour = Palette.OnMinimap(terrain.SeenTerrain(tile));
                    else if (sight.KnowsTile(tile)) colour = Veiled(Palette.OnMinimap(terrain.SeenTerrain(tile)), dark);
                    else colour = dark;
                    Fill(tx * DOTS, ty * DOTS, DOTS, DOTS, colour);
                }
            }

            // Buildings the player knows of, in sight or remembered, as squares the size of their footprint.
            foreach (BuildingViews.Shown building in buildings.All)
            {
                EntityType type = EntityTypes.ENTITY_TYPES[building.entityType];
                // Farms show as the ground they are, not as blocks.
                if (type.farm) continue;
                int side = Math.Max(DOTS * 2, type.footprint * DOTS);
                int cx = (int)((building.tileX + 0.5f) * DOTS);
                int cy = (int)((building.tileY + 0.5f) * DOTS);
                Fill(cx - side / 2, cy - side / 2, side, side, team[building.owner % team.Length]);
            }

            // Units, where they can be seen.
            var white = new Color32(255, 255, 255, 255);
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0 || !sight.ShowsNow(slot)) continue;
                int px = (int)(Ground.F(world.posX[slot]) * DOTS);
                int py = (int)(Ground.F(world.posY[slot]) * DOTS);
                bool picked = selected != null && selected(world.IdAt(slot));
                Fill(px - 1, py - 1, DOTS + 1, DOTS + 1, picked ? white : team[world.owner[slot] % team.Length]);
            }

            picture.SetPixels32(dots);
            picture.Apply(false);

            void Fill(int left, int top, int width, int height, Color32 colour)
            {
                for (int y = Math.Max(0, top); y < Math.Min(tall, top + height); y++)
                {
                    // The picture's first row is its bottom one; the map's first row is the north.
                    int row = (tall - 1 - y) * wide;
                    for (int x = Math.Max(0, left); x < Math.Min(wide, left + width); x++) dots[row + x] = colour;
                }
            }
        }

        static Color32 Veiled(Color32 colour, Color32 dark)
        {
            int keep = 255 - VEIL;
            return new Color32(
                (byte)((colour.r * keep + dark.r * VEIL) / 255),
                (byte)((colour.g * keep + dark.g * VEIL) / 255),
                (byte)((colour.b * keep + dark.b * VEIL) / 255),
                255);
        }

        /// <summary>The outline of what the main view shows, and any rings calling for attention.</summary>
        void DrawLines(MeshGenerationContext context)
        {
            float width = lines.layout.width;
            float height = lines.layout.height;
            if (width <= 0f || height <= 0f) return;
            float sx = width / map.width;
            float sy = height / map.height;
            Painter2D painter = context.painter2D;

            foreach (Flash ping in pings)
            {
                float age = (seconds - ping.born) / PING_SECONDS;
                if (age < 0f || age >= 1f) continue;
                // Three quick rings closing in on the spot.
                float pulse = age * 3f % 1f;
                Color colour = Palette.PING;
                colour.a = 1f - age;
                painter.strokeColor = colour;
                painter.lineWidth = 1.5f;
                painter.BeginPath();
                painter.Arc(new Vector2(ping.x * sx, ping.y * sy), 3f + (1f - pulse) * 14f, 0f, 360f);
                painter.Stroke();
            }

            painter.strokeColor = Palette.PARCHMENT;
            painter.lineWidth = 1f;
            painter.BeginPath();
            painter.MoveTo(new Vector2(corners[0].x * sx, corners[0].y * sy));
            for (int i = 1; i < corners.Length; i++) painter.LineTo(new Vector2(corners[i].x * sx, corners[i].y * sy));
            painter.ClosePath();
            painter.Stroke();
        }

        public void Dispose()
        {
            UnityEngine.Object.Destroy(picture);
        }
    }
}
