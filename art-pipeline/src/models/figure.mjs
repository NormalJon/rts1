// Stylised human figure built from rigid parts in a node hierarchy, so it can be animated
// with plain node rotations (no skinning). Faces +Z; the figure's left is +X.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, qEuler } from '../math.mjs';
import { C } from '../palette.mjs';

const HIP_Y = 0.92;

/** Create the joint hierarchy with an empty MeshBuilder on each part. */
export function makeRig(seed, { itemL = null, itemR = null } = {}) {
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

/**
 * Build a clip from a pose function. pose(t) returns angles in radians for time t:
 *   { hips:[dx,dy,dz], torso:[pitch,yaw], head, armL, armR, legL, shinL, legR, shinR, itemR }
 * Every clip keys every animated joint, so switching clips never leaves a stale pose.
 */
export function clip(rig, name, times, pose) {
  const P = times.map((t) => ({
    hips: [0, 0, 0], torso: [0, 0], head: 0, armL: 0, armR: 0, legL: 0, shinL: 0, legR: 0, shinR: 0, itemR: 0,
    ...pose(t),
  }));
  const rot = (part, f) => ({ node: part.node, path: 'rotation', times, values: P.map(f) });
  const channels = [
    { node: rig.hips.node, path: 'translation', times, values: P.map((p) => [p.hips[0], HIP_Y + p.hips[1], p.hips[2]]) },
    rot(rig.torso, (p) => qEuler(p.torso[0], p.torso[1], 0)),
    rot(rig.head, (p) => qEuler(0, p.head, 0)),
    rot(rig.armL, (p) => qEuler(p.armL, 0, 0)),
    rot(rig.armR, (p) => qEuler(p.armR, 0, 0)),
    rot(rig.legL, (p) => qEuler(p.legL, 0, 0)),
    rot(rig.shinL, (p) => qEuler(p.shinL, 0, 0)),
    rot(rig.legR, (p) => qEuler(p.legR, 0, 0)),
    rot(rig.shinR, (p) => qEuler(p.shinR, 0, 0)),
  ];
  if (rig.itemR) channels.push(rot(rig.itemR, (p) => qEuler(p.itemR, 0, 0)));
  return { name, channels };
}

const samples = (duration, n) => Array.from({ length: n + 1 }, (_, i) => +((duration * i) / n).toFixed(4));

/** Breathing and a slow look around. itemRest is the held item's resting tilt. */
export function idleClip(rig, itemRest = 0) {
  const D = 3.2;
  return clip(rig, 'idle', samples(D, 16), (t) => {
    const p = (t / D) * TAU;
    const armR = 0.03 * Math.sin(p + 1);
    return {
      hips: [0, 0.004 * Math.sin(p), 0],
      torso: [0.014 * Math.sin(p), 0.03 * Math.sin(p * 0.5)],
      head: 0.2 * Math.sin(p),
      armL: 0.025 * Math.sin(p + 2),
      armR,
      itemR: itemRest - armR,
    };
  });
}

export function walkClip(rig, itemRest = 0) {
  const D = 0.9, A = 0.5, K = 0.95;
  return clip(rig, 'walk', samples(D, 16), (t) => {
    const p = (t / D) * TAU;
    const s = Math.sin(p), c = Math.cos(p);
    const armR = -0.1 * s;
    return {
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
  });
}

/** Interpolate between hand-set key poses, then sample evenly so playback is smooth. */
export function keyedClip(rig, name, keys, n = 20) {
  const D = keys[keys.length - 1].t;
  const smooth = (x) => x * x * (3 - 2 * x);
  const mix = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * k) : a + (b - a) * k);
  return clip(rig, name, samples(D, n), (t) => {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    const k = smooth(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
    const out = {};
    for (const key of Object.keys(a)) if (key !== 't') out[key] = mix(a[key], b[key], k);
    return out;
  });
}

