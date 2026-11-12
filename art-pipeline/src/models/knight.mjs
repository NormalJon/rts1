// Knight, c. 1250: the heavy horseman of the High Middle Ages. Mail from head to foot under
// a surcoat in the owner's colour, a flat-topped great helm, a heater shield, and a heavy
// lance carried sloped and couched level for the charge. His horse is a dark destrier in a
// caparison of the same colour, which is what tells him from the plain horseman at a glance.
// Horse and rider are the rigid parts of the mounted rig, which the horseman shares.
import { T, RX, RY, RZ } from '../math.mjs';
import { C } from '../palette.mjs';
import { rigToNodes, arm, sampledClip, samples, keyframes, hitTime, jointQuat } from './figure.mjs';
import { COATS, paintSaddle, paintCaparison } from './horse.mjs';
import { mountedRig, paintHorse, STILL, mountedBindings, mountedIdle, mountedCanter } from './mounted.mjs';
import { paintHeater, paintGreatHelm } from './gear.mjs';

const SLOPE = 0.75; // the lance's lean forward from upright when it is only carried

export function build() {
  const R = mountedRig(501, { pennon: false });
  const { horse, neck, rider, torso, head, armL, armR, shield, spear } = R;
  spear.rotation = jointQuat(SLOPE); // so that the model at rest carries its lance as it does standing

  // ---- Horse -------------------------------------------------------------------------
  paintHorse(R, COATS.black);
  paintCaparison(horse.mb, neck.mb);
  paintSaddle(horse.mb, { cloth: false });

  // ---- Rider -------------------------------------------------------------------------
  // Seat: the surcoat's skirt spread over the saddle, and the mailed legs hanging astride.
  const seat = rider.mb;
  seat.team().at(T(0, -0.22, 0), () => seat.frustum(0.56, 0.44, 0.45, 0.31, 0.28, { bottom: false }));
  seat.color(C.leather, 0.04).at(T(0, -0.01, 0), () => seat.box(0.48, 0.07, 0.34));
  for (const s of [-1, 1]) {
    seat.color(C.mailDark, 0.05).beam([s * 0.14, -0.08, 0], [s * 0.3, -0.36, 0.3], 0.17, 0.18, { bottom: false });
    seat.beam([s * 0.31, -0.3, 0.3], [s * 0.34, -0.8, 0.22], 0.13, 0.14);
    seat.color(C.leather, 0.05).at(T(s * 0.34, -0.89, 0.27), () => seat.box(0.13, 0.09, 0.27));
  }
  torso.mb.team().frustum(0.46, 0.32, 0.58, 0.35, 0.46);
  torso.mb.color(C.mailDark, 0.06).at(T(0, 0.43, 0), () => torso.mb.frustum(0.62, 0.35, 0.34, 0.3, 0.1, { bottom: false }));
  paintGreatHelm(head.mb);
  arm(armL.mb, { upper: C.mailDark, lower: C.mailDark });
  arm(armR.mb, { upper: C.mailDark, lower: C.mailDark });

  // Heater shield on the left arm, hung along the horse's flank with its face turned up a little.
  shield.mb.at(RZ(0.4), RY(1.32), () => paintHeater(shield.mb));

  // Heavy lance: a stout ash shaft and a socketed head. The origin is the grip.
  spear.mb.color(C.timberLight, 0.04).at(T(0, -0.6, 0), () => spear.mb.cyl(0.036, 0.028, 2.16, 6));
  spear.mb.color(C.steel, 0.04).at(T(0, 1.56, 0), () => {
    spear.mb.cyl(0.034, 0.024, 0.1, 6, { bottom: false });
    spear.mb.at(T(0, 0.1, 0), () => spear.mb.cyl(0.022, 0.065, 0.08, 4, { top: false, bottom: false }));
    spear.mb.at(T(0, 0.18, 0), () => spear.mb.cyl(0.065, 0, 0.16, 4, { bottom: false }));
  });

  const root = rigToNodes({ root: { name: 'root', children: [horse] } });

  // ---- Animation ----------------------------------------------------------------------
  const still = { ...STILL, lance: SLOPE };
  const bindings = mountedBindings(R);
  const idle = mountedIdle(bindings, still);
  // A heavier canter than the horseman's: one loop of 16 frames at 30 a second is one stride,
  // which is 2.35 m at the game's 4.4 m/s.
  const walk = mountedCanter(bindings, still, { stride: 16 / 30, lance: 0.95 });

  // The charge: the lance comes down from the slope to be couched level under the arm, and
  // horse and rider drive it home together. It lands at 0.4 s.
  const level = Math.PI / 2;
  const home = { body: [0, -0.03, 0.2], pitch: 0.05, neck: 0.2, nod: 0.06, tail: [0.6, 0, 0], hl: [0.2, 0], hr: [0.28, 0], fl: [-0.25, 0.1], torso: [0.34, 0.16], look: -0.1, armL: -0.25, armR: -0.5, lance: level + 0.17 };
  const keys = [
    { t: 0, ...still },
    { t: 0.2, ...still, body: [0, 0.02, -0.06], pitch: -0.05, neck: -0.12, nod: 0.1, fl: [-0.3, 0.7], tail: [0.3, 0, 0], torso: [0.06, -0.12], armL: -0.15, armR: -0.15, lance: level - 0.05 },
    { t: 0.4, hit: true, ...still, ...home },
    { t: 0.58, ...still, ...home, body: [0, -0.025, 0.18], torso: [0.3, 0.14] },
    { t: 1.0, ...still, body: [0, 0, 0.03], neck: -0.05, tail: [0.1, 0, 0.2], torso: [0.04, -0.05], armR: -0.15, lance: 1.15 },
    { t: 1.35, ...still },
    { t: 1.6, ...still },
  ];
  const attack = sampledClip('attack', samples(1.6, 32), keyframes(keys), bindings);
  attack.hit = hitTime(keys);

  return {
    id: 'knight',
    label: 'Knight',
    note: 'Heavy horse of c. 1250: great helm, surcoat over mail, heater shield and couched lance, on a destrier in a caparison of the owner\'s colour. The canter covers 2.35 m a loop.',
    yaw: -0.7,
    roots: [root],
    animations: [idle, walk, attack],
  };
}
