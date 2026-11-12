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
    /// Choosing units and buildings with a pretend mouse and keyboard: click,
    /// drag a box, click twice, shift, escape, control groups and the
    /// idle-villager key.
    /// </summary>
    public class SelectionTests
    {
        readonly PlayRig rig = new PlayRig();

        [TearDown]
        public void PutBack()
        {
            rig.Stop();
        }

        [UnityTest]
        [Timeout(300000)]
        public IEnumerator UnitsAndBuildingsAreChosenWithTheMouseAndKeys()
        {
            yield return rig.Start(MatchMode.Play, Difficulty.Easy);
            PlayerControls controls = rig.controls;
            World world = rig.world;
            Assert.That(controls, Is.Not.Null, "a match with a player has controls");
            Debug.Log($"[RTS] the test screen is {rig.lens.pixelWidth} x {rig.lens.pixelHeight} (Screen says {Screen.width} x {Screen.height})");

            yield return rig.LookAt(rig.TownOf(0), 46f);
            List<int> villagers = rig.Own(Kind.Villager);
            Assert.That(villagers.Count, Is.EqualTo(World.STARTING_VILLAGERS), "villagers at the start");
            int townCentre = rig.Own(Kind.TownCentre)[0];
            yield return rig.Shoot("20-play-opening");

            // A click on one of the player's own selects it, and it alone.
            yield return rig.Click(rig.ScreenOf(villagers[0]));
            Assert.That(controls.Selected, Is.EqualTo(new[] { villagers[0] }), "after a click on one villager");
            Assert.That(rig.runner.Overlays.RingsDrawn, Is.EqualTo(1), "a ring under the one selected");
            Assert.That(rig.hud.SelectionText, Does.StartWith("Villager · 50/50 hp"), "what the panel says of a villager");

            // A second click on the same one, straight away, selects everyone of its kind in view.
            yield return rig.Click(rig.ScreenOf(villagers[0]));
            Assert.That(controls.Selected, Is.EquivalentTo(villagers), "after clicking a villager twice");
            Assert.That(rig.hud.SelectionText, Is.EqualTo("6 villagers"));
            yield return rig.Frames(1);
            Assert.That(rig.runner.Overlays.RingsDrawn, Is.EqualTo(villagers.Count), "a ring under each");
            yield return rig.Shoot("21-play-all-villagers-selected");

            // Shift and a click takes one out, and puts it back.
            yield return rig.Pause();
            yield return rig.Hold(Key.LeftShift);
            yield return rig.Click(rig.ScreenOf(villagers[2]));
            Assert.That(controls.Selected, Is.EquivalentTo(villagers.Where(id => id != villagers[2])), "after shift-clicking one of the selected");
            yield return rig.Pause();
            yield return rig.Click(rig.ScreenOf(villagers[2]));
            Assert.That(controls.Selected, Is.EquivalentTo(villagers), "after shift-clicking it again");
            yield return rig.Release(Key.LeftShift);

            // Escape clears the selection.
            yield return rig.Tap(Key.Escape);
            Assert.That(controls.Selected, Is.Empty, "after escape");
            Assert.That(rig.hud.SelectionText, Is.EqualTo("Nothing selected"));

            // A box dragged out selects exactly those of the player's units inside it.
            Vector2 a = rig.ScreenOf(villagers[0]);
            Vector2 b = rig.ScreenOf(villagers[1]);
            Vector2 low = Vector2.Min(a, b) - new Vector2(6f, 6f);
            Vector2 high = Vector2.Max(a, b) + new Vector2(6f, 6f);
            var inside = villagers.Where(id =>
            {
                Vector2 at = rig.ScreenOf(id);
                return at.x >= low.x && at.x <= high.x && at.y >= low.y && at.y <= high.y;
            }).ToList();
            yield return rig.MoveTo(low);
            yield return rig.Button(UnityEngine.InputSystem.LowLevel.MouseButton.Left, true);
            yield return rig.MoveTo(high);
            Assert.That(controls.DragBox(out Rect box), Is.True, "a box shows while it is dragged out");
            Assert.That(box.width, Is.EqualTo(high.x - low.x).Within(0.5f));
            yield return rig.Button(UnityEngine.InputSystem.LowLevel.MouseButton.Left, false);
            Assert.That(controls.Selected, Is.EquivalentTo(inside), "after dragging a box round two villagers");
            Assert.That(inside.Count, Is.GreaterThanOrEqualTo(2));

            // Ctrl and a digit saves the selection as a group; the digit alone brings it back.
            yield return rig.Hold(Key.LeftCtrl);
            yield return rig.Tap(Key.Digit1);
            yield return rig.Release(Key.LeftCtrl);
            yield return rig.Tap(Key.Escape);
            Assert.That(controls.Selected, Is.Empty);
            yield return rig.Tap(Key.Digit1);
            Assert.That(controls.Selected, Is.EquivalentTo(inside), "after recalling group 1");
            yield return rig.Frames(15);
            Assert.That(rig.hud.Press("group-1"), Is.True, "the group has a chip to click");
            // Shift saves a group too, as it has to in a browser.
            yield return rig.Tap(Key.Escape);
            yield return rig.Click(rig.ScreenOf(villagers[3]));
            yield return rig.Hold(Key.LeftShift);
            yield return rig.Tap(Key.Digit2);
            yield return rig.Release(Key.LeftShift);
            yield return rig.Tap(Key.Digit1);
            yield return rig.Pause();
            yield return rig.Tap(Key.Digit2);
            Assert.That(controls.Selected, Is.EqualTo(new[] { villagers[3] }), "after recalling group 2");

            // A click on a building selects it; on a tree, says what is left of it; on bare ground, clears.
            yield return rig.Pause();
            yield return rig.Click(rig.ScreenOf(townCentre));
            Assert.That(controls.Building, Is.EqualTo(townCentre), "after clicking the town centre");
            Assert.That(controls.Selected, Is.Empty);
            Assert.That(rig.hud.SelectionText, Does.StartWith("Town centre · 2400/2400 hp"));
            yield return rig.Shoot("22-play-town-centre-selected");
            int tree = rig.NearestTile(rig.TownOf(0), Terrain.Forest);
            yield return rig.LookAt(new Vector2(tree % world.map.width + 0.5f, tree / world.map.width + 0.5f), 46f);
            yield return rig.Click(rig.ScreenOfTile(tree % world.map.width + 0.5f, tree / world.map.width + 0.5f, 1.5f));
            Assert.That(controls.InspectedTile, Is.Not.EqualTo(-1), "after clicking a tree");
            Assert.That(world.map.terrain[controls.InspectedTile], Is.EqualTo(Terrain.Forest));
            Assert.That(rig.hud.SelectionText, Does.Match(@"^Tree · \d+ wood left$"));
            yield return rig.LookAt(rig.TownOf(0), 46f);
            Vector2Int open = rig.FreePlot(rig.TownOf(0), Kind.House);
            yield return rig.Pause();
            yield return rig.Click(rig.ScreenOfTile(open.x + 0.5f, open.y + 0.5f));
            Assert.That(controls.Building, Is.EqualTo(World.NO_ENTITY), "after clicking bare ground");
            Assert.That(controls.InspectedTile, Is.EqualTo(-1));

            // The full stop jumps to an idle villager: at the start, all six are.
            yield return rig.Tap(Key.Period);
            Assert.That(controls.Selected.Count, Is.EqualTo(1), "after the idle-villager key");
            Assert.That(villagers, Does.Contain(controls.Selected[0]));
            int first = controls.Selected[0];
            yield return rig.Tap(Key.Period);
            Assert.That(controls.Selected[0], Is.Not.EqualTo(first), "the key moves on to the next idle villager");

            // None of that was an order: the match has not been told anything.
            Assert.That(rig.runner.Session.Replay().commands.Count, Is.EqualTo(0), "choosing units gives no orders");
        }
    }
}
