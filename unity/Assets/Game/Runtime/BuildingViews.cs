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
    /// </summary>
    public sealed class BuildingViews
    {
        /// <summary>How long a ruin's bare plot shows, in seconds.</summary>
        const float RUIN_SECONDS = 12f;
        static readonly int BASE_COLOUR = Shader.PropertyToID("_BaseColor");

        sealed class Shown
        {
            public int id;
            public GameObject group;
            public Transform model;
            public GameObject plot;
            /// <summary>How high the finished model stands, in metres.</summary>
            public float height;
            public float fit;
            public float born;
        }

        readonly World world;
        readonly Ground ground;
        readonly ModelLibrary library;
        readonly ModelMaterials materials;
        readonly Transform parent;
        readonly Mesh plotMesh;
        readonly Dictionary<int, Shown> buildings = new Dictionary<int, Shown>();
        readonly List<Shown> ruins = new List<Shown>();
        readonly List<int> gone = new List<int>();

        public int Count => buildings.Count;

        public BuildingViews(World world, Ground ground, ModelLibrary library, ModelMaterials materials, Transform parent)
        {
            this.world = world;
            this.ground = ground;
            this.library = library;
            this.materials = materials;
            this.parent = new GameObject("Buildings").transform;
            this.parent.SetParent(parent, false);
            plotMesh = Sheet();
        }

        public void Draw(float seconds, Overlays overlays)
        {
            // A building that is gone leaves its bare plot for a while.
            foreach (KeyValuePair<int, Shown> entry in buildings)
            {
                if (!world.IsAlive(entry.Key)) gone.Add(entry.Key);
            }
            foreach (int id in gone)
            {
                Shown shown = buildings[id];
                buildings.Remove(id);
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
                int id = world.IdAt(slot);
                if (!buildings.TryGetValue(id, out Shown shown))
                {
                    shown = Raise(slot, id);
                    if (shown == null) continue;
                    buildings[id] = shown;
                }
                // A building rises out of the ground as the work is done.
                bool finished = world.built[slot] == 1;
                float done = finished
                    ? 1f
                    : (float)world.buildPoints[slot] / EntityTypes.BuildPointsNeeded(world.entityType[slot], world.config.tickRate);
                shown.model.localScale = new Vector3(shown.fit, shown.fit * (0.06f + 0.94f * Mathf.Clamp01(done)), shown.fit);
                if (shown.plot.activeSelf == finished) shown.plot.SetActive(!finished);
                // A bar over anything damaged.
                EntityType type = world.TypeOf(slot);
                if (finished && world.hp[slot] < type.hp)
                {
                    Vector3 at = shown.group.transform.position;
                    overlays.AddBar(new Vector3(at.x, at.y + shown.height + 0.9f, at.z), type.footprint * 0.9f, (float)world.hp[slot] / type.hp);
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

            return new Shown { id = id, group = group, model = model.transform, plot = plot, height = source.height * fit, fit = fit };
        }

        /// <summary>A one-metre square lying flat, facing up.</summary>
        static Mesh Sheet()
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
