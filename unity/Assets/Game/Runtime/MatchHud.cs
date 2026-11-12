using System.Text;
using Rts.Sim;
using UnityEngine;

namespace Rts.Game
{
    /// <summary>
    /// A few lines of text over the picture: how far the match has got, how
    /// each side stands, and which keys do what. A stand-in until the game has
    /// a proper display of its own.
    /// </summary>
    [RequireComponent(typeof(MatchRunner))]
    public sealed class MatchHud : MonoBehaviour
    {
        public bool shown = true;

        MatchRunner runner;
        GUIStyle text;
        GUIStyle box;
        Texture2D shade;
        readonly StringBuilder words = new StringBuilder();
        string report = "";
        float nextReport;

        void Awake()
        {
            runner = GetComponent<MatchRunner>();
        }

        void Update()
        {
            if (runner.World == null || Time.unscaledTime < nextReport) return;
            nextReport = Time.unscaledTime + 0.25f;
            report = Report(runner.World);
        }

        string Report(World world)
        {
            words.Clear();
            int totalSeconds = world.tick / world.config.tickRate;
            words.Append("Match time ").Append(totalSeconds / 60).Append(':').Append((totalSeconds % 60).ToString("00"));
            words.Append("    Speed x").Append(runner.Speed.ToString("0"));
            if (runner.paused) words.Append("  (paused)");
            words.Append('\n');
            for (int player = 0; player < world.config.playerCount; player++)
            {
                int units = 0, buildings = 0;
                for (int slot = 0; slot < world.highWater; slot++)
                {
                    if (world.alive[slot] == 0 || world.owner[slot] != player) continue;
                    if (world.mobile[slot] == 1) units++;
                    else buildings++;
                }
                int at = player * EntityTypes.RESOURCE_COUNT;
                words.Append(Palette.TEAM_NAMES[player % Palette.TEAM_NAMES.Length]).Append(":  ")
                    .Append(EntityTypes.AGE_NAMES[world.age[player]])
                    .Append("    ").Append(units).Append(" people, ").Append(buildings).Append(" buildings")
                    .Append("    food ").Append(world.stock[at])
                    .Append("  wood ").Append(world.stock[at + 1])
                    .Append("  stone ").Append(world.stock[at + 2])
                    .Append("  gold ").Append(world.stock[at + 3])
                    .Append('\n');
            }
            words.Append("Move: arrows or W A S D, or hold the middle mouse button    Zoom: wheel\n");
            words.Append("Faster / slower: + and -    Pause: space    Jump to a town: 1 or 2\n");
            words.Append(runner.FramesPerSecond.ToString("0")).Append(" frames a second    ")
                .Append(runner.TickMilliseconds.ToString("0.00")).Append(" ms a tick    tick ").Append(world.tick)
                .Append("    ").Append(Hash.HashHex(Hash.HashWorld(world)));
            return words.ToString();
        }

        void OnGUI()
        {
            if (!shown || report.Length == 0) return;
            if (text == null)
            {
                shade = new Texture2D(1, 1);
                shade.SetPixel(0, 0, new Color(0.06f, 0.08f, 0.07f, 0.78f));
                shade.Apply();
                box = new GUIStyle(GUI.skin.box) { normal = { background = shade } };
                text = new GUIStyle(GUI.skin.label) { fontSize = 15, richText = false, normal = { textColor = new Color(0.93f, 0.92f, 0.86f) } };
            }
            // Drawn for a screen 1080 high and scaled to whatever the screen is.
            float scale = Mathf.Max(1f, Screen.height / 1080f);
            GUI.matrix = Matrix4x4.Scale(new Vector3(scale, scale, 1f));
            var content = new GUIContent(report);
            Vector2 size = text.CalcSize(content);
            var area = new Rect(12f, 12f, size.x + 24f, size.y + 16f);
            GUI.Box(area, GUIContent.none, box);
            GUI.Label(new Rect(area.x + 12f, area.y + 8f, size.x, size.y), content, text);
        }
    }
}
