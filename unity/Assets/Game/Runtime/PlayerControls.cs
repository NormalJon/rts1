using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Rts.Session;
using Rts.Sim;
using UnityEngine;
using Terrain = Rts.Sim.Terrain;

namespace Rts.Game
{
    /// <summary>A button in the action row: something to build, train or research, or pulling a building down.</summary>
    public sealed class GameAction
    {
        public string label;
        public string detail;
        /// <summary>What it costs, so it can be shown as out of reach; null if nothing.</summary>
        public int[] cost;
        /// <summary>Why it cannot be done at all just now, if it cannot. Shown in place of the cost.</summary>
        public string locked;
        /// <summary>A longer word on what it is, for when the pointer rests on it.</summary>
        public string about;
        public Action run;
    }

    /// <summary>An order waiting for the player to click where: the next click on the field gives it.</summary>
    public enum Aiming
    {
        None,
        AttackMove,
        Patrol,
    }

    /// <summary>
    /// Choosing units and buildings and telling them what to do: what a click,
    /// a drag or a key means for the match. Ported from
    /// src/client/game/controls.ts; keep the two in step.
    ///
    /// What is selected is the player's own business and never enters the
    /// simulation. Orders do, and only as commands through the session:
    /// nothing here touches the world. Nothing here reads a mouse or a
    /// keyboard either (PlayerInput does that) or draws a panel (Hud does).
    ///
    /// Screen positions are in pixels from the bottom left.
    /// </summary>
    public sealed class PlayerControls
    {
        /// <summary>Pixels the pointer may wander and still count as a click, on a screen 1080 high.</summary>
        const float CLICK_SLOP = 5f;
        /// <summary>Pixels around the pointer in which a unit can be clicked, on a screen 1080 high.</summary>
        const float PICK_RADIUS = 26f;
        public const double DOUBLE_CLICK_SECONDS = 0.32;
        const double TOAST_SECONDS = 2.4;
        /// <summary>The keys for the buttons in the action row, left to right.</summary>
        public static readonly string[] ACTION_KEYS = { "q", "w", "e", "r", "t", "y", "u", "i", "o" };
        /// <summary>The order buildings are offered in: what a town needs first, first. Anything not listed follows.</summary>
        static readonly int[] BUILD_ORDER =
        {
            Kind.House, Kind.Farm, Kind.Mill, Kind.LumberCamp, Kind.MiningCamp,
            Kind.Barracks, Kind.ArcheryRange, Kind.Stable, Kind.Blacksmith, Kind.Watchtower,
        };
        /// <summary>How far from the middle of the view something must be hit before the player is told, in tiles.</summary>
        const float ALARM_DISTANCE = 22f;
        const double ALARM_EVERY_SECONDS = 12.0;

        static readonly Dictionary<string, string> PLURALS = new Dictionary<string, string>
        {
            { "spearman", "spearmen" }, { "horseman", "horsemen" }, { "pikeman", "pikemen" },
            { "longbowman", "longbowmen" }, { "crossbowman", "crossbowmen" }, { "man-at-arms", "men-at-arms" },
        };
        /// <summary>What a weapon's bonus is against, in words, by tag.</summary>
        static readonly (int tag, string words)[] TAG_WORDS =
        {
            (Tag.Cavalry, "horsemen"), (Tag.Ranged, "archers"), (Tag.Spear, "spearmen"), (Tag.Heavy, "armour"), (Tag.Building, "buildings"),
        };
        static readonly string[] RESOURCE_VERBS = { "Foraging", "Felling", "Quarrying", "Mining" };
        static readonly string[] RESOURCE_SOURCES = { "Berry bush", "Tree", "Stone outcrop", "Gold ore" };

        public readonly int player;
        readonly LocalSession session;
        readonly World world;
        readonly ScreenMap screen;
        readonly Sight sight;
        readonly BuildingViews buildings;
        readonly UnitViews units;
        readonly Overlays overlays;
        readonly RtsCamera view;

        /// <summary>The units selected, in the order they were chosen.</summary>
        readonly List<int> selected = new List<int>();
        readonly HashSet<int> selectedSet = new HashSet<int>();
        /// <summary>The building being looked at. Only the player's own can be given orders.</summary>
        int building = World.NO_ENTITY;
        /// <summary>A resource tile being looked at, or -1.</summary>
        int inspectedTile = -1;
        /// <summary>An enemy unit being looked at.</summary>
        int inspectedUnit = World.NO_ENTITY;
        /// <summary>The type of building being placed, while choosing where; -1 for none.</summary>
        int placing = -1;
        Aiming aiming = Aiming.None;
        /// <summary>Hit points of the player's own things as last seen, to notice an attack, and where the last one was.</summary>
        readonly Dictionary<int, int> hpSeen = new Dictionary<int, int>();
        readonly List<int> scratch = new List<int>();
        bool alarmed;
        Vector2 alarmAt;
        double alarmDue;
        bool hasPointer;
        Vector2 pointer;

        readonly List<int>[] groups = new List<int>[10];
        bool dragging;
        Vector2 dragStart;
        double lastClickTime;
        int lastClickUnit = World.NO_ENTITY;
        double lastGroupTime;
        int lastGroupDigit = -1;
        float alpha = 1f;
        int idleCursor;
        double now;
        double watchDue;
        string toast = "";
        double toastUntil;

