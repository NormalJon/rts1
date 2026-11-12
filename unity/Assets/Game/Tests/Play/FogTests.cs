using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using Rts.Ai;
using Rts.Sim;
using Unity.Collections;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.TestTools;
using Terrain = Rts.Sim.Terrain;

namespace Rts.Game.Tests
{
    /// <summary>
    /// The fog of war as it is drawn: that the picture shows the player's side
    /// what it can see and no more. Ground never seen is dark; ground seen
    /// before is dimmed and kept as it was last seen; enemy units out of sight
    /// are not drawn and cannot be clicked; enemy buildings are remembered;
    /// and the testing switch lifts all of it and lets it fall again.
    /// </summary>
    public class FogTests
    {
        readonly PlayRig rig = new PlayRig();
        World world;
        /// <summary>Red buildings that have been in blue's sight at a moment the picture was drawn.</summary>
        readonly HashSet<int> everSeen = new HashSet<int>();
        /// <summary>Red units that have been in blue's sight at such a moment.</summary>
        readonly HashSet<int> unitsSeen = new HashSet<int>();
        bool sawAnEnemy;
        bool lostSightOfOne;
        bool rememberedABuilding;
        bool alarmed;
        bool pinged;
        string alarm = "";
        int treesRemembered;

        [TearDown]
        public void PutBack()
        {
            rig.Stop();
        }

        static int Brightest(Color32 dot) => Mathf.Max(dot.r, Mathf.Max(dot.g, dot.b));

        /// <summary>The share of a picture that is as dark as ground never seen.</summary>
        static float DarkShare(Color32[] dots)
        {
            int dark = 0;
            foreach (Color32 dot in dots)
            {
                if (Brightest(dot) < 45) dark++;
            }
            return (float)dark / dots.Length;
        }

