using System;
using System.Collections.Generic;
using Rts.Sim;
using UnityEngine;
using UnityEngine.Rendering;
using Terrain = Rts.Sim.Terrain;

namespace Rts.Game
{
    /// <summary>
    /// The trees, bushes and outcrops standing on resource tiles: one to a
    /// tile, several thousand on a map. They are not scene objects. Each kind
    /// is a list of placements drawn in bulk every frame, which costs a handful
    /// of draw calls however many there are.
    /// </summary>
    public sealed class PropField
    {
        /// <summary>The most copies Unity draws in one call.</summary>
        const int PER_CALL = 1023;

        sealed class Part
        {
            public Mesh mesh;
            public Material material;
            /// <summary>Where the part sits within its model.</summary>
            public Matrix4x4 local;
            public Matrix4x4[] placed = new Matrix4x4[256];
        }

        sealed class Kind
        {
            public readonly List<Part> parts = new List<Part>();
            /// <summary>The tile each copy stands on, in the order the copies are stored.</summary>
            public readonly List<int> tiles = new List<int>();
        }

        readonly Ground ground;
        readonly List<Kind> kinds = new List<Kind>();
        /// <summary>Which kind stands on a tile, and which of its copies that is.</summary>
        readonly Dictionary<int, (Kind kind, int index)> onTile = new Dictionary<int, (Kind, int)>();
        readonly Matrix4x4[] call = new Matrix4x4[PER_CALL];
        readonly Bounds bounds;

        public int Count => onTile.Count;

        public PropField(Ground ground, ModelLibrary library, ModelMaterials materials, Bounds bounds)
        {
            this.ground = ground;
            this.bounds = bounds;
            GameMap map = ground.map;
            Kind oak = KindOf(library.oak, materials);
            Kind conifer = KindOf(library.conifer, materials);
            Kind berries = KindOf(library.berries, materials);
            Kind stone = KindOf(library.stone, materials);
            Kind gold = KindOf(library.gold, materials);

            for (int ty = 0; ty < map.height; ty++)
            {
                for (int tx = 0; tx < map.width; tx++)
                {
                    int tile = ty * map.width + tx;
                    // The same three numbers the browser version draws from, so both plant the same wood.
                    float a = Palette.TileNoise(tx * 3 + 1, ty * 3 + 2);
                    float b = Palette.TileNoise(tx * 5 + 7, ty * 5 + 3);
                    float c = Palette.TileNoise(tx * 7 + 5, ty * 7 + 11);
                    switch (map.terrain[tile])
                    {
                        case Terrain.Forest:
                        {
                            // One tree to a tile. Oaks spread wide, so they are few among the firs.
                            bool isOak = a < 0.14f;
                            Place(isOak ? oak : conifer, tile, tx + 0.3f + b * 0.4f, ty + 0.3f + c * 0.4f, b * 360f, (isOak ? 0.6f : 0.72f) + c * 0.38f);
                            break;
                        }
                        case Terrain.Berries:
                            Place(berries, tile, tx + 0.5f, ty + 0.5f, a * 360f, 0.92f + b * 0.2f);
                            break;
                        case Terrain.Stone:
                        case Terrain.Gold:
                            Place(map.terrain[tile] == Terrain.Stone ? stone : gold, tile, tx + 0.5f, ty + 0.5f, Mathf.Floor(a * 4f) * 90f, 0.9f + b * 0.18f);
                            break;
                    }
                }
            }
        }

        Kind KindOf(ModelLibrary.StaticModel model, ModelMaterials materials)
        {
            var kind = new Kind();
            kinds.Add(kind);
            if (model == null || model.prefab == null) return kind;
            Matrix4x4 toModel = model.prefab.transform.worldToLocalMatrix;
            foreach (MeshFilter filter in model.prefab.GetComponentsInChildren<MeshFilter>(true))
            {
                MeshRenderer renderer = filter.GetComponent<MeshRenderer>();
                if (filter.sharedMesh == null || renderer == null || renderer.sharedMaterial == null) continue;
                kind.parts.Add(new Part
                {
                    mesh = filter.sharedMesh,
                    material = materials.PaintedInBulk(renderer.sharedMaterial),
                    local = toModel * filter.transform.localToWorldMatrix,
                });
            }
            return kind;
        }

        void Place(Kind kind, int tile, float x, float y, float turn, float size)
        {
            if (kind.parts.Count == 0) return;
            Matrix4x4 at = Matrix4x4.TRS(ground.Place(x, y, -0.05f), Quaternion.Euler(0f, 180f - turn, 0f), new Vector3(size, size, size));
            int index = kind.tiles.Count;
            kind.tiles.Add(tile);
            foreach (Part part in kind.parts)
            {
                if (index >= part.placed.Length) Array.Resize(ref part.placed, part.placed.Length * 2);
                part.placed[index] = at * part.local;
            }
            onTile[tile] = (kind, index);
        }

        /// <summary>Takes away whatever stands on a tile: the tree has been felled, the deposit worked out.</summary>
        public void Remove(int tile)
        {
            if (!onTile.TryGetValue(tile, out (Kind kind, int index) found)) return;
            onTile.Remove(tile);
            Kind kind = found.kind;
            int last = kind.tiles.Count - 1;
            if (found.index != last)
            {
                // The last copy takes the place of the one removed.
                int moved = kind.tiles[last];
                kind.tiles[found.index] = moved;
                foreach (Part part in kind.parts) part.placed[found.index] = part.placed[last];
                onTile[moved] = (kind, found.index);
            }
            kind.tiles.RemoveAt(last);
        }

        /// <summary>Draws every copy for this frame.</summary>
        public void Draw()
        {
            foreach (Kind kind in kinds)
            {
                int count = kind.tiles.Count;
                if (count == 0) continue;
                foreach (Part part in kind.parts)
                {
                    var how = new RenderParams(part.material)
                    {
                        worldBounds = bounds,
                        shadowCastingMode = ShadowCastingMode.On,
                        receiveShadows = true,
                    };
                    for (int start = 0; start < count; start += PER_CALL)
                    {
                        int n = Math.Min(PER_CALL, count - start);
                        Array.Copy(part.placed, start, call, 0, n);
                        Graphics.RenderMeshInstanced(how, part.mesh, 0, call, n);
                    }
                }
            }
        }
    }
}
