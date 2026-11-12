using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using NUnit.Framework;
using Rts.Ai;
using Rts.Sim;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;
using MouseButton = UnityEngine.InputSystem.LowLevel.MouseButton;
using Object = UnityEngine.Object;
using Terrain = Rts.Sim.Terrain;

namespace Rts.Game.Tests
{
    /// <summary>
    /// What the checks of the playable game share: starting a match in the
    /// match scene, a pretend mouse and keyboard to play it with, and taking
    /// pictures of it with the display on.
    ///
    /// The pretend devices are real ones as far as the game can tell. What
    /// they send goes through the engine's input system and is read by
    /// PlayerInput exactly as a hand on a mouse would be; nothing here calls
    /// the controls or the session to give an order.
    /// </summary>
    public sealed class PlayRig
    {
        public MatchRunner runner;
        public RtsCamera view;
        public Camera lens;
        public Hud hud;
        public World world;
        public PlayerControls controls;
        public Keyboard keyboard;
        public Mouse mouse;

        MouseState pointer;
        readonly List<Key> held = new List<Key>();
        InputSettings.BackgroundBehavior background;
        InputSettings.EditorInputBehaviorInPlayMode editorBehaviour;
        string folder;

        /// <summary>Loads the match scene and starts a match of the kind asked for, with time stopped: the check moves it on by hand.</summary>
        public IEnumerator Start(MatchMode mode, Difficulty opponent)
        {
            folder = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Logs", "Snapshots"));
            Directory.CreateDirectory(folder);

            // A test runs with no window in front, so the input system is told not to wait for one.
            InputSettings settings = InputSystem.settings;
            background = settings.backgroundBehavior;
            editorBehaviour = settings.editorInputBehaviorInPlayMode;
            settings.backgroundBehavior = InputSettings.BackgroundBehavior.IgnoreFocus;
            settings.editorInputBehaviorInPlayMode = InputSettings.EditorInputBehaviorInPlayMode.AllDeviceInputAlwaysGoesToGameView;
            keyboard = InputSystem.AddDevice<Keyboard>("Test keyboard");
            mouse = InputSystem.AddDevice<Mouse>("Test mouse");
            pointer = default;
            held.Clear();

            MatchRunner.Next = new MatchPlan { mode = mode, opponent = opponent, paused = true };
            SceneManager.LoadScene("Match");
            yield return null;
            yield return null;
            runner = Object.FindFirstObjectByType<MatchRunner>();
            Assert.That(runner, Is.Not.Null, "the Match scene has no MatchRunner");
            Assert.That(runner.World, Is.Not.Null, "the match did not start");
            world = runner.World;
            controls = runner.Controls;
            hud = runner.hud;
            lens = Camera.main;
            view = lens.GetComponent<RtsCamera>();
            Assert.That(world.tick, Is.EqualTo(0), "the match waits for the check to move it on");
            runner.UseDevices(keyboard, mouse);
            // The list of controls covers a good part of a small screen; the checks click on the field.
            if (hud != null) hud.ShowHelp(false);
            yield return null;
        }

        /// <summary>Puts the input system back as it was and takes the pretend devices away.</summary>
        public void Stop()
        {
            if (runner != null) runner.UseDevices(null, null);
            if (keyboard != null) InputSystem.RemoveDevice(keyboard);
            if (mouse != null) InputSystem.RemoveDevice(mouse);
            keyboard = null;
            mouse = null;
            InputSettings settings = InputSystem.settings;
            settings.backgroundBehavior = background;
            settings.editorInputBehaviorInPlayMode = editorBehaviour;
        }

        // ---- Time ------------------------------------------------------------------

        public IEnumerator Frames(int count)
        {
            for (int i = 0; i < count; i++) yield return null;
        }

        /// <summary>Runs the match on a number of ticks and lets the picture catch up.</summary>
        public IEnumerator Play(int ticks)
        {
            const int STEP = 30 * 10;
            for (int done = 0; done < ticks; done += STEP)
            {
                runner.Advance(Mathf.Min(STEP, ticks - done));
                yield return null;
            }
            yield return null;
        }

