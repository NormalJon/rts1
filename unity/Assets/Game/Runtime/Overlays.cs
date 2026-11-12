using System;
using System.Collections.Generic;
using Rts.Sim;
using UnityEngine;
using UnityEngine.Rendering;

namespace Rts.Game
{
    /// <summary>What an order marker says: where to go, a waypoint, work to do, or something to attack.</summary>
    public enum MarkerKind
    {
        Move,
        Queue,
        Work,
        Attack,
    }

    /// <summary>
    /// The small things drawn afresh every frame and in bulk: arrows in the
    /// air, the health bars over the hurt, the rings under whoever is
    /// selected, the marks left where an order was given, and the plot shown
    /// under the pointer while choosing where to build.
    /// </summary>
    public sealed class Overlays
    {
        const int PER_CALL = 1023;
        const float MARKER_SECONDS = 0.8f;
        static readonly int BASE_COLOUR = Shader.PropertyToID("_BaseColor");

        sealed class Batch
        {
            public Mesh mesh;
            public Material material;
            public Matrix4x4[] placed = new Matrix4x4[PER_CALL];
            public int count;

            public void Add(Matrix4x4 at)
            {
                if (count < placed.Length) placed[count++] = at;
            }

            public void Draw(Bounds bounds, bool shadows)
            {
                if (count == 0) return;
                var how = new RenderParams(material)
                {
                    worldBounds = bounds,
                    shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off,
                    receiveShadows = false,
                };
                Graphics.RenderMeshInstanced(how, mesh, 0, placed, count);
                count = 0;
            }
        }

        struct Marker
        {
            public float x;
            public float y;
            public MarkerKind kind;
            public float born;
        }

        readonly World world;
        readonly Ground ground;
        readonly Sight sight;
        readonly Bounds bounds;
        readonly Batch arrows;
        readonly Batch barBacks;
        /// <summary>Health bars by how full: sound, hurt, and nearly gone.</summary>
        readonly Batch[] barFills = new Batch[3];
        readonly Batch rings;
        readonly List<Marker> markers = new List<Marker>();
        readonly Mesh markerMesh;
        readonly Mesh sheet;
        readonly Material overlay;
        readonly MaterialPropertyBlock tint = new MaterialPropertyBlock();
        Quaternion facing = Quaternion.identity;
        Vector3 right = Vector3.right;
        Vector3 toward = Vector3.back;
        float seconds;

        bool plotShown;
        Vector3 plotAt;
        float plotSpan;
        bool plotAllowed;

        public Overlays(World world, Ground ground, ModelLibrary library, Sight sight, Bounds bounds)
        {
            this.world = world;
            this.ground = ground;
            this.sight = sight;
            this.bounds = bounds;
            arrows = new Batch { mesh = Box(0.06f, 0.06f, 1.1f), material = Tinted(library.arrow, Palette.ARROW, "Arrow") };
            Mesh card = Card();
            barBacks = new Batch { mesh = card, material = Tinted(library.barBack, Palette.BAR_BACK, "Bar back") };
            for (int i = 0; i < barFills.Length; i++)
            {
                barFills[i] = new Batch { mesh = card, material = Tinted(library.barFill, Palette.BAR[i], "Bar " + i) };
            }
            Color ring = Palette.PARCHMENT;
            ring.a = 0.95f;
            rings = new Batch { mesh = Ring(0.87f, 1f, 28), material = Tinted(library.overlay, ring, "Selection ring") };
            markerMesh = Ring(0.78f, 1f, 32);
            sheet = BuildingViews.Sheet();
            overlay = library.overlay;
        }

        /// <summary>A copy of a material in a colour of its own, able to draw many copies at once.</summary>
        public static Material Tinted(Material source, Color colour, string name)
        {
            var material = new Material(source) { name = name, enableInstancing = true };
            material.SetColor(BASE_COLOUR, colour);
            return material;
        }

        /// <summary>Tells the bars which way to turn to face the camera.</summary>
        public void Face(Transform camera)
        {
            facing = camera.rotation;
            right = camera.right;
            toward = -camera.forward;
        }

