using System;
using System.Collections.Generic;
using System.Text;
using Rts.Ai;
using Rts.Sim;
using UnityEngine;
using UnityEngine.UIElements;

namespace Rts.Game
{
    /// <summary>
    /// What is on the screen over the battlefield: the stores, the age and the
    /// population along the top; the minimap; what is selected and the buttons
    /// for it along the bottom; what is in training; messages; the list of
    /// controls; and the banner when a town centre falls. Laid out as
    /// src/client/game/page.html is, and styled by UI/Hud.uss.
    ///
    /// This is display only. It reads the world and the controls and shows
    /// them; a button here does nothing itself but tell the controls it was
    /// pressed, exactly as the key for it does. Orders are the controls'
    /// business (PlayerControls), never this file's.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class Hud : MonoBehaviour
    {
        const float BANNER_SECONDS = 9f;
        static readonly string[] RESOURCE_TITLES = { "Food", "Wood", "Stone", "Gold" };
        static readonly string[] LEVEL_NAMES = { "Easy", "Standard", "Hard" };
        /// <summary>Whether the player wants the list of controls open. Kept from one match to the next.</summary>
        static bool helpOpen = true;

        public StyleSheet styles;

        MatchRunner runner;
        bool helpShown;
        PlayerControls controls;
        Func<int, bool> isSelected;
        World world;
        int player;
        UIDocument document;
        VisualElement root;

        Label stats;
        Label age;
        readonly Label[] stores = new Label[EntityTypes.RESOURCE_COUNT];
        readonly int[] storesShown = new int[EntityTypes.RESOURCE_COUNT];
        Label population;
        VisualElement production;
        VisualElement help;
        VisualElement helpButton;
        VisualElement fogButton;
        VisualElement idleButton;
        Label idleLabel;
        VisualElement groups;
        VisualElement command;
        Label selection;
        VisualElement orders;
        VisualElement attackButton;
        VisualElement patrolButton;
        VisualElement progress;
        VisualElement progressBar;
        VisualElement queue;
        VisualElement actions;
        VisualElement toast;
        Label toastLabel;
        VisualElement banner;
        Label bannerTitle;
        Label bannerLine;
        VisualElement box;
        Label tip;

        /// <summary>What each row was last built for, so it is only rebuilt when that changes and a click is never lost to a redraw.</summary>
        string actionsFor = "";
        string queueFor = "";
        string productionFor = "";
        string groupsFor = "";
        int idleShown = -1;
        readonly List<VisualElement> actionButtons = new List<VisualElement>();
        readonly List<int> busy = new List<int>();
        readonly List<VisualElement> productionBars = new List<VisualElement>();
        /// <summary>What the player had researched when last looked at, to announce what is new.</summary>
        byte[] researchSeen;
        float due;
        float bannerUntil;
        bool bannerShown;
        readonly StringBuilder words = new StringBuilder();

        public Minimap Minimap { get; private set; }
        /// <summary>The words on the banner, or an empty string while there is none: "Victory" or "Defeat".</summary>
        public string Banner => bannerShown ? bannerTitle.text : "";
        public string SelectionText => selection != null ? selection.text : "";
        public string ToastText => toast != null && toast.style.display == DisplayStyle.Flex ? toastLabel.text : "";
        public string StoresText(int resource) => stores[resource].text;
        public string PopulationText => population.text;
        public string AgeText => age.text;
        /// <summary>The names on the buttons of the action row, left to right.</summary>
        public List<string> ActionLabels()
        {
            var labels = new List<string>();
            foreach (VisualElement button in actionButtons) labels.Add(button.Q<Label>(className: "action-name").text);
            return labels;
        }

        /// <summary>
        /// Presses the button or chip of this name as a click on it would, for
        /// the checks: "attack-move", "action-0", "queued-0", "group-1" and so
        /// on. False if there is none of that name showing.
        /// </summary>
        public bool Press(string name)
        {
            VisualElement button = root.Q(name);
            if (button == null || button.resolvedStyle.display == DisplayStyle.None || !(button.userData is Action act)) return false;
            for (VisualElement up = button.parent; up != null && up != root; up = up.parent)
            {
                if (up.style.display == DisplayStyle.None) return false;
            }
            act();
            return true;
        }

        /// <summary>
        /// Where the middle of a named part of the display is on the screen, in
        /// pixels from the bottom left: for the checks, which click there with
        /// a pretend mouse.
        /// </summary>
        public bool ScreenPlaceOf(string name, out Vector2 screen)
        {
            screen = default;
            VisualElement element = root != null ? root.Q(name) : null;
            if (element == null || root.panel == null) return false;
            Vector2 origin = RuntimePanelUtils.ScreenToPanel(root.panel, Vector2.zero);
            Vector2 perPixel = RuntimePanelUtils.ScreenToPanel(root.panel, Vector2.one) - origin;
            Vector2 centre = element.worldBound.center;
            screen = new Vector2((centre.x - origin.x) / perPixel.x, Screen.height - (centre.y - origin.y) / perPixel.y);
            return true;
        }

        /// <summary>Called once the match and everything that draws it exists.</summary>
        public void Attach(MatchRunner runner)
        {
            this.runner = runner;
            controls = runner.Controls;
            isSelected = controls != null ? controls.IsSelected : (Func<int, bool>)null;
            world = runner.World;
            player = runner.Viewer;
            document = GetComponent<UIDocument>();
            VisualElement page = document.rootVisualElement;
            if (page == null)
            {
                Debug.LogError("[RTS] the display has no panel to draw on: the UIDocument has no panel settings");
                return;
            }
            page.Clear();
            page.pickingMode = PickingMode.Ignore;
            page.style.flexGrow = 1f;
            if (styles != null && !page.styleSheets.Contains(styles)) page.styleSheets.Add(styles);
            for (int i = 0; i < storesShown.Length; i++) storesShown[i] = -1;
            researchSeen = null;
            Build(page);
            Refresh();
        }

        // ---- Laying it out -----------------------------------------------------------

        static VisualElement Group(string classes, params VisualElement[] children)
        {
            var element = new VisualElement { pickingMode = PickingMode.Ignore };
            foreach (string name in classes.Split(' ')) if (name.Length > 0) element.AddToClassList(name);
            foreach (VisualElement child in children) element.Add(child);
            return element;
        }

        static VisualElement Panel(string classes, params VisualElement[] children)
        {
            VisualElement element = Group("panel " + classes, children);
            // A panel takes the clicks that land on it; the field under it does not.
            element.pickingMode = PickingMode.Position;
            return element;
        }

        static Label Text(string classes, string text = "")
        {
            var label = new Label(text) { pickingMode = PickingMode.Ignore };
            label.AddToClassList("t");
            foreach (string name in classes.Split(' ')) if (name.Length > 0) label.AddToClassList(name);
            return label;
        }

        /// <summary>Something to click: it calls what it is given, and can be found again by its name.</summary>
        VisualElement Button(string name, string classes, Action onClick, string about, params VisualElement[] children)
        {
            var button = new VisualElement { name = name, pickingMode = PickingMode.Position, focusable = false, userData = onClick };
            button.AddToClassList("btn");
            foreach (string each in classes.Split(' ')) if (each.Length > 0) button.AddToClassList(each);
            foreach (VisualElement child in children) button.Add(child);
            button.AddManipulator(new Clickable(onClick));
            if (!string.IsNullOrEmpty(about))
            {
                button.RegisterCallback<PointerEnterEvent>(_ => ShowTip(button, about));
                button.RegisterCallback<PointerLeaveEvent>(_ => HideTip());
            }
            return button;
        }

        static Label Key(string key)
        {
            return Text("kbd", key);
        }

        void Build(VisualElement page)
        {
            root = Group("hud");
            page.Add(root);
            bool playing = controls != null;

            // ---- Top left: what this is, how the match is running, and what is in training.
            stats = Text("stats");
            VisualElement titleRow = Group("title-row", Text("h1", playing ? "Skirmish" : "Watching a match"));
            if (playing)
            {
                VisualElement level = Group("level", Text("muted small", "Opponent"));
                for (int i = 0; i < LEVEL_NAMES.Length; i++)
                {
                    var difficulty = (Difficulty)i;
                    VisualElement choice = Button("level-" + LEVEL_NAMES[i].ToLowerInvariant(), "level-choice",
                        () => runner.Restart(MatchMode.Play, difficulty),
                        "How strong the red side plays. Choosing another starts a new match.",
                        Text("small", LEVEL_NAMES[i]));
                    choice.EnableInClassList("pressed", runner.opponent == difficulty);
                    level.Add(choice);
                }
                titleRow.Add(level);
            }
            production = Group("production");
            VisualElement title = Group("title", Panel("title-card", titleRow, stats), production);

            // ---- Top middle: the age, the stores and the population.
            age = Text("age");
            VisualElement storesPanel = Panel("stores", Group("store store-age", age));
            for (int r = 0; r < stores.Length; r++)
            {
                stores[r] = Text("data");
                storesPanel.Add(Group("store", Text("muted small", RESOURCE_TITLES[r]), stores[r]));
            }
            population = Text("data");
            storesPanel.Add(Group("store", Text("muted small", "People"), population));
            storesPanel.style.display = playing ? DisplayStyle.Flex : DisplayStyle.None;

            // ---- Top right: the tools, and the list of controls under them.
            helpButton = Button("help", "tool", () => SetHelp(!helpShown), null, Text("", "Controls"));
            fogButton = Button("fog", "tool", () => runner.LiftFog(!runner.Sight.Lifted),
                "Testing aid: show the whole map. The game's rules stay the same.", Text("", "Lift fog"));
            VisualElement modeButton = playing
                ? Button("watch", "tool", () => runner.Restart(MatchMode.Watch, runner.opponent),
                    "Stop playing and watch two computer players have a match.", Text("", "Watch a match"))
                : Button("play", "tool", () => runner.Restart(MatchMode.Play, MatchRunner.ChosenLevel()),
                    "Start a match of your own against the computer.", Text("", "Play a match"));
            VisualElement tools = Group("tools", helpButton, fogButton, modeButton);
            help = BuildHelp(playing);
            VisualElement right = Group("right", tools, help);

            // ---- Bottom: the map, and what is selected with its buttons.
            Minimap = new Minimap(world, runner.Sight, runner.Terrain, runner.Buildings, runner.OnScreen, runner.view);
            if (controls != null)
            {
                Minimap.onOrder = controls.Order;
                controls.onAlarm = Minimap.Ping;
            }
            VisualElement map = Panel("map", Minimap.element);

            idleLabel = Text("small");
            idleButton = Button("idle", "idle", () => controls.SelectIdleVillager(), "Jump to the next villager with nothing to do", idleLabel, Key("."));
            groups = Group("groups");
            selection = Text("selection", "Nothing selected");
            attackButton = Button("attack-move", "order", () => controls.Aim(Aiming.AttackMove), "March there, fighting whatever they meet", Text("", "Attack-move"), Key("A"));
            patrolButton = Button("patrol", "order", () => controls.Aim(Aiming.Patrol), "Walk to and fro between here and a point", Text("", "Patrol"), Key("P"));
            orders = Group("orders",
                attackButton,
                patrolButton,
                Button("hold", "order", () => controls.Hold(), "Stand fast: strike what comes within reach, never give chase", Text("", "Hold"), Key("H")),
                Button("stop", "order", () => controls.Stop(), null, Text("", "Stop"), Key("S")));
            progressBar = Group("progress-bar");
            progress = Group("progress", progressBar);
            queue = Group("queue");
            actions = Group("actions");
            command = Panel("command", Group("command-head", selection, orders), progress, queue, actions);
            VisualElement bar = Group("bar", Group("above", idleButton, groups), command);
            bar.style.display = playing ? DisplayStyle.Flex : DisplayStyle.None;

            root.Add(Group("top", title, storesPanel, right));
            root.Add(Group("bottom", map, bar));

            // ---- Over everything: messages, the banner, the box being dragged, and what a button is.
            toastLabel = Text("");
            toast = Group("panel toast", toastLabel);
            root.Add(Group("float float-toast", toast));
            bannerTitle = Text("banner-title");
            bannerLine = Text("muted");
            banner = Group("panel banner", bannerTitle, bannerLine);
            root.Add(Group("float float-banner", banner));
            box = Group("select-box");
            root.Add(box);
            tip = Text("tip");
            root.Add(tip);
            toast.style.display = DisplayStyle.None;
            banner.style.display = DisplayStyle.None;
            box.style.display = DisplayStyle.None;
            tip.style.display = DisplayStyle.None;

            SetHelp(playing && helpOpen);
        }

        VisualElement BuildHelp(bool playing)
        {
            var scroll = new ScrollView(ScrollViewMode.Vertical) { name = "help-text" };
            scroll.AddToClassList("help-scroll");
            scroll.Add(Text("h2", "Controls"));
            void Row(string keys, string what)
            {
                scroll.Add(Group("help-row", Text("help-keys", keys), Text("help-what", what)));
            }
            void Paragraph(string text)
            {
                scroll.Add(Text("help-text muted", text));
            }
            if (playing)
            {
                Row("drag", "Select the units inside the box");
                Row("click", "Select one; twice for all of its kind in view");
                Row("shift", "Add to, or take from, the selection");
                Row("right-click", "Send them there, or at an enemy to attack it. Villagers gather from a tree, bush, stone or gold, build at a site, and mend a damaged building. With a building selected, sets where its new units go");
                Row("shift + right", "Add a waypoint");
                Row("A, click", "Attack-move: march there, fighting whatever they meet");
                Row("P, click", "Patrol between here and there");
                Row("H   S", "Hold ground (never give chase) · Stop");
                Row("Q W E R…", "With villagers: choose a building (W is a farm), then click where it goes. With a building: train a unit");
                Row("F", "Look at the last place you were attacked");
                Row("del", "Pull down the selected building");
                Row(".", "Jump to the next idle villager");
                Row("ctrl + 1–9", "Save the selection as a group (shift works too)");
                Row("1–9", "Recall a group; twice to jump to it");
                Row("arrows", "Move the view, or drag with the middle button");
                Row("wheel  + −", "Zoom");
                Row("space", "Jump to your selection");
                Row("esc", "Clear the selection");
                Row("[  ]  F10", "For testing: slower, faster, pause");
                Paragraph("Spearmen stop horsemen, horsemen ride down archers, archers shoot spearmen before they close. Soldiers left alone guard where they stand; a plain move ignores the enemy.");
                Paragraph("There are four ages. To leave one, choose one of the two reforms offered at the town centre: each takes you on and leaves its own mark, and the other is then closed. Later ages bring soldiers in armour (they cost gold) and the weapons that beat them. Research at each building improves what it deals in; rest the pointer on a button to read what it was.");
                Paragraph("You see only what your people see. Ground you have left stays on the map as you last saw it; ground you have never seen is dark, and nothing can be built there. Lift fog shows everything, for testing.");
                Paragraph("You lead the blue side, in the north-west. The computer leads red: it builds a town, scouts you out, and attacks when it has the soldiers, with more each time. It plays by your rules, fog and all. Pick how hard it plays with Opponent. When the berries run out, build farms: one villager works each, and the food never ends. Pull down the red town centre to win.");
            }
            else
            {
                Row("arrows  W A S D", "Move the view, or drag with the middle button");
                Row("wheel", "Zoom");
                Row("+  −", "Faster, slower");
                Row("space", "Pause");
                Row("1  2", "Jump to the blue town, or the red");
                Paragraph("Two computer players are having a match and nobody is at the controls. Lift fog is on, so you see everything; turn it off to see only what blue sees. Play a match starts one of your own.");
            }
            VisualElement panel = Panel("help", scroll);
            return panel;
        }

        /// <summary>Opens or closes the list of controls.</summary>
        public void ShowHelp(bool open)
        {
            if (root != null) SetHelp(open);
        }

        void SetHelp(bool open)
        {
            helpShown = open;
            if (controls != null) helpOpen = open;
            help.style.display = open ? DisplayStyle.Flex : DisplayStyle.None;
            helpButton.EnableInClassList("pressed", open);
        }

        // ---- What a button is --------------------------------------------------------

        void ShowTip(VisualElement over, string about)
        {
            tip.text = about;
            tip.style.display = DisplayStyle.Flex;
            Rect at = over.worldBound;
            Rect all = root.worldBound;
            float left = Mathf.Clamp(at.xMin - all.xMin, 8f, Mathf.Max(8f, all.width - 380f));
            tip.style.left = left;
            if (at.center.y > all.center.y)
            {
                // Low on the screen: the words go above the button.
                tip.style.top = StyleKeyword.Auto;
                tip.style.bottom = all.yMax - at.yMin + 6f;
            }
            else
            {
                tip.style.bottom = StyleKeyword.Auto;
                tip.style.top = at.yMax - all.yMin + 6f;
            }
        }

        void HideTip()
        {
            tip.style.display = DisplayStyle.None;
        }

        /// <summary>Whether a point on the screen, in pixels from the bottom left, is over one of the panels.</summary>
        public bool IsOver(Vector2 screen)
        {
            if (root == null || root.panel == null) return false;
            Vector2 at = RuntimePanelUtils.ScreenToPanel(root.panel, new Vector2(screen.x, Screen.height - screen.y));
            VisualElement hit = root.panel.Pick(at);
            return hit != null && hit != root && root.Contains(hit);
        }

        // ---- Every frame -----------------------------------------------------------

        /// <summary>Call once a frame, after the controls have been brought up to date.</summary>
        public void Frame(float dt)
        {
            if (root == null) return;
            ShowBox();
            ShowStores();
            Judge();
            Minimap.Draw(dt, isSelected);
            // Much of what the panels show changes without the player's say, so they are
            // looked over a few times a second, and at once when the controls say so.
            due -= dt;
            bool told = controls != null && controls.Stale;
            if (due > 0f && !told) return;
            Refresh();
            // An order shows in the match a tick after it is given, so look again shortly after one.
            if (told) due = 0.09f;
        }

        void ShowBox()
        {
            if (controls == null || !controls.DragBox(out Rect drag) || root.panel == null)
            {
                if (box.style.display != DisplayStyle.None) box.style.display = DisplayStyle.None;
                return;
            }
            Vector2 topLeft = RuntimePanelUtils.ScreenToPanel(root.panel, new Vector2(drag.xMin, Screen.height - drag.yMax));
            Vector2 bottomRight = RuntimePanelUtils.ScreenToPanel(root.panel, new Vector2(drag.xMax, Screen.height - drag.yMin));
            box.style.display = DisplayStyle.Flex;
            box.style.left = topLeft.x;
            box.style.top = topLeft.y;
            box.style.width = bottomRight.x - topLeft.x;
            box.style.height = bottomRight.y - topLeft.y;
        }

        void ShowStores()
        {
            if (controls == null) return;
            for (int r = 0; r < stores.Length; r++)
            {
                int amount = world.stock[player * EntityTypes.RESOURCE_COUNT + r];
                if (amount == storesShown[r]) continue;
                storesShown[r] = amount;
                stores[r].text = amount.ToString();
            }
        }

        /// <summary>The match is decided when a town centre falls, though play carries on.</summary>
        void Judge()
        {
            if (bannerShown && Time.unscaledTime >= bannerUntil)
            {
                banner.style.display = DisplayStyle.None;
                bannerShown = false;
            }
            if (!runner.TakeOutcome(out MatchOutcome outcome)) return;
            if (controls != null)
            {
                bool won = outcome == MatchOutcome.Victory;
                bannerTitle.text = won ? "Victory" : "Defeat";
                bannerLine.text = won ? "The red town centre has fallen." : "Your town centre has fallen.";
            }
            else
            {
                bool blueWon = outcome == MatchOutcome.Victory;
                bannerTitle.text = blueWon ? "Blue wins" : "Red wins";
                bannerLine.text = blueWon ? "The red town centre has fallen." : "The blue town centre has fallen.";
            }
            banner.style.display = DisplayStyle.Flex;
            bannerShown = true;
            bannerUntil = Time.unscaledTime + BANNER_SECONDS;
        }

        /// <summary>Brings every panel up to date with the match and the controls.</summary>
        public void Refresh()
        {
            if (root == null) return;
            due = 0.2f;
            ShowStats();
            fogButton.EnableInClassList("pressed", runner.Sight.Lifted);
            if (controls == null) return;
            controls.Stale = false;

            selection.text = controls.Summary();
            orders.style.display = controls.Selected.Count == 0 ? DisplayStyle.None : DisplayStyle.Flex;
            attackButton.EnableInClassList("pressed", controls.AimingAt == Aiming.AttackMove);
            patrolButton.EnableInClassList("pressed", controls.AimingAt == Aiming.Patrol);
            string said = controls.Toast;
            toast.style.display = said.Length > 0 ? DisplayStyle.Flex : DisplayStyle.None;
            if (said.Length > 0) toastLabel.text = said;

            ShowActions();
            ShowQueue();
            ShowProduction();
            ShowAge();
            ShowPeople();
            ShowGroups();
        }

        void ShowStats()
        {
            words.Clear();
            int totalSeconds = world.tick / world.config.tickRate;
            words.Append(totalSeconds / 60).Append(':').Append((totalSeconds % 60).ToString("00"));
            if (runner.paused) words.Append(" · paused");
            else if (runner.Speed != 1f) words.Append(" · speed x").Append(runner.Speed.ToString("0"));
            words.Append(" · ").Append(runner.FramesPerSecond.ToString("0")).Append(" frames a second · ")
                .Append(runner.TickMilliseconds.ToString("0.00")).Append(" ms a tick");
            if (controls == null)
            {
                for (int side = 0; side < world.config.playerCount; side++)
                {
                    int people = 0, standing = 0;
                    for (int slot = 0; slot < world.highWater; slot++)
                    {
                        if (world.alive[slot] == 0 || world.owner[slot] != side) continue;
                        if (world.mobile[slot] == 1) people++;
                        else standing++;
                    }
                    int at = side * EntityTypes.RESOURCE_COUNT;
                    words.Append('\n').Append(Palette.TEAM_NAMES[side % Palette.TEAM_NAMES.Length]).Append(": ")
                        .Append(EntityTypes.AGE_NAMES[world.age[side]])
                        .Append(" · ").Append(people).Append(" people, ").Append(standing).Append(" buildings")
                        .Append(" · food ").Append(world.stock[at])
                        .Append(", wood ").Append(world.stock[at + 1])
                        .Append(", stone ").Append(world.stock[at + 2])
                        .Append(", gold ").Append(world.stock[at + 3]);
                }
            }
            words.Append('\n').Append("tick ").Append(world.tick).Append(" · ").Append(Hash.HashHex(Hash.HashWorld(world)));
            stats.text = words.ToString();
        }

        void ShowActions()
        {
            List<GameAction> list = controls.Placing != -1 ? new List<GameAction>() : controls.Actions();
            int own = controls.OwnBuilding();
            words.Clear();
            foreach (GameAction action in list) words.Append(action.label).Append('|').Append(action.detail).Append('|').Append(action.locked ?? "").Append(';');
            string wanted = words.ToString();
            if (wanted != actionsFor)
            {
                actionsFor = wanted;
                HideTip();
                actions.Clear();
                actionButtons.Clear();
                for (int i = 0; i < list.Count; i++)
                {
                    GameAction action = list[i];
                    int index = i;
                    bool pullDown = own != -1 && index == list.Count - 1;
                    string key = pullDown ? "DEL" : index < PlayerControls.ACTION_KEYS.Length ? PlayerControls.ACTION_KEYS[index].ToUpperInvariant() : null;
                    VisualElement face = Group("action-face", Text("action-name", action.label), Text("action-detail small", action.locked ?? action.detail));
                    VisualElement button = key != null
                        ? Button("action-" + index, "action", () => controls.Act(index), action.about, face, Key(key))
                        : Button("action-" + index, "action", () => controls.Act(index), action.about, face);
                    if (pullDown) button.AddToClassList("action--quiet");
                    if (action.locked != null) button.AddToClassList("action--locked");
                    actions.Add(button);
                    actionButtons.Add(button);
                }
                actions.style.display = list.Count == 0 ? DisplayStyle.None : DisplayStyle.Flex;
            }
            for (int i = 0; i < list.Count && i < actionButtons.Count; i++)
            {
                // Shown as out of reach rather than switched off, so a click can still say what is missing.
                GameAction action = list[i];
                actionButtons[i].EnableInClassList("action--short", action.locked == null && action.cost != null && !world.CanAfford(player, action.cost));
            }
        }

        void ShowQueue()
        {
            int own = controls.OwnBuilding();
            int length = EntityTypes.TRAIN_QUEUE_LENGTH;
            // Progress: of the building going up, or of the unit being trained.
            float done = -1f;
            int waiting = own == -1 ? 0 : world.trainLength[own];
            if (own != -1 && world.built[own] == 0)
            {
                done = (float)world.buildPoints[own] / EntityTypes.BuildPointsNeeded(world.entityType[own], world.config.tickRate);
            }
            else if (waiting > 0)
            {
                done = (float)world.trainTicks[own] / controls.QueuedTicks(world.trainQueue[own * length]);
            }
            progress.style.display = done < 0f ? DisplayStyle.None : DisplayStyle.Flex;
            if (done >= 0f) progressBar.style.width = Length.Percent(Mathf.Min(100f, done * 100f));

            bool held = waiting > 0 && world.trainStarted[own] == 0 && world.trainQueue[own * length] < Techs.QUEUED_TECH;
            words.Clear();
            words.Append(own).Append(':');
            for (int k = 0; k < waiting; k++) words.Append(world.trainQueue[own * length + k]).Append(',');
            words.Append(held);
            string wanted = words.ToString();
            if (wanted == queueFor) return;
            queueFor = wanted;
            HideTip();
            queue.Clear();
            for (int k = 0; k < waiting; k++)
            {
                int index = k;
                string name = controls.QueuedName(world.trainQueue[own * length + k]) + (k == 0 && held ? " · needs a house" : "");
                VisualElement chip = Button("queued-" + k, "queued", () => controls.CancelQueued(index), "Click to cancel and get the cost back", Text("small", name));
                if (k == 0) chip.AddToClassList("queued--first");
                queue.Add(chip);
            }
            queue.style.display = waiting == 0 ? DisplayStyle.None : DisplayStyle.Flex;
        }

        /// <summary>Everything in training, across all the player's buildings.</summary>
        void ShowProduction()
        {
            int length = EntityTypes.TRAIN_QUEUE_LENGTH;
            busy.Clear();
            words.Clear();
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 1 || world.owner[slot] != player || world.trainLength[slot] == 0) continue;
                busy.Add(slot);
                words.Append(world.IdAt(slot)).Append(':').Append(world.trainQueue[slot * length]).Append(':')
                    .Append(world.trainLength[slot]).Append(':').Append(world.trainStarted[slot]).Append(';');
            }
            string wanted = words.ToString();
            if (wanted != productionFor)
            {
                productionFor = wanted;
                HideTip();
                production.Clear();
                productionBars.Clear();
                for (int i = 0; i < busy.Count; i++)
                {
                    int slot = busy[i];
                    int id = world.IdAt(slot);
                    int head = world.trainQueue[slot * length];
                    int more = world.trainLength[slot] - 1;
                    bool waitingForRoom = head < Techs.QUEUED_TECH && world.trainStarted[slot] == 0;
                    string label = controls.QueuedName(head) + (more > 0 ? " +" + more : "") + (waitingForRoom ? " · needs a house" : "");
                    VisualElement bar = Group("producing-bar");
                    VisualElement row = Button("producing-" + i, "producing", () => controls.GoToBuilding(id),
                        "Under way at the " + world.TypeOf(slot).name + ". Click to go there.", Text("small", label), bar);
                    production.Add(row);
                    productionBars.Add(bar);
                }
                production.style.display = busy.Count == 0 ? DisplayStyle.None : DisplayStyle.Flex;
            }
            for (int i = 0; i < busy.Count && i < productionBars.Count; i++)
            {
                int slot = busy[i];
                float done = (float)world.trainTicks[slot] / controls.QueuedTicks(world.trainQueue[slot * length]);
                productionBars[i].style.width = Length.Percent(Mathf.Min(100f, done * 100f));
            }
        }

        /// <summary>The age, and word of anything newly researched.</summary>
        void ShowAge()
        {
            int reached = world.age[player];
            age.text = EntityTypes.AGE_NAMES[reached];
            int count = Techs.TECHS.Length;
            if (researchSeen == null)
            {
                researchSeen = new byte[count];
                Array.Copy(world.researched, player * count, researchSeen, 0, count);
                return;
            }
            for (int id = 0; id < count; id++)
            {
                byte has = world.researched[player * count + id];
                if (has == researchSeen[id]) continue;
                researchSeen[id] = has;
                if (has != 1) continue;
                Tech fresh = Techs.TECHS[id];
                controls.Say(fresh.reform
                    ? fresh.name + ": you have entered the " + EntityTypes.AGE_NAMES[reached] + " age"
                    : "Researched: " + fresh.name);
            }
        }

        void ShowPeople()
        {
            Population people = Production.CountPopulation(world);
            population.text = people.used[player] + "/" + people.room[player];
            population.EnableInClassList("warn", people.used[player] >= people.room[player]);

            int idle = controls.IdleVillagers().Count;
            if (idle == idleShown) return;
            idleShown = idle;
            idleButton.style.display = idle == 0 ? DisplayStyle.None : DisplayStyle.Flex;
            idleLabel.text = idle + (idle == 1 ? " idle villager" : " idle villagers");
        }

        void ShowGroups()
        {
            words.Clear();
            for (int digit = 0; digit < 10; digit++) words.Append(controls.GroupSize(digit)).Append(',');
            string wanted = words.ToString();
            if (wanted == groupsFor) return;
            groupsFor = wanted;
            groups.Clear();
            for (int d = 0; d < 10; d++)
            {
                int digit = d;
                int living = controls.GroupSize(digit);
                if (living == 0) continue;
                groups.Add(Button("group-" + digit, "group-chip", () => controls.RecallGroup(digit, false),
                    "Group " + digit + ": " + living + " units", Text("group-digit", digit.ToString()), Text("data small", living.ToString())));
            }
        }

        void OnDestroy()
        {
            Minimap?.Dispose();
        }
    }
}