        [UnityTest]
        [Timeout(600000)]
        public IEnumerator ThePictureShowsOnlyWhatThePlayersSideCanSee()
        {
            yield return rig.Start(MatchMode.Play, Difficulty.Hard);
            world = rig.world;
            PlayerControls controls = rig.controls;
            Sight sight = rig.runner.Sight;
            GameMap map = world.map;
            Vector2 red = rig.TownOf(1);
            int redTown = rig.Own(Kind.TownCentre, 1)[0];
            int redVillager = rig.Own(Kind.Villager, 1)[0];
            everSeen.Clear();
            unitsSeen.Clear();
            yield return rig.Frames(2);

            // ---- At the start: red's town has never been seen ---------------------------------
            Check("at the start");
            Assert.That(sight.Lifted, Is.False, "a match with a player starts under the fog");
            Assert.That(rig.runner.Buildings.Known(redTown), Is.Null, "the red town centre is not known of");
            Assert.That(rig.runner.Units.IsDrawn(World.EntityIndex(redVillager)), Is.False, "a red villager is not drawn");
            yield return rig.LookAt(red, 60f);
            Assert.That(DarkShare(rig.Look(320, 180)), Is.GreaterThan(0.995f), "the picture of the red town is dark");
            yield return rig.Shoot("30-fog-red-town-never-seen");
            Assert.That(rig.hud.Minimap.DotAt((int)red.x, (int)red.y), Is.EqualTo(Palette.MINIMAP_DARK), "the red town is dark on the minimap");
            Vector2 blue = rig.TownOf(0);
            Assert.That(rig.hud.Minimap.DotAt((int)blue.x + 4, (int)blue.y + 4), Is.Not.EqualTo(Palette.MINIMAP_DARK), "the blue town is not");

            // The river in the middle of the map has not been seen either. Water is see-through, and
            // see-through things are the ones most easily left shining through the fog.
            int river = -1;
            float nearest = float.MaxValue;
            for (int tile = 0; tile < map.tileCount; tile++)
            {
                if (map.terrain[tile] != Terrain.Water) continue;
                float dx = tile % map.width - map.width / 2f;
                float dy = tile / map.width - map.height / 2f;
                if (dx * dx + dy * dy >= nearest) continue;
                nearest = dx * dx + dy * dy;
                river = tile;
            }
            Assert.That(river, Is.Not.EqualTo(-1), "the map has a river");
            Assert.That(sight.KnowsTile(river), Is.False, "which blue has not seen");
            yield return rig.LookAt(new Vector2(river % map.width + 0.5f, river / map.width + 0.5f), 60f);
            Assert.That(DarkShare(rig.Look(320, 180)), Is.GreaterThan(0.995f), "the picture of the unseen river is dark");
            yield return rig.LookAt(red, 60f);

            // What cannot be seen cannot be clicked.
            yield return rig.Click(rig.ScreenOf(redVillager));
            Assert.That(controls.InspectedUnit, Is.EqualTo(World.NO_ENTITY), "a click where an unseen enemy stands finds nobody");
            yield return rig.Pause();
            yield return rig.Click(rig.ScreenOf(redTown));
            Assert.That(controls.Building, Is.EqualTo(World.NO_ENTITY), "a click where an unseen building stands finds nothing");

            // ---- The testing switch lifts the fog ---------------------------------------------
            Assert.That(rig.hud.Press("fog"), Is.True, "there is a Lift fog button");
            Assert.That(sight.Lifted, Is.True);
            yield return rig.Frames(3);
            Assert.That(rig.runner.Buildings.Known(redTown), Is.Not.Null, "with the fog lifted the red town centre is drawn");
            Assert.That(rig.runner.Units.IsDrawn(World.EntityIndex(redVillager)), Is.True, "and so are red's villagers");
            Assert.That(DarkShare(rig.Look(320, 180)), Is.LessThan(0.5f), "and the picture of the red town is lit");
            yield return rig.Pause();
            yield return rig.Click(rig.ScreenOf(redVillager));
            Assert.That(controls.InspectedUnit, Is.EqualTo(redVillager), "and a red villager can be clicked to look at");
            Assert.That(rig.hud.SelectionText, Does.StartWith("Enemy villager · 50/50 hp"));
            yield return rig.Shoot("31-fog-lifted-red-town");
            // Lifting the fog shows; it does not change what may be done. An attack on someone
            // the side cannot truly see is refused by the rules.
            yield return rig.LookAt(blue, 50f);
            int own = rig.Own(Kind.Villager)[0];
            yield return rig.Pause();
            yield return rig.Click(rig.ScreenOf(own));
            yield return rig.LookAt(red, 60f);
            yield return rig.RightClick(rig.ScreenOf(redVillager));
            yield return rig.Play(1);
            Assert.That(world.target[World.EntityIndex(own)], Is.EqualTo(World.NO_ENTITY), "the rules still refuse an attack on someone out of sight");
            yield return rig.Tap(Key.S);
            yield return rig.Play(1);

            // ---- And lets it fall again -------------------------------------------------------
            Assert.That(rig.hud.Press("fog"), Is.True);
            Assert.That(sight.Lifted, Is.False);
            yield return rig.Frames(3);
            Assert.That(rig.runner.Buildings.Known(redTown), Is.Null, "what was seen only with the fog lifted is forgotten when it falls");
            Assert.That(rig.runner.Units.IsDrawn(World.EntityIndex(redVillager)), Is.False);
            Assert.That(DarkShare(rig.Look(320, 180)), Is.GreaterThan(0.995f), "and the picture of the red town is dark again");
            Check("with the fog fallen again");

            // ---- A match: a scout is sent to the red town, and red comes scouting too -----------
            yield return rig.LookAt(blue, 50f);
            yield return rig.Pause();
            yield return rig.Tap(Key.Escape);
            yield return rig.Click(rig.ScreenOf(own));
            Assert.That(controls.Selected, Is.EqualTo(new[] { own }));
            rig.hud.Minimap.Press(red.x, red.y, 1, false);
            for (int step = 0; step < 150; step++)
            {
                rig.runner.Advance(60);
                yield return null;
                Check("at tick " + world.tick);
                // The scout is hit far from where the player is looking: they are told, and the minimap flashes there.
                if (controls.Alarmed && !alarmed)
                {
                    alarmed = true;
                    alarm = controls.Toast;
                    pinged = rig.hud.Minimap.Pings > 0;
                    yield return rig.Shoot("34-fog-scout-attacked-alarm");
                }
            }
            Assert.That(sawAnEnemy, Is.True, "a red unit came into sight and was drawn");
            Assert.That(lostSightOfOne, Is.True, "a red unit went out of sight and was hidden");
            Assert.That(rememberedABuilding, Is.True, "a red building went out of sight and stayed on the picture as last seen");
            Assert.That(alarmed, Is.True, "the player was told when the scout was hit out of view");
            Assert.That(alarm, Does.StartWith("Your people are under attack"));
            Assert.That(pinged, Is.True, "and the minimap flashed where");
            yield return rig.Tap(Key.F);
            Assert.That(new Vector2(rig.view.targetX, rig.view.targetY), Is.EqualTo(controls.AlarmAt), "F looks at the place");

            // ---- Ground seen before is dimmer than ground in sight, and lighter than the dark ----
            int seenGrass = OpenGrass(tile => sight.SeesTile(tile));
            int knownGrass = OpenGrass(tile => !sight.SeesTile(tile) && sight.KnowsTile(tile));
            Assert.That(seenGrass, Is.Not.EqualTo(-1), "open grass in sight");
            Assert.That(knownGrass, Is.Not.EqualTo(-1), "open grass that was seen and is not now");
            yield return rig.LookAt(new Vector2(seenGrass % map.width + 0.5f, seenGrass / map.width + 0.5f), 30f);
            int lit = Brightest(Middle(rig.Look(320, 180), 320, 180));
            yield return rig.LookAt(new Vector2(knownGrass % map.width + 0.5f, knownGrass / map.width + 0.5f), 30f);
            int dim = Brightest(Middle(rig.Look(320, 180), 320, 180));
            yield return rig.Shoot("32-fog-ground-seen-before");
            Assert.That(lit, Is.GreaterThan(110), "grass in sight is bright");
            Assert.That(dim, Is.LessThan(lit * 0.8f), "grass seen before is dimmer");
            Assert.That(dim, Is.GreaterThan(50), "but not dark");

            yield return rig.LookAt(new Vector2(map.width / 2f, map.height / 2f + 14f), 190f);
            yield return rig.Shoot("33-fog-whole-map-as-blue-knows-it");
            Debug.Log($"[RTS] fog checked to tick {world.tick}: {everSeen.Count} red buildings seen, {treesRemembered} tiles remembered other than they now are");
        }