        /// <summary>Queues a health bar for this frame: centred on a point, so wide, and so full.</summary>
        public void AddBar(Vector3 centre, float width, float fraction)
        {
            float full = Mathf.Clamp01(fraction);
            barBacks.Add(Matrix4x4.TRS(centre, facing, new Vector3(width + 0.1f, 0.22f, 1f)));
            Batch fill = barFills[full > 0.6f ? 0 : full > 0.3f ? 1 : 2];
            Vector3 at = centre - right * (width * (1f - full) / 2f) + toward * 0.03f;
            fill.Add(Matrix4x4.TRS(at, facing, new Vector3(Mathf.Max(0.001f, width * full), 0.12f, 1f)));
        }

        /// <summary>How many health bars, selection rings and arrows the last frame drew.</summary>
        public int BarsDrawn { get; private set; }
        public int RingsDrawn { get; private set; }
        public int ArrowsDrawn { get; private set; }

        /// <summary>Queues a ring on the ground for this frame, under someone who is selected.</summary>
        public void AddRing(Vector3 at, float radius)
        {
            rings.Add(Matrix4x4.TRS(at, Quaternion.identity, new Vector3(radius, 1f, radius)));
        }

        /// <summary>Shows a ring on the ground where an order was given. It closes in and fades in under a second.</summary>
        public void AddMarker(float x, float y, MarkerKind kind)
        {
            markers.Add(new Marker { x = x, y = y, kind = kind, born = seconds });
        }

        public int Markers => markers.Count;

        /// <summary>Shows where a building would go, green if it can and red if it cannot.</summary>
        public void ShowPlot(int tileX, int tileY, int size, bool allowed)
        {
            float x = tileX + 0.5f;
            float y = tileY + 0.5f;
            plotShown = true;
            plotAt = ground.Place(x, y, 0.15f);
            plotSpan = size * Ground.TILE;
            plotAllowed = allowed;
        }

        public void HidePlot()
        {
            plotShown = false;
        }

        /// <summary>Whether a plot is being shown under the pointer, and whether it is the green one.</summary>
        public bool PlotShown => plotShown;
        public bool PlotAllowed => plotAllowed;

        /// <summary>Queues every arrow in the air, part-way along its arc.</summary>
        public void AddArrows(float alpha, UnitViews units)
        {
            int[] shots = world.shots;
            GameMap map = world.map;
            for (int i = 0; i < world.shotCount; i++)
            {
                int row = i * World.SHOT_FIELDS;
                int target = shots[row + 3];
                if (!world.IsAlive(target)) continue;
                int to = World.EntityIndex(target);
                int source = shots[row + 2];
                bool fromTower = world.IsAlive(source) && world.mobile[World.EntityIndex(source)] == 0;
                float fromX = Ground.F(shots[row]);
                float fromY = Ground.F(shots[row + 1]);
                float fromLift = ground.HeightAt(fromX, fromY) + (fromTower ? 5f : 1.5f);
                bool mobile = world.mobile[to] == 1;
                float toX = mobile ? units.DrawnX(to) : Ground.F(world.posX[to]);
                float toY = mobile ? units.DrawnY(to) : Ground.F(world.posY[to]);
                float toLift = ground.HeightAt(toX, toY) + (mobile ? 1.1f : 2.2f);
                float flight = Math.Max(1, shots[row + 6] - shots[row + 5]);
                float gone = Mathf.Clamp01((world.tick - 1 + alpha - shots[row + 5]) / flight);
                float arc = Mathf.Min(3.2f, Mathf.Sqrt((toX - fromX) * (toX - fromX) + (toY - fromY) * (toY - fromY)) * Ground.TILE * 0.13f);

                Vector3 Along(float t)
                {
                    return new Vector3(
                        (fromX + (toX - fromX) * t) * Ground.TILE,
                        fromLift + (toLift - fromLift) * t + Mathf.Sin(Mathf.PI * t) * arc,
                        -(fromY + (toY - fromY) * t) * Ground.TILE);
                }

                // An arrow is seen only while it is over ground that is in sight.
                int overX = Mathf.Clamp((int)(fromX + (toX - fromX) * gone), 0, map.width - 1);
                int overY = Mathf.Clamp((int)(fromY + (toY - fromY) * gone), 0, map.height - 1);
                if (!sight.SeesTile(overY * map.width + overX)) continue;
                Vector3 heading = Along(Mathf.Min(1f, gone + 0.04f)) - Along(Mathf.Max(0f, gone - 0.04f));
                if (heading.sqrMagnitude < 1e-8f) continue;
                arrows.Add(Matrix4x4.TRS(Along(gone), Quaternion.LookRotation(heading.normalized), Vector3.one));
            }
        }

