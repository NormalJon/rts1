// Mailed spearman, c. 1100: conical helm with nasal, knee-length hauberk over a tunic,
// kite shield, thrusting spear. Equipment follows the Bayeux Tapestry.
import { T, RX, RY } from '../math.mjs';
import { C } from '../palette.mjs';
import { makeRig, rigToNodes, arm, leg, idleClip, walkClip, keyedClip } from './figure.mjs';

export const KITE = [
  [-0.28, 0.26], [-0.2, 0.39], [0, 0.44], [0.2, 0.39], [0.28, 0.26],
  [0.24, -0.1], [0.12, -0.45], [0, -0.68], [-0.12, -0.45], [-0.24, -0.1],
];

export function build() {
  const rig = makeRig(101, {
    itemL: { name: 'shield', translation: [0.03, -0.34, 0.375] },
    itemR: { name: 'spear', translation: [0, -0.3, 0.29] },
  });

  // Hips: hauberk skirt, with the tunic hem showing below it in team colour.
  const hips = rig.hips.mb;
  hips.color(C.mail, 0.06).at(T(0, -0.36, 0), () => hips.frustum(0.52, 0.38, 0.45, 0.31, 0.42, { bottom: false }));
  hips.team().at(T(0, -0.47, 0), () => hips.frustum(0.56, 0.42, 0.52, 0.38, 0.12));
  hips.color(C.leather, 0.04).at(T(0, -0.01, 0), () => hips.box(0.48, 0.07, 0.34));

  // Torso: mail body and collar.
  const torso = rig.torso.mb;
  torso.color(C.mail, 0.06).frustum(0.45, 0.31, 0.56, 0.34, 0.46);
  torso.at(T(0, 0.44, 0), () => torso.box(0.3, 0.09, 0.28));

  // Head: mail coif framing the face, conical helm with a nasal bar.
  const head = rig.head.mb;
  const flat = Math.PI / 8; // turns the octagon so a flat faces forward
  head.color(C.mail, 0.05).at(T(0, 0, -0.01), () => head.cyl(0.17, 0.165, 0.3, 8, { phase: flat }));
  head.color(C.skin, 0.03).at(T(0, 0.05, 0.125), () => head.box(0.17, 0.18, 0.05));
  head.color(C.iron, 0.04).at(T(0, 0.21, -0.01), () => head.cyl(0.195, 0.19, 0.055, 8, { phase: flat }));
  head.color(C.steel, 0.06).at(T(0, 0.265, -0.01), () => head.cyl(0.18, 0, 0.3, 8, { bottom: false, phase: flat }));
  head.color(C.steel, 0.03).at(T(0, 0.08, 0.175), () => head.box(0.045, 0.17, 0.03));

  arm(rig.armL.mb, { upper: C.mail, lower: C.mail });
  arm(rig.armR.mb, { upper: C.mail, lower: C.mail });
  leg(rig.legL.mb, rig.shinL.mb, { hose: C.hose, wraps: C.wraps });
  leg(rig.legR.mb, rig.shinR.mb, { hose: C.hose, wraps: C.wraps });

  // Kite shield: team-colour face, leather-edged wooden back, iron boss.
  const sh = rig.itemL.mb;
  sh.at(RY(0.22), RX(-0.05), () => {
    sh.team().extrude(KITE, -0.02, 0.025, { back: false, sides: false });
    sh.color(C.leather, 0.05).extrude(KITE, -0.02, 0.025, { front: false, back: false });
    sh.color(C.timberMid, 0.05).extrude(KITE, -0.02, 0.025, { front: false, sides: false });
    sh.color(C.steel, 0.04).at(T(0, 0.12, 0.025), RX(Math.PI / 2), () => sh.cyl(0.075, 0.03, 0.05, 8, { bottom: false }));
  });

  // Spear: ash shaft, socketed leaf-shaped head. The node origin is the grip.
  const sp = rig.itemR.mb;
  sp.color(C.timberLight, 0.04).at(T(0, -1.06, 0), () => sp.cyl(0.024, 0.022, 2.26, 6));
  sp.color(C.steel, 0.04).at(T(0, 1.16, 0), () => sp.cyl(0.03, 0.022, 0.1, 6, { bottom: false }));
  sp.at(T(0, 1.26, 0), () => {
    sp.cyl(0.02, 0.07, 0.1, 4, { top: false, bottom: false });
    sp.at(T(0, 0.1, 0), () => sp.cyl(0.07, 0, 0.24, 4, { bottom: false }));
  });

  const root = rigToNodes(rig);

  const rest = { hips: [0, 0, 0], torso: [0, 0], head: 0, armL: 0, armR: 0, legL: 0, shinL: 0, legR: 0, shinR: 0, itemR: 0 };
  const level = (armR, pitch) => Math.PI / 2 - armR - pitch; // keeps the spear horizontal
  const attack = keyedClip(rig, 'attack', [
    { t: 0, ...rest },
    { t: 0.22, ...rest, hips: [0, -0.02, -0.02], torso: [0, -0.3], armR: 0.3, itemR: level(0.3, 0), legL: -0.15, legR: 0.1, head: 0.2 },
    { t: 0.4, ...rest, hips: [0, -0.03, -0.06], torso: [-0.05, -0.45], armR: 0.75, itemR: level(0.75, -0.05), legL: -0.2, legR: 0.15, head: 0.3 },
    { t: 0.5, hit: true, ...rest, hips: [0, -0.07, 0.22], torso: [0.2, 0.3], armL: -0.2, armR: -1.15, itemR: level(-1.15, 0.2), legL: -0.7, shinL: 0.6, legR: 0.5, shinR: 0.15, head: -0.15 },
    { t: 0.64, ...rest, hips: [0, -0.06, 0.2], torso: [0.18, 0.27], armL: -0.18, armR: -1.05, itemR: level(-1.05, 0.18), legL: -0.66, shinL: 0.56, legR: 0.46, shinR: 0.15, head: -0.15 },
    { t: 0.88, ...rest, hips: [0, -0.02, 0], torso: [0, -0.2], armR: 0.25, itemR: level(0.25, 0), legL: -0.1, legR: 0.05, head: 0.1 },
    { t: 1.1, ...rest },
  ], 22);

  return {
    id: 'spearman',
    label: 'Spearman',
    note: 'Nasal helm, mail hauberk, kite shield and spear, after the Bayeux Tapestry. Ten rigid parts, three clips.',
    yaw: 0.55,
    featured: true,
    roots: [root],
    animations: [idleClip(rig), walkClip(rig), attack],
  };
}