        /// <summary>Told where on the map the player's attention is wanted.</summary>
        public Action<float, float> onAlarm;
        /// <summary>Set whenever something the panels show has changed, so they can be brought up to date at once.</summary>
        public bool Stale = true;

        public PlayerControls(int player, LocalSession session, ScreenMap screen, Sight sight, BuildingViews buildings, UnitViews units, Overlays overlays, RtsCamera view)
        {
            this.player = player;
            this.session = session;
            this.screen = screen;
            this.sight = sight;
            this.buildings = buildings;
            this.units = units;
            this.overlays = overlays;
            this.view = view;
            world = session.world;
            for (int i = 0; i < groups.Length; i++) groups[i] = new List<int>();
        }

        // ---- What is selected --------------------------------------------------------

        public IReadOnlyList<int> Selected => selected;
        public bool IsSelected(int id) => selectedSet.Contains(id);
        /// <summary>The building being looked at, or NO_ENTITY.</summary>
        public int Building => building;
        /// <summary>The type of building being placed, or -1.</summary>
        public int Placing => placing;
        public Aiming AimingAt => aiming;
        public int InspectedUnit => inspectedUnit;
        public int InspectedTile => inspectedTile;
        /// <summary>The message for the player just now, or an empty string.</summary>
        public string Toast => toast;
        /// <summary>Where the player was last told of an attack, if they have been.</summary>
        public bool Alarmed => alarmed;
        public Vector2 AlarmAt => alarmAt;

        float Scale => Mathf.Max(1f, screen.Height / 1080f);

        void Issue(Command command)
        {
            session.Issue(player, command);
        }

        void Add(int id)
        {
            if (selectedSet.Add(id)) selected.Add(id);
        }

        void Remove(int id)
        {
            if (selectedSet.Remove(id)) selected.Remove(id);
        }

        public void ClearSelection()
        {
            selected.Clear();
            selectedSet.Clear();
            building = World.NO_ENTITY;
            inspectedTile = -1;
            inspectedUnit = World.NO_ENTITY;
            aiming = Aiming.None;
            Stale = true;
        }

        void SelectUnits(IEnumerable<int> ids, bool add)
        {
            if (!add) ClearSelection();
            building = World.NO_ENTITY;
            inspectedTile = -1;
            inspectedUnit = World.NO_ENTITY;
            foreach (int id in ids) Add(id);
            Stale = true;
        }

        /// <summary>Whether the view should ring a unit and show its health: the selection, and any enemy being looked at.</summary>
        public bool Watched(int id)
        {
            return selectedSet.Contains(id) || id == inspectedUnit;
        }

        void SelectBuilding(int id)
        {
            ClearSelection();
            building = id;
        }

        /// <summary>The selected building's slot if it belongs to the player, else -1.</summary>
        public int OwnBuilding()
        {
            if (building == World.NO_ENTITY || !world.IsAlive(building)) return -1;
            int slot = World.EntityIndex(building);
            return world.owner[slot] == player ? slot : -1;
        }

        public bool BuildersSelected()
        {
            foreach (int id in selected)
            {
                if (world.TypeOf(World.EntityIndex(id)).builds) return true;
            }
            return false;
        }

        int[] SelectedArray()
        {
            return selected.ToArray();
        }

        // ---- Pointer ---------------------------------------------------------------

        /// <summary>A mouse button has gone down over the field. Button 0 is the left one, 1 the right.</summary>
        public void PointerDown(int button, Vector2 at, bool shift)
        {
            hasPointer = true;
            pointer = at;
            if (button == 1)
            {
                if (placing != -1) StopPlacing();
                else if (aiming != Aiming.None) Aim(Aiming.None);
                else OrderAt(at, shift);
                return;
            }
            if (button != 0) return;
            if (placing != -1)
            {
                PlaceAt(at, shift);
                return;
            }
            if (aiming != Aiming.None)
            {
                if (screen.ScreenToGround(at, out Vector2 ground)) Order(ground.x, ground.y, shift);
                return;
            }
            dragging = true;
            dragStart = at;
        }

        public void PointerMove(Vector2 at)
        {
            hasPointer = true;
            pointer = at;
        }

        /// <summary>The pointer has left the field: it is over a panel, or outside the window.</summary>
        public void PointerAway()
        {
            hasPointer = false;
        }

        public void PointerUp(int button, Vector2 at, bool shift)
        {
            if (button != 0 || !dragging) return;
            dragging = false;
            float slop = CLICK_SLOP * Scale;
            bool dragged = Mathf.Abs(at.x - dragStart.x) >= slop || Mathf.Abs(at.y - dragStart.y) >= slop;
            if (dragged) SelectInBox(dragStart, at, shift);
            else Click(at, shift);
            Stale = true;
        }

        public void CancelDrag()
        {
            dragging = false;
        }

        /// <summary>The box being dragged out, in screen pixels, once the pointer has moved far enough to count as a drag.</summary>
        public bool DragBox(out Rect box)
        {
            box = default;
            if (!dragging || !hasPointer) return false;
            float width = Mathf.Abs(pointer.x - dragStart.x);
            float height = Mathf.Abs(pointer.y - dragStart.y);
            float slop = CLICK_SLOP * Scale;
            if (width < slop && height < slop) return false;
            box = new Rect(Mathf.Min(pointer.x, dragStart.x), Mathf.Min(pointer.y, dragStart.y), width, height);
            return true;
        }

