using System.Collections.Generic;
using Rts.Sim;
using UnityEngine;
using UnityEngine.Rendering;

namespace Rts.Game
{
    /// <summary>
    /// The buildings: a copy of its model for each, rising out of the ground
    /// as the work is done, with bare earth marking out the plot until it is
    /// finished and for a little while after it comes down.
    ///
    /// This is also the player's memory of buildings. One that is out of sight
    /// stays drawn as it was last seen, even if it has since been finished,
    /// damaged or destroyed, until someone looks at the place again.
    /// </summary>
    public sealed class BuildingViews
    {
        /// <summary>How long a ruin's bare plot shows, in seconds.</summary>
        const float RUIN_SECONDS = 12f;
        static readonly int BASE_COLOUR = Shader.PropertyToID("_BaseColor");

        /// <summary>A building as the player knows it.</summary>
        public sealed class Shown
        {
            public int id;
            public int owner;
            public int entityType;
            /// <summary>The tile at its centre.</summary>
            public int tileX;
            public int tileY;
            internal GameObject group;
            internal Transform model;
            internal GameObject plot;
            /// <summary>How high the finished model stands, in metres.</summary>
            internal float height;
            internal float fit;
            internal float born;
        }

        readonly World world;
        readonly Ground ground;
        readonly ModelLibrary library;
        readonly ModelMaterials materials;
        readonly Sight sight;
        readonly Transform parent;
        readonly Mesh plotMesh;
        /// <summary>Buildings the player knows of, by their handle, and which of them stands on each tile.</summary>
        readonly Dictionary<int, Shown> buildings = new Dictionary<int, Shown>();
        readonly Dictionary<int, int> buildingAtTile = new Dictionary<int, int>();
        readonly List<Shown> ruins = new List<Shown>();
        readonly List<Shown> gone = new List<Shown>();
        /// <summary>The outline round the selected building, and the flag at its rally point.</summary>
        readonly LineRenderer outline;
        readonly GameObject flag;

        public int Count => buildings.Count;

        public BuildingViews(World world, Ground ground, ModelLibrary library, ModelMaterials materials, Sight sight, Transform parent)
        {
            this.world = world;
            this.ground = ground;
            this.library = library;
            this.materials = materials;
            this.sight = sight;
            this.parent = new GameObject("Buildings").transform;
            this.parent.SetParent(parent, false);
            plotMesh = Sheet();
            outline = MakeOutline();
            flag = MakeFlag();
        }

        /// <summary>Every building the player knows of, in sight or remembered.</summary>
        public IEnumerable<Shown> All => buildings.Values;

        /// <summary>What the player knows of one building, or null if nothing.</summary>
        public Shown Known(int id)
        {
            return buildings.TryGetValue(id, out Shown shown) ? shown : null;
        }

        /// <summary>The building the player knows of on a tile, or NO_ENTITY. It may be a memory of one since destroyed.</summary>
        public int BuildingOn(int tile)
        {
            return buildingAtTile.TryGetValue(tile, out int id) ? id : World.NO_ENTITY;
        }

        /// <summary>Whether a building the player knows of is in sight right now, and so shown as it truly is.</summary>
        public bool Sees(int id)
        {
            return world.IsAlive(id) && sight.ShowsNow(World.EntityIndex(id));
        }

        /// <summary>Whether any part of the ground a known building stands on is in sight.</summary>
        bool SeesPlace(Shown shown)
        {
            int half = EntityTypes.ENTITY_TYPES[shown.entityType].footprint >> 1;
            for (int ty = shown.tileY - half; ty <= shown.tileY + half; ty++)
            {
                for (int tx = shown.tileX - half; tx <= shown.tileX + half; tx++)
                {
                    if (sight.SeesTile(ty * world.map.width + tx)) return true;
                }
            }
            return false;
        }

