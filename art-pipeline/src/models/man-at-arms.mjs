// Man-at-arms, c. 1200: the heavy foot soldier of the High Middle Ages. Mail from head to
// foot, a flat-topped great helm that closes the face, a heater shield in the owner's colour
// and an arming sword; no spear. Darker and broader than the spearman, and all metal but for
// the shield, the hem of his coat and the painted crown of the helm.
// The figure is the spearman's rig, with the same ten parts.
import { T, RX, RY } from '../math.mjs';
import { C } from '../palette.mjs';
import { makeRig, rigToNodes, arm, leg, idleClip, walkClip, keyedClip } from './figure.mjs';
import { paintHeater, paintGreatHelm } from './gear.mjs';

const CARRY = 0.55; // the sword's lean forward from upright when it is only carried

export function build() {
  const rig = makeRig(301, {
    itemL: { name: 'shield', translation: [0.03, -0.32, 0.375] },
    itemR: { name: 'sword', translation: [0, -0.3, 0.29] },
  });

  // Hips: the hauberk's skirt to the knee, the hem of the coat under it showing in the owner's
  // colour, a sword belt and the scabbard at the left hip.
  const hips = rig.hips.mb;
  hips.color(C.mailDark, 0.06).at(T(0, -0.5, 0), () => hips.frustum(0.6, 0.45, 0.47, 0.33, 0.56));
  hips.team().at(T(0, -0.58, 0), () => hips.frustum(0.58, 0.43, 0.58, 0.43, 0.09, { top: false }));
  hips.color(C.leather, 0.04).at(T(0, -0.02, 0), () => hips.box(0.5, 0.08, 0.36));
  hips.color(C.leather, 0.05).beam([0.27, -0.04, 0.06], [0.33, -0.6, -0.22], 0.05, 0.07);

  // Torso: mail over padding, broad across the shoulders.
  const torso = rig.torso.mb;
  torso.color(C.mailDark, 0.06).frustum(0.47, 0.33, 0.62, 0.37, 0.46);
  torso.at(T(0, 0.43, 0), () => torso.frustum(0.66, 0.36, 0.34, 0.3, 0.1, { bottom: false }));

  paintGreatHelm(rig.head.mb);
  arm(rig.armL.mb, { upper: C.mailDark, lower: C.mailDark });
  arm(rig.armR.mb, { upper: C.mailDark, lower: C.mailDark });
  leg(rig.legL.mb, rig.shinL.mb, { hose: C.mailDark, wraps: C.mailDark });
  leg(rig.legR.mb, rig.shinR.mb, { hose: C.mailDark, wraps: C.mailDark });
  // Knee cops over the mail.
  for (const shin of [rig.shinL.mb, rig.shinR.mb]) shin.color(C.steel, 0.05).at(T(0, -0.05, 0.03), () => shin.frustum(0.17, 0.16, 0.13, 0.1, 0.1, { bottom: false }));

  rig.itemL.mb.at(RY(0.22), RX(-0.05), () => paintHeater(rig.itemL.mb));

  // Arming sword: the node origin is the grip, the blade runs up +Y with its edges fore and aft.
  const sw = rig.itemR.mb;
  sw.color(C.leather, 0.05).at(T(0, -0.09, 0), () => sw.box(0.035, 0.17, 0.035, { top: false, bottom: false }));
  sw.color(C.iron, 0.05).at(T(0, -0.14, 0), () => sw.cyl(0.04, 0.04, 0.05, 5));
  sw.at(T(0, 0.08, 0), () => sw.box(0.04, 0.035, 0.24));
  sw.color(C.steel, 0.05).at(T(0, 0.115, 0), () => sw.frustum(0.018, 0.07, 0.012, 0.045, 0.7, { bottom: false }));
  sw.at(T(0, 0.815, 0), () => sw.frustum(0.012, 0.045, 0.004, 0.004, 0.09, { bottom: false }));

  const root = rigToNodes(rig);

  const rest = { hips: [0, 0, 0], torso: [0, 0], head: 0, armL: 0, armR: 0, legL: 0, shinL: 0, legR: 0, shinR: 0, itemR: CARRY };
  // A cut from over the right shoulder, stepping in with the left foot. It lands at 0.5 s.
  const struck = { hips: [0, -0.07, 0.17], torso: [0.3, 0.32], armL: -0.2, armR: -0.55, itemR: 1.95, legL: -0.62, shinL: 0.52, legR: 0.42, shinR: 0.12, head: -0.15 };
  const attack = keyedClip(rig, 'attack', [
    { t: 0, ...rest },
    { t: 0.24, ...rest, hips: [0, 0.01, -0.03], torso: [-0.1, -0.3], armL: -0.3, armR: -2.2, itemR: 0.75, legL: -0.14, legR: 0.1, head: 0.2 },
    { t: 0.4, ...rest, hips: [0, 0.01, -0.05], torso: [-0.15, -0.4], armL: -0.38, armR: -2.5, itemR: 0.95, legL: -0.18, legR: 0.13, head: 0.26 },
    { t: 0.5, hit: true, ...rest, ...struck },
    { t: 0.66, ...rest, ...struck, hips: [0, -0.06, 0.15], torso: [0.27, 0.28], itemR: 2.05 },
    { t: 0.95, ...rest, hips: [0, -0.01, 0.02], torso: [0.04, -0.1], armR: -0.2, itemR: 0.95, legL: -0.1, legR: 0.06 },
    { t: 1.2, ...rest },
  ], 24);

  return {
    id: 'man-at-arms',
    label: 'Man-at-arms',
    note: 'Heavy foot of c. 1200: mail to the feet, a flat-topped great helm, heater shield and arming sword. The cut lands at 0.5 s.',
    yaw: 0.55,
    roots: [root],
    animations: [idleClip(rig, CARRY), walkClip(rig, CARRY), attack],
  };
}
