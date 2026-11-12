using System;
using Rts.Ai;
using Rts.Session;
using Rts.Sim;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Rts.Game
{
    /// <summary>Who is at the controls.</summary>
    public enum MatchMode
    {
        /// <summary>The player leads blue against the skirmish AI on red.</summary>
        Play,
        /// <summary>Two skirmish AIs play each other and nobody gives orders.</summary>
        Watch,
    }

    /// <summary>How the match went for blue, once a town centre has fallen.</summary>
    public enum MatchOutcome
    {
        Undecided,
        Victory,
        Defeat,
    }

    /// <summary>What the next match to start should be, when that is not what the scene says.</summary>
    public sealed class MatchPlan
    {
        public MatchMode mode = MatchMode.Play;
        /// <summary>How hard red plays against the player.</summary>
        public Difficulty opponent = Difficulty.Easy;
        /// <summary>Whether the match starts with time stopped, for whoever started it to move on by hand.</summary>
        public bool paused;
    }

    /// <summary>
    /// Runs a match and shows it: a skirmish on a generated map, either with
    /// the player leading blue against the skirmish AI on red, or with two AIs
    /// playing each other and nobody at the controls.
    ///
    /// The simulation decides everything that happens. This turns real time
    /// into ticks, asks the session to run them, and has the views draw the
    /// result. The player's orders reach the match only as commands through
    /// the session (PlayerControls); nothing here or in the views changes it.
    /// </summary>
    public sealed class MatchRunner : MonoBehaviour
    {
        static readonly float[] SPEEDS = { 1f, 2f, 4f, 8f, 16f };
        /// <summary>The most ticks run in one frame. Past this the match falls behind the clock sooner than the picture stalls.</summary>
        const int MOST_TICKS_A_FRAME = 120;
        /// <summary>Where the opponent the player last asked for is kept from one day to the next.</summary>
        public const string LEVEL_KEY = "rts-opponent-level";
        /// <summary>Where the editor's menu leaves word of which kind of match to start when Play is next pressed.</summary>
        public const string ASKED_FOR_KEY = "Rts.Match.AskedFor";

        /// <summary>
        /// If set, the next match to start is this and not what the scene says.
        /// It is how a new match is asked for from inside the game, and how the
        /// checks choose what to play.
        /// </summary>
        public static MatchPlan Next;

        public ModelLibrary library;
        public RtsCamera view;
        public Light sun;
        public Hud hud;

        [Header("The match")]
        public MatchMode mode = MatchMode.Play;
        public int seed = 1066;
        public int mapSize = 128;
        [Tooltip("How hard red plays against the player. The level the player last picked in the game takes its place.")]
        public Difficulty opponent = Difficulty.Easy;
        [Tooltip("When watching: how hard each of the two computer players plays.")]
        public Difficulty blue = Difficulty.Hard;
        public Difficulty red = Difficulty.Hard;

        [Header("Time")]
        [Range(0, 4)] public int speedStep = 0;
        public bool paused;

        public LocalSession Session { get; private set; }
        public World World => Session?.world;
        /// <summary>The player through whose eyes the match is shown.</summary>
        public int Viewer { get; private set; }
        public Ground Ground { get; private set; }
        public Sight Sight { get; private set; }
        public TerrainView Terrain { get; private set; }
        public PropField Props { get; private set; }
        public BuildingViews Buildings { get; private set; }
        public UnitViews Units { get; private set; }
        public Overlays Overlays { get; private set; }
        /// <summary>What is where on the screen.</summary>
        public ScreenMap OnScreen { get; private set; }
        /// <summary>The player's selection and orders. Null when nobody is playing.</summary>
        public PlayerControls Controls { get; private set; }
        public PlayerInput Input { get; private set; }
        public MatchOutcome Outcome { get; private set; }
        public float Speed => SPEEDS[Mathf.Clamp(speedStep, 0, SPEEDS.Length - 1)];
        /// <summary>How far the picture is between the last tick and the next, from 0 to 1.</summary>
        public float Alpha { get; private set; }
        /// <summary>Milliseconds the simulation took per tick, averaged over the last half second.</summary>
        public float TickMilliseconds { get; private set; }
        public float FramesPerSecond { get; private set; }

        FogPass fogPass;
        Func<int, bool> watched;
        Keyboard keyboard;
        int blueTown = World.NO_ENTITY;
        int redTown = World.NO_ENTITY;
        bool outcomeFresh;
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
            if (Session != null) return;
#if UNITY_EDITOR
            string asked = UnityEditor.SessionState.GetString(ASKED_FOR_KEY, "");
            if (asked.Length > 0)
            {
                UnityEditor.SessionState.EraseString(ASKED_FOR_KEY);
                if (Next == null && Enum.TryParse(asked, out MatchMode askedFor)) Next = new MatchPlan { mode = askedFor, opponent = ChosenLevel() };
            }
#endif
            if (Next != null)
            {
                mode = Next.mode;
                opponent = Next.opponent;
                paused = Next.paused;
                Next = null;
            }
            else if (mode == MatchMode.Play && PlayerPrefs.HasKey(LEVEL_KEY))
            {
                opponent = ChosenLevel();
            }
            Begin();
        }

        /// <summary>The opponent the player last asked for, or the gentlest if they never have.</summary>
        public static Difficulty ChosenLevel()
        {
            return Enum.TryParse(PlayerPrefs.GetString(LEVEL_KEY, ""), out Difficulty level) && Enum.IsDefined(typeof(Difficulty), level)
                ? level
                : Difficulty.Easy;
        }

        /// <summary>Starts a new match in place of this one: the player's own against red at a level, or one to watch.</summary>
        public void Restart(MatchMode mode, Difficulty level)
        {
            if (mode == MatchMode.Play)
            {
                PlayerPrefs.SetString(LEVEL_KEY, level.ToString());
                PlayerPrefs.Save();
            }
            Next = new MatchPlan { mode = mode, opponent = level };
            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
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
            if (view == null && Camera.main != null) view = Camera.main.GetComponent<RtsCamera>();
            // Without a camera of the game's own there is nothing to point at, so nobody can play.
            bool playing = mode == MatchMode.Play && view != null;

            Session = new LocalSession(config);
            if (!playing) Session.Control(0, new SkirmishAi(0, blue));
            Session.Control(1, new SkirmishAi(1, playing ? opponent : red));
            World world = Session.world;
            Viewer = 0;
            blueTown = TownCentreOf(0);
            redTown = TownCentreOf(1);
            Outcome = MatchOutcome.Undecided;
            outcomeFresh = false;

            SetLight();
            Ground = new Ground(world.map);
            // With nobody playing there is nothing to hide: the whole map is shown.
            Sight = new Sight(world, Viewer, !playing);
            var materials = new ModelMaterials();
            Terrain = new TerrainView(Ground, library, transform);
            Bounds bounds = Terrain.SceneBounds();
            Props = new PropField(Ground, library, materials, bounds);
            Terrain.onTileChanged = Props.Remove;
            Buildings = new BuildingViews(world, Ground, library, materials, Sight, transform);
            Units = new UnitViews(world, Ground, library, materials, Sight, transform);
            Overlays = new Overlays(world, Ground, library, Sight, bounds);

            if (view != null)
            {
                view.Attach(Ground);
                view.lettersMove = !playing;
                if (world.map.starts.Length > 0) LookAtTown(0);
                OnScreen = new ScreenMap(view.Lens, Ground, Sight, Terrain, Buildings);
                if (library.fog != null)
                {
                    fogPass = new FogPass(library.fog, view.Lens);
                    fogPass.Show(Sight);
                }
            }
            if (playing)
            {
                Controls = new PlayerControls(Viewer, Session, OnScreen, Sight, Buildings, Units, Overlays, view);
                Input = new PlayerInput(Controls, view, at => hud != null && hud.IsOver(at));
                watched = Controls.Watched;
            }
            if (hud != null && view != null) hud.Attach(this);
        }

        int TownCentreOf(int player)
        {
            World world = Session.world;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 1 && world.owner[slot] == player && world.entityType[slot] == Kind.TownCentre) return world.IdAt(slot);
            }
            return World.NO_ENTITY;
        }

        /// <summary>Has the game read this keyboard and mouse and no others. For the checks, which bring their own.</summary>
        public void UseDevices(Keyboard keyboard, Mouse mouse)
        {
            this.keyboard = keyboard;
            if (view != null)
            {
                view.keyboard = keyboard;
                view.mouse = mouse;
            }
            if (Input != null)
            {
                Input.keyboard = keyboard;
                Input.mouse = mouse;
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

        /// <summary>
        /// Lifts the fog for a look round, or lets it fall again. A testing aid:
        /// only what is drawn changes, never the rules.
        /// </summary>
        public void LiftFog(bool lift)
        {
            Sight.Lift(lift);
            // Whatever was seen only because the fog was lifted is forgotten when it falls.
            if (!lift) Buildings.ForgetWhatWasNeverSeen();
            if (Controls != null) Controls.Stale = true;
            else if (hud != null) hud.Refresh();
        }

        void Update()
        {
            if (Session == null) return;
            ReadKeys();
            // The player's clicks and keys become commands here, before the match moves on.
            Input?.Read();
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
            Controls?.Update(Alpha, Time.unscaledTimeAsDouble);
            Draw(dt);
            if (hud != null) hud.Frame(dt);
            Measure();
        }

        void Run(int ticks)
        {
            for (int i = 0; i < ticks; i++)
            {
                Units.RememberPositions();
                Session.Step();
            }
            Judge();
        }

        /// <summary>The match is decided when a town centre falls, though play carries on.</summary>
        void Judge()
        {
            if (Outcome != MatchOutcome.Undecided) return;
            bool won = !World.IsAlive(redTown);
            bool lost = !World.IsAlive(blueTown);
            if (!won && !lost) return;
            Outcome = won ? MatchOutcome.Victory : MatchOutcome.Defeat;
            outcomeFresh = true;
        }

        /// <summary>Hands over the outcome of the match, once, when it has just been decided.</summary>
        public bool TakeOutcome(out MatchOutcome outcome)
        {
            outcome = Outcome;
            if (!outcomeFresh) return false;
            outcomeFresh = false;
            return true;
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
            Sight.Update(dt);
            Terrain.Sync(Sight);
            if (view != null) Overlays.Face(view.transform);
            Buildings.Draw(seconds, Overlays, Controls != null ? Controls.Building : World.NO_ENTITY);
            Units.Draw(Alpha, dt, seconds, Overlays, watched);
            Overlays.AddArrows(Alpha, Units);
            Props.Draw();
            Overlays.Draw(dt);
        }

        void ReadKeys()
        {
            Keyboard keys = keyboard != null && keyboard.added ? keyboard : Keyboard.current;
            if (keys == null) return;
            bool playing = Controls != null;
            // With someone playing, space, + and - and the digits are the game's own keys,
            // so only the keys nothing else uses change how fast time runs.
            if (playing ? keys.f10Key.wasPressedThisFrame || keys.pauseKey.wasPressedThisFrame : keys.spaceKey.wasPressedThisFrame) paused = !paused;
            if (keys.rightBracketKey.wasPressedThisFrame || (!playing && (keys.equalsKey.wasPressedThisFrame || keys.numpadPlusKey.wasPressedThisFrame)))
            {
                speedStep = Mathf.Min(SPEEDS.Length - 1, speedStep + 1);
            }
            if (keys.leftBracketKey.wasPressedThisFrame || (!playing && (keys.minusKey.wasPressedThisFrame || keys.numpadMinusKey.wasPressedThisFrame)))
            {
                speedStep = Mathf.Max(0, speedStep - 1);
            }
            if (playing) return;
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

        void OnDestroy()
        {
            fogPass?.Stop();
            Sight?.Dispose();
        }
    }
}