        /// <param name="selected">The building the player has selected, or NO_ENTITY.</param>
        public void Draw(float seconds, Overlays overlays, int selected)
        {
            // A known building that is gone is taken off the screen once its place
            // is in sight again. Until then the player has no way of knowing.
            foreach (Shown shown in buildings.Values)
            {
                if (!world.IsAlive(shown.id) && SeesPlace(shown)) gone.Add(shown);
            }
            foreach (Shown shown in gone)
            {
                Forget(shown);
                shown.model.gameObject.SetActive(false);
                shown.plot.SetActive(true);
                // Its own copy of the material, so that it can fade by itself.
                shown.plot.GetComponent<MeshRenderer>().material.name = "Ruin";
                shown.born = seconds;
                ruins.Add(shown);
            }
            gone.Clear();
            for (int i = ruins.Count - 1; i >= 0; i--)
            {
                Shown ruin = ruins[i];
                float age = (seconds - ruin.born) / RUIN_SECONDS;
                if (age < 1f)
                {
                    Material material = ruin.plot.GetComponent<MeshRenderer>().sharedMaterial;
                    Color colour = material.GetColor(BASE_COLOUR);
                    colour.a = 0.85f * (1f - age * age);
                    material.SetColor(BASE_COLOUR, colour);
                    continue;
                }
                Object.Destroy(ruin.plot.GetComponent<MeshRenderer>().sharedMaterial);
                Object.Destroy(ruin.group);
                ruins.RemoveAt(i);
            }

            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 1) continue;
                // Out of sight, a building is shown as it was last seen, or not at all.
                if (!sight.ShowsNow(slot)) continue;
                int id = world.IdAt(slot);
                if (!buildings.TryGetValue(id, out Shown shown))
                {
                    shown = Raise(slot, id);
                    if (shown == null) continue;
                    Remember(shown);
                }
                // A building rises out of the ground as the work is done.
                bool finished = world.built[slot] == 1;
                float done = finished
                    ? 1f
                    : (float)world.buildPoints[slot] / EntityTypes.BuildPointsNeeded(world.entityType[slot], world.config.tickRate);
                shown.model.localScale = new Vector3(shown.fit, shown.fit * (0.06f + 0.94f * Mathf.Clamp01(done)), shown.fit);
                if (shown.plot.activeSelf == finished) shown.plot.SetActive(!finished);
                // A bar over anything damaged, and over whatever is selected.
                EntityType type = world.TypeOf(slot);
                bool picked = selected == id;
                if (picked || (finished && world.hp[slot] < type.hp))
                {
                    Vector3 at = shown.group.transform.position;
                    overlays.AddBar(new Vector3(at.x, at.y + shown.height * (finished ? 1f : 0.5f) + 0.9f, at.z), type.footprint * 0.9f, (float)world.hp[slot] / type.hp);
                }
            }