        /// <summary>Whether a living unit is one the player may click on: their own, or someone else's in sight.</summary>
        bool OnScreen(int slot, bool own, out Vector2 at)
        {
            at = default;
            if ((world.owner[slot] == player) != own) return false;
            // Nobody can click on what they cannot see.
            if (!own && !sight.ShowsNow(slot)) return false;
            Vector2 tile = units.Position(slot, alpha);
            Vector3 point = screen.ToScreen(tile.x, tile.y, 0.9f);
            if (!screen.InFront(point)) return false;
            at = new Vector2(point.x, point.y);
            return true;
        }

        /// <summary>The unit nearest a screen position, if one is close enough to be meant: the player's own, or someone else's.</summary>
        int UnitAt(Vector2 at, bool own)
        {
            int best = World.NO_ENTITY;
            float bestDistance = PICK_RADIUS * Scale;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0) continue;
                if (!OnScreen(slot, own, out Vector2 where)) continue;
                float distance = Vector2.Distance(where, at);
                if (distance < bestDistance)
                {
                    best = world.IdAt(slot);
                    bestDistance = distance;
                }
            }
            return best;
        }

        void Click(Vector2 at, bool add)
        {
            int best = UnitAt(at, true);
            if (best == World.NO_ENTITY)
            {
                lastClickTime = 0.0;
                lastClickUnit = World.NO_ENTITY;
                if (add) return;
                // None of the player's units here, but there may be an enemy to look
                // at, a building to select or a resource to inspect.
                int other = UnitAt(at, false);
                Pick under = other == World.NO_ENTITY ? screen.Pick(at) : default;
                ClearSelection();
                if (other != World.NO_ENTITY) inspectedUnit = other;
                else if (under.kind == PickKind.Building) SelectBuilding(under.id);
                else if (under.kind == PickKind.Tile) inspectedTile = under.tile;
                return;
            }
            bool twice = now - lastClickTime < DOUBLE_CLICK_SECONDS && lastClickUnit == best;
            lastClickTime = now;
            lastClickUnit = best;
            if (twice)
            {
                // Everyone of that kind in view.
                int kind = world.entityType[World.EntityIndex(best)];
                scratch.Clear();
                for (int slot = 0; slot < world.highWater; slot++)
                {
                    if (world.alive[slot] == 0 || world.mobile[slot] == 0 || world.entityType[slot] != kind) continue;
                    if (!OnScreen(slot, true, out Vector2 where)) continue;
                    if (where.x >= 0f && where.x <= screen.Width && where.y >= 0f && where.y <= screen.Height) scratch.Add(world.IdAt(slot));
                }
                SelectUnits(scratch, add);
                return;
            }
            if (add && selectedSet.Contains(best)) Remove(best);
            else SelectUnits(new[] { best }, add);
        }

        void SelectInBox(Vector2 from, Vector2 to, bool add)
        {
            float left = Mathf.Min(from.x, to.x);
            float right = Mathf.Max(from.x, to.x);
            float low = Mathf.Min(from.y, to.y);
            float high = Mathf.Max(from.y, to.y);
            scratch.Clear();
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0) continue;
                if (!OnScreen(slot, true, out Vector2 where)) continue;
                if (where.x >= left && where.x <= right && where.y >= low && where.y <= high) scratch.Add(world.IdAt(slot));
            }
            SelectUnits(scratch, add);
        }

        // ---- Orders ----------------------------------------------------------------

        /// <summary>
        /// The right-click: whatever makes sense for what is selected and what is
        /// under the pointer. With units: attack an enemy, gather from a tree, bush
        /// or deposit, work on one of your building sites or mend a damaged building,
        /// hand in at a drop-off, or go there. With one of your buildings: set where
        /// the units it trains will go.
        /// </summary>
        void OrderAt(Vector2 at, bool queue)
        {
            DropTheDead();
            Stale = true;

            if (selected.Count > 0)
            {
                int foe = UnitAt(at, false);
                if (foe != World.NO_ENTITY && world.Hostile(player, world.owner[World.EntityIndex(foe)]))
                {
                    Issue(Command.Attack(SelectedArray(), foe));
                    Vector2 where = units.Position(World.EntityIndex(foe), alpha);
                    overlays.AddMarker(where.x, where.y, MarkerKind.Attack);
                    return;
                }
            }

            Pick target = screen.Pick(at);
            if (target.kind == PickKind.Nothing) return;
            BuildingViews.Shown known = target.kind == PickKind.Building ? buildings.Known(target.id) : null;
            float spotX, spotY;
            if (target.kind == PickKind.Tile)
            {
                spotX = target.tile % world.map.width + 0.5f;
                spotY = target.tile / world.map.width + 0.5f;
            }
            else if (target.kind == PickKind.Building)
            {
                spotX = (known != null ? known.tileX : 0) + 0.5f;
                spotY = (known != null ? known.tileY : 0) + 0.5f;
            }
            else
            {
                spotX = target.x;
                spotY = target.y;
            }

            if (selected.Count == 0)
            {
                int own = OwnBuilding();
                if (own == -1 || target.kind == PickKind.Building) return;
                Issue(Command.Rally(new[] { building }, Units.FromFloat(spotX), Units.FromFloat(spotY)));
                overlays.AddMarker(spotX, spotY, MarkerKind.Queue);
                return;
            }

            int[] who = SelectedArray();
            if (target.kind == PickKind.Tile && EntityTypes.ResourceOfTerrain(world.map.terrain[target.tile]) != -1)
            {
                Issue(Command.Gather(who, target.tile));
                overlays.AddMarker(spotX, spotY, MarkerKind.Work);
                return;
            }
            if (target.kind == PickKind.Building && !world.IsAlive(target.id))
            {
                // A building remembered from an earlier look, which has in truth been
                // destroyed since. The player cannot know that: the soldiers march on
                // the place ready to fight, and find out when they get there.
                Issue(Command.AttackMove(who, Units.FromFloat(spotX), Units.FromFloat(spotY), queue));
                overlays.AddMarker(spotX, spotY, MarkerKind.Attack);
                return;
            }
            if (target.kind == PickKind.Building)
            {
                int slot = World.EntityIndex(target.id);
                bool mine = world.owner[slot] == player;
                EntityType type = world.TypeOf(slot);
                bool damaged = world.hp[slot] < type.hp;
                if (!mine && world.Hostile(player, world.owner[slot]))
                {
                    Issue(Command.Attack(who, target.id));
                    overlays.AddMarker(spotX, spotY, MarkerKind.Attack);
                }
                else if (mine && type.farm && world.built[slot] == 1 && !damaged)
                {
                    // A farm: work it. The crop is gathered from its middle tile.
                    int middle = (world.posY[slot] >> 16) * world.map.width + (world.posX[slot] >> 16);
                    Issue(Command.Gather(who, middle));
                    overlays.AddMarker(spotX, spotY, MarkerKind.Work);
                }
                else if (mine && (world.built[slot] == 0 || (damaged && BuildersSelected() && !Carrying(type.accepts))))
                {
                    // Finish it, or mend it.
                    Issue(Command.Construct(who, target.id));
                    overlays.AddMarker(spotX, spotY, MarkerKind.Work);
                }
                else if (mine && type.accepts != 0)
                {
                    Issue(Command.Deliver(who, target.id));
                    overlays.AddMarker(spotX, spotY, MarkerKind.Work);
                }
                else
                {
                    Order(spotX, spotY, queue);
                }
                return;
            }
            Order(spotX, spotY, queue);
        }

        /// <summary>Whether anyone selected is carrying something a building with these `accepts` bits takes in.</summary>
        bool Carrying(int accepts)
        {
            foreach (int id in selected)
            {
                int slot = World.EntityIndex(id);
                if (world.carry[slot] > 0 && (accepts & (1 << world.carryKind[slot])) != 0) return true;
            }
            return false;
        }

        /// <summary>
        /// Sends the selection to a place: as a plain march, or, if the player has
        /// picked attack-move or patrol and is choosing where, as that. With queue,
        /// as a waypoint after what they are already doing.
        /// </summary>
        public void Order(float x, float y, bool queue)
        {
            DropTheDead();
            if (selected.Count == 0) return;
            int[] who = SelectedArray();
            Aiming aimed = aiming;
            int fx = Units.FromFloat(x);
            int fy = Units.FromFloat(y);
            if (aimed == Aiming.Patrol) Issue(Command.Patrol(who, fx, fy));
            else if (aimed == Aiming.AttackMove) Issue(Command.AttackMove(who, fx, fy, queue));
            else Issue(Command.Move(who, fx, fy, queue));
            overlays.AddMarker(x, y, aimed == Aiming.AttackMove ? MarkerKind.Attack : queue || aimed == Aiming.Patrol ? MarkerKind.Queue : MarkerKind.Move);
            // Shift keeps the order in hand for another click.
            if (aimed != Aiming.None && !queue) Aim(Aiming.None);
            Stale = true;
        }

        /// <summary>Takes up an order that needs a place (the next click on the field gives it), or puts it down.</summary>
        public void Aim(Aiming order)
        {
            DropTheDead();
            aiming = order != Aiming.None && selected.Count > 0 ? order : Aiming.None;
            if (aiming != Aiming.None && placing != -1) StopPlacing();
            Stale = true;
        }

        public void Hold()
        {
            DropTheDead();
            if (selected.Count == 0) return;
            Issue(Command.Hold(SelectedArray()));
            Stale = true;
        }

        public void Stop()
        {
            DropTheDead();
            if (selected.Count == 0) return;
            Issue(Command.Stop(SelectedArray()));
            Stale = true;
        }

        /// <summary>The player's villagers with nothing to do, in slot order.</summary>
        public List<int> IdleVillagers()
        {
            var idle = new List<int>();
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0 || world.owner[slot] != player) continue;
                if (world.TypeOf(slot).carries > 0 && world.job[slot] == Job.None && world.moveState[slot] == MoveState.Idle) idle.Add(world.IdAt(slot));
            }
            return idle;
        }

        /// <summary>Selects the next idle villager and brings them into view.</summary>
        public void SelectIdleVillager()
        {
            List<int> idle = IdleVillagers();
            if (idle.Count == 0) return;
            idleCursor = (idleCursor + 1) % idle.Count;
            SelectUnits(new[] { idle[idleCursor] }, false);
            JumpToSelection();
        }

        void DropTheDead()
        {
            for (int i = selected.Count - 1; i >= 0; i--)
            {
                if (world.IsAlive(selected[i])) continue;
                selectedSet.Remove(selected[i]);
                selected.RemoveAt(i);
                Stale = true;
            }
            if (inspectedUnit != World.NO_ENTITY && (!world.IsAlive(inspectedUnit) || !sight.ShowsNow(World.EntityIndex(inspectedUnit))))
            {
                inspectedUnit = World.NO_ENTITY;
                Stale = true;
            }
            if (selected.Count == 0) aiming = Aiming.None;
            // A building stays selected for as long as the player knows of it. One
            // remembered from an earlier look may be gone, but they cannot tell yet.
            if (building != World.NO_ENTITY && buildings.Known(building) == null)
            {
                building = World.NO_ENTITY;
                Stale = true;
            }
        }

        // ---- Building and training ---------------------------------------------------

        /// <summary>A cost in words: "60 food, 20 wood".</summary>
        public static string CostText(int[] cost)
        {
            var words = new StringBuilder();
            for (int r = 0; r < cost.Length; r++)
            {
                if (cost[r] <= 0) continue;
                if (words.Length > 0) words.Append(", ");
                words.Append(cost[r]).Append(' ').Append(EntityTypes.RESOURCE_NAMES[r]);
            }
            return words.Length > 0 ? words.ToString() : "free";
        }

        static string Capital(string text)
        {
            return text.Length == 0 ? text : char.ToUpperInvariant(text[0]) + text.Substring(1);
        }

        /// <summary>What the buttons in the action row do just now, left to right.</summary>
        public List<GameAction> Actions()
        {
            var list = new List<GameAction>();
            EntityType[] types = world.types[player];
            int age = world.age[player];
            int own = OwnBuilding();
            if (own != -1)
            {
                EntityType type = world.TypeOf(own);
                bool built = world.built[own] == 1;
                if (built)
                {
                    foreach (int trained in type.trains)
                    {
                        int unitType = trained;
                        EntityType unit = types[unitType];
                        list.Add(new GameAction
                        {
                            label = "Train " + unit.name,
                            detail = CostText(unit.cost),
                            cost = unit.cost,
                            locked = unit.age > age ? "needs the " + EntityTypes.AGE_NAMES[unit.age] + " age" : null,
                            run = () => Train(unitType),
                        });
                    }
                    // What can be researched here: everything not yet done, apart from reforms whose age is past.
                    for (int i = 0; i < Techs.TECHS.Length; i++)
                    {
                        int id = i;
                        Tech tech = Techs.TECHS[id];
                        if (tech.at != world.entityType[own] || world.researched[player * Techs.TECHS.Length + id] == 1) continue;
                        string why = Techs.WhyNot(world, player, id);
                        if (tech.reform && (why == "that age is past" || why == "not yet")) continue;
                        list.Add(new GameAction
                        {
                            label = tech.reform ? "Reform: " + tech.name : tech.name,
                            detail = CostText(tech.cost) + " · " + tech.seconds + " s",
                            cost = tech.cost,
                            locked = why,
                            about = tech.reform
                                ? tech.about + " Takes you into the " + EntityTypes.AGE_NAMES[tech.age + 1] + " age; the other reform is then closed."
                                : tech.about,
                            run = () => Research(id),
                        });
                    }
                }
                list.Add(new GameAction
                {
                    label = built ? "Pull down" : "Cancel site",
                    detail = built ? "no refund" : "refunds " + CostText(type.cost),
                    cost = null,
                    run = Demolish,
                });
                return list;
            }
            if (BuildersSelected())
            {
                var offered = new List<int>();
                for (int entityType = 0; entityType < types.Length; entityType++)
                {
                    if (types[entityType].building && types[entityType].buildable) offered.Add(entityType);
                }
                offered.Sort((a, b) => Rank(a) - Rank(b));
                foreach (int offer in offered)
                {
                    int entityType = offer;
                    EntityType type = types[entityType];
                    list.Add(new GameAction
                    {
                        label = Capital(type.name),
                        detail = CostText(type.cost),
                        cost = type.cost,
                        locked = type.age > age ? "needs the " + EntityTypes.AGE_NAMES[type.age] + " age" : null,
                        run = () => StartPlacing(entityType),
                    });
                }
            }
            return list;
        }

        static int Rank(int entityType)
        {
            int at = Array.IndexOf(BUILD_ORDER, entityType);
            return at == -1 ? BUILD_ORDER.Length + entityType : at;
        }

        /// <summary>Presses a button of the action row, counting from the left.</summary>
        public void Act(int index)
        {
            List<GameAction> actions = Actions();
            if (index >= 0 && index < actions.Count) actions[index].run();
            Stale = true;
        }

        /// <summary>
        /// The key for a button of the action row. The last button of a building's
        /// row is "pull down", which has its own key so it is not hit by accident.
        /// </summary>
        public bool ActionKey(int index)
        {
            int count = Actions().Count;
            if (index < 0 || index >= count) return false;
            if (OwnBuilding() != -1 && index == count - 1) return true;
            Act(index);
            return true;
        }

        void Train(int unitType)
        {
            int own = OwnBuilding();
            if (own == -1) return;
            EntityType type = world.types[player][unitType];
            if (type.age > world.age[player])
            {
                Say("A " + type.name + " needs the " + EntityTypes.AGE_NAMES[type.age] + " age: choose a reform at the town centre");
                return;
            }
            if (world.trainLength[own] >= EntityTypes.TRAIN_QUEUE_LENGTH)
            {
                Say("The queue is full");
                return;
            }
            if (!world.CanAfford(player, type.cost))
            {
                Say("Not enough for a " + type.name + ": " + CostText(type.cost));
                return;
            }
            Issue(Command.Train(building, unitType));
        }

        void Research(int id)
        {
            int own = OwnBuilding();
            if (own == -1) return;
            Tech tech = Techs.TECHS[id];
            string why = Techs.WhyNot(world, player, id);
            if (why != null)
            {
                Say(tech.name + ": " + why);
                return;
            }
            if (world.trainLength[own] >= EntityTypes.TRAIN_QUEUE_LENGTH)
            {
                Say("The queue is full");
                return;
            }
            if (!world.CanAfford(player, tech.cost))
            {
                Say("Not enough for " + tech.name + ": " + CostText(tech.cost));
                return;
            }
            Issue(Command.Research(building, id));
        }

        /// <summary>Takes something out of the selected building's queue and gets its cost back.</summary>
        public void CancelQueued(int index)
        {
            if (OwnBuilding() == -1) return;
            Issue(Command.CancelTrain(building, index));
            Stale = true;
        }

        /// <summary>What something in a building's queue is called: a unit, or a technology.</summary>
        public string QueuedName(int queued)
        {
            if (queued >= Techs.QUEUED_TECH)
            {
                int id = queued - Techs.QUEUED_TECH;
                return id < Techs.TECHS.Length ? Techs.TECHS[id].name : "Research";
            }
            EntityType[] types = world.types[player];
            return queued >= 1 && queued <= types.Length ? Capital(types[queued - 1].name) : "Unit";
        }

        /// <summary>How many ticks something in a building's queue takes.</summary>
        public int QueuedTicks(int queued)
        {
            if (queued >= Techs.QUEUED_TECH) return Techs.ResearchTicks(queued - Techs.QUEUED_TECH, world.config.tickRate);
            return EntityTypes.TrainingTicks(world.types[player][queued - 1], world.config.tickRate);
        }

        /// <summary>Pulls down the selected building, or calls off the site.</summary>
        public void Demolish()
        {
            if (OwnBuilding() == -1) return;
            Issue(Command.Demolish(new[] { building }));
            Stale = true;
        }

        void StartPlacing(int entityType)
        {
            EntityType type = world.types[player][entityType];
            if (type.age > world.age[player])
            {
                Say("A " + type.name + " needs the " + EntityTypes.AGE_NAMES[type.age] + " age: choose a reform at the town centre");
                return;
            }
            if (!world.CanAfford(player, type.cost))
            {
                Say("Not enough for a " + type.name + ": " + CostText(type.cost));
                return;
            }
            placing = entityType;
            aiming = Aiming.None;
        }

        void StopPlacing()
        {
            placing = -1;
            overlays.HidePlot();
            Stale = true;
        }

        /// <summary>The tile under a screen position and whether the building being placed can go there.</summary>
        bool PlotAt(Vector2 at, out int tileX, out int tileY, out int size, out bool allowed)
        {
            tileX = tileY = size = 0;
            allowed = false;
            if (placing == -1 || !screen.ScreenToGround(at, out Vector2 ground)) return false;
            EntityType type = EntityTypes.ENTITY_TYPES[placing];
            tileX = Mathf.FloorToInt(ground.x);
            tileY = Mathf.FloorToInt(ground.y);
            size = type.footprint;
            allowed = Buildings.CanPlace(world, placing, tileX, tileY, player) && world.CanAfford(player, type.cost);
            return true;
        }

        void PlaceAt(Vector2 at, bool keepPlacing)
        {
            if (!PlotAt(at, out int tileX, out int tileY, out _, out bool allowed)) return;
            EntityType type = EntityTypes.ENTITY_TYPES[placing];
            if (!allowed)
            {
                Say(world.CanAfford(player, type.cost)
                    ? "It needs open grass you have explored: no trees, water, rock or buildings"
                    : "Not enough for a " + type.name + ": " + CostText(type.cost));
                return;
            }
            DropTheDead();
            Issue(Command.Build(SelectedArray(), placing, tileX, tileY));
            overlays.AddMarker(tileX + 0.5f, tileY + 0.5f, MarkerKind.Work);
            Stale = true;
            if (!keepPlacing) StopPlacing();
        }

        /// <summary>Puts a message in front of the player for a couple of seconds.</summary>
        public void Say(string message)
        {
            toast = message;
            toastUntil = now + TOAST_SECONDS;
            Stale = true;
        }

        // ---- Keys ------------------------------------------------------------------

        /// <summary>
        /// A digit key. With save (shift or ctrl held) it makes the selection that
        /// group; without, it recalls the group, and pressed twice quickly jumps
        /// the view to it.
        /// </summary>
        public void GroupKey(int digit, bool save)
        {
            if (digit < 0 || digit >= groups.Length) return;
            if (save)
            {
                DropTheDead();
                groups[digit].Clear();
                groups[digit].AddRange(selected);
            }
            else
            {
                bool again = lastGroupDigit == digit && now - lastGroupTime < DOUBLE_CLICK_SECONDS * 1.5;
                lastGroupTime = now;
                lastGroupDigit = digit;
                RecallGroup(digit, again);
            }
            Stale = true;
        }

        public void RecallGroup(int digit, bool jump)
        {
            if (digit < 0 || digit >= groups.Length) return;
            List<int> members = groups[digit];
            members.RemoveAll(id => !world.IsAlive(id));
            if (members.Count == 0) return;
            SelectUnits(members.ToArray(), false);
            if (jump) JumpToSelection();
        }

        /// <summary>How many of a saved group are still alive.</summary>
        public int GroupSize(int digit)
        {
            int living = 0;
            foreach (int id in groups[digit])
            {
                if (world.IsAlive(id)) living++;
            }
            return living;
        }

        /// <summary>Escape: puts down whatever is in hand, or failing that clears the selection.</summary>
        public void Escape()
        {
            if (placing != -1) StopPlacing();
            else if (aiming != Aiming.None) Aim(Aiming.None);
            else ClearSelection();
            Stale = true;
        }

        /// <summary>Looks at the last place the player was told of an attack.</summary>
        public void LookAtAlarm()
        {
            if (alarmed) view.LookAt(alarmAt.x, alarmAt.y);
        }

        /// <summary>Selects one of the player's buildings and brings it into view: for the list of what is in training.</summary>
        public void GoToBuilding(int id)
        {
            if (!world.IsAlive(id)) return;
            SelectBuilding(id);
            int slot = World.EntityIndex(id);
            view.LookAt(Ground.F(world.posX[slot]), Ground.F(world.posY[slot]));
            Stale = true;
        }

        /// <summary>Centres the view on the selection, or on all the player's units if nothing is selected.</summary>
        public void JumpToSelection()
        {
            DropTheDead();
            float x = 0f, y = 0f;
            int n = 0;
            if (selected.Count > 0)
            {
                foreach (int id in selected)
                {
                    Vector2 at = units.Position(World.EntityIndex(id), 1f);
                    x += at.x;
                    y += at.y;
                    n++;
                }
            }
            else
            {
                for (int slot = 0; slot < world.highWater; slot++)
                {
                    if (world.alive[slot] == 0 || world.mobile[slot] == 0 || world.owner[slot] != player) continue;
                    Vector2 at = units.Position(slot, 1f);
                    x += at.x;
                    y += at.y;
                    n++;
                }
            }
            if (n > 0) view.LookAt(x / n, y / n);
        }

        // ---- Every frame -----------------------------------------------------------

        /// <param name="now">The time on the clock, in seconds: for double clicks and for how long a message stays up.</param>
        public void Update(float alpha, double now)
        {
            this.alpha = alpha;
            this.now = now;

            // The plot follows the pointer, and is checked again as the world changes under it.
            if (placing != -1 && !BuildersSelected()) StopPlacing();
            if (placing != -1 && hasPointer && PlotAt(pointer, out int tileX, out int tileY, out int size, out bool allowed))
            {
                overlays.ShowPlot(tileX, tileY, size, allowed);
            }
            else
            {
                overlays.HidePlot();
            }

            DropTheDead();
            if (toastUntil != 0.0 && now >= toastUntil)
            {
                toast = "";
                toastUntil = 0.0;
                Stale = true;
            }
            if (now >= watchDue)
            {
                watchDue = now + 0.2;
                WatchForAttack();
            }
        }

        /// <summary>
        /// Tells the player when something of theirs is hit somewhere they are not
        /// looking: a message, a mark on the map, and F to go there.
        /// </summary>
        void WatchForAttack()
        {
            bool hit = false;
            Vector2 where = default;
            scratch.Clear();
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.owner[slot] != player) continue;
                int id = world.IdAt(slot);
                scratch.Add(id);
                int hp = world.hp[slot];
                bool known = hpSeen.TryGetValue(id, out int before);
                hpSeen[id] = hp;
                if (!known || hp >= before) continue;
                float x = Ground.F(world.posX[slot]);
                float y = Ground.F(world.posY[slot]);
                float dx = x - view.targetX;
                float dy = y - view.targetY;
                if (Mathf.Sqrt(dx * dx + dy * dy) > ALARM_DISTANCE)
                {
                    hit = true;
                    where = new Vector2(x, y);
                }
            }
            if (hpSeen.Count != scratch.Count)
            {
                var present = new HashSet<int>(scratch);
                scratch.Clear();
                foreach (int id in hpSeen.Keys)
                {
                    if (!present.Contains(id)) scratch.Add(id);
                }
                foreach (int id in scratch) hpSeen.Remove(id);
            }
            if (!hit || now < alarmDue) return;
            alarmDue = now + ALARM_EVERY_SECONDS;
            alarmed = true;
            alarmAt = where;
            Say("Your people are under attack — press F to look");
            onAlarm?.Invoke(where.x, where.y);
        }

        // ---- In words --------------------------------------------------------------

        /// <summary>One unit's vital statistics, for the panel.</summary>
        string StatsOf(int slot)
        {
            EntityType type = world.TypeOf(slot);
            var text = new StringBuilder();
            text.Append(world.hp[slot]).Append('/').Append(type.hp).Append(" hp");
            if (type.damage > 0)
            {
                var bonuses = new List<string>();
                foreach (int[] bonus in type.bonuses)
                {
                    string against = "some";
                    foreach ((int tag, string words) in TAG_WORDS)
                    {
                        if ((bonus[0] & tag) == 0) continue;
                        against = words;
                        break;
                    }
                    bonuses.Add("+" + bonus[1] + " against " + against);
                }
                if (type.charge > 0) bonuses.Add("+" + type.charge + " on a charge");
                text.Append(" · ").Append(type.ranged ? "shoots" : "hits").Append(" for ").Append(type.damage);
                if (bonuses.Count > 0) text.Append(" (").Append(string.Join(", ", bonuses)).Append(')');
            }
            if (type.meleeArmor > 0 || type.rangedArmor > 0)
            {
                text.Append(" · armour ").Append(type.meleeArmor).Append(" / ").Append(type.rangedArmor).Append(" vs arrows");
            }
            return text.ToString();
        }

        static string OrderWords(int orderKind)
        {
            switch (orderKind)
            {
                case OrderKind.AttackMove: return "Marching to attack";
                case OrderKind.Patrol: return "On patrol";
                case OrderKind.AttackTarget: return "Attacking";
                case OrderKind.Hold: return "Holding ground";
                default: return null;
            }
        }

        /// <summary>What is selected, or what the player is in the middle of doing, in a line of words.</summary>
        public string Summary()
        {
            if (placing != -1)
            {
                return "Placing a " + EntityTypes.ENTITY_TYPES[placing].name + " — click to build, shift-click for more, right-click to cancel";
            }
            if (aiming != Aiming.None)
            {
                return aiming == Aiming.AttackMove
                    ? "Attack-move — click where to march; they fight whatever they meet. Right-click to cancel"
                    : "Patrol — click the far end of the beat. Right-click to cancel";
            }
            if (inspectedUnit != World.NO_ENTITY && world.IsAlive(inspectedUnit))
            {
                int slot = World.EntityIndex(inspectedUnit);
                string whose = world.Hostile(player, world.owner[slot]) ? "Enemy" : "Allied";
                return whose + " " + world.TypeOf(slot).name + " · " + StatsOf(slot);
            }
            BuildingViews.Shown remembered = building == World.NO_ENTITY ? null : buildings.Known(building);
            if (remembered != null && !buildings.Sees(remembered.id))
            {
                // Out of sight, all the player has is the memory of it.
                string whose = world.Hostile(player, remembered.owner) ? "the enemy's" : "an ally's";
                return Capital(EntityTypes.ENTITY_TYPES[remembered.entityType].name) + " · " + whose + " · as last seen";
            }
            if (building != World.NO_ENTITY && world.IsAlive(building))
            {
                int slot = World.EntityIndex(building);
                EntityType type = world.TypeOf(slot);
                string name = Capital(type.name);
                string health = world.hp[slot] + "/" + type.hp + " hp";
                if (world.owner[slot] != player) return name + " · the enemy's · " + health;
                if (world.built[slot] == 0)
                {
                    long needed = EntityTypes.BuildPointsNeeded(world.entityType[slot], world.config.tickRate);
                    return name + " · " + (world.buildPoints[slot] * 100L / needed) + "% built · " + health;
                }
                string arrows = type.damage > 0
                    ? " · shoots for " + type.damage + ", " + Ground.F(type.range).ToString("0.##", CultureInfo.InvariantCulture) + " tiles"
                    : type.farm ? " · one villager farms it, and the food never runs out" : "";
                string mend = world.hp[slot] < type.hp ? " · right-click it with villagers to mend" : "";
                return name + " · " + health + arrows + mend;
            }
            if (inspectedTile >= 0)
            {
                int resource = EntityTypes.ResourceOfTerrain(world.map.terrain[inspectedTile]);
                if (resource == -1) inspectedTile = -1;
                else return RESOURCE_SOURCES[resource] + " · " + world.map.amount[inspectedTile] + " " + EntityTypes.RESOURCE_NAMES[resource] + " left";
            }
            if (selected.Count == 0) return "Nothing selected";
            if (selected.Count == 1)
            {
                // For a single unit, its figures, and for a villager what they are up to.
                int slot = World.EntityIndex(selected[0]);
                EntityType type = world.TypeOf(slot);
                string text = Capital(type.name) + " · " + StatsOf(slot);
                string order = OrderWords(world.orderKind[slot]);
                if (order != null) text += " — " + order;
                if (type.carries > 0 && order == null)
                {
                    int job = world.job[slot];
                    string doing = "Idle";
                    if (job == Job.ToDropOff) doing = "Carrying a load home";
                    else if (job == Job.ToResource || job == Job.Harvesting)
                    {
                        if (world.jobTerrain[slot] == Terrain.Field) doing = "Farming";
                        else
                        {
                            int resource = EntityTypes.ResourceOfTerrain(world.jobTerrain[slot]);
                            doing = resource >= 0 ? RESOURCE_VERBS[resource] : "Working";
                        }
                    }
                    else if (job == Job.ToSite || job == Job.Constructing) doing = "Building";
                    if (world.carry[slot] > 0) doing += " · carrying " + world.carry[slot];
                    text += " — " + doing;
                }
                return text;
            }
            // So many of each kind, in the order of the kinds.
            var counts = new SortedDictionary<int, int>();
            foreach (int id in selected)
            {
                int kind = world.entityType[World.EntityIndex(id)];
                counts.TryGetValue(kind, out int n);
                counts[kind] = n + 1;
            }
            var words = new StringBuilder();
            foreach (KeyValuePair<int, int> entry in counts)
            {
                string name = entry.Key < EntityTypes.ENTITY_TYPES.Length ? EntityTypes.ENTITY_TYPES[entry.Key].name : "unit";
                if (words.Length > 0) words.Append(" · ");
                words.Append(entry.Value).Append(' ');
                if (entry.Value == 1) words.Append(name);
                else words.Append(PLURALS.TryGetValue(name, out string plural) ? plural : name + "s");
            }
            return words.ToString();
        }
    }
}
