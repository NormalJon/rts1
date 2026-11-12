using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Rts.Ai;
using Rts.Sim;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.TestTools;
using Terrain = Rts.Sim.Terrain;

namespace Rts.Game.Tests
{
    /// <summary>
    /// A match played by a script through the game's own controls: every
    /// order is a click or a key on a pretend mouse and keyboard, and each is
    /// checked to have taken effect in the match. Nothing here calls the
    /// session to give an order.
    ///
    /// At the end, the commands the match recorded are played back with no
    /// picture at all, and must leave the world in the same state: the
    /// controls and the display read the match and never change it.
    /// </summary>
    public class OrdersTests
    {
        const int SECOND = 30;
        readonly PlayRig rig = new PlayRig();
        World world;
        PlayerControls controls;

        [TearDown]
        public void PutBack()
        {
            rig.Stop();
        }

        static int Slot(int id) => World.EntityIndex(id);

        Vector2 Goal(int id)
        {
            return new Vector2(Ground.F(world.goalX[Slot(id)]), Ground.F(world.goalY[Slot(id)]));
        }

        int Commands()
        {
            return rig.runner.Session.Replay().commands.Count(entry => entry.player == 0);
        }

        /// <summary>Turns the view to a place on the map, so that it is in the middle of the screen and clear of the panels.</summary>
        IEnumerator Face(Vector2 tile)
        {
            return rig.LookAt(tile, 50f);
        }

        IEnumerator Face(int id)
        {
            return rig.LookAt(rig.PlaceOf(id), 50f);
        }

        /// <summary>
        /// The middle of a tile of a building's plot that the player has seen. A
        /// building first comes into sight a corner at a time, and only the part
        /// that has been seen can be clicked on.
        /// </summary>
        Vector2 SeenPartOf(int building)
        {
            int slot = Slot(building);
            int half = world.TypeOf(slot).footprint >> 1;
            int cx = world.posX[slot] >> 16;
            int cy = world.posY[slot] >> 16;
            // From the south side first: that is the side the camera sees.
            for (int ty = cy + half; ty >= cy - half; ty--)
            {
                for (int tx = cx - half; tx <= cx + half; tx++)
                {
                    if (rig.runner.Sight.KnowsTile(ty * world.map.width + tx)) return new Vector2(tx + 0.5f, ty + 0.5f);
                }
            }
            Assert.Fail("no part of the building has been seen");
            return default;
        }

        static Vector2 Middle(GameMap map, int tile)
        {
            return new Vector2(tile % map.width + 0.5f, tile / map.width + 0.5f);
        }

        IEnumerator Select(params int[] ids)
        {
            yield return Face(ids[0]);
            yield return rig.Pause();
            yield return rig.Tap(Key.Escape);
            yield return rig.Click(rig.ScreenOf(ids[0]));
            if (ids.Length > 1)
            {
                yield return rig.Hold(Key.LeftShift);
                for (int i = 1; i < ids.Length; i++) yield return rig.Click(rig.ScreenOf(ids[i]));
                yield return rig.Release(Key.LeftShift);
            }
            Assert.That(controls.Selected, Is.EquivalentTo(ids), "selected by clicking");
        }

