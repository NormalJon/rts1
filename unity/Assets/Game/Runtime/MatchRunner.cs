using Rts.Ai;
using Rts.Session;
using Rts.Sim;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;

namespace Rts.Game
{
    /// <summary>
    /// Runs a match and shows it: two skirmish AIs playing each other on a
    /// generated map, with nobody at the controls. This is the first picture
    /// of the game in the engine; orders, selection and the fog come later.
    ///
    /// The simulation decides everything that happens. This turns real time
    /// into ticks, asks the session to run them, and has the views draw the
    /// result. Nothing here feeds back into the match.
    /// </summary>
    public sealed class MatchRunner : MonoBehaviour
    {
        static readonly float[] SPEEDS = { 1f, 2f, 4f, 8f, 16f };
        /// <summary>The most ticks run in one frame. Past this the match falls behind the clock sooner than the picture stalls.</summary>
        const int MOST_TICKS_A_FRAME = 120;

        public ModelLibrary library;
        public RtsCamera view;
        public Light sun;

        [Header("The match")]
        public int seed = 1066;
        public int mapSize = 128;
        public Difficulty blue = Difficulty.Hard;
        public Difficulty red = Difficulty.Hard;

        [Header("Watching")]
        [Range(0, 4)] public int speedStep = 0;
        public bool paused;

        public LocalSession Session { get; private set; }
        public World World => Session?.world;
        public Ground Ground { get; private set; }
        public TerrainView Terrain { get; private set; }
        public PropField Props { get; private set; }
        public BuildingViews Buildings { get; private set; }
        public UnitViews Units { get; private set; }
        public Overlays Overlays { get; private set; }
        public float Speed => SPEEDS[Mathf.Clamp(speedStep, 0, SPEEDS.Length - 1)];
        /// <summary>How far the picture is between the last tick and the next, from 0 to 1.</summary>
        public float Alpha { get; private set; }
        /// <summary>Milliseconds the simulation took per tick, averaged over the last half second.</summary>
        public float TickMilliseconds { get; private set; }
        public float FramesPerSecond { get; private set; }

        float owed;
        float seconds;
        float windowStart;
        int windowFrames;
        int windowTicks;
        double windowSimSeconds;

        void Start()
        {
            // The editor's Game view does not wait for the screen unless told to, and would
            // otherwise draw many hundreds of frames a second to no purpose.
            if (Application.isEditor && !Application.isBatchMode)
            {
                Application.targetFrameRate = Mathf.Max(60, Mathf.RoundToInt((float)Screen.currentResolution.refreshRateRatio.value));
            }
            if (Session == null) Begin();
        }

        /// <summary>Sets up the match and everything that draws it.</summary>
        public void Begin()
        {
            var config = new SimConfig
            {
                seed = seed,
                playerCount = 2,
                mapWidth = mapSize,
                mapHeight = mapSize,
                map = MapSpec.Generated(),
                start = StartKind.Standard,
                maxEntities = 2048,
            };
            Session = new LocalSession(config);
            Session.Control(0, new SkirmishAi(0, blue));
            Session.Control(1, new SkirmishAi(1, red));
            World world = Session.world;

            SetLight();
            Ground = new Ground(world.map);
            var materials = new ModelMaterials();
            Terrain = new TerrainView(Ground, library, transform);
            Bounds bounds = Terrain.SceneBounds();
            Props = new PropField(Ground, library, materials, bounds);
            Terrain.onTileChanged = Props.Remove;
            Buildings = new BuildingViews(world, Ground, library, materials, transform);
            Units = new UnitViews(world, Ground, library, materials, transform);
            Overlays = new Overlays(world, Ground, library, bounds);

            if (view == null && Camera.main != null) view = Camera.main.GetComponent<RtsCamera>();
            if (view != null)
            {
                view.Attach(Ground);
                if (world.map.starts.Length > 0) LookAtTown(0);
            }
        }

