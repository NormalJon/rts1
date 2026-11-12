// Handgunner, c. 1480: a soft cap with a feather, a short dark doublet with sleeves in the
// owner's colour, hose of two colours, a powder flask and a coil of slow match at the belt.
// His handgun is a hook gun of about 1.2 m, an iron barrel on a straight wooden tiller,
// carried slanting across the chest: a straight dark bar, with nothing bow-shaped about him.
// The figure is the spearman's rig, with two parts added: the gun in the right hand, and a
// puff of smoke that shows at the muzzle for a few frames when he fires.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RY, RZ, qEuler, qMul, qConj, qRotate, add } from '../math.mjs';
import { C } from '../palette.mjs';
import { makeRig, rigToNodes, arm, idleClip, walkClip, keyedClip, jointQuat, samples } from './figure.mjs';

const FIRE = 0.8, SMOKE = 0.2, LENGTH = 3.4;
const MUZZLE = [0, 0.035, 1.05]; // in the gun's own frame, whose origin is the right hand

export function build() {
  const rig = makeRig(401);
  const part = (name, translation, seed) => ({ name, translation, mb: new MeshBuilder(seed), children: [] });
  const gun = part('handgun', [0, -0.3, 0.29], 421);
  rig.armR.children.push(gun);
  const HIDDEN = [0, 0.2, 0]; // inside the chest, where the smoke waits out of sight
  const puff = part('smoke', HIDDEN, 422);
  rig.torso.children.push(puff);

  // The carry: right hand low at the hip on the tiller, left hand up at the chest under the
  // barrel, the muzzle up and to the left. The figure rests that way.
  const PORT = { armR: [0.25, 0.6, 0], armL: [-0.55, -0.7, 0], gun: [-1.04, 1.42] };
  const gunTurn = (p) => qMul(qConj(qMul(qEuler(p.torso[0], p.torso[1], 0), jointQuat(p.armR))), qEuler(p.gun[0], p.gun[1], 0));
  rig.armR.rotation = jointQuat(PORT.armR);
  rig.armL.rotation = jointQuat(PORT.armL);
  gun.rotation = gunTurn({ torso: [0, 0], ...PORT });

  // Hips: the doublet's short skirt over the hose, a belt, the powder flask and the match.
  const hips = rig.hips.mb;
  hips.color(C.timber, 0.06).at(T(0, -0.2, 0), () => hips.frustum(0.54, 0.4, 0.46, 0.32, 0.26));
  hips.color(C.leather, 0.04).at(T(0, -0.01, 0), () => hips.box(0.49, 0.07, 0.35));
  hips.color(C.linen, 0.06).at(T(-0.27, -0.26, 0.05), RZ(0.25), () => hips.frustum(0.05, 0.05, 0.12, 0.09, 0.22));
  hips.color(C.rope, 0.07).at(T(0.27, -0.22, 0.02), RZ(Math.PI / 2), () => hips.cyl(0.09, 0.09, 0.05, 6));
  // A short sword hangs behind the left hip, and a pouch of shot in front of the right.
  hips.color(C.leather, 0.05).beam([0.25, -0.06, -0.1], [0.3, -0.62, -0.3], 0.05, 0.06, { top: false });
  hips.color(C.iron, 0.05).at(T(0.25, -0.05, -0.1), RX(0.34), () => hips.box(0.04, 0.13, 0.13, { bottom: false }));
  hips.color(C.leather, 0.05).at(T(-0.14, -0.2, 0.16), () => hips.box(0.13, 0.13, 0.07, { bottom: false }));

  // Torso: the doublet, close in the body and padded at the shoulders.
  const torso = rig.torso.mb;
  torso.color(C.timber, 0.06).frustum(0.44, 0.31, 0.55, 0.34, 0.46);
  torso.color(C.linen, 0.05).at(T(0, 0.44, 0), () => torso.box(0.28, 0.06, 0.26, { bottom: false }));

  // Head: bare-faced under a broad soft cap, with a feather in it.
  const head = rig.head.mb;
  const flat = Math.PI / 8;
  head.color(C.bark, 0.05).at(T(0, 0, -0.01), () => head.cyl(0.158, 0.152, 0.28, 8, { top: false, phase: flat }));
  head.color(C.skin, 0.03).at(T(0, 0.04, 0.112), () => head.box(0.17, 0.19, 0.05));
  head.at(T(0.02, 0.25, -0.02), RZ(-0.16), () => {
    head.color(C.capDark, 0.07).cyl(0.2, 0.26, 0.07, 8, { phase: flat });
    head.at(T(0, 0.07, 0), () => head.cyl(0.25, 0.15, 0.05, 8, { bottom: false, phase: flat }));
    const quill = [[0.2, 0.06, -0.02], [0.26, 0.11, -0.1], [0.2, 0.36, -0.26], [0.15, 0.3, -0.16]];
    head.color(C.linen, 0.05).poly(quill).poly([...quill].reverse());
  });

  // Sleeves in the owner's colour, and hose of two colours: his on the left leg, undyed on the right.
  arm(rig.armL.mb, { upper: 'team', lower: 'team' });
  arm(rig.armR.mb, { upper: 'team', lower: 'team' });
  for (const [thigh, shin, own] of [[rig.legL.mb, rig.shinL.mb, true], [rig.legR.mb, rig.shinR.mb, false]]) {
    (own ? thigh.team() : thigh.color(C.linen, 0.05)).at(T(0, -0.44, 0), () => thigh.frustum(0.16, 0.17, 0.19, 0.2, 0.46));
    (own ? shin.team() : shin.color(C.linen, 0.06)).at(T(0, -0.36, 0), () => shin.frustum(0.125, 0.135, 0.16, 0.17, 0.38));
    shin.color(C.leather, 0.05).at(T(0, -0.43, 0.045), () => shin.box(0.14, 0.09, 0.27));
  }

  // The gun: the origin is the right hand on the tiller, the ball flies along +Z.
  const g = gun.mb;
  g.color(C.timberMid, 0.06).at(T(0, -0.055, 0.2), () => g.box(0.06, 0.07, 0.7));
  g.color(C.iron, 0.05).rod([0, 0.035, 0.05], MUZZLE, 0.034, 6, { rt: 0.03 });
  g.at(T(0, -0.1, 0.78), () => g.box(0.03, 0.09, 0.05, { top: false }));
  g.at(T(0.045, 0.02, 0.1), RX(-0.5), () => g.box(0.02, 0.1, 0.03, { bottom: false }));
  // Smoke: a pale faceted lump, a little longer than it is wide.
  puff.mb.color(C.smoke, 0.08);
  puff.mb.cyl(0.14, 0, 0.14, 5, { bottom: false });
  puff.mb.at(RX(Math.PI), () => puff.mb.cyl(0.14, 0, 0.12, 5, { bottom: false }));

  const root = rigToNodes(rig);

  // ---- Animation ----------------------------------------------------------------------
  // The pose carries `gun`, the gun's [pitch, yaw] in the world: [0, 0] is levelled at the
  // target. It is set against the torso and arm above it.
  const SHOULDER_R = [-0.31, 0.42, 0];
  const smokePose = (p, t, firing) => {
    if (!firing || t < FIRE || t > FIRE + SMOKE) return HIDDEN;
    // At the muzzle, drifting up and on as it thins.
    const qArm = jointQuat(p.armR), k = (t - FIRE) / SMOKE;
    const at = add(add(SHOULDER_R, qRotate(qArm, gun.translation)), qRotate(qMul(qArm, gunTurn(p)), add(MUZZLE, [0, 0, 0.12 + 0.3 * k])));
    return add(at, [0, 0.16 * k, 0]);
  };
  const extras = (times, firing = false) => {
    // The smoke jumps to the muzzle and back, so it gets a key a moment either side of each jump.
    const smokeTimes = firing ? [...times, FIRE - 0.0001, FIRE + SMOKE + 0.0001].sort((a, b) => a - b) : times;
    return [
      { part: gun, path: 'rotation', value: gunTurn },
      { part: puff, path: 'translation', times: smokeTimes, value: (p, t) => smokePose(p, t, firing) },
      { part: puff, path: 'rotation', times: smokeTimes, value: (p, t) => qEuler(0, t * 9, t * 5) },
    ];
  };
  const carried = (p) => ({ armR: [PORT.armR[0] + p.armR, PORT.armR[1], 0], armL: [PORT.armL[0] + p.armL * 0.5, PORT.armL[1], 0], gun: PORT.gun });

  const rest = { hips: [0, 0, 0], torso: [0, 0], head: 0, legL: 0, shinL: 0, legR: 0, shinR: 0, ...PORT };
  const level = { hips: [0, -0.01, 0], torso: [0, -0.2], head: 0.2, armR: [-0.85, 0.5, 0], armL: [-0.95, -0.95, 0], gun: [0, 0], legL: -0.16, legR: 0.12 };
  // Reloading: the gun dips across the body while the left hand goes from flask to muzzle and back.
  const low = { torso: [0.14, 0.12], head: -0.1, armR: [0.35, 0.5, 0], gun: [-0.55, 0.9] };
  const keys = [
    { t: 0, ...rest },
    { t: 0.35, ...rest, ...level },
    { t: 0.75, ...rest, ...level },
    { t: FIRE, hit: true, ...rest, ...level, hips: [0, -0.01, -0.03], torso: [-0.09, -0.2], gun: [-0.13, 0] },
    { t: 1.05, ...rest, ...level, torso: [-0.03, -0.2], gun: [-0.04, 0] },
    { t: 1.45, ...rest, ...low, armL: [0.3, -0.2, 0] },
    { t: 1.7, ...rest, ...low, armL: [0.3, -0.2, 0] },
    { t: 2.0, ...rest, ...low, armL: [-1.1, -0.6, 0] },
    { t: 2.25, ...rest, ...low, armL: [-0.7, -0.6, 0] },
    { t: 2.5, ...rest, ...low, armL: [-1.1, -0.6, 0] },
    { t: 2.75, ...rest, ...low, armL: [-0.7, -0.6, 0] },
    { t: 3.15, ...rest },
    { t: LENGTH, ...rest },
  ];
  const attack = keyedClip(rig, 'attack', keys, 68, extras(samples(LENGTH, 68), true));
  const idle = idleClip(rig, 0, { also: carried, extra: extras(samples(3.2, 16)) });
  const walk = walkClip(rig, 0, { also: carried, extra: extras(samples(0.9, 16)) });

  return {
    id: 'handgunner',
    label: 'Handgunner',
    note: 'Hook gun of c. 1480 carried across the chest, soft cap, dark doublet, sleeves and one leg of the hose in the owner\'s colour. He fires at 0.8 s with a puff of smoke, then reloads.',
    yaw: 0.55,
    roots: [root],
    animations: [idle, walk, attack],
  };
}
