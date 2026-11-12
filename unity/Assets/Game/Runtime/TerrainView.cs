using System;
using Rts.Sim;
using UnityEngine;
using UnityEngine.Rendering;
using Terrain = Rts.Sim.Terrain;

namespace Rts.Game
{
    /// <summary>
    /// The ground: one mesh for the lie of the land, painted by a picture of
    /// the map with a few dots to a tile, plus the water and the dark table
    /// the map sits on. Display only: it reads the map and never changes it.
    /// </summary>
    public sealed class TerrainView
    {
        public const float WATER_LEVEL = -0.16f;
        /// <summary>Dots of the ground picture along one side of a tile.</summary>
        const int DOTS = 4;

        readonly Ground ground;
        readonly GameMap map;
        readonly Texture2D picture;
        readonly Color32[] dots;
        /// <summary>Each tile's own colour and the blend at each corner, as linear red, green, blue.</summary>
        readonly float[] tileColour;
        readonly float[] cornerColour;
        /// <summary>
        /// The terrain as last drawn, to spot what has changed since. It is also
        /// what the player believes is there: a tree felled out of sight stays
        /// standing on the screen until someone goes and looks.
        /// </summary>
        readonly byte[] seenTerrain;
        bool pictureStale;

        public readonly GameObject root;
        /// <summary>Called for each tile whose terrain has changed since it was last drawn.</summary>
        public Action<int> onTileChanged;

        public TerrainView(Ground ground, ModelLibrary library, Transform parent)
        {
            this.ground = ground;
            map = ground.map;
            root = new GameObject("Terrain");
            root.transform.SetParent(parent, false);

            tileColour = new float[map.tileCount * 3];
            cornerColour = new float[(map.width + 1) * (map.height + 1) * 3];
            seenTerrain = (byte[])map.terrain.Clone();
            for (int ty = 0; ty < map.height; ty++) for (int tx = 0; tx < map.width; tx++) PaintTile(tx, ty);
            for (int cy = 0; cy <= map.height; cy++) for (int cx = 0; cx <= map.width; cx++) BlendCorner(cx, cy);

            picture = new Texture2D(map.width * DOTS, map.height * DOTS, TextureFormat.RGBA32, true, false)
            {
                name = "Ground picture",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Trilinear,
                anisoLevel = 4,
            };
            dots = new Color32[picture.width * picture.height];
            for (int ty = 0; ty < map.height; ty++) for (int tx = 0; tx < map.width; tx++) ColourTile(tx, ty);
            picture.SetPixels32(dots);
            picture.Apply(true);

            var land = new GameObject("Land");
            land.transform.SetParent(root.transform, false);
            land.AddComponent<MeshFilter>().sharedMesh = BuildLand();
            var landMaterial = new Material(library.terrain) { name = "Land (this match)", mainTexture = picture };
            land.AddComponent<MeshRenderer>().sharedMaterial = landMaterial;

            float width = map.width * Ground.TILE;
            float depth = map.height * Ground.TILE;
            AddFlat("Water", library.water, 0f, width, 0f, depth, WATER_LEVEL, false);
            // A dark table under the map, so its edges do not hang in space.
            AddFlat("Table", library.table, -width, width * 2f, -depth, depth * 2f, -1.2f, false);
        }

        /// <summary>Works out one tile's own colour from its terrain, with a little variation.</summary>
        void PaintTile(int tx, int ty)
        {
            Color colour = Palette.Ground(map.terrain[ty * map.width + tx]).linear;
            float shade = 0.9f + Palette.TileNoise(tx, ty) * 0.2f;
            int at = (ty * map.width + tx) * 3;
            tileColour[at] = colour.r * shade;
            tileColour[at + 1] = colour.g * shade;
            tileColour[at + 2] = colour.b * shade;
        }

        /// <summary>
        /// Blends the colours of the tiles meeting at a corner, so terrain types
        /// fade into each other instead of meeting along the grid. Rock keeps a
        /// hard edge and takes no part.
        /// </summary>
        void BlendCorner(int cx, int cy)
        {
            float r = 0f, g = 0f, b = 0f;
            int n = 0;
            for (int oy = -1; oy <= 0; oy++)
            {
                for (int ox = -1; ox <= 0; ox++)
                {
                    int tx = cx + ox;
                    int ty = cy + oy;
                    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
                    if (map.terrain[ty * map.width + tx] == Terrain.Rock) continue;
                    int from = (ty * map.width + tx) * 3;
                    r += tileColour[from];
                    g += tileColour[from + 1];
                    b += tileColour[from + 2];
                    n++;
                }
            }
            if (n == 0) return;
            int at = (cy * (map.width + 1) + cx) * 3;
            cornerColour[at] = r / n;
            cornerColour[at + 1] = g / n;
            cornerColour[at + 2] = b / n;
        }