        /// <summary>Lets the time between two clicks pass, so that the next click is not taken for the second of a pair.</summary>
        public IEnumerator Pause()
        {
            float until = Time.unscaledTime + (float)PlayerControls.DOUBLE_CLICK_SECONDS * 1.6f;
            while (Time.unscaledTime < until) yield return null;
        }

        // ---- The pretend mouse and keyboard ----------------------------------------

        public IEnumerator MoveTo(Vector2 at)
        {
            pointer.position = at;
            InputSystem.QueueStateEvent(mouse, pointer);
            yield return null;
            WakeTheDisplay();
        }

        public IEnumerator Button(MouseButton button, bool down)
        {
            pointer = pointer.WithButton(button, down);
            InputSystem.QueueStateEvent(mouse, pointer);
            yield return null;
            WakeTheDisplay();
        }

        object displayEvents;
        MethodInfo displayUpdate;
        object[] displayAlways;
        bool displayLookedFor;

        /// <summary>
        /// Has the engine's display code take in what the pretend mouse has done.
        /// It does this by itself every frame, but only while the game's window
        /// is the one in front, and a check has no window. The engine keeps the
        /// way to ask for it to itself, so it is asked for by name.
        /// </summary>
        void WakeTheDisplay()
        {
            if (!displayLookedFor)
            {
                displayLookedFor = true;
                Type utility = typeof(VisualElement).Assembly.GetType("UnityEngine.UIElements.UIElementsRuntimeUtility");
                PropertyInfo system = utility?.GetProperty("defaultEventSystem", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                displayEvents = system?.GetValue(null);
                if (displayEvents != null)
                {
                    foreach (MethodInfo method in displayEvents.GetType().GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
                    {
                        ParameterInfo[] takes = method.GetParameters();
                        if (method.Name != "Update" || takes.Length != 1 || !takes[0].ParameterType.IsEnum) continue;
                        displayUpdate = method;
                        displayAlways = new[] { Enum.Parse(takes[0].ParameterType, "Always") };
                    }
                }
            }
            CanClickTheDisplay = displayUpdate != null;
            if (displayUpdate != null) displayUpdate.Invoke(displayEvents, displayAlways);
        }

        /// <summary>Whether a way was found to have the display take a pretend click with no window in front.</summary>
        public bool CanClickTheDisplay { get; private set; }

        public IEnumerator Click(Vector2 at, MouseButton button = MouseButton.Left)
        {
            yield return MoveTo(at);
            yield return Button(button, true);
            yield return Button(button, false);
        }

        public IEnumerator RightClick(Vector2 at)
        {
            return Click(at, MouseButton.Right);
        }

        public IEnumerator Drag(Vector2 from, Vector2 to)
        {
            yield return MoveTo(from);
            yield return Button(MouseButton.Left, true);
            yield return MoveTo(Vector2.Lerp(from, to, 0.5f));
            yield return MoveTo(to);
            yield return Button(MouseButton.Left, false);
        }

        public IEnumerator Hold(Key key)
        {
            if (!held.Contains(key)) held.Add(key);
            InputSystem.QueueStateEvent(keyboard, new KeyboardState(held.ToArray()));
            yield return null;
        }

        public IEnumerator Release(Key key)
        {
            held.Remove(key);
            InputSystem.QueueStateEvent(keyboard, new KeyboardState(held.ToArray()));
            yield return null;
        }

        /// <summary>Presses a key and lets it go.</summary>
        public IEnumerator Tap(Key key)
        {
            yield return Hold(key);
            yield return Release(key);
        }

        // ---- Where things are ------------------------------------------------------

        /// <summary>Points the camera at a place, in tiles, from a distance in metres.</summary>
        public IEnumerator LookAt(Vector2 tile, float distance)
        {
            view.distance = distance;
            view.LookAt(tile.x, tile.y);
            // Two frames: one for the camera to settle and one drawn from where it now is.
            yield return null;
            yield return null;
        }

        public Vector2 TownOf(int player)
        {
            StartPosition start = world.map.starts[player];
            return new Vector2(Ground.F(start.x), Ground.F(start.y));
        }

        public Vector2 PlaceOf(int id)
        {
            int slot = World.EntityIndex(id);
            return new Vector2(Ground.F(world.posX[slot]), Ground.F(world.posY[slot]));
        }

        /// <summary>Where a unit or building appears on the screen.</summary>
        public Vector2 ScreenOf(int id)
        {
            Vector2 at = PlaceOf(id);
            return ScreenOfTile(at.x, at.y, world.mobile[World.EntityIndex(id)] == 1 ? 0.9f : 0.3f);
        }

        /// <summary>Where a point on the map, so high above the ground in metres, appears on the screen.</summary>
        public Vector2 ScreenOfTile(float x, float y, float lift = 0f)
        {
            Vector3 point = runner.OnScreen.ToScreen(x, y, lift);
            Assert.That(runner.OnScreen.InFront(point), Is.True, $"({x}, {y}) is not in front of the camera");
            Assert.That(point.x >= 0f && point.x <= lens.pixelWidth && point.y >= 0f && point.y <= lens.pixelHeight, Is.True,
                $"({x}, {y}) is off the screen at ({point.x}, {point.y}) of {lens.pixelWidth} x {lens.pixelHeight}");
            var at = new Vector2(point.x, point.y);
            Assert.That(hud == null || !hud.IsOver(at), Is.True, $"({x}, {y}) is under a panel of the display at ({point.x}, {point.y})");
            return at;
        }

        public List<int> Own(int kind, int player = 0)
        {
            var found = new List<int>();
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 1 && world.owner[slot] == player && world.entityType[slot] == kind) found.Add(world.IdAt(slot));
            }
            return found;
        }