        /// <summary>The sun and the light of the sky, as in the browser version.</summary>
        void SetLight()
        {
            RenderSettings.fog = false;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            Color sky = Color.white * 0.78f;
            Color earth = Palette.GROUND_LIGHT * 0.78f;
            RenderSettings.ambientSkyColor = sky;
            RenderSettings.ambientGroundColor = earth;
            RenderSettings.ambientEquatorColor = Color.Lerp(earth, sky, 0.5f);
            if (sun == null) return;
            sun.type = LightType.Directional;
            sun.color = Palette.SUN;
            sun.intensity = 0.85f;
            sun.shadows = LightShadows.Soft;
            // From the north-west and a little behind the camera, so shadows fall toward the viewer's right.
            sun.transform.rotation = Quaternion.LookRotation(new Vector3(0.55f, -1f, 0.4f).normalized);
        }

        /// <summary>Points the camera at a player's starting place.</summary>
        public void LookAtTown(int player)
        {
            StartPosition[] starts = World.map.starts;
            if (view == null || player < 0 || player >= starts.Length) return;
            view.LookAt(Ground.F(starts[player].x), Ground.F(starts[player].y));
        }

        void Update()
        {
            if (Session == null) return;
            ReadKeys();
            float dt = Mathf.Min(0.1f, Time.unscaledDeltaTime);
            if (!paused) owed += dt * Speed * World.config.tickRate;
            int due = Mathf.Min((int)owed, MOST_TICKS_A_FRAME);
            // Whatever could not be run this frame is let go, not saved up.
            owed = Mathf.Min(owed - due, 1f);
            if (due > 0)
            {
                float before = Time.realtimeSinceStartup;
                Run(due);
                windowSimSeconds += Time.realtimeSinceStartup - before;
                windowTicks += due;
            }
            Alpha = paused ? Alpha : Mathf.Clamp01(owed);
            Draw(dt);
            Measure();
        }

        void Run(int ticks)
        {
            for (int i = 0; i < ticks; i++)
            {
                Units.RememberPositions();
                Session.Step();
            }
        }

        /// <summary>Runs the match forward a number of ticks at once, without drawing in between.</summary>
        public void Advance(int ticks)
        {
            Run(ticks);
            if (ticks > World.config.tickRate) Units.DropTheDead();
            owed = 0f;
            Alpha = 1f;
        }

        /// <summary>Brings the picture up to date with the match.</summary>
        public void Draw(float dt)
        {
            seconds += dt;
            Terrain.Sync();
            if (view != null) Overlays.Face(view.transform);
            Buildings.Draw(seconds, Overlays);
            Units.Draw(Alpha, dt, seconds, Overlays);
            Overlays.AddArrows(Alpha, Units);
            Props.Draw();
            Overlays.Draw();
        }

        void ReadKeys()
        {
            Keyboard keys = Keyboard.current;
            if (keys == null) return;
            if (keys.spaceKey.wasPressedThisFrame) paused = !paused;
            if (keys.equalsKey.wasPressedThisFrame || keys.rightBracketKey.wasPressedThisFrame || keys.numpadPlusKey.wasPressedThisFrame)
            {
                speedStep = Mathf.Min(SPEEDS.Length - 1, speedStep + 1);
            }
            if (keys.minusKey.wasPressedThisFrame || keys.leftBracketKey.wasPressedThisFrame || keys.numpadMinusKey.wasPressedThisFrame)
            {
                speedStep = Mathf.Max(0, speedStep - 1);
            }
            if (keys.digit1Key.wasPressedThisFrame) LookAtTown(0);
            if (keys.digit2Key.wasPressedThisFrame) LookAtTown(1);
        }

        void Measure()
        {
            windowFrames++;
            float now = Time.realtimeSinceStartup;
            float span = now - windowStart;
            if (span < 0.5f) return;
            FramesPerSecond = windowFrames / span;
            TickMilliseconds = windowTicks > 0 ? (float)(windowSimSeconds * 1000.0 / windowTicks) : 0f;
            windowStart = now;
            windowFrames = 0;
            windowTicks = 0;
            windowSimSeconds = 0.0;
        }
    }
}