        /// <summary>Paints a tile's dots: its own flat colour for rock, a blend of its four corners otherwise.</summary>
        void ColourTile(int tx, int ty)
        {
            int tile = ty * map.width + tx;
            bool rock = map.terrain[tile] == Terrain.Rock;
            int row = map.width + 1;
            int c00 = (ty * row + tx) * 3;
            int c10 = c00 + 3;
            int c01 = ((ty + 1) * row + tx) * 3;
            int c11 = c01 + 3;
            for (int j = 0; j < DOTS; j++)
            {
                float fy = (j + 0.5f) / DOTS;
                for (int i = 0; i < DOTS; i++)
                {
                    float fx = (i + 0.5f) / DOTS;
                    float r, g, b;
                    if (rock)
                    {
                        r = tileColour[tile * 3];
                        g = tileColour[tile * 3 + 1];
                        b = tileColour[tile * 3 + 2];
                    }
                    else
                    {
                        float w00 = (1f - fx) * (1f - fy), w10 = fx * (1f - fy), w01 = (1f - fx) * fy, w11 = fx * fy;
                        r = cornerColour[c00] * w00 + cornerColour[c10] * w10 + cornerColour[c01] * w01 + cornerColour[c11] * w11;
                        g = cornerColour[c00 + 1] * w00 + cornerColour[c10 + 1] * w10 + cornerColour[c01 + 1] * w01 + cornerColour[c11 + 1] * w11;
                        b = cornerColour[c00 + 2] * w00 + cornerColour[c10 + 2] * w10 + cornerColour[c01 + 2] * w01 + cornerColour[c11 + 2] * w11;
                    }
                    dots[(ty * DOTS + j) * picture.width + tx * DOTS + i] = new Color32(Stored(r), Stored(g), Stored(b), 255);
                }
            }
        }

        /// <summary>A linear colour value as the picture stores it.</summary>
        static byte Stored(float linear)
        {
            return (byte)Mathf.Clamp(Mathf.RoundToInt(Mathf.LinearToGammaSpace(Mathf.Clamp01(linear)) * 255f), 0, 255);
        }

        Mesh BuildLand()
        {
            int row = map.width + 1;
            var vertices = new Vector3[row * (map.height + 1)];
            var uv = new Vector2[vertices.Length];
            for (int cy = 0; cy <= map.height; cy++)
            {
                for (int cx = 0; cx <= map.width; cx++)
                {
                    vertices[cy * row + cx] = new Vector3(cx * Ground.TILE, ground.CornerHeight(cx, cy), -cy * Ground.TILE);
                    uv[cy * row + cx] = new Vector2((float)cx / map.width, (float)cy / map.height);
                }
            }
            // Each tile is two triangles split along the diagonal from its first
            // corner, which is what Ground.HeightAt assumes.
            var triangles = new int[map.tileCount * 6];
            int at = 0;
            for (int ty = 0; ty < map.height; ty++)
            {
                for (int tx = 0; tx < map.width; tx++)
                {
                    int a = ty * row + tx;
                    int d = a + 1;
                    int b = a + row;
                    int c = b + 1;
                    triangles[at++] = a;
                    triangles[at++] = c;
                    triangles[at++] = b;
                    triangles[at++] = a;
                    triangles[at++] = d;
                    triangles[at++] = c;
                }
            }
            var mesh = new Mesh { name = "Land" };
            if (vertices.Length > 65535) mesh.indexFormat = IndexFormat.UInt32;
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>A level sheet facing up, from (left, near) for (width, depth) metres. "Near" is the north edge.</summary>
        void AddFlat(string name, Material material, float left, float width, float north, float depth, float y, bool shadows)
        {
            var mesh = new Mesh { name = name };
            mesh.vertices = new[]
            {
                new Vector3(left, y, -north),
                new Vector3(left + width, y, -north),
                new Vector3(left + width, y, -(north + depth)),
                new Vector3(left, y, -(north + depth)),
            };
            mesh.uv = new[] { new Vector2(0f, 0f), new Vector2(1f, 0f), new Vector2(1f, 1f), new Vector2(0f, 1f) };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            var sheet = new GameObject(name);
            sheet.transform.SetParent(root.transform, false);
            sheet.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = sheet.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
        }

        /// <summary>The terrain of a tile as the player last saw it.</summary>
        public int SeenTerrain(int tile) => seenTerrain[tile];

        /// <summary>
        /// Brings the ground up to date with tiles that have changed: felled
        /// trees, worked-out deposits, tilled fields. Only for tiles in sight.
        /// </summary>
        public void Sync(Sight sight)
        {
            byte[] terrain = map.terrain;
            for (int tile = 0; tile < terrain.Length; tile++)
            {
                if (terrain[tile] == seenTerrain[tile] || !sight.SeesTile(tile)) continue;
                seenTerrain[tile] = terrain[tile];
                RepaintAround(tile);
                onTileChanged?.Invoke(tile);
            }
            if (!pictureStale) return;
            pictureStale = false;
            picture.SetPixels32(dots);
            picture.Apply(true);
        }

        /// <summary>Repaints the ground on and around a tile whose terrain has changed.</summary>
        void RepaintAround(int tile)
        {
            int tx = tile % map.width;
            int ty = tile / map.width;
            PaintTile(tx, ty);
            for (int oy = 0; oy <= 1; oy++) for (int ox = 0; ox <= 1; ox++) BlendCorner(tx + ox, ty + oy);
            for (int oy = -1; oy <= 1; oy++)
            {
                for (int ox = -1; ox <= 1; ox++)
                {
                    int nx = tx + ox;
                    int ny = ty + oy;
                    if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height) ColourTile(nx, ny);
                }
            }
            pictureStale = true;
        }

        /// <summary>The whole map as a box in the scene, tall enough for anything standing on it.</summary>
        public Bounds SceneBounds()
        {
            float width = map.width * Ground.TILE;
            float depth = map.height * Ground.TILE;
            return new Bounds(new Vector3(width / 2f, 10f, -depth / 2f), new Vector3(width + 20f, 80f, depth + 20f));
        }
    }
}
