using System.Collections.Generic;
using UnityEngine;

namespace Rts.Game
{
    /// <summary>
    /// The materials everything from Assets/Models is drawn with. Each model
    /// file arrives with its own two, "Palette" (the model's painted colours)
    /// and "TeamColor" (the parts that take the player's colour), but they are
    /// all alike. Drawing every model with one shared copy of each lets Unity
    /// draw many things at once.
    /// </summary>
    public sealed class ModelMaterials
    {
        public const string TEAM_MATERIAL = "TeamColor";
        static readonly int BASE_COLOUR = Shader.PropertyToID("baseColorFactor");
        static readonly int BASE_COLOUR_URP = Shader.PropertyToID("_BaseColor");

        Material palette;
        Material paletteInstanced;
        Material teamSource;
        readonly Material[] team = new Material[Palette.TEAM.Length];
        readonly List<Renderer> scratch = new List<Renderer>();

        public static bool IsTeam(Material material)
        {
            return material != null && material.name.StartsWith(TEAM_MATERIAL);
        }

        /// <summary>The painted material, as one shared copy.</summary>
        public Material Painted(Material source)
        {
            if (palette == null) palette = new Material(source) { name = "Palette (shared)" };
            return palette;
        }

        /// <summary>The painted material in a form that can draw a thousand copies in one go.</summary>
        public Material PaintedInBulk(Material source)
        {
            if (paletteInstanced == null) paletteInstanced = new Material(source) { name = "Palette (in bulk)", enableInstancing = true };
            return paletteInstanced;
        }

        /// <summary>The team material in a player's colour.</summary>
        public Material Team(Material source, int owner)
        {
            int index = owner % team.Length;
            if (team[index] == null)
            {
                if (teamSource == null) teamSource = source;
                var material = new Material(teamSource) { name = "Team " + Palette.TEAM_NAMES[index] };
                if (material.HasProperty(BASE_COLOUR)) material.SetColor(BASE_COLOUR, Palette.TEAM[index]);
                if (material.HasProperty(BASE_COLOUR_URP)) material.SetColor(BASE_COLOUR_URP, Palette.TEAM[index]);
                team[index] = material;
            }
            return team[index];
        }

        /// <summary>Gives everything under a freshly made copy of a model the shared materials, in its owner's colour.</summary>
        public void Dress(GameObject model, int owner)
        {
            model.GetComponentsInChildren(true, scratch);
            foreach (Renderer renderer in scratch)
            {
                Material source = renderer.sharedMaterial;
                if (source == null) continue;
                renderer.sharedMaterial = IsTeam(source) ? Team(source, owner) : Painted(source);
            }
            scratch.Clear();
        }
    }
}
