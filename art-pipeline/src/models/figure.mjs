// Stylised human figure built from rigid parts in a node hierarchy, so it can be animated
// with plain node rotations (no skinning). Faces +Z; the figure's left is +X.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, qEuler } from '../math.mjs';
import { C } from '../palette.mjs';

const HIP_Y = 0.92;

/**
 * Create the joint hierarchy with an empty MeshBuilder on each part. With `turn` the whole
 * figure can swing about its own axis in a clip, as an archer does to stand side on.
 */
export function makeRig(seed, { itemL = null, itemR = null, turn = false } = {}) {
  let s = seed;
  const part = (name, translation, children = []) => ({ name, translation, mb: new MeshBuilder(s++), children });
  const rig = {};
  rig.shinL = part('shin_L', [0, -0.42, 0]);
  rig.shinR = part('shin_R', [0, -0.42, 0]);
  rig.legL = part('leg_L', [0.13, -0.07, 0], [rig.shinL]);
  rig.legR = part('leg_R', [-0.13, -0.07, 0], [rig.shinR]);
  rig.itemL = itemL ? part(itemL.name, itemL.translation) : null;
  rig.itemR = itemR ? part(itemR.name, itemR.translation) : null;
  if (rig.itemL && itemL.rotation) rig.itemL.rotation = itemL.rotation;
  if (rig.itemR && itemR.rotation) rig.itemR.rotation = itemR.rotation;
  rig.armL = part('arm_L', [0.31, 0.42, 0], rig.itemL ? [rig.itemL] : []);
  rig.armR = part('arm_R', [-0.31, 0.42, 0], rig.itemR ? [rig.itemR] : []);
  rig.head = part('head', [0, 0.5, 0]);
  rig.torso = part('torso', [0, 0.06, 0], [rig.head, rig.armL, rig.armR]);
  rig.hips = part('hips', [0, HIP_Y, 0], [rig.torso, rig.legL, rig.legR]);
  rig.root = { name: 'root', children: [rig.hips] };
  rig.turn = turn;
  return rig;
}

/** Convert the rig into plain nodes for the GLB writer. */
export function rigToNodes(rig) {
  const convert = (p) => {
    const node = { name: p.name };
    if (p.translation) node.translation = p.translation;
    if (p.rotation) node.rotation = p.rotation;
    if (p.mb && p.mb.triangleCount() > 0) node.mesh = p.mb.toMesh(p.name);
    node.children = (p.children ?? []).map(convert);
    p.node = node;
    return node;
  };
  return convert(rig.root);
}

// ---- Shared body parts -------------------------------------------------------------

/** One arm: upper arm hanging, forearm bent forward, bare hand. A colour of 'team' uses TeamColor. */
export function arm(mb, { upper, lower, upperVary = 0.05 }) {
  const paint = (c) => (c === 'team' ? mb.team() : mb.color(c, upperVary));
  paint(upper).at(T(0, -0.3, 0), () => mb.frustum(0.12, 0.13, 0.14, 0.15, 0.32));
  paint(lower).at(T(0, -0.3, 0.02), RX(Math.PI / 2), () => mb.frustum(0.12, 0.12, 0.1, 0.1, 0.29));
  mb.color(C.skin, 0.03).at(T(0, -0.355, 0.29), () => mb.box(0.1, 0.11, 0.1));
}

export function leg(thigh, shin, { hose, wraps }) {
  thigh.color(hose, 0.05).at(T(0, -0.44, 0), () => thigh.frustum(0.16, 0.17, 0.19, 0.2, 0.46));
  shin.color(wraps, 0.06).at(T(0, -0.36, 0), () => shin.frustum(0.125, 0.135, 0.16, 0.17, 0.38));
  shin.color(C.leather, 0.05).at(T(0, -0.43, 0.045), () => shin.box(0.14, 0.09, 0.27));
}

// ---- Animation ---------------------------------------------------------------------

const TAU = Math.PI * 2;

/** A joint angle as a rotation: a number is a pitch about X, an array is [pitch, yaw, roll]. */
export const jointQuat = (v) => (Array.isArray(v) ? qEuler(v[0], v[1] ?? 0, v[2] ?? 0) : qEuler(v, 0, 0));

/**
 * Build a clip from a pose function. pose(t) returns angles in radians for time t:
 *   { hips:[dx,dy,dz], torso:[pitch,yaw], head, armL, armR, legL, shinL, legR, shinR, itemR, turn }
 * An arm or item angle may also be [pitch, yaw, roll]. Every clip keys every animated joint,
 * so switching clips never leaves a stale pose.
 * `extra` adds channels for parts beyond the figure: [{ part, path, value(pose, t), times? }].
 * Its poses may carry further keys of their own; with its own `times` a channel can jump
 * between two closely spaced keys instead of gliding.
 */
