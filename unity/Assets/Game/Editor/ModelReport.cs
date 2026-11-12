using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Rts.Game.EditorTools
{
    /// <summary>
    /// Writes down what each imported model is made of: its parts, their
    /// materials and its animation clips. Run from the menu or from
    /// scripts/unity-batch.ps1; the report goes to Logs/model-report.txt.
    /// </summary>
    public static class ModelReport
    {
        [MenuItem("RTS/Write Model Report")]
        public static void Run()
        {
            var report = new StringBuilder();
            foreach (string guid in AssetDatabase.FindAssets("", new[] { "Assets/Models" }).Distinct())
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.EndsWith(".glb")) continue;
                AssetImporter importer = AssetImporter.GetAtPath(path);
                report.AppendLine($"== {path}  (importer: {(importer == null ? "none" : importer.GetType().FullName)})");
                Object[] all = AssetDatabase.LoadAllAssetsAtPath(path);
                Object main = AssetDatabase.LoadMainAssetAtPath(path);
                report.AppendLine($"   main asset: {(main == null ? "none" : main.GetType().Name + " " + main.name)}; sub-assets: " +
                    string.Join(", ", all.GroupBy(o => o == null ? "null" : o.GetType().Name).Select(g => g.Key + " x" + g.Count())));
                foreach (Material material in all.OfType<Material>())
                {
                    string colour = material.HasProperty("baseColorFactor") ? material.GetColor("baseColorFactor").ToString()
                        : material.HasProperty("_BaseColor") ? material.GetColor("_BaseColor").ToString() : "?";
                    report.AppendLine($"   material '{material.name}' shader '{material.shader.name}' colour {colour} instancing {material.enableInstancing}");
                }
                foreach (AnimationClip clip in all.OfType<AnimationClip>())
                {
                    report.AppendLine($"   clip '{clip.name}' {clip.length:0.###}s legacy={clip.legacy} wrap={clip.wrapMode} fps={clip.frameRate}");
                }
                if (main is GameObject root)
                {
                    Bounds bounds = new Bounds();
                    bool any = false;
                    foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(true))
                    {
                        if (!any) { bounds = renderer.bounds; any = true; }
                        else bounds.Encapsulate(renderer.bounds);
                    }
                    report.AppendLine($"   bounds min {bounds.min} max {bounds.max}; components on root: " +
                        string.Join(", ", root.GetComponents<Component>().Select(c => c.GetType().Name)));
                    Describe(root.transform, 2, report);
                }
            }
            string output = Path.Combine(Directory.GetParent(Application.dataPath).FullName, "Logs", "model-report.txt");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            File.WriteAllText(output, report.ToString());
            Debug.Log("[RTS] model report written to " + output);
        }

        static void Describe(Transform node, int depth, StringBuilder report)
        {
            string line = new string(' ', depth * 2) + node.name +
                $"  pos {node.localPosition} rot {node.localEulerAngles} scale {node.localScale}";
            MeshFilter filter = node.GetComponent<MeshFilter>();
            MeshRenderer renderer = node.GetComponent<MeshRenderer>();
            if (filter != null && filter.sharedMesh != null)
            {
                Mesh mesh = filter.sharedMesh;
                line += $"  mesh '{mesh.name}' {mesh.vertexCount}v {mesh.subMeshCount}sub colours={mesh.colors32.Length > 0}";
            }
            if (renderer != null) line += "  materials [" + string.Join(", ", renderer.sharedMaterials.Select(m => m == null ? "null" : m.name)) + "]";
            SkinnedMeshRenderer skinned = node.GetComponent<SkinnedMeshRenderer>();
            if (skinned != null) line += "  SKINNED";
            report.AppendLine(line);
            if (depth > 7) return;
            foreach (Transform child in node) Describe(child, depth + 1, report);
        }
    }
}