        public int Stock(int resource, int player = 0)
        {
            return world.stock[player * EntityTypes.RESOURCE_COUNT + resource];
        }

        /// <summary>The tile of a kind of terrain nearest a place that the player's side can see, or -1.</summary>
        public int NearestTile(Vector2 from, int terrain)
        {
            GameMap map = world.map;
            int best = -1;
            float bestDistance = float.MaxValue;
            for (int tile = 0; tile < map.tileCount; tile++)
            {
                if (map.terrain[tile] != terrain || !runner.Sight.SeesTile(tile)) continue;
                float dx = tile % map.width + 0.5f - from.x;
                float dy = tile / map.width + 0.5f - from.y;
                float distance = dx * dx + dy * dy;
                if (distance >= bestDistance) continue;
                bestDistance = distance;
                best = tile;
            }
            return best;
        }

        /// <summary>
        /// The middle of an open plot of grass near a place where a building of
        /// this size could go, clear of everyone, and with nothing tall standing
        /// just south of it: the camera looks from the south, and a click meant
        /// for ground hidden behind a building or a tree lands on that instead.
        /// </summary>
        public Vector2Int FreePlot(Vector2 near, int entityType, int clearOf = 3)
        {
            GameMap map = world.map;
            for (int radius = 4; radius < 30; radius++)
            {
                for (int dy = -radius; dy <= radius; dy++)
                {
                    for (int dx = -radius; dx <= radius; dx++)
                    {
                        if (Mathf.Max(Mathf.Abs(dx), Mathf.Abs(dy)) != radius) continue;
                        int tx = (int)near.x + dx;
                        int ty = (int)near.y + dy;
                        if (!Buildings.CanPlace(world, entityType, tx, ty, 0) || Hidden(tx, ty)) continue;
                        bool crowded = false;
                        for (int slot = 0; slot < world.highWater && !crowded; slot++)
                        {
                            if (world.alive[slot] == 0 || world.mobile[slot] == 0) continue;
                            crowded = Mathf.Abs(Ground.F(world.posX[slot]) - tx - 0.5f) < clearOf && Mathf.Abs(Ground.F(world.posY[slot]) - ty - 0.5f) < clearOf;
                        }
                        if (!crowded) return new Vector2Int(tx, ty);
                    }
                }
            }
            Assert.Fail("no open plot near " + near);
            return default;
        }

