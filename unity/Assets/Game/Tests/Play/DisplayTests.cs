using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using Rts.Ai;
using Rts.Sim;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.TestTools;

namespace Rts.Game.Tests
{
    /// <summary>
    /// The display over the battlefield: that it says what the match says,
    /// that its buttons do what the keys for them do, that the minimap moves
    /// the view and gives orders, that a click on a panel is not a click on
    /// the field, and that the banner comes up when a town centre falls.
    /// </summary>
    public class DisplayTests
    {
        readonly PlayRig rig = new PlayRig();

        [TearDown]
        public void PutBack()
        {
            rig.Stop();
        }

        [UnityTest]
        [Timeout(300000)]
        public IEnumerator TheDisplayShowsTheMatchAndItsButtonsWork()
        {
            yield return rig.Start(MatchMode.Play, Difficulty.Easy);
            World world = rig.world;
            PlayerControls controls = rig.controls;
            Hud hud = rig.hud;
            Assert.That(hud, Is.Not.Null, "the match scene has a display");
            Vector2 town = rig.TownOf(0);
            yield return rig.LookAt(town, 50f);

            // ---- What it says ----------------------------------------------------------------
            for (int r = 0; r < EntityTypes.RESOURCE_COUNT; r++)
            {
                Assert.That(hud.StoresText(r), Is.EqualTo(rig.Stock(r).ToString()), "the stores as the match has them: " + EntityTypes.RESOURCE_NAMES[r]);
            }
            Assert.That(hud.PopulationText, Is.EqualTo("6/10"));
            Assert.That(hud.AgeText, Is.EqualTo("Early Medieval"));
            Assert.That(hud.SelectionText, Is.EqualTo("Nothing selected"));
            Assert.That(hud.ActionLabels(), Is.Empty, "no buttons with nothing selected");
            Assert.That(hud.Press("stop"), Is.False, "and no orders to give");
            Assert.That(hud.Banner, Is.EqualTo(""));

            // ---- A villager's buttons, in the browser version's order --------------------------
            int villager = rig.Own(Kind.Villager)[0];
            yield return rig.Click(rig.ScreenOf(villager));
            Assert.That(hud.ActionLabels(), Is.EqualTo(new[]
            {
                "House", "Farm", "Mill", "Lumber camp", "Mining camp", "Barracks", "Archery range", "Stable", "Blacksmith", "Watchtower",
            }));
            Assert.That(hud.Press("action-1"), Is.True);
            Assert.That(controls.Placing, Is.EqualTo(Kind.Farm), "the second button chooses a farm, as W does");
            yield return rig.Frames(2);
            Assert.That(hud.SelectionText, Does.StartWith("Placing a farm"));
            Assert.That(hud.ActionLabels(), Is.Empty, "the buttons step aside while a place is chosen");
            yield return rig.Tap(Key.Escape);
            Assert.That(controls.Placing, Is.EqualTo(-1));

            // A building the player cannot yet have says why, and cannot be chosen.
            Assert.That(hud.Press("action-8"), Is.True);
            Assert.That(controls.Placing, Is.EqualTo(-1), "a blacksmith cannot be chosen in the first age");
            Assert.That(controls.Toast, Does.Contain("needs the High Medieval age"));
            yield return rig.Frames(2);
            Assert.That(hud.ToastText, Does.Contain("needs the High Medieval age"), "and the display says so");

            // ---- Resting the pointer on a button says what it is ---------------------------------
            Assert.That(hud.ScreenPlaceOf("attack-move", out Vector2 orderButton), Is.True);
            yield return rig.MoveTo(orderButton);
            yield return rig.Frames(2);
            Assert.That(hud.TipText, Is.EqualTo("March there, fighting whatever they meet"), "what the attack-move button is");
            yield return rig.Shoot("39-display-what-a-button-is", () => hud.ShowTipFor("attack-move"));
            hud.ShowHelp(true);
            yield return rig.Shoot("38-display-list-of-controls");
            hud.ShowHelp(false);
            yield return rig.MoveTo(rig.ScreenOf(villager));
            yield return rig.Frames(2);
            Assert.That(hud.TipText, Is.EqualTo(""), "and it goes when the pointer leaves");

            // ---- The order buttons ------------------------------------------------------------
            Assert.That(hud.Press("attack-move"), Is.True);
            Assert.That(controls.AimingAt, Is.EqualTo(Aiming.AttackMove));
            Assert.That(hud.Press("patrol"), Is.True);
            Assert.That(controls.AimingAt, Is.EqualTo(Aiming.Patrol));
            yield return rig.Tap(Key.Escape);
            Assert.That(controls.AimingAt, Is.EqualTo(Aiming.None));
            Assert.That(controls.Selected.Count, Is.EqualTo(1), "escape put the order down and left the selection");
            Assert.That(hud.Press("hold"), Is.True);
            yield return rig.Play(1);
            Assert.That(world.orderKind[World.EntityIndex(villager)], Is.EqualTo(OrderKind.Hold));
            Assert.That(hud.Press("stop"), Is.True);
            yield return rig.Play(1);
            Assert.That(world.orderKind[World.EntityIndex(villager)], Is.EqualTo(OrderKind.None));

            // ---- A real click on a button, through the engine's own handling of the display -----
            yield return rig.Tap(Key.Escape);
            yield return rig.Pause();
            Assert.That(hud.ScreenPlaceOf("idle", out Vector2 idleButton), Is.True, "the idle-villager button is showing");
            Assert.That(hud.IsOver(idleButton), Is.True, "the pointer there is over a panel");
            yield return rig.Click(idleButton);
            yield return rig.Frames(2);
            Assert.That(controls.Selected.Count, Is.EqualTo(1), "a click on the idle-villager button selects one");

            // ---- A click on a panel is not a click on the field ---------------------------------
            IReadOnlyList<int> chosen = controls.Selected;
            int kept = chosen[0];
            yield return rig.Pause();
            Assert.That(hud.ScreenPlaceOf("action-0", out Vector2 overPanel), Is.True);
            int before = rig.runner.Session.Replay().commands.Count;
            yield return rig.Click(overPanel + new Vector2(0f, 14f * Screen.height / 900f), UnityEngine.InputSystem.LowLevel.MouseButton.Right);
            Assert.That(rig.runner.Session.Replay().commands.Count, Is.EqualTo(before), "a right-click on the panel gives no order");
            Assert.That(controls.Selected, Is.EqualTo(new[] { kept }), "and does not disturb the selection");

            // ---- The minimap ------------------------------------------------------------------
            Assert.That(hud.ScreenPlaceOf("minimap-lines", out Vector2 mapMiddle), Is.True);
            yield return rig.Click(mapMiddle);
            Assert.That(rig.view.targetX, Is.EqualTo(world.map.width / 2f).Within(1.5f), "a click in the middle of the minimap moves the view to the middle of the map");
            Assert.That(rig.view.targetY, Is.EqualTo(world.map.height / 2f).Within(1.5f));
            yield return rig.RightClick(mapMiddle);
            yield return rig.Play(1);
            int slot = World.EntityIndex(kept);
            Assert.That(world.moveState[slot], Is.Not.EqualTo(MoveState.Idle), "a right-click on the minimap sends the selection there");
            yield return rig.Tap(Key.S);
            yield return rig.Play(1);
            yield return rig.LookAt(town, 50f);
            yield return rig.Shoot("40-display-villager-selected");

            // ---- Time: the testing keys ---------------------------------------------------------
            Assert.That(rig.runner.Speed, Is.EqualTo(1f));
            yield return rig.Tap(Key.RightBracket);
            Assert.That(rig.runner.Speed, Is.EqualTo(2f), "] runs the match faster");
            yield return rig.Tap(Key.LeftBracket);
            Assert.That(rig.runner.Speed, Is.EqualTo(1f), "[ slower");
            yield return rig.Tap(Key.F10);
            Assert.That(rig.runner.paused, Is.False, "F10 lets time run");
            yield return rig.Tap(Key.F10);
            Assert.That(rig.runner.paused, Is.True, "and stops it again");

            // ---- The banner: the player pulls down their own town centre, and is told ------------
            int townCentre = rig.Own(Kind.TownCentre)[0];
            yield return rig.Pause();
            yield return rig.Tap(Key.Escape);
            yield return rig.Click(rig.ScreenOf(townCentre));
            Assert.That(controls.Building, Is.EqualTo(townCentre));
            List<string> labels = hud.ActionLabels();
            Assert.That(labels[labels.Count - 1], Is.EqualTo("Pull down"));
            Assert.That(labels[0], Is.EqualTo("Train villager"));
            // The key for the last button does nothing: pulling down has a key of its own.
            yield return rig.Tap(Key.T);
            yield return rig.Play(1);
            Assert.That(world.IsAlive(townCentre), Is.True, "the letter under the Pull down button does not pull it down");
            yield return rig.Tap(Key.Delete);
            yield return rig.Play(1);
            Assert.That(world.IsAlive(townCentre), Is.False, "delete does");
            yield return rig.Frames(2);
            Assert.That(rig.runner.Outcome, Is.EqualTo(MatchOutcome.Defeat));
            Assert.That(hud.Banner, Is.EqualTo("Defeat"), "the banner says the match is lost");
            yield return rig.Shoot("41-display-defeat");
        }

