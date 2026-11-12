using System.Collections.Generic;
using System.IO;
using System.Linq;
using GLTFast;
using Rts.Sim;
using UnityEditor;
using UnityEditor.Rendering.Universal.ShaderGUI;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace Rts.Game.EditorTools
{
    /// <summary>
    /// Builds everything in the project that is made, not written: brings the
    /// models in from art-pipeline/models, makes the materials, lists which
    /// model draws which thing, sets how the picture is rendered, and lays out
    /// the scene the match runs in. It can be run again at any time and
    /// leaves things as they should be: from the menu (RTS > Set Up Project)
    /// or with scripts/unity-batch.ps1 -Method Rts.Game.EditorTools.ProjectSetup.Run.
    /// </summary>
    public static class ProjectSetup
    {
        const string MODELS = "Assets/Models";
        const string MATERIALS = "Assets/Game/Materials";
        const string LIBRARY = "Assets/Game/ModelLibrary.asset";
        const string PIPELINE = "Assets/Settings/PC_RPAsset.asset";
        public const string SCENE = "Assets/Scenes/Match.unity";

        static readonly Dictionary<int, string> UNIT_FILES = new Dictionary<int, string>
        {
            { Kind.Spearman, "spearman" }, { Kind.Villager, "villager" }, { Kind.Archer, "archer" }, { Kind.Horseman, "horseman" },
            { Kind.ManAtArms, "man-at-arms" }, { Kind.Knight, "knight" }, { Kind.Crossbowman, "crossbowman" }, { Kind.Handgunner, "handgunner" },
        };

        static readonly Dictionary<int, string> BUILDING_FILES = new Dictionary<int, string>
        {
            { Kind.TownCentre, "hall" }, { Kind.House, "house" }, { Kind.Mill, "mill" }, { Kind.LumberCamp, "lumber-camp" },
            { Kind.MiningCamp, "mining-camp" }, { Kind.Barracks, "barracks" }, { Kind.ArcheryRange, "archery-range" },
            { Kind.Stable, "stable" }, { Kind.Watchtower, "watchtower" }, { Kind.Farm, "farm" }, { Kind.Blacksmith, "blacksmith" },
        };

        static readonly string[] PROP_FILES = { "oak", "conifer", "berry-bush", "stone-deposit", "gold-deposit" };

        [MenuItem("RTS/Set Up Project")]
        public static void Run()
        {
            BringInModels();
            ImportWithPlainClips();
            ModelLibrary library = BuildLibrary();
            SetUpPipeline();
            BuildScene(library);
            // What the project template came with and the game does not use.
            foreach (string leftover in new[] { "Assets/Scenes/SampleScene.unity", "Assets/Settings/SampleSceneProfile.asset" })
            {
                if (File.Exists(leftover)) AssetDatabase.DeleteAsset(leftover);
            }
            AssetDatabase.SaveAssets();
            Debug.Log("[RTS] project set up: " + library.units.Count(u => u != null && u.prefab != null) + " unit models, " +
                library.buildings.Count(b => b != null && b.prefab != null) + " building models, scene at " + SCENE);
        }

        static IEnumerable<string> ModelNames()
        {
            return UNIT_FILES.Values.Concat(BUILDING_FILES.Values).Concat(PROP_FILES);
        }

        /// <summary>Copies any model that is new or has changed from art-pipeline/models, where the models are made.</summary>
        static void BringInModels()
        {
            string source = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "art-pipeline", "models"));
            if (!Directory.Exists(source))
            {
                Debug.LogWarning("[RTS] no folder " + source + "; keeping the models already in " + MODELS);
                return;
            }
            Directory.CreateDirectory(MODELS);
            int copied = 0;
            foreach (string name in ModelNames())
            {
                string from = Path.Combine(source, name + ".glb");
                string to = Path.Combine(MODELS, name + ".glb");
                if (!File.Exists(from)) continue;
                if (File.Exists(to) && File.ReadAllBytes(from).SequenceEqual(File.ReadAllBytes(to))) continue;
                File.Copy(from, to, true);
                copied++;
            }
            if (copied > 0) AssetDatabase.Refresh();
            Debug.Log("[RTS] models brought in from art-pipeline: " + copied);
        }

        /// <summary>
        /// Has the importer make plain ("legacy") animation clips. The game
        /// poses each unit itself, frame by frame, from what the simulation
        /// says, and plain clips are the kind that can simply be sampled.
        /// </summary>
        static void ImportWithPlainClips()
        {
            foreach (string name in ModelNames())
            {
                string path = MODELS + "/" + name + ".glb";
                AssetImporter importer = AssetImporter.GetAtPath(path);
                if (importer == null) continue;
                var settings = new SerializedObject(importer);
                SerializedProperty method = settings.FindProperty("importSettings.animationMethod");
                if (method == null || method.intValue == (int)AnimationMethod.Legacy) continue;
                method.intValue = (int)AnimationMethod.Legacy;
                settings.ApplyModifiedPropertiesWithoutUndo();
                importer.SaveAndReimport();
            }
        }

        static ModelLibrary BuildLibrary()
        {
            ModelLibrary library = AssetDatabase.LoadAssetAtPath<ModelLibrary>(LIBRARY);
            if (library == null)
            {
                library = ScriptableObject.CreateInstance<ModelLibrary>();
                AssetDatabase.CreateAsset(library, LIBRARY);
            }
            int kinds = EntityTypes.ENTITY_TYPES.Length;
            library.units = new ModelLibrary.UnitModel[kinds];
            library.buildings = new ModelLibrary.StaticModel[kinds];
            for (int kind = 0; kind < kinds; kind++)
            {
                library.units[kind] = UNIT_FILES.TryGetValue(kind, out string unit) ? Unit(unit) : new ModelLibrary.UnitModel();
                library.buildings[kind] = BUILDING_FILES.TryGetValue(kind, out string building) ? Static(building) : new ModelLibrary.StaticModel();
            }
            library.oak = Static("oak");
            library.conifer = Static("conifer");
            library.berries = Static("berry-bush");
            library.stone = Static("stone-deposit");
            library.gold = Static("gold-deposit");

            Directory.CreateDirectory(MATERIALS);
            // The ground is matt: no shine and no reflected sky.
            library.terrain = Lit("Terrain", Color.white, false);
            library.water = Lit("Water", WithAlpha(Palette.WATER, 0.8f), true);
            library.plot = Lit("Plot", WithAlpha(Palette.PLOT, 0.85f), true);
            // The colour of the background, so the table and the empty sky are one darkness.
            library.table = Unlit("Table", Palette.BACKGROUND);
            library.arrow = Unlit("Arrow", Palette.ARROW);
            library.barBack = Unlit("BarBack", Palette.BAR_BACK);
            library.barFill = Unlit("BarFill", Color.white);
            EditorUtility.SetDirty(library);
            return library;
        }

        static Color WithAlpha(Color colour, float alpha)
        {
            colour.a = alpha;
            return colour;
        }

        static GameObject Prefab(string name)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(MODELS + "/" + name + ".glb");
            if (prefab == null) Debug.LogError("[RTS] model missing or not imported: " + name);
            return prefab;
        }

        /// <summary>How far a model reaches from its centre along the ground, and how tall it stands.</summary>
        static void Measure(GameObject prefab, out float reach, out float height)
        {
            reach = 0f;
            height = 0f;
            foreach (Renderer renderer in prefab.GetComponentsInChildren<Renderer>(true))
            {
                Bounds b = renderer.bounds;
                reach = Mathf.Max(reach, Mathf.Abs(b.min.x), Mathf.Abs(b.max.x), Mathf.Abs(b.min.z), Mathf.Abs(b.max.z));
                height = Mathf.Max(height, b.max.y);
            }
        }

        static ModelLibrary.StaticModel Static(string name)
        {
            var model = new ModelLibrary.StaticModel { prefab = Prefab(name) };
            if (model.prefab != null) Measure(model.prefab, out model.reach, out model.height);
            return model;
        }

        static ModelLibrary.UnitModel Unit(string name)
        {
            var model = new ModelLibrary.UnitModel { prefab = Prefab(name) };
            if (model.prefab == null) return model;
            Measure(model.prefab, out _, out model.height);
            foreach (AnimationClip clip in AssetDatabase.LoadAllAssetsAtPath(MODELS + "/" + name + ".glb").OfType<AnimationClip>())
            {
                switch (clip.name)
                {
                    case "idle": model.idle = clip; break;
                    case "walk": model.walk = clip; break;
                    case "attack": model.attack = clip; break;
                    case "chop": model.chop = clip; break;
                }
                if (!clip.legacy) Debug.LogError("[RTS] clip '" + clip.name + "' of " + name + " is not a plain clip; the units will not move their limbs");
            }
            if (model.idle == null || model.walk == null) Debug.LogError("[RTS] model " + name + " has no idle or no walk clip");
            return model;
        }

        static Material Asset(string name, string shader)
        {
            string path = MATERIALS + "/" + name + ".mat";
            Shader wanted = Shader.Find(shader);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(wanted) { name = name };
                AssetDatabase.CreateAsset(material, path);
            }
            else if (material.shader != wanted)
            {
                material.shader = wanted;
            }
            return material;
        }

        static Material Lit(string name, Color colour, bool seeThrough)
        {
            Material material = Asset(name, "Universal Render Pipeline/Lit");
            material.SetColor("_BaseColor", colour);
            material.SetFloat("_Smoothness", 0f);
            material.SetFloat("_Metallic", 0f);
            material.SetFloat("_SpecularHighlights", 0f);
            material.SetFloat("_EnvironmentReflections", 0f);
            material.SetFloat("_Surface", seeThrough ? 1f : 0f);
            material.SetFloat("_Blend", 0f);
            BaseShaderGUI.SetMaterialKeywords(material, LitGUI.SetMaterialKeywords);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        static Material Unlit(string name, Color colour)
        {
            Material material = Asset(name, "Universal Render Pipeline/Unlit");
            material.SetColor("_BaseColor", colour);
            material.SetFloat("_Surface", 0f);
            BaseShaderGUI.SetMaterialKeywords(material);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        /// <summary>
        /// How the picture is rendered on a desktop. Shadows have to reach a
        /// long way, because the camera sits far back from what it shows.
        /// </summary>
        static void SetUpPipeline()
        {
            var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PIPELINE);
            if (pipeline == null)
            {
                Debug.LogError("[RTS] no render pipeline settings at " + PIPELINE);
                return;
            }
            var settings = new SerializedObject(pipeline);
            Set(settings, "m_MSAA", (int)MsaaQuality._4x);
            Set(settings, "m_MainLightShadowmapResolution", 4096);
            Set(settings, "m_ShadowCascadeCount", 4);
            settings.FindProperty("m_ShadowDistance").floatValue = 280f;
            settings.FindProperty("m_SoftShadowsSupported").boolValue = true;
            settings.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(pipeline);

            // The match carries on while the owner looks at another window.
            PlayerSettings.runInBackground = true;

            // "PC" is the quality level the editor and a desktop build use.
            string[] levels = QualitySettings.names;
            int pc = System.Array.IndexOf(levels, "PC");
            if (pc >= 0 && QualitySettings.GetQualityLevel() != pc) QualitySettings.SetQualityLevel(pc, true);
        }

        static void Set(SerializedObject settings, string name, int value)
        {
            SerializedProperty property = settings.FindProperty(name);
            if (property == null) Debug.LogError("[RTS] render pipeline has no setting called " + name);
            else property.intValue = value;
        }

        static void BuildScene(ModelLibrary library)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var cameraObject = new GameObject("Main Camera") { tag = "MainCamera" };
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Palette.BACKGROUND;
            camera.fieldOfView = 30f;
            camera.nearClipPlane = 2f;
            camera.farClipPlane = 2500f;
            camera.allowMSAA = true;
            cameraObject.AddComponent<AudioListener>();
            UniversalAdditionalCameraData extra = cameraObject.AddComponent<UniversalAdditionalCameraData>();
            // The colours are the browser version's own. Nothing grades them yet; that is for the graphics pass.
            extra.renderPostProcessing = false;
            extra.renderShadows = true;
            RtsCamera view = cameraObject.AddComponent<RtsCamera>();
            cameraObject.transform.SetPositionAndRotation(new Vector3(128f, 60f, -170f), Quaternion.Euler(55f, 0f, 0f));

            var sunObject = new GameObject("Sun");
            Light sun = sunObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = Palette.SUN;
            sun.intensity = 0.85f;
            sun.shadows = LightShadows.Soft;
            sunObject.transform.rotation = Quaternion.LookRotation(new Vector3(0.55f, -1f, 0.4f).normalized);
            sunObject.AddComponent<UniversalAdditionalLightData>();

            var match = new GameObject("Match");
            MatchRunner runner = match.AddComponent<MatchRunner>();
            runner.library = library;
            runner.view = view;
            runner.sun = sun;
            match.AddComponent<MatchHud>();

            RenderSettings.skybox = null;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.fog = false;

            Directory.CreateDirectory(Path.GetDirectoryName(SCENE));
            EditorSceneManager.SaveScene(scene, SCENE);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(SCENE, true) };
        }
    }

}
