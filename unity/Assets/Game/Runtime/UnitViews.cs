using System;
using System.Collections.Generic;
using Rts.Sim;
using UnityEngine;

namespace Rts.Game
{
    /// <summary>
    /// The units: a copy of its model for each one alive, moved, turned and
    /// posed every frame from what the simulation says of it. Between ticks a
    /// unit is drawn part-way from where it was to where it now is, so
    /// movement is smooth at any frame rate.
    /// </summary>
    public sealed class UnitViews
    {
        /// <summary>How long the fallen lie where they fell, in seconds.</summary>
        const float FALLEN_SECONDS = 9f;
        /// <summary>How fast a unit turns to face the way the simulation has it facing, in radians a second.</summary>
        const float TURN_RATE = 11f;

        const byte CLIP_IDLE = 0;
        const byte CLIP_WALK = 1;
        const byte CLIP_WORK = 2;
        const byte CLIP_STRIKE = 3;
        const byte CLIP_NONE = 255;

        sealed class Fallen
        {
            public GameObject body;
            public float x;
            public float y;
            public float yaw;
            public float born;
        }

        readonly World world;
        readonly Ground ground;
        readonly ModelLibrary library;
        readonly ModelMaterials materials;
        readonly Transform parent;

        // Per-unit display state, by slot.
        readonly float[] prevX;
        readonly float[] prevY;
        /// <summary>The way each is drawn facing: an angle in radians, 0 for south, turning toward east.</summary>
        readonly float[] yaw;
        readonly float[] animTime;
        readonly byte[] clipOf;
        /// <summary>Who was last drawn in each slot (-1 for nobody), to notice arrivals and deaths.</summary>
        readonly int[] shownId;
        readonly float[] drawnX;
        readonly float[] drawnY;
        readonly GameObject[] bodies;
        readonly ModelLibrary.UnitModel[] models;
        readonly List<Fallen> fallen = new List<Fallen>();

        public int Count { get; private set; }

        public UnitViews(World world, Ground ground, ModelLibrary library, ModelMaterials materials, Transform parent)
        {
            this.world = world;
            this.ground = ground;
            this.library = library;
            this.materials = materials;
            this.parent = new GameObject("Units").transform;
            this.parent.SetParent(parent, false);
            int n = world.config.maxEntities;
            prevX = new float[n];
            prevY = new float[n];
            yaw = new float[n];
            animTime = new float[n];
            clipOf = new byte[n];
            shownId = new int[n];
            drawnX = new float[n];
            drawnY = new float[n];
            bodies = new GameObject[n];
            models = new ModelLibrary.UnitModel[n];
            for (int slot = 0; slot < n; slot++) shownId[slot] = -1;
            RememberPositions();
        }

        /// <summary>Where a unit was drawn this frame, in tiles.</summary>
        public float DrawnX(int slot) => drawnX[slot];
        public float DrawnY(int slot) => drawnY[slot];

        /// <summary>
        /// Takes away, without ceremony, the bodies of those who died while
        /// nothing was being drawn. Call after running the match on a long way
        /// in one go: nobody saw them fall, so nobody should see them topple
        /// now, wherever they last happened to be drawn.
        /// </summary>
        public void DropTheDead()
        {
            for (int slot = 0; slot < shownId.Length; slot++)
            {
                int id = shownId[slot];
                if (id == -1 || world.IsAlive(id)) continue;
                shownId[slot] = -1;
                if (bodies[slot] != null) UnityEngine.Object.Destroy(bodies[slot]);
                bodies[slot] = null;
            }
        }

        /// <summary>Call just before each simulation tick, so drawing can blend from here to the new positions.</summary>
        public void RememberPositions()
        {
            for (int slot = 0; slot < world.highWater; slot++)
            {
                prevX[slot] = Ground.F(world.posX[slot]);
                prevY[slot] = Ground.F(world.posY[slot]);
            }
        }

