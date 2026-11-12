using System.Collections;
using System.IO;
using NUnit.Framework;
using Rts.Ai;
using Rts.Session;
using Rts.Sim;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Rts.Game.Tests
{
    /// <summary>
    /// Plays the match scene as the game does and checks it from the inside:
    /// that everything alive is drawn, that drawing does not disturb the
    /// match, and that nothing complains. It also takes pictures along the
    /// way and leaves them in Logs/Snapshots, so that whoever ran it can look
    /// at what the game looked like.
    /// </summary>
    public class MatchSceneTests
    {
        const int TICKS_A_MINUTE = 30 * 60;

        MatchRunner runner;
        RtsCamera view;
        Camera lens;
        string folder;

        [UnityTest]
        [Timeout(900000)]
        public IEnumerator TheMatchPlaysAndEverythingAliveIsDrawn()
        {
            folder = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Logs", "Snapshots"));
            Directory.CreateDirectory(folder);

            SceneManager.LoadScene("Match");
            yield return null;
            yield return null;
            runner = Object.FindFirstObjectByType<MatchRunner>();
            Assert.That(runner, Is.Not.Null, "the Match scene has no MatchRunner");
            Assert.That(runner.World, Is.Not.Null, "the match did not start");
            lens = Camera.main;
            view = lens.GetComponent<RtsCamera>();
            view.takesInput = false;
            // The test moves the match on by hand, so that it knows exactly which tick it is looking at.
            runner.paused = true;
            World world = runner.World;

            Assert.That(runner.Props.Count, Is.GreaterThan(500), "trees and deposits standing on the map");
            yield return Look("01-opening-blue-town", 0, 62f);
            yield return LookAt("02-opening-close", TownOf(0) + new Vector2(4.5f, 0f), 24f);
            yield return LookAt("03-whole-map", new Vector2(world.map.width / 2f, world.map.height / 2f + 14f), 190f);

            yield return Play(2 * TICKS_A_MINUTE);
            yield return Look("04-two-minutes-blue", 0, 62f);
            yield return LookAt("05-two-minutes-close", TownOf(0) + new Vector2(5f, 2f), 30f);

            // A stretch run a tick at a time, drawing between ticks, as it is when someone watches.
            for (int i = 0; i < 90; i++)
            {
                runner.Advance(1);
                yield return null;
            }
            yield return LookAt("06-working-close", Busiest(0), 26f);

            yield return Play(6 * TICKS_A_MINUTE);
            yield return Look("07-eight-minutes-blue", 0, 80f);
            yield return Look("08-eight-minutes-red", 1, 80f);

            yield return Play(8 * TICKS_A_MINUTE);
            yield return Look("09-sixteen-minutes-blue", 0, 95f);
            yield return LookAt("10-sixteen-minutes-fight", Fighting(), 40f);

            yield return Play(10 * TICKS_A_MINUTE);
            yield return Look("11-twenty-six-minutes-red", 1, 95f);
            yield return LookAt("12-twenty-six-minutes-fight", Fighting(), 34f);
            yield return LookAt("13-twenty-six-minutes-whole-map", new Vector2(world.map.width / 2f, world.map.height / 2f + 14f), 190f);

            // How long a frame takes with this much on the map, running one tick each
            // frame. A rough figure: nothing is shown on a screen while a test runs.
            yield return Look("14-timing", 0, 95f);
            float started = Time.realtimeSinceStartup;
            const int FRAMES = 200;
            for (int i = 0; i < FRAMES; i++)
            {
                runner.Advance(1);
                yield return null;
            }
            float milliseconds = (Time.realtimeSinceStartup - started) * 1000f / FRAMES;

            // Everything alive has something drawn for it.
            int units = 0, buildings = 0;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0) continue;
                if (world.mobile[slot] == 1) units++;
                else buildings++;
            }
            Assert.That(runner.Units.Count, Is.EqualTo(units), "units drawn against units alive");
            Assert.That(runner.Buildings.Count, Is.EqualTo(buildings), "buildings drawn against buildings standing");
            Assert.That(units, Is.GreaterThan(20), "the AIs should have raised some people by now");

            // Drawing reads the match and never changes it: the same match
            // played with no picture at all is in the same state.
            var plain = new LocalSession(world.config.Clone());
            plain.Control(0, new SkirmishAi(0, runner.blue));
            plain.Control(1, new SkirmishAi(1, runner.red));
            for (int i = 0; i < world.tick; i++) plain.Step();
            Assert.That(Hash.HashHex(Hash.HashWorld(world)), Is.EqualTo(Hash.HashHex(Hash.HashWorld(plain.world))),
                "the match in the scene against the same match played without a picture, at tick " + world.tick);
            Debug.Log($"[RTS] match scene played to tick {world.tick}: {units} units, {buildings} buildings, {runner.Props.Count} trees and deposits, " +
                $"checksum {Hash.HashHex(Hash.HashWorld(world))}; {milliseconds:0.00} ms a frame with a tick in each; pictures in {folder}");
        }

        /// <summary>Runs the match on and lets a few frames be drawn.</summary>
        IEnumerator Play(int ticks)
        {
            // In steps, so that the picture is brought up to date now and then as it would be.
            const int STEP = 30 * 20;
            for (int done = 0; done < ticks; done += STEP)
            {
                runner.Advance(Mathf.Min(STEP, ticks - done));
                yield return null;
            }
            yield return null;
        }

        Vector2 TownOf(int player)
        {
            StartPosition start = runner.World.map.starts[player];
            return new Vector2(Ground.F(start.x), Ground.F(start.y));
        }

        /// <summary>Where the most of a player's villagers are at work.</summary>
        Vector2 Busiest(int player)
        {
            World world = runner.World;
            Vector2 sum = Vector2.zero;
            int n = 0;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.owner[slot] != player || world.job[slot] != Job.Harvesting) continue;
                sum += new Vector2(Ground.F(world.posX[slot]), Ground.F(world.posY[slot]));
                n++;
            }
            return n > 0 ? NearestTo(sum / n, player, true) : TownOf(player);
        }

        /// <summary>Somewhere soldiers are fighting, or failing that where the most soldiers are.</summary>
        Vector2 Fighting()
        {
            World world = runner.World;
            Vector2 sum = Vector2.zero;
            int n = 0;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0 || world.target[slot] == World.NO_ENTITY) continue;
                sum += new Vector2(Ground.F(world.posX[slot]), Ground.F(world.posY[slot]));
                n++;
            }
            if (n > 0) return NearestTo(sum / n, -1, false);
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0 || world.TypeOf(slot).damage == 0 || world.entityType[slot] == Kind.Villager) continue;
                sum += new Vector2(Ground.F(world.posX[slot]), Ground.F(world.posY[slot]));
                n++;
            }
            return n > 0 ? NearestTo(sum / n, -1, false) : TownOf(1);
        }

        /// <summary>The place of the unit nearest a point, so the camera looks at someone and not at the gap between two crowds.</summary>
        Vector2 NearestTo(Vector2 point, int player, bool workers)
        {
            World world = runner.World;
            Vector2 best = point;
            float bestDistance = float.MaxValue;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0) continue;
                if (player != -1 && world.owner[slot] != player) continue;
                if (workers && world.job[slot] != Job.Harvesting) continue;
                if (!workers && world.target[slot] == World.NO_ENTITY && world.entityType[slot] == Kind.Villager) continue;
                var at = new Vector2(Ground.F(world.posX[slot]), Ground.F(world.posY[slot]));
                float distance = (at - point).sqrMagnitude;
                if (distance >= bestDistance) continue;
                bestDistance = distance;
                best = at;
            }
            return best;
        }

        IEnumerator Look(string name, int player, float distance)
        {
            return LookAt(name, TownOf(player), distance);
        }

        IEnumerator LookAt(string name, Vector2 tile, float distance)
        {
            view.distance = distance;
            view.LookAt(tile.x, tile.y);
            // Two frames: one for the camera to settle and one drawn from where it now is.
            yield return null;
            yield return null;
            Shoot(name);
        }

        void Shoot(string name)
        {
            var target = new RenderTexture(1920, 1080, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
            RenderTexture before = lens.targetTexture;
            lens.targetTexture = target;
            lens.Render();
            lens.targetTexture = before;
            RenderTexture active = RenderTexture.active;
            RenderTexture.active = target;
            var picture = new Texture2D(target.width, target.height, TextureFormat.RGB24, false);
            picture.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
            picture.Apply();
            RenderTexture.active = active;
            File.WriteAllBytes(Path.Combine(folder, name + ".png"), picture.EncodeToPNG());
            Object.Destroy(picture);
            target.Release();
            Object.Destroy(target);
        }
    }
}