export function clip(rig, name, times, pose, extra = []) {
  const at = (t) => ({
    hips: [0, 0, 0], torso: [0, 0], head: 0, armL: 0, armR: 0, legL: 0, shinL: 0, legR: 0, shinR: 0, itemR: 0, turn: 0,
    ...pose(t),
  });
  const P = times.map(at);
  const rot = (part, f) => ({ node: part.node, path: 'rotation', times, values: P.map(f) });
  const channels = [
    { node: rig.hips.node, path: 'translation', times, values: P.map((p) => [p.hips[0], HIP_Y + p.hips[1], p.hips[2]]) },
    rot(rig.torso, (p) => qEuler(p.torso[0], p.torso[1], 0)),
    rot(rig.head, (p) => qEuler(0, p.head, 0)),
    rot(rig.armL, (p) => jointQuat(p.armL)),
    rot(rig.armR, (p) => jointQuat(p.armR)),
    rot(rig.legL, (p) => qEuler(p.legL, 0, 0)),
    rot(rig.shinL, (p) => qEuler(p.shinL, 0, 0)),
    rot(rig.legR, (p) => qEuler(p.legR, 0, 0)),
    rot(rig.shinR, (p) => qEuler(p.shinR, 0, 0)),
  ];
  if (rig.itemR) channels.push(rot(rig.itemR, (p) => jointQuat(p.itemR)));
  if (rig.turn) channels.push(rot(rig.hips, (p) => qEuler(0, p.turn, 0)));
  for (const e of extra) {
    const ts = e.times ?? times;
    channels.push({ node: e.part.node, path: e.path, times: ts, values: ts.map((t) => e.value(at(t), t)) });
  }
  return { name, channels };
}

/**
 * A clip for any hierarchy of rigid parts: pose(t) returns whatever numbers the rig needs,
 * and each binding { part, path, value(pose, t) } turns them into one channel.
 */
export function sampledClip(name, times, pose, bindings) {
  const P = times.map(pose);
  return { name, channels: bindings.map((b) => ({ node: b.part.node, path: b.path, times, values: P.map((p, i) => b.value(p, times[i])) })) };
}

/** n + 1 evenly spaced sample times from 0 to `duration`. */
export const samples = (duration, n) => Array.from({ length: n + 1 }, (_, i) => +((duration * i) / n).toFixed(4));

/**
 * Breathing and a slow look around. itemRest is the held item's resting tilt. `also(pose, t)`
 * returns changes to the pose, and `extra` is passed on to clip().
 */
export function idleClip(rig, itemRest = 0, { also = null, extra = [] } = {}) {
  const D = 3.2;
  return clip(rig, 'idle', samples(D, 16), (t) => {
    const p = (t / D) * TAU;
    const armR = 0.03 * Math.sin(p + 1);
    const pose = {
      hips: [0, 0.004 * Math.sin(p), 0],
      torso: [0.014 * Math.sin(p), 0.03 * Math.sin(p * 0.5)],
      head: 0.2 * Math.sin(p),
      armL: 0.025 * Math.sin(p + 2),
      armR,
      itemR: itemRest - armR,
    };
    return also ? { ...pose, ...also(pose, t) } : pose;
  }, extra);
}

export function walkClip(rig, itemRest = 0, { also = null, extra = [] } = {}) {
  const D = 0.9, A = 0.5, K = 0.95;
  return clip(rig, 'walk', samples(D, 16), (t) => {
    const p = (t / D) * TAU;
    const s = Math.sin(p), c = Math.cos(p);
    const armR = -0.1 * s;
    const pose = {
      hips: [0, -0.016 * (1 - Math.cos(2 * p)), 0],
      torso: [0.04, 0.07 * s],
      head: -0.05 * s,
      legL: -A * s,
      legR: A * s,
      shinL: K * Math.max(0, c) ** 1.3,
      shinR: K * Math.max(0, -c) ** 1.3,
      armL: 0.08 * s,
      armR,
      itemR: itemRest - armR + 0.05,
    };
    return also ? { ...pose, ...also(pose, t) } : pose;
  }, extra);
}

/**
 * A pose function that eases between hand-set key poses, [{ t, ...angles }]. Keys may hold
 * any numbers or arrays of numbers, as long as every key holds the same ones. The key marked
 * `hit: true` is the instant the blow lands or the arrow leaves.
 */
export function keyframes(keys) {
  const smooth = (x) => x * x * (3 - 2 * x);
  const mix = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * k) : a + (b - a) * k);
  return (t) => {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    const k = smooth(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
    const out = {};
    for (const key of Object.keys(a)) if (key !== 't' && key !== 'hit') out[key] = mix(a[key], b[key], k);
    return out;
  };
}

/** The time of the key marked `hit: true`, or undefined. */
export const hitTime = (keys) => keys.find((k) => k.hit)?.t;

/** Interpolate between hand-set key poses, then sample evenly so playback is smooth. */
export function keyedClip(rig, name, keys, n = 20, extra = []) {
  const D = keys[keys.length - 1].t;
  const out = clip(rig, name, samples(D, n), keyframes(keys), extra);
  const hit = hitTime(keys);
  if (hit !== undefined) out.hit = hit;
  return out;
}