        public void Draw(float alpha, float dt, float seconds, Overlays overlays)
        {
            int tickRate = world.config.tickRate;
            float tickSeconds = 1f / tickRate;

            // Anyone drawn last frame who is no longer alive has fallen.
            for (int slot = 0; slot < shownId.Length; slot++)
            {
                int id = shownId[slot];
                if (id == -1)
                {
                    if (slot >= world.highWater) break;
                    continue;
                }
                if (world.IsAlive(id)) continue;
                shownId[slot] = -1;
                GameObject body = bodies[slot];
                bodies[slot] = null;
                if (body == null) continue;
                if (fallen.Count < 600)
                {
                    if (models[slot].idle != null) models[slot].idle.SampleAnimation(body, 0f);
                    fallen.Add(new Fallen { body = body, x = drawnX[slot], y = drawnY[slot], yaw = yaw[slot], born = seconds });
                }
                else
                {
                    UnityEngine.Object.Destroy(body);
                }
            }

            int count = 0;
            for (int slot = 0; slot < world.highWater; slot++)
            {
                if (world.alive[slot] == 0 || world.mobile[slot] == 0) continue;
                int typeId = world.entityType[slot];
                EntityType type = world.TypeOf(slot);
                float curX = Ground.F(world.posX[slot]);
                float curY = Ground.F(world.posY[slot]);
                float facing = Mathf.Atan2(Ground.F(world.dirX[slot]), Ground.F(world.dirY[slot]));
                int id = world.IdAt(slot);
                if (shownId[slot] != id)
                {
                    // A newcomer in this slot: there is nowhere to blend from.
                    ModelLibrary.UnitModel fresh = library.UnitFor(typeId);
                    if (fresh == null) continue;
                    if (bodies[slot] != null) UnityEngine.Object.Destroy(bodies[slot]);
                    bodies[slot] = Raise(fresh, type.name + " " + id, world.owner[slot]);
                    models[slot] = fresh;
                    shownId[slot] = id;
                    prevX[slot] = curX;
                    prevY[slot] = curY;
                    yaw[slot] = facing;
                    clipOf[slot] = CLIP_NONE;
                }
                ModelLibrary.UnitModel model = models[slot];
                float x = prevX[slot] + (curX - prevX[slot]) * alpha;
                float y = prevY[slot] + (curY - prevY[slot]) * alpha;
                drawnX[slot] = x;
                drawnY[slot] = y;

                // Turn smoothly toward the simulation's facing.
                float turn = Mathf.DeltaAngle(yaw[slot] * Mathf.Rad2Deg, facing * Mathf.Rad2Deg) * Mathf.Deg2Rad;
                float maxTurn = TURN_RATE * dt;
                yaw[slot] += Mathf.Clamp(turn, -maxTurn, maxTurn);

                // Walk when covering ground, at a pace that matches it.
                float stepX = curX - prevX[slot];
                float stepY = curY - prevY[slot];
                float speed = Mathf.Sqrt(stepX * stepX + stepY * stepY) / tickSeconds;
                float nominal = Ground.F(world.speed[slot]) / tickSeconds;
                bool walking = speed > nominal * 0.2f;
                AnimationClip clip = model.idle;
                byte clipCode = CLIP_IDLE;
                float clipTime = -1f;
                if (walking)
                {
                    clip = model.walk;
                    clipCode = CLIP_WALK;
                }
                else
                {
                    // A blow is drawn from the simulation's own count of it, so the spear
                    // lands on the tick the damage does, whatever the frame rate.
                    AnimationClip strike = model.attack != null ? model.attack : model.chop;
                    int windup = world.windup[slot];
                    int cooldown = world.cooldown[slot];
                    if (strike != null && type.damage > 0 && (windup > 0 || cooldown > 0))
                    {
                        int lead = EntityTypes.TicksOf(type.windup, tickRate);
                        int rest = Math.Max(1, EntityTypes.TicksOf(type.cycle, tickRate) - lead);
                        float elapsed = (windup > 0 ? lead - windup : lead + rest - cooldown) - 1 + alpha;
                        float at = Mathf.Max(0f, elapsed) * tickSeconds;
                        if (at < strike.length)
                        {
                            clip = strike;
                            clipCode = CLIP_STRIKE;
                            clipTime = at;
                        }
                    }
                    // Villagers swing their axe at whatever they are gathering or building, for now.
                    int job = world.job[slot];
                    if (clipTime < 0f && (job == Job.Harvesting || job == Job.Constructing) && model.chop != null)
                    {
                        clip = model.chop;
                        clipCode = CLIP_WORK;
                    }
                }
                if (clipCode != clipOf[slot])
                {
                    clipOf[slot] = clipCode;
                    // Each starts at its own point in the clip, so that a line of men does not move as one.
                    animTime[slot] = (slot * 0.37f) % 1f;
                }
                animTime[slot] += dt * (walking ? Mathf.Max(0.5f, nominal > 0f ? speed / nominal : 1f) : 1f);
                if (clip != null)
                {
                    if (clipTime < 0f) clipTime = clip.length > 0f ? animTime[slot] % clip.length : 0f;
                    clip.SampleAnimation(bodies[slot], clipTime);
                }

                Transform at2 = bodies[slot].transform;
                Vector3 place = ground.Place(x, y);
                at2.SetPositionAndRotation(place, Quaternion.Euler(0f, 180f - yaw[slot] * Mathf.Rad2Deg, 0f));
                count++;

                int hp = world.hp[slot];
                if (hp < type.hp)
                {
                    // Over the head, not over the tip of a spear or lance.
                    float head = Mathf.Min(model.height, type.charge > 0 ? 2.9f : 2.1f);
                    float radius = Ground.F(world.radius[slot]) * Ground.TILE;
                    overlays.AddBar(new Vector3(place.x, place.y + head + 0.35f, place.z), Mathf.Max(1f, radius * 2.4f), (float)hp / type.hp);
                }
            }
            Count = count;

            // The fallen topple backward, lie a while, and sink into the ground.
            for (int i = fallen.Count - 1; i >= 0; i--)
            {
                Fallen body = fallen[i];
                float age = seconds - body.born;
                if (age > FALLEN_SECONDS)
                {
                    UnityEngine.Object.Destroy(body.body);
                    fallen.RemoveAt(i);
                    continue;
                }
                float over = Mathf.Min(1f, age / 0.45f);
                float tilt = over * over * (3f - 2f * over) * 90f;
                float sink = Mathf.Max(0f, age - (FALLEN_SECONDS - 3f)) * 0.2f;
                body.body.transform.SetPositionAndRotation(
                    ground.Place(body.x, body.y, 0.1f * over - sink),
                    Quaternion.Euler(0f, 180f - body.yaw * Mathf.Rad2Deg, 0f) * Quaternion.Euler(-tilt, 0f, 0f));
            }
        }

        GameObject Raise(ModelLibrary.UnitModel model, string name, int owner)
        {
            GameObject body = UnityEngine.Object.Instantiate(model.prefab, parent);
            body.name = name;
            // The clips are posed by hand each frame; nothing should play them of its own accord.
            foreach (Animation animation in body.GetComponentsInChildren<Animation>(true)) animation.enabled = false;
            foreach (Animator animator in body.GetComponentsInChildren<Animator>(true)) animator.enabled = false;
            materials.Dress(body, owner);
            return body;
        }
    }
}
