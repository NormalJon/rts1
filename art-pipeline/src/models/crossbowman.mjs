// Crossbowman, c. 1350: kettle hat with a wide brim, a padded jack with sleeves in the
// owner's colour, a quiver of bolts at the belt and a pavise slung on the back. The crossbow
// is held level in both hands, its bow lying across in front of him, which with the brimmed
// hat is what tells him from the archer.
// The figure is the spearman's rig, with two parts added: the crossbow on the right hand and
// the bolt lying on it. Loosing takes the bolt off the tiller; the reload brings it back.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RY, RZ, qEuler, qMul, qConj } from '../math.mjs';
import { C } from '../palette.mjs';
import { makeRig, rigToNodes, arm, leg, idleClip, walkClip, keyedClip, jointQuat, samples } from './figure.mjs';

const LOOSE = 0.6, LOADED = 1.9, LENGTH = 2.2;
const X0 = 0.112; // the tiller lies this far inboard of the right hand, on the figure's middle line

export function build() {
  const rig = makeRig(351);
  const part = (name, translation, seed) => ({ name, translation, mb: new MeshBuilder(seed), children: [] });
  const bow = part('crossbow', [0, -0.3, 0.29], 371);
  const BOLT_ON = [X0, 0.036, 0.14], BOLT_OFF = [X0, -0.022, 0.02]; // on the tiller, or sunk out of sight inside it
  const bolt = part('bolt', BOLT_ON, 372);
  bow.children.push(bolt);
  rig.armR.children.push(bow);
  // Both forearms are turned in to hold the crossbow before the body; the figure rests that way.
  const HOLD_R = [0, 0.75, 0], HOLD_L = [0, -0.75, 0];
  rig.armR.rotation = jointQuat(HOLD_R);
  rig.armL.rotation = jointQuat(HOLD_L);
  bow.rotation = qConj(jointQuat(HOLD_R));

  // Hips: the jack's skirt, a belt, and a quiver of bolts at the right hip.
  const hips = rig.hips.mb;
  hips.color(C.sack, 0.06).at(T(0, -0.42, 0), () => hips.frustum(0.58, 0.44, 0.46, 0.32, 0.48));
  hips.color(C.leather, 0.04).at(T(0, -0.01, 0), () => hips.box(0.49, 0.07, 0.35));
  hips.at(T(-0.3, -0.36, -0.04), RX(-0.25), () => {
    hips.color(C.leather, 0.06).frustum(0.1, 0.09, 0.13, 0.11, 0.34);
    hips.color(C.linen, 0.08).at(T(0, 0.34, 0), () => hips.frustum(0.11, 0.09, 0.13, 0.1, 0.09, { bottom: false }));
  });

  // Torso: the padded jack, and on the back a pavise in the owner's colour with its rib.
  const torso = rig.torso.mb;
  torso.color(C.sack, 0.06).frustum(0.46, 0.32, 0.56, 0.35, 0.46);
  torso.color(C.linen, 0.05).at(T(0, 0.44, 0), () => torso.box(0.3, 0.07, 0.28, { bottom: false }));
  torso.at(T(0, -0.44, -0.235), RX(-0.07), () => {
    torso.team().box(0.54, 1.0, 0.05);
    torso.color(C.linen, 0.05).at(T(0, 0.04, -0.03), () => torso.box(0.11, 0.92, 0.03, { bottom: false }));
  });

  // Head: a padded coif under the kettle hat, an iron bowl on a wide brim.
  const head = rig.head.mb;
  const flat = Math.PI / 8;
  head.color(C.linen, 0.05).at(T(0, 0, -0.01), () => head.cyl(0.162, 0.156, 0.29, 8, { top: false, phase: flat }));
  head.color(C.skin, 0.03).at(T(0, 0.05, 0.116), () => head.box(0.17, 0.18, 0.05));
  head.color(C.iron, 0.05).at(T(0, 0.265, -0.01), () => head.cyl(0.33, 0.31, 0.04, 8, { phase: flat }));
  head.color(C.steel, 0.06).at(T(0, 0.305, -0.01), () => head.cyl(0.19, 0.11, 0.13, 8, { bottom: false, phase: flat }));

  arm(rig.armL.mb, { upper: 'team', lower: C.sack });
  arm(rig.armR.mb, { upper: 'team', lower: C.sack });
  leg(rig.legL.mb, rig.shinL.mb, { hose: C.hose, wraps: C.leather });
  leg(rig.legR.mb, rig.shinR.mb, { hose: C.hose, wraps: C.leather });

  // Crossbow: the origin is the trigger hand, the bolt flies along +Z. A wooden tiller, a
  // short stiff bow lashed across its head, the string drawn back to the nut, a stirrup.
  const cb = bow.mb;
  cb.color(C.timberMid, 0.06).at(T(X0, -0.055, 0.11), () => cb.box(0.06, 0.075, 0.78));
  cb.color(C.iron, 0.05);
  for (const s of [-1, 1]) cb.beam([X0, 0, 0.47], [X0 + s * 0.38, 0, 0.36], 0.05, 0.045);
  cb.color(C.linen, 0.03);
  for (const s of [-1, 1]) cb.rod([X0 + s * 0.37, 0.005, 0.355], [X0, 0.03, 0.12], 0.007, 3, { top: false, bottom: false });
  cb.color(C.iron, 0.05);
  for (const s of [-1, 1]) cb.rod([X0 + s * 0.055, -0.02, 0.5], [X0 + s * 0.055, -0.02, 0.63], 0.012, 3, { top: false, bottom: false });
  cb.beam([X0 - 0.07, -0.02, 0.63], [X0 + 0.07, -0.02, 0.63], 0.025, 0.025);
  // The bolt: short and thick, with two vanes.
  bolt.mb.color(C.timberLight, 0.05).rod([0, 0, 0], [0, 0, 0.32], 0.011, 3, { top: false });
  bolt.mb.color(C.steel, 0.05).rod([0, 0, 0.3], [0, 0, 0.37], 0.02, 4, { rt: 0 });
  bolt.mb.color(C.linen, 0.06);
  const vane = [[-0.026, 0, 0.01], [0.026, 0, 0.01], [0.026, 0, 0.1], [-0.026, 0, 0.1]];
  bolt.mb.poly(vane).poly([...vane].reverse());

  const root = rigToNodes(rig);

  // ---- Animation ----------------------------------------------------------------------
  // The pose carries `aim`, the crossbow's tilt in the world: 0 is level, a quarter turn
  // stands it on its nose. It is set against the torso and arm above it, so it stays put
  // however they move.
  const bowTurn = (p) => qMul(qConj(qMul(qEuler(p.torso[0], p.torso[1], 0), jointQuat(p.armR))), qEuler(p.aim, 0, 0));
  const crossbow = (times, shooting = false) => {
    // The bolt is on the tiller except between the loose and the end of the reload.
    const on = (t) => !shooting || t <= LOOSE || t > LOADED;
    const boltTimes = shooting ? [...times, LOOSE + 0.0001, LOADED + 0.0001].sort((a, b) => a - b) : times;
    return [
      { part: bow, path: 'rotation', value: bowTurn },
      { part: bolt, path: 'translation', times: boltTimes, value: (p, t) => (on(t) ? BOLT_ON : BOLT_OFF) },
    ];
  };
  const held = (p) => ({ armR: [p.armR, HOLD_R[1], 0], armL: [p.armL * 0.5, HOLD_L[1], 0], aim: 0 });

  const rest = {
    hips: [0, 0, 0], torso: [0, 0], head: 0, armL: HOLD_L, armR: HOLD_R, legL: 0, shinL: 0, legR: 0, shinR: 0, aim: 0,
  };
  const aimed = { hips: [0, -0.01, 0], torso: [-0.03, -0.12], head: 0.1, armR: [-0.95, 0.5, 0], armL: [-0.95, -0.5, 0], legL: -0.14, legR: 0.1 };
  // Stooped over the crossbow stood on its nose, a foot in the stirrup.
  const stooped = { hips: [0, -0.2, 0.03], torso: [1.0, 0], armR: [0.5, 0.42, 0], armL: [0.5, -0.42, 0], legL: 0.12, shinL: 0.35, legR: -0.38, shinR: 0.75, aim: Math.PI / 2 };
  const keys = [
    { t: 0, ...rest },
    { t: 0.3, ...rest, ...aimed },
    { t: 0.55, ...rest, ...aimed },
    { t: LOOSE, hit: true, ...rest, ...aimed, torso: [-0.07, -0.12], aim: -0.07 },
    { t: 0.78, ...rest, ...aimed, torso: [-0.04, -0.1], aim: -0.03 },
    { t: 1.1, ...rest, ...stooped },
    { t: 1.2, ...rest, ...stooped },
    // The span: both hands haul the string up to the nut.
    { t: 1.5, ...rest, ...stooped, hips: [0, -0.15, 0.03], torso: [0.82, 0], armR: [0.1, 0.42, 0], armL: [-0.2, -0.42, 0] },
    { t: 1.62, ...rest, ...stooped, hips: [0, -0.15, 0.03], torso: [0.82, 0], armR: [0.1, 0.42, 0], armL: [-0.2, -0.42, 0] },
    { t: 1.95, ...rest, torso: [0.08, 0.05], armL: [-0.3, -0.75, 0] },
    { t: LENGTH, ...rest },
  ];
  const attack = keyedClip(rig, 'attack', keys, 44, crossbow(samples(LENGTH, 44), true));
  const idle = idleClip(rig, 0, { also: held, extra: crossbow(samples(3.2, 16)) });
  const walk = walkClip(rig, 0, { also: held, extra: crossbow(samples(0.9, 16)) });

  return {
    id: 'crossbowman',
    label: 'Crossbowman',
    note: 'Kettle hat, padded jack, a pavise on the back and the crossbow held level. He looses at 0.6 s, then stoops with a foot in the stirrup to span it again.',
    yaw: 0.55,
    roots: [root],
    animations: [idle, walk, attack],
  };
}