        public void Draw(float dt)
        {
            seconds += dt;
            BarsDrawn = barBacks.count;
            RingsDrawn = rings.count;
            ArrowsDrawn = arrows.count;
            arrows.Draw(bounds, true);
            barBacks.Draw(bounds, false);
            foreach (Batch fill in barFills) fill.Draw(bounds, false);
            rings.Draw(bounds, false);

            for (int i = markers.Count - 1; i >= 0; i--)
            {
                Marker marker = markers[i];
                float age = (seconds - marker.born) / MARKER_SECONDS;
                if (age >= 1f)
                {
                    markers.RemoveAt(i);
                    continue;
                }
                Color colour = Palette.MARKER[(int)marker.kind];
                colour.a = 1f - age * age;
                float size = 1.5f - age * 0.9f;
                Flat(markerMesh, ground.Place(marker.x, marker.y, 0.1f), new Vector3(size, 1f, size), colour);
            }

            if (plotShown)
            {
                Color colour = plotAllowed ? Palette.PLOT_ALLOWED : Palette.PLOT_REFUSED;
                colour.a = 0.45f;
                Flat(sheet, plotAt, new Vector3(plotSpan, 1f, plotSpan), colour);
            }
        }

        /// <summary>Draws one flat see-through shape this frame, in a colour of its own.</summary>
        void Flat(Mesh mesh, Vector3 at, Vector3 scale, Color colour)
        {
            // A fresh block each time: the engine keeps hold of the one it is given until the frame is drawn.
            var block = new MaterialPropertyBlock();
            block.SetColor(BASE_COLOUR, colour);
            var how = new RenderParams(overlay)
            {
                worldBounds = bounds,
                shadowCastingMode = ShadowCastingMode.Off,
                receiveShadows = false,
                matProps = block,
            };
            Graphics.RenderMesh(how, mesh, 0, Matrix4x4.TRS(at, Quaternion.identity, scale));
        }

        /// <summary>A flat card standing upright, seen from in front of it.</summary>
        static Mesh Card()
        {
            var mesh = new Mesh { name = "Card" };
            mesh.vertices = new[]
            {
                new Vector3(-0.5f, -0.5f, 0f), new Vector3(-0.5f, 0.5f, 0f), new Vector3(0.5f, 0.5f, 0f), new Vector3(0.5f, -0.5f, 0f),
            };
            mesh.uv = new[] { new Vector2(0f, 0f), new Vector2(0f, 1f), new Vector2(1f, 1f), new Vector2(1f, 0f) };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>A flat ring lying on the ground, facing up: one metre across its outer edge's radius.</summary>
        static Mesh Ring(float inner, float outer, int segments)
        {
            var vertices = new Vector3[segments * 2];
            var triangles = new int[segments * 6];
            for (int i = 0; i < segments; i++)
            {
                float angle = i * Mathf.PI * 2f / segments;
                float cos = Mathf.Cos(angle);
                float sin = Mathf.Sin(angle);
                vertices[i * 2] = new Vector3(cos * outer, 0f, sin * outer);
                vertices[i * 2 + 1] = new Vector3(cos * inner, 0f, sin * inner);
                int next = (i + 1) % segments;
                int at = i * 6;
                triangles[at] = i * 2;
                triangles[at + 1] = next * 2;
                triangles[at + 2] = i * 2 + 1;
                triangles[at + 3] = i * 2 + 1;
                triangles[at + 4] = next * 2;
                triangles[at + 5] = next * 2 + 1;
            }
            var mesh = new Mesh { name = "Ring" };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>A plain box centred on its middle.</summary>
        static Mesh Box(float width, float height, float length)
        {
            GameObject cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Mesh unit = cube.GetComponent<MeshFilter>().sharedMesh;
            UnityEngine.Object.Destroy(cube);
            Vector3[] vertices = unit.vertices;
            for (int i = 0; i < vertices.Length; i++) vertices[i] = Vector3.Scale(vertices[i], new Vector3(width, height, length));
            var mesh = new Mesh { name = "Box" };
            mesh.vertices = vertices;
            mesh.normals = unit.normals;
            mesh.uv = unit.uv;
            mesh.triangles = unit.triangles;
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