            // The selected building's outline, and for one of the viewer's own its rally flag.
            Shown known = selected == World.NO_ENTITY ? null : Known(selected);
            bool flagged = false;
            if (known != null)
            {
                float span = EntityTypes.ENTITY_TYPES[known.entityType].footprint * Ground.TILE + 0.5f;
                Vector3 at = known.group.transform.position;
                outline.transform.position = new Vector3(at.x, at.y + 0.12f, at.z);
                outline.transform.localScale = new Vector3(span, 1f, span);
                int slot = World.EntityIndex(known.id);
                if (world.IsAlive(known.id) && sight.OnViewersSide(known.owner) && world.rallyX[slot] >= 0)
                {
                    flag.transform.position = ground.Place(Ground.F(world.rallyX[slot]), Ground.F(world.rallyY[slot]));
                    flagged = true;
                }
            }
            if (outline.gameObject.activeSelf != (known != null)) outline.gameObject.SetActive(known != null);
            if (flag.activeSelf != flagged) flag.SetActive(flagged);
        }

        /// <summary>
        /// Call when the fog falls again after being lifted for a look round:
        /// whatever was seen only because it was lifted is forgotten.
        /// </summary>
        public void ForgetWhatWasNeverSeen()
        {
            foreach (Shown shown in buildings.Values)
            {
                if (sight.OnViewersSide(shown.owner) || sight.KnowsTile(shown.tileY * world.map.width + shown.tileX)) continue;
                gone.Add(shown);
            }
            foreach (Shown shown in gone)
            {
                Forget(shown);
                Object.Destroy(shown.group);
            }
            gone.Clear();
        }

        void Remember(Shown shown)
        {
            // If the player remembers something else on this ground, that memory is out of date.
            int half = EntityTypes.ENTITY_TYPES[shown.entityType].footprint >> 1;
            for (int ty = shown.tileY - half; ty <= shown.tileY + half; ty++)
            {
                for (int tx = shown.tileX - half; tx <= shown.tileX + half; tx++)
                {
                    if (!buildingAtTile.TryGetValue(ty * world.map.width + tx, out int before)) continue;
                    if (!buildings.TryGetValue(before, out Shown old)) continue;
                    Forget(old);
                    Object.Destroy(old.group);
                }
            }
            buildings[shown.id] = shown;
            for (int ty = shown.tileY - half; ty <= shown.tileY + half; ty++)
            {
                for (int tx = shown.tileX - half; tx <= shown.tileX + half; tx++)
                {
                    buildingAtTile[ty * world.map.width + tx] = shown.id;
                }
            }
        }

        void Forget(Shown shown)
        {
            buildings.Remove(shown.id);
            int half = EntityTypes.ENTITY_TYPES[shown.entityType].footprint >> 1;
            for (int ty = shown.tileY - half; ty <= shown.tileY + half; ty++)
            {
                for (int tx = shown.tileX - half; tx <= shown.tileX + half; tx++)
                {
                    int tile = ty * world.map.width + tx;
                    if (buildingAtTile.TryGetValue(tile, out int there) && there == shown.id) buildingAtTile.Remove(tile);
                }
            }
        }

        Shown Raise(int slot, int id)
        {
            int entityType = world.entityType[slot];
            ModelLibrary.StaticModel source = library.BuildingFor(entityType);
            if (source == null) return null;
            int footprint = EntityTypes.ENTITY_TYPES[entityType].footprint;
            float span = footprint * Ground.TILE;
            float x = Ground.F(world.posX[slot]);
            float y = Ground.F(world.posY[slot]);

            var group = new GameObject(EntityTypes.ENTITY_TYPES[entityType].name + " " + id);
            group.transform.SetParent(parent, false);
            group.transform.position = ground.Place(x, y);

            // Models face south, toward the camera, as they do in the browser version.
            GameObject model = Object.Instantiate(source.prefab, group.transform);
            model.name = "Model";
            model.transform.localPosition = Vector3.zero;
            model.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
            materials.Dress(model, world.owner[slot]);
            // A model too big for its plot is shrunk to fit it.
            float fit = source.reach > 0f ? Mathf.Min(1f, span * 0.49f / source.reach) : 1f;

            // Bare earth marks out the plot while the building goes up.
            var plot = new GameObject("Plot");
            plot.transform.SetParent(group.transform, false);
            plot.transform.localPosition = new Vector3(0f, 0.05f, 0f);
            plot.transform.localScale = new Vector3(span * 0.96f, 1f, span * 0.96f);
            plot.AddComponent<MeshFilter>().sharedMesh = plotMesh;
            MeshRenderer renderer = plot.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = library.plot;
            renderer.shadowCastingMode = ShadowCastingMode.Off;

            return new Shown
            {
                id = id,
                owner = world.owner[slot],
                entityType = entityType,
                tileX = (int)x,
                tileY = (int)y,
                group = group,
                model = model.transform,
                plot = plot,
                height = source.height * fit,
                fit = fit,
            };
        }

        LineRenderer MakeOutline()
        {
            var holder = new GameObject("Selected building");
            holder.transform.SetParent(parent, false);
            LineRenderer line = holder.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.loop = true;
            line.positionCount = 4;
            line.SetPositions(new[]
            {
                new Vector3(-0.5f, 0f, -0.5f), new Vector3(0.5f, 0f, -0.5f), new Vector3(0.5f, 0f, 0.5f), new Vector3(-0.5f, 0f, 0.5f),
            });
            line.widthMultiplier = 0.14f;
            line.sharedMaterial = Overlays.Tinted(library.overlay, Palette.PARCHMENT, "Outline");
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            holder.SetActive(false);
            return line;
        }

        /// <summary>A pole with a pennant, for the rally point.</summary>
        GameObject MakeFlag()
        {
            var holder = new GameObject("Rally flag");
            holder.transform.SetParent(parent, false);

            GameObject pole = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            pole.name = "Pole";
            Object.Destroy(pole.GetComponent<Collider>());
            pole.transform.SetParent(holder.transform, false);
            pole.transform.localPosition = new Vector3(0f, 1.2f, 0f);
            pole.transform.localScale = new Vector3(0.1f, 1.2f, 0.1f);
            MeshRenderer wood = pole.GetComponent<MeshRenderer>();
            wood.sharedMaterial = Overlays.Tinted(library.arrow, Palette.POLE, "Pole");
            wood.shadowCastingMode = ShadowCastingMode.Off;

            var mesh = new Mesh { name = "Pennant" };
            mesh.vertices = new[] { new Vector3(0f, 2.4f, 0f), new Vector3(0.95f, 2.1f, 0f), new Vector3(0f, 1.8f, 0f) };
            // Both faces, so that it shows from either side.
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 1 };
            mesh.RecalculateBounds();
            var pennant = new GameObject("Pennant");
            pennant.transform.SetParent(holder.transform, false);
            pennant.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer cloth = pennant.AddComponent<MeshRenderer>();
            cloth.sharedMaterial = Overlays.Tinted(library.arrow, Palette.PARCHMENT, "Pennant");
            cloth.shadowCastingMode = ShadowCastingMode.Off;

            holder.SetActive(false);
            return holder;
        }

        /// <summary>A one-metre square lying flat, facing up.</summary>
        public static Mesh Sheet()
        {
            var mesh = new Mesh { name = "Sheet" };
            mesh.vertices = new[]
            {
                new Vector3(-0.5f, 0f, 0.5f), new Vector3(0.5f, 0f, 0.5f), new Vector3(0.5f, 0f, -0.5f), new Vector3(-0.5f, 0f, -0.5f),
            };
            mesh.uv = new[] { new Vector2(0f, 1f), new Vector2(1f, 1f), new Vector2(1f, 0f), new Vector2(0f, 0f) };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