        static Color32 Middle(Color32[] dots, int width, int height)
        {
            return dots[height / 2 * width + width / 2];
        }

        /// <summary>A tile of open grass, with open grass of the same standing all round it, for looking at the bare ground.</summary>
        int OpenGrass(System.Func<int, bool> wanted)
        {
            GameMap map = world.map;
            for (int ty = 4; ty < map.height - 4; ty++)
            {
                for (int tx = 4; tx < map.width - 4; tx++)
                {
                    bool good = true;
                    for (int dy = -3; dy <= 3 && good; dy++)
                    {
                        for (int dx = -3; dx <= 3 && good; dx++)
                        {
                            int tile = (ty + dy) * map.width + tx + dx;
                            good = map.terrain[tile] == Terrain.Grass && rig.runner.Terrain.SeenTerrain(tile) == Terrain.Grass && map.blocked[tile] == 0 && wanted(tile);
                        }
                    }
                    if (!good) continue;
                    // Nobody standing on it either.
                    for (int slot = 0; slot < world.highWater && good; slot++)
                    {
                        if (world.alive[slot] == 0) continue;
                        good = Mathf.Abs(Ground.F(world.posX[slot]) - tx) > 4f || Mathf.Abs(Ground.F(world.posY[slot]) - ty) > 4f;
                    }
                    if (good) return ty * map.width + tx;
                }
            }
            return -1;
        }

