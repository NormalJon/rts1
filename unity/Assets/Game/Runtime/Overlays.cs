using System;
using Rts.Sim;
using UnityEngine;
using UnityEngine.Rendering;

namespace Rts.Game
{
    /// <summary>
    /// The small things drawn afresh every frame and in bulk: arrows in the
    /// air, and the health bars over the hurt.
    /// </summary>
    public sealed class Overlays
    {
        const int PER_CALL = 1023;

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

        readonly World world;
        readonly Ground ground;
        readonly Bounds bounds;
        readonly Batch arrows;
        readonly Batch barBacks;
        /// <summary>Health bars by how full: sound, hurt, and nearly gone.</summary>
        readonly Batch[] barFills = new Batch[3];
        Quaternion facing = Quaternion.identity;
        Vector3 right = Vector3.right;
        Vector3 toward = Vector3.back;

        public Overlays(World world, Ground ground, ModelLibrary library, Bounds bounds)
        {
            this.world = world;
            this.ground = ground;
            this.bounds = bounds;
            arrows = new Batch { mesh = Box(0.06f, 0.06f, 1.1f), material = Bulk(library.arrow, Palette.ARROW, "Arrow") };
            Mesh card = Card();
            barBacks = new Batch { mesh = card, material = Bulk(library.barBack, Palette.BAR_BACK, "Bar back") };
            for (int i = 0; i < barFills.Length; i++)
            {
                barFills[i] = new Batch { mesh = card, material = Bulk(library.barFill, Palette.BAR[i], "Bar " + i) };
            }
        }

        static Material Bulk(Material source, Color colour, string name)
        {
            var material = new Material(source) { name = name, enableInstancing = true };
            material.SetColor("_BaseColor", colour);
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

        /// <summary>Queues every arrow in the air, part-way along its arc.</summary>
        public void AddArrows(float alpha, UnitViews units)
        {
            int[] shots = world.shots;
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

                Vector3 heading = Along(Mathf.Min(1f, gone + 0.04f)) - Along(Mathf.Max(0f, gone - 0.04f));
                if (heading.sqrMagnitude < 1e-8f) continue;
                arrows.Add(Matrix4x4.TRS(Along(gone), Quaternion.LookRotation(heading.normalized), Vector3.one));
            }
        }

        public int ArrowsQueued => arrows.count;

        public void Draw()
        {
            arrows.Draw(bounds, true);
            barBacks.Draw(bounds, false);
            foreach (Batch fill in barFills) fill.Draw(bounds, false);
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
