using System;
using UnityEngine;

namespace Rts.Game
{
    /// <summary>
    /// Which model draws which thing. Built by the editor from the files in
    /// Assets/Models (RTS > Set Up Project), so nothing in a scene has to be
    /// wired by hand. The two lists are in the order of the simulation's
    /// ENTITY_TYPES.
    /// </summary>
    public sealed class ModelLibrary : ScriptableObject
    {
        [Serializable]
        public sealed class UnitModel
        {
            public GameObject prefab;
            public AnimationClip idle;
            public AnimationClip walk;
            /// <summary>A soldier's blow. Null for those who have none.</summary>
            public AnimationClip attack;
            /// <summary>A villager at work. Null for everyone else.</summary>
            public AnimationClip chop;
            /// <summary>How tall it stands, in metres, spear tip and all.</summary>
            public float height;
        }

        [Serializable]
        public sealed class StaticModel
        {
            public GameObject prefab;
            /// <summary>How far the model reaches from its centre along the ground, in metres.</summary>
            public float reach;
            public float height;
        }

        /// <summary>By entity type. Buildings have an empty entry here.</summary>
        public UnitModel[] units = new UnitModel[0];
        /// <summary>By entity type. Units have an empty entry here.</summary>
        public StaticModel[] buildings = new StaticModel[0];

        public StaticModel oak;
        public StaticModel conifer;
        public StaticModel berries;
        public StaticModel stone;
        public StaticModel gold;

        public Material terrain;
        public Material water;
        public Material table;
        /// <summary>The bare earth under a building going up.</summary>
        public Material plot;
        public Material arrow;
        public Material barBack;
        public Material barFill;
        /// <summary>Plain, see-through and drawn after the fog: selection rings, order markers, the plot under the pointer.</summary>
        public Material overlay;
        /// <summary>Draws the fog of war over the picture (Shaders/Fog.shader).</summary>
        public Material fog;

        public UnitModel UnitFor(int entityType)
        {
            if (entityType < 0 || entityType >= units.Length) return null;
            UnitModel model = units[entityType];
            return model != null && model.prefab != null ? model : null;
        }

        public StaticModel BuildingFor(int entityType)
        {
            if (entityType < 0 || entityType >= buildings.Length) return null;
            StaticModel model = buildings[entityType];
            return model != null && model.prefab != null ? model : null;
        }
    }
}