        [UnityTest]
        [Timeout(600000)]
        public IEnumerator EveryOrderGivenThroughTheControlsTakesEffectAndTheMatchReplaysWithoutAPicture()
        {
            yield return rig.Start(MatchMode.Play, Difficulty.Easy);
            world = rig.world;
            controls = rig.controls;
            GameMap map = world.map;
            Vector2 town = rig.TownOf(0);
            int townCentre = rig.Own(Kind.TownCentre)[0];
            List<int> villagers = rig.Own(Kind.Villager);
            int[] woodcutters = { villagers[0], villagers[1], villagers[2], villagers[3] };
            int forager = villagers[4];
            int builder = villagers[5];

            // ---- Gather: four villagers to the trees, one to the berries ---------------------
            yield return Select(woodcutters);
            int tree = rig.NearestTile(town, Terrain.Forest);
            Assert.That(tree, Is.Not.EqualTo(-1), "a tree in sight of the town");
            yield return Face(Middle(map, tree));
            yield return rig.RightClick(rig.ScreenOfTile(tree % map.width + 0.5f, tree / map.width + 0.5f, 1.5f));
            Assert.That(rig.runner.Overlays.Markers, Is.GreaterThanOrEqualTo(1), "a mark is left where the order was given");
            yield return rig.Play(2);
            foreach (int id in woodcutters)
            {
                Assert.That(world.job[Slot(id)], Is.EqualTo(Job.ToResource).Or.EqualTo(Job.Harvesting), "sent to the trees");
                Assert.That(world.jobTerrain[Slot(id)], Is.EqualTo(Terrain.Forest));
            }

            yield return Select(forager);
            int bush = rig.NearestTile(town, Terrain.Berries);
            Assert.That(bush, Is.Not.EqualTo(-1), "berries in sight of the town");
            yield return Face(Middle(map, bush));
            yield return rig.RightClick(rig.ScreenOfTile(bush % map.width + 0.5f, bush / map.width + 0.5f, 0.4f));
            yield return rig.Play(2);
            Assert.That(world.jobTerrain[Slot(forager)], Is.EqualTo(Terrain.Berries), "sent to the berries");
            yield return rig.Pause();
            Assert.That(rig.hud.SelectionText, Does.Contain("Foraging"), "the panel says what the villager is doing");

            // ---- Move, a waypoint, and stop --------------------------------------------------
            yield return Select(builder);
            Vector2Int first = rig.FreePlot(town, Kind.House);
            Vector2Int second = rig.FreePlot(town + new Vector2(0f, 7f), Kind.House);
            var there = new Vector2(first.x + 0.5f, first.y + 0.5f);
            var further = new Vector2(second.x + 0.5f, second.y + 0.5f);
            yield return Face(there);
            yield return rig.RightClick(rig.ScreenOfTile(there.x, there.y));
            yield return rig.Play(1);
            Assert.That(world.moveState[Slot(builder)], Is.Not.EqualTo(MoveState.Idle), "on the move after a right-click on the ground");
            Assert.That(Vector2.Distance(Goal(builder), there), Is.LessThan(0.75f), "heading where the pointer was");
            yield return Face(further);
            yield return rig.Hold(Key.LeftShift);
            yield return rig.RightClick(rig.ScreenOfTile(further.x, further.y));
            yield return rig.Release(Key.LeftShift);
            yield return rig.Play(1);
            Assert.That(world.queueLength[Slot(builder)], Is.EqualTo(1), "shift and a right-click adds a waypoint");
            yield return rig.Tap(Key.S);
            yield return rig.Play(1);
            Assert.That(world.moveState[Slot(builder)], Is.EqualTo(MoveState.Idle), "stopped with S");
            Assert.That(world.queueLength[Slot(builder)], Is.EqualTo(0));

            // ---- Attack-move, patrol and hold ------------------------------------------------
            yield return rig.Tap(Key.A);
            Assert.That(controls.AimingAt, Is.EqualTo(Aiming.AttackMove), "A takes up attack-move");
            Assert.That(rig.hud.SelectionText, Does.StartWith("Attack-move"));
            int before = Commands();
            yield return Face(there);
            yield return rig.RightClick(rig.ScreenOfTile(there.x, there.y));
            Assert.That(controls.AimingAt, Is.EqualTo(Aiming.None), "a right-click puts it down");
            Assert.That(Commands(), Is.EqualTo(before), "and gives no order");
            yield return rig.Tap(Key.A);
            yield return rig.Click(rig.ScreenOfTile(there.x, there.y));
            yield return rig.Play(1);
            Assert.That(world.orderKind[Slot(builder)], Is.EqualTo(OrderKind.AttackMove), "A and a click");
            Assert.That(controls.AimingAt, Is.EqualTo(Aiming.None));
            yield return rig.Tap(Key.P);
            yield return Face(further);
            yield return rig.Click(rig.ScreenOfTile(further.x, further.y));
            yield return rig.Play(1);
            Assert.That(world.orderKind[Slot(builder)], Is.EqualTo(OrderKind.Patrol), "P and a click");
            yield return rig.Tap(Key.H);
            yield return rig.Play(1);
            Assert.That(world.orderKind[Slot(builder)], Is.EqualTo(OrderKind.Hold), "H");
            yield return rig.Tap(Key.S);
            yield return rig.Play(1);
            Assert.That(world.orderKind[Slot(builder)], Is.EqualTo(OrderKind.None), "S");

            // ---- Build: choose a house, see where it may go, and found it -----------------------
            yield return rig.Tap(Key.Q);
            Assert.That(controls.Placing, Is.EqualTo(Kind.House), "Q with a villager chooses a house");
            Vector2Int plot = rig.FreePlot(town, Kind.House);
            yield return Face(new Vector2(plot.x + 0.5f, plot.y + 0.5f));
            yield return rig.MoveTo(rig.ScreenOfTile(plot.x + 0.5f, plot.y + 0.5f));
            yield return rig.Frames(1);
            Assert.That(rig.runner.Overlays.PlotShown && rig.runner.Overlays.PlotAllowed, Is.True, "a green plot over open grass");
            yield return rig.Shoot("23-play-placing-a-house");
            yield return Face(Middle(map, tree));
            yield return rig.MoveTo(rig.ScreenOfTile(tree % map.width + 0.5f, tree / map.width + 0.5f));
            yield return rig.Frames(1);
            Assert.That(rig.runner.Overlays.PlotShown && !rig.runner.Overlays.PlotAllowed, Is.True, "a red plot over the trees");
            yield return Face(new Vector2(plot.x + 0.5f, plot.y + 0.5f));
            int wood = rig.Stock(Resource.Wood);
            yield return rig.Click(rig.ScreenOfTile(plot.x + 0.5f, plot.y + 0.5f));
            Assert.That(controls.Placing, Is.EqualTo(-1), "placing ends with the click");
            yield return rig.Play(1);
            List<int> houses = rig.Own(Kind.House);
            Assert.That(houses.Count, Is.EqualTo(1), "a house site was founded");
            int house = houses[0];
            Assert.That(world.built[Slot(house)], Is.EqualTo(0));
            Assert.That(world.posX[Slot(house)] >> 16, Is.EqualTo(plot.x));
            Assert.That(world.posY[Slot(house)] >> 16, Is.EqualTo(plot.y));
            Assert.That(rig.Stock(Resource.Wood), Is.EqualTo(wood - 50), "and paid for");
            Assert.That(world.jobTarget[Slot(builder)], Is.EqualTo(house), "the builder is on his way to it");

            // ---- Construct: a second villager is sent to help by a right-click on the site ----------
            yield return rig.Frames(2);
            yield return Select(forager);
            yield return Face(house);
            yield return rig.RightClick(rig.ScreenOf(house));
            yield return rig.Play(1);
            Assert.That(world.job[Slot(forager)], Is.EqualTo(Job.ToSite).Or.EqualTo(Job.Constructing), "sent to build at the site");
            Assert.That(world.jobTarget[Slot(forager)], Is.EqualTo(house));
            yield return rig.Play(35 * SECOND);
            Assert.That(world.built[Slot(house)], Is.EqualTo(1), "the house is finished");
            yield return rig.Pause();
            Assert.That(rig.hud.PopulationText, Is.EqualTo("6/20"), "and the display counts its room");

            // ---- Demolish: a second site is founded and called off with the delete key ----------
            yield return Select(builder);
            yield return rig.Tap(Key.Q);
            Vector2Int spare = rig.FreePlot(town, Kind.House);
            yield return Face(new Vector2(spare.x + 0.5f, spare.y + 0.5f));
            yield return rig.Click(rig.ScreenOfTile(spare.x + 0.5f, spare.y + 0.5f));
            yield return rig.Play(1);
            int site = rig.Own(Kind.House).Single(id => id != house);
            yield return Face(site);
            yield return rig.Pause();
            yield return rig.Tap(Key.Escape);
            yield return rig.Click(rig.ScreenOf(site));
            Assert.That(controls.Building, Is.EqualTo(site), "a click on the site selects it");
            Assert.That(rig.hud.SelectionText, Does.Match(@"^House · \d+% built"));
            Assert.That(rig.hud.ActionLabels(), Is.EqualTo(new[] { "Cancel site" }));
            wood = rig.Stock(Resource.Wood);
            yield return rig.Tap(Key.Delete);
            yield return rig.Play(1);
            Assert.That(world.IsAlive(site), Is.False, "the site is called off");
            Assert.That(rig.Stock(Resource.Wood), Is.GreaterThanOrEqualTo(wood + 50), "and its cost given back");

            // ---- The town centre: train, cancel from the queue, rally, and a reform out of reach ----
            yield return Face(townCentre);
            yield return rig.Pause();
            yield return rig.Click(rig.ScreenOf(townCentre));
            Assert.That(controls.Building, Is.EqualTo(townCentre));
            int centre = Slot(townCentre);
            int food = rig.Stock(Resource.Food);
            yield return rig.Tap(Key.Q);
            yield return rig.Play(1);
            Assert.That(world.trainLength[centre], Is.EqualTo(1), "Q at the town centre trains a villager");
            Assert.That(rig.Stock(Resource.Food), Is.LessThanOrEqualTo(food - 50 + 5), "and takes its cost");
            yield return rig.Pause();
            Assert.That(rig.hud.Press("queued-0"), Is.True, "what is in training shows as a chip to click");
            yield return rig.Play(1);
            Assert.That(world.trainLength[centre], Is.EqualTo(0), "a click on the chip cancels it");
            yield return rig.Tap(Key.Q);
            yield return rig.Tap(Key.Q);
            yield return rig.Play(1);
            Assert.That(world.trainLength[centre], Is.EqualTo(2), "two villagers queued");
            Vector2Int flag = rig.FreePlot(town + new Vector2(-6f, 0f), Kind.House);
            var rally = new Vector2(flag.x + 0.5f, flag.y + 0.5f);
            yield return Face(rally);
            yield return rig.RightClick(rig.ScreenOfTile(rally.x, rally.y));
            yield return rig.Play(1);
            var rallied = new Vector2(Ground.F(world.rallyX[centre]), Ground.F(world.rallyY[centre]));
            Assert.That(Vector2.Distance(rallied, rally), Is.LessThan(0.75f), "a right-click with the town centre selected sets its rally point");
            yield return rig.Frames(2);
            yield return rig.Shoot("24-play-training-and-rally-flag");
            yield return rig.Tap(Key.W);
            Assert.That(controls.Toast, Does.Contain("needs 2 of"), "a reform out of reach says why");
            yield return rig.Play(50 * SECOND);
            List<int> grown = rig.Own(Kind.Villager);
            Assert.That(grown.Count, Is.EqualTo(8), "both villagers were trained");
            int recruit = grown.First(id => !villagers.Contains(id));
            Assert.That(Vector2.Distance(rig.PlaceOf(recruit), rally), Is.LessThan(3f), "and went to the rally point");

            // ---- Deliver: someone with wood on their back is sent to hand it in ------------------
            int carrier = World.NO_ENTITY;
            for (int tries = 0; tries < 600 && carrier == World.NO_ENTITY; tries++)
            {
                foreach (int id in woodcutters)
                {
                    if (world.job[Slot(id)] == Job.Harvesting && world.carry[Slot(id)] > 0) carrier = id;
                }
                if (carrier == World.NO_ENTITY) rig.runner.Advance(1);
            }
            Assert.That(carrier, Is.Not.EqualTo(World.NO_ENTITY), "a woodcutter at work with something on their back");
            yield return Select(carrier);
            yield return Face(townCentre);
            yield return rig.RightClick(rig.ScreenOf(townCentre));
            yield return rig.Play(1);
            Assert.That(world.job[Slot(carrier)], Is.EqualTo(Job.ToDropOff), "sent to hand in at the town centre");
            Assert.That(world.jobTarget[Slot(carrier)], Is.EqualTo(townCentre));

            // ---- Research: a mill is built, and the heavy plough researched at it -----------------
            yield return Select(builder);
            Assert.That(rig.hud.ActionLabels()[2], Is.EqualTo("Mill"));
            yield return rig.Tap(Key.E);
            Assert.That(controls.Placing, Is.EqualTo(Kind.Mill), "E with a villager chooses a mill");
            Vector2Int millPlot = rig.FreePlot(town, Kind.Mill);
            yield return Face(new Vector2(millPlot.x + 0.5f, millPlot.y + 0.5f));
            yield return rig.Click(rig.ScreenOfTile(millPlot.x + 0.5f, millPlot.y + 0.5f));
            yield return rig.Play(30 * SECOND);
            int mill = rig.Own(Kind.Mill).Single();
            Assert.That(world.built[Slot(mill)], Is.EqualTo(1), "the mill is finished");
            for (int tries = 0; tries < 120 && rig.Stock(Resource.Wood) < 125; tries++) yield return rig.Play(SECOND);
            yield return Face(mill);
            yield return rig.Pause();
            yield return rig.Tap(Key.Escape);
            yield return rig.Click(rig.ScreenOf(mill));
            Assert.That(controls.Building, Is.EqualTo(mill));
            Assert.That(rig.hud.ActionLabels()[0], Is.EqualTo("Heavy plough"));
            wood = rig.Stock(Resource.Wood);
            yield return rig.Tap(Key.Q);
            yield return rig.Play(1);
            Assert.That(world.trainLength[Slot(mill)], Is.EqualTo(1), "Q at the mill starts its research");
            Assert.That(world.trainQueue[Slot(mill) * EntityTypes.TRAIN_QUEUE_LENGTH], Is.EqualTo(Techs.QUEUED_TECH + TechId.HeavyPlough));
            Assert.That(rig.Stock(Resource.Wood), Is.LessThanOrEqualTo(wood - 125 + 5), "and takes its cost");
            yield return rig.Play(31 * SECOND);
            Assert.That(world.researched[TechId.HeavyPlough], Is.EqualTo(1), "the heavy plough is researched");
            yield return rig.Pause();
            Assert.That(rig.hud.ToastText, Is.EqualTo("Researched: Heavy plough"), "and the player is told");

            // ---- The minimap: a right-click on it sends the selection; a click moves the view -----
            yield return Select(builder);
            yield return rig.Hold(Key.LeftCtrl);
            yield return rig.Tap(Key.Digit3);
            yield return rig.Release(Key.LeftCtrl);
            Vector2 enemyTown = rig.TownOf(1);
            rig.hud.Minimap.Press(enemyTown.x, enemyTown.y, 1, false);
            yield return rig.Play(1);
            Assert.That(world.moveState[Slot(builder)], Is.Not.EqualTo(MoveState.Idle), "a right-click on the minimap sends the selection");
            rig.hud.Minimap.Press(40f, 50f, 0, false);
            Assert.That(new Vector2(rig.view.targetX, rig.view.targetY), Is.EqualTo(new Vector2(40f, 50f)), "a click on the minimap moves the view");

            // ---- Attack: the scout walks until he sees something of red's, and is set on it -------
            int foe = World.NO_ENTITY;
            for (int seconds = 0; seconds < 240 && foe == World.NO_ENTITY; seconds++)
            {
                yield return rig.Play(SECOND);
                Assert.That(world.IsAlive(builder), Is.True, "the scout is still alive after " + seconds + " seconds on the road");
                for (int slot = 0; slot < world.highWater; slot++)
                {
                    if (world.alive[slot] == 1 && world.owner[slot] == 1 && world.mobile[slot] == 0 && Vision.CanSee(world, 0, slot)) foe = world.IdAt(slot);
                }
            }
            Assert.That(foe, Is.Not.EqualTo(World.NO_ENTITY), "the scout found a red building");
            Vector2 seen = SeenPartOf(foe);
            yield return Face(seen);
            Assert.That(rig.runner.Buildings.Known(foe), Is.Not.Null, "a building in sight is known of");
            yield return rig.Tap(Key.Digit3);
            Assert.That(controls.Selected, Is.EqualTo(new[] { builder }), "the scout is recalled as group 3");
            yield return rig.RightClick(rig.ScreenOfTile(seen.x, seen.y, 0.2f));
            yield return rig.Play(1);
            Assert.That(world.orderKind[Slot(builder)], Is.EqualTo(OrderKind.AttackTarget), "a right-click on an enemy building is an attack");
            Assert.That(world.target[Slot(builder)], Is.EqualTo(foe));
            yield return rig.Pause();
            Assert.That(rig.hud.SelectionText, Does.EndWith("Attacking"));
            yield return rig.Shoot("25-play-scout-at-the-red-town");

            // A click on it shows whose it is. Then the scout goes home, and it is remembered as last seen.
            yield return rig.Pause();
            yield return rig.Tap(Key.Escape);
            yield return rig.Click(rig.ScreenOfTile(seen.x, seen.y, 0.2f));
            Assert.That(controls.Building, Is.EqualTo(foe), "a click on an enemy building selects it to look at");
            Assert.That(rig.hud.SelectionText, Does.Contain("the enemy's"));
            Assert.That(rig.hud.ActionLabels(), Is.Empty, "but it cannot be given orders");
            yield return rig.Tap(Key.Digit3);
            rig.hud.Minimap.Press(town.x, town.y, 1, false);
            for (int seconds = 0; seconds < 60 && rig.runner.Buildings.Sees(foe); seconds++) yield return rig.Play(SECOND);
            Assert.That(rig.runner.Buildings.Sees(foe), Is.False, "the red building is out of sight again");
            Assert.That(rig.runner.Buildings.Known(foe), Is.Not.Null, "but still known of");
            yield return rig.Pause();
            yield return rig.Tap(Key.Escape);
            yield return rig.Click(rig.ScreenOfTile(seen.x, seen.y, 0.2f));
            Assert.That(controls.Building, Is.EqualTo(foe));
            Assert.That(rig.hud.SelectionText, Does.EndWith("the enemy's · as last seen"));
            yield return rig.Shoot("26-play-red-building-remembered");

            // ---- Every kind of order went into the match as a command ---------------------------
            var kinds = new HashSet<CommandKind>(rig.runner.Session.Replay().commands.Where(entry => entry.player == 0).Select(entry => entry.command.kind));
            foreach (CommandKind kind in new[]
            {
                CommandKind.Move, CommandKind.AttackMove, CommandKind.Patrol, CommandKind.Attack, CommandKind.Stop, CommandKind.Hold,
                CommandKind.Gather, CommandKind.Deliver, CommandKind.Build, CommandKind.Construct, CommandKind.Train, CommandKind.Research,
                CommandKind.CancelTrain, CommandKind.Rally, CommandKind.Demolish,
            })
            {
                Assert.That(kinds, Does.Contain(kind), "an order of this kind was given through the controls");
            }

            // ---- And the match is the one its commands make, picture or no picture -----------------
            yield return rig.Play(60 * SECOND);
            Replay replay = rig.runner.Session.Replay();
            World plain = Replay.RunReplay(replay);
            Assert.That(plain.tick, Is.EqualTo(world.tick));
            Assert.That(Hash.HashHex(Hash.HashWorld(world)), Is.EqualTo(Hash.HashHex(Hash.HashWorld(plain))),
                "the match played through the controls against its commands replayed with no picture, at tick " + world.tick);
            Debug.Log($"[RTS] scripted match played through the controls to tick {world.tick}: {Commands()} orders from the player, " +
                $"{replay.commands.Count} commands in all, checksum {Hash.HashHex(Hash.HashWorld(world))}");
        }
    }
}