        /// <summary>Whether a building or a tree stands close enough to the south of a tile to hide it from the camera.</summary>
        bool Hidden(int tx, int ty)
        {
            GameMap map = world.map;
            for (int dy = 1; dy <= 6; dy++)
            {
                for (int dx = -3; dx <= 3; dx++)
                {
                    int x = tx + dx;
                    int y = ty + dy;
                    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
                    int tile = y * map.width + x;
                    if (map.blocked[tile] == 1 || map.terrain[tile] == Terrain.Forest) return true;
                }
            }
            return false;
        }

        // ---- Pictures --------------------------------------------------------------

        /// <summary>
        /// Takes a picture of the match as it would be on a screen 1920 by 1080,
        /// display and all, and leaves it in Logs/Snapshots.
        /// </summary>
        public IEnumerator Shoot(string name)
        {
            const int WIDTH = 1920;
            const int HEIGHT = 1080;
            // The fog rolls back and closes in over half a second or so; a check has no time to wait for it.
            runner.Sight.Settle();
            // The display is drawn on a sheet of its own for a moment, so that it can be laid over the picture.
            PanelSettings panel = hud != null ? hud.GetComponent<UIDocument>().panelSettings : null;
            RenderTexture sheet = null;
            if (panel != null)
            {
                sheet = new RenderTexture(WIDTH, HEIGHT, 24, RenderTextureFormat.ARGB32);
                panel.clearColor = true;
                panel.colorClearValue = Color.clear;
                panel.targetTexture = sheet;
                // A few frames for it to be laid out at its new size and drawn. (Waiting for the
                // end of a frame would wait for ever: with no window, no frame ever ends.)
                yield return null;
                yield return null;
                yield return null;
            }

            var target = new RenderTexture(WIDTH, HEIGHT, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
            RenderTexture before = lens.targetTexture;
            lens.targetTexture = target;
            lens.Render();
            lens.targetTexture = before;
            Texture2D picture = Read(target, TextureFormat.RGB24);
            if (sheet != null)
            {
                Texture2D over = Read(sheet, TextureFormat.RGBA32);
                Color32[] under = picture.GetPixels32();
                Color32[] top = over.GetPixels32();
                for (int i = 0; i < under.Length; i++)
                {
                    Color32 t = top[i];
                    if (t.a == 0) continue;
                    Color32 u = under[i];
                    int keep = 255 - t.a;
                    under[i] = new Color32(
                        (byte)Mathf.Min(255, t.r + u.r * keep / 255),
                        (byte)Mathf.Min(255, t.g + u.g * keep / 255),
                        (byte)Mathf.Min(255, t.b + u.b * keep / 255),
                        255);
                }
                picture.SetPixels32(under);
                picture.Apply();
                Object.Destroy(over);
                panel.targetTexture = null;
                panel.clearColor = false;
                sheet.Release();
                Object.Destroy(sheet);
            }
            File.WriteAllBytes(Path.Combine(folder, name + ".png"), picture.EncodeToPNG());
            Object.Destroy(picture);
            target.Release();
            Object.Destroy(target);
            yield return null;
        }

        /// <summary>The picture the camera draws, as numbers, for checking what is and is not shown. No display over it.</summary>
        public Color32[] Look(int width, int height)
        {
            runner.Sight.Settle();
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            RenderTexture before = lens.targetTexture;
            lens.targetTexture = target;
            lens.Render();
            lens.targetTexture = before;
            Texture2D picture = Read(target, TextureFormat.RGB24);
            Color32[] dots = picture.GetPixels32();
            Object.Destroy(picture);
            target.Release();
            Object.Destroy(target);
            return dots;
        }

        static Texture2D Read(RenderTexture from, TextureFormat format)
        {
            RenderTexture active = RenderTexture.active;
            RenderTexture.active = from;
            var picture = new Texture2D(from.width, from.height, format, false);
            picture.ReadPixels(new Rect(0, 0, from.width, from.height), 0, 0);
            picture.Apply();
            RenderTexture.active = active;
            return picture;
        }
    }
}
