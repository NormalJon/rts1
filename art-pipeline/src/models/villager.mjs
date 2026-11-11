// Villager with a felling axe: belted knee-length tunic, caped hood, hose and leg wraps.
import { T, RX, RY, qEuler } from '../math.mjs';
import { C } from '../palette.mjs';
import { makeRig, rigToNodes, arm, leg, idleClip, walkClip, keyedClip } from './figure.mjs';

const CARRY = -0.8; // axe rests back over the shoulder

export function build() {
  const rig = makeRig(131, {
    itemR: { name: 'axe', translation: [0, -0.3, 0.29], rotation: qEuler(CARRY, 0, 0) },
  });

  const hips = rig.hips.mb;
  hips.team().at(T(0, -0.5, 0), () => hips.frustum(0.58, 0.44, 0.45, 0.31, 0.56));
  hips.color(C.leather, 0.04).at(T(0, -0.01, 0), () => hips.box(0.48, 0.06, 0.34));
  hips.color(C.leather, 0.05).at(T(0.2, -0.19, 0.14), () => hips.box(0.12, 0.15, 0.08)); // belt pouch

  const torso = rig.torso.mb;
  torso.team().frustum(0.45, 0.31, 0.54, 0.33, 0.46);
  // Caped hood: a short shoulder cape, a close hood and its point hanging back.
  torso.color(C.wool, 0.06).at(T(0, 0.33, 0), () => torso.frustum(0.64, 0.42, 0.34, 0.3, 0.17, { bottom: false }));

  const head = rig.head.mb;
  const flat = Math.PI / 8;
  head.color(C.wool, 0.05).at(T(0, 0, -0.015), () => head.cyl(0.175, 0.155, 0.31, 8, { phase: flat }));
  head.color(C.skin, 0.03).at(T(0, 0.045, 0.115), () => head.box(0.18, 0.19, 0.06));
  head.color(C.wool, 0.05).at(T(0, 0.3, -0.03), RX(-0.5), () => head.cyl(0.15, 0, 0.2, 8, { phase: flat }));

  arm(rig.armL.mb, { upper: 'team', lower: C.linen });
  arm(rig.armR.mb, { upper: 'team', lower: C.linen });
  leg(rig.legL.mb, rig.shinL.mb, { hose: C.wool, wraps: C.wraps });
  leg(rig.legR.mb, rig.shinR.mb, { hose: C.wool, wraps: C.wraps });

  // Felling axe. Node origin is the grip; the blade faces forward (+Z).
  const axe = rig.itemR.mb;
  axe.color(C.timberLight, 0.04).at(T(0, -0.12, 0), () => axe.cyl(0.024, 0.02, 0.86, 6));
  axe.color(C.iron, 0.04).at(T(0, 0.6, -0.005), () => axe.box(0.045, 0.1, 0.11));
  axe.color(C.steel, 0.05).at(RY(-Math.PI / 2), () =>
    axe.extrude([[0.05, 0.615], [0.23, 0.53], [0.23, 0.77], [0.05, 0.685]], -0.016, 0.016));

  const root = rigToNodes(rig);

  const rest = { hips: [0, 0, 0], torso: [0, 0], head: 0, armL: 0, armR: 0, legL: 0, shinL: 0, legR: 0, shinR: 0, itemR: CARRY };
  const chop = keyedClip(rig, 'chop', [
    { t: 0, ...rest },
    { t: 0.3, ...rest, hips: [0, 0.01, -0.02], torso: [-0.12, -0.12], armR: -2.2, armL: -0.5, itemR: 1.3, legL: -0.15, legR: 0.1 },
    { t: 0.42, ...rest, hips: [0, 0.01, -0.02], torso: [-0.14, -0.14], armR: -2.3, armL: -0.55, itemR: 1.25, legL: -0.15, legR: 0.1 },
    { t: 0.54, ...rest, hips: [0, -0.06, 0.05], torso: [0.32, 0.1], armR: -0.2, armL: -0.25, itemR: 1.35, legL: -0.3, shinL: 0.3, legR: 0.2 },
    { t: 0.7, ...rest, hips: [0, -0.05, 0.04], torso: [0.28, 0.08], armR: -0.3, armL: -0.25, itemR: 1.35, legL: -0.28, shinL: 0.28, legR: 0.18 },
    { t: 1.1, ...rest },
  ], 22);

  return {
    id: 'villager',
    label: 'Villager',
    note: 'Tunic, caped hood and felling axe. Same rig as the spearman, different clothes and clips.',
    yaw: 0.55,
    roots: [root],
    animations: [idleClip(rig, CARRY), walkClip(rig, CARRY), chop],
  };
}