        /// <summary>
        /// Holds what was last drawn to what blue's side can see, worked out here
        /// from the simulation's own count of who sees what.
        /// </summary>
        void Check(string when)
        {
            Sight sight = rig.runner.Sight;
            UnitViews units = rig.runner.Units;
            BuildingViews buildings = rig.runner.Buildings;
            GameMap map = world.map;
            ushort[] seen = world.seen[world.view[0]];
            byte[] explored = world.explored[world.view[0]];

            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0) continue;
                bool mine = world.owner[slot] == 0;
                bool inSight = mine || Vision.CanSee(world, 0, slot);
                int id = world.IdAt(slot);
                if (world.mobile[slot] == 1)
                {
                    Assert.That(units.IsDrawn(slot), Is.EqualTo(inSight), $"{when}: a {world.TypeOf(slot).name} of player {world.owner[slot]} is drawn only if it is in sight");
                    if (!mine && inSight)
                    {
                        sawAnEnemy = true;
                        unitsSeen.Add(id);
                    }
                    if (!mine && !inSight && unitsSeen.Contains(id)) lostSightOfOne = true;
                    continue;
                }
                if (inSight)
                {
                    Assert.That(buildings.Known(id), Is.Not.Null, $"{when}: a {world.TypeOf(slot).name} in sight is drawn");
                    if (!mine) everSeen.Add(id);
                }
            }
            foreach (BuildingViews.Shown shown in buildings.All)
            {
                if (shown.owner == 0) continue;
                Assert.That(everSeen, Does.Contain(shown.id), $"{when}: a red building on the picture is one that has been seen");
                if (!buildings.Sees(shown.id)) rememberedABuilding = true;
            }

            // The fog itself, a dot to a tile: dark, dimmed or clear.
            sight.Settle();
            NativeArray<byte> fog = sight.Picture.GetPixelData<byte>(0);
            int dimmed = Mathf.RoundToInt(Sight.FOG_EXPLORED * 255f);
            int wrong = 0;
            int remembered = 0;
            for (int tile = 0; tile < map.tileCount; tile++)
            {
                int want = seen[tile] > 0 ? 255 : explored[tile] == 1 ? dimmed : 0;
                if (fog[tile] != want) wrong++;
                // The ground is drawn as it was last seen, and brought up to date only where it is in sight.
                bool same = rig.runner.Terrain.SeenTerrain(tile) == map.terrain[tile];
                if (!same) remembered++;
                if (seen[tile] > 0) Assert.That(same, Is.True, $"{when}: a tile in sight is drawn as it is");
            }
            Assert.That(wrong, Is.EqualTo(0), $"{when}: tiles whose fog is not what the side sees");
            treesRemembered = Mathf.Max(treesRemembered, remembered);

            // The minimap shows nothing where nothing has ever been seen (a dot or a square may lap a tile or two over the edge).
            Minimap minimap = rig.hud.Minimap;
            for (int ty = 0; ty < map.height; ty += 3)
            {
                for (int tx = 0; tx < map.width; tx += 3)
                {
                    if (minimap.DotAt(tx, ty).Equals(Palette.MINIMAP_DARK)) continue;
                    bool near = false;
                    for (int dy = -3; dy <= 3 && !near; dy++)
                    {
                        for (int dx = -3; dx <= 3 && !near; dx++)
                        {
                            int x = tx + dx;
                            int y = ty + dy;
                            near = x >= 0 && y >= 0 && x < map.width && y < map.height && explored[y * map.width + x] == 1;
                        }
                    }
                    Assert.That(near, Is.True, $"{when}: the minimap shows something at ({tx}, {ty}), which has never been seen");
                }
            }
        }
    }
}