        [UnityTest]
        [Timeout(300000)]
        public IEnumerator AMatchCanStillBeWatchedAndANewOneStartedFromTheDisplay()
        {
            // The opponent the owner last picked is theirs: it is put back after this check has pressed the button.
            bool had = PlayerPrefs.HasKey(MatchRunner.LEVEL_KEY);
            string kept = PlayerPrefs.GetString(MatchRunner.LEVEL_KEY, "");
            try
            {
                yield return rig.Start(MatchMode.Watch, Difficulty.Easy);
                Assert.That(rig.controls, Is.Null, "nobody is at the controls of a match being watched");
                Assert.That(rig.runner.Sight.Lifted, Is.True, "and nothing is hidden");
                Assert.That(rig.hud.Press("stop"), Is.False, "there are no orders to give");
                yield return rig.Play(60 * 30);
                Assert.That(rig.runner.Session.Replay().commands.Count, Is.GreaterThan(0), "both sides are playing");
                int blueOrders = 0;
                foreach (ScheduledCommand entry in rig.runner.Session.Replay().commands) if (entry.player == 0) blueOrders++;
                Assert.That(blueOrders, Is.GreaterThan(0), "blue is led by the computer");
                yield return rig.LookAt(rig.TownOf(0), 62f);
                yield return rig.Shoot("42-display-watching");

                // "Play a match" starts one with the player at the controls.
                Assert.That(rig.hud.Press("play"), Is.True);
                yield return rig.Frames(3);
                MatchRunner next = Object.FindFirstObjectByType<MatchRunner>();
                Assert.That(next.Controls, Is.Not.Null, "the new match has controls");
                Assert.That(next.mode, Is.EqualTo(MatchMode.Play));
                Assert.That(next.World.tick, Is.LessThan(30), "and has only just begun");
                Assert.That(next.Sight.Lifted, Is.False);

                // Choosing an opponent starts another, at that level.
                Assert.That(next.hud.Press("level-hard"), Is.True);
                yield return rig.Frames(3);
                MatchRunner harder = Object.FindFirstObjectByType<MatchRunner>();
                Assert.That(harder, Is.Not.SameAs(next));
                Assert.That(harder.opponent, Is.EqualTo(Difficulty.Hard));
                Assert.That(harder.Controls, Is.Not.Null);
                rig.runner = harder;
            }
            finally
            {
                if (had) PlayerPrefs.SetString(MatchRunner.LEVEL_KEY, kept);
                else PlayerPrefs.DeleteKey(MatchRunner.LEVEL_KEY);
                PlayerPrefs.Save();
            }
        }
    }
}
