// Horseman, c. 1100: a light rider in the Norman manner, as on the Bayeux Tapestry. Conical
// helm with a nasal, mail shirt, kite shield slung on the left arm, and a lance with a pennon,
// carried upright at rest and stabbed overarm in the attack. The horse is a small bay of about
// 1.5 m at the withers under a saddle cloth in the owner's colour.
// Horse and rider are the rigid parts of the mounted rig, which the knight shares.
import { T, RX, RY, RZ } from '../math.mjs';
import { C } from '../palette.mjs';
import { rigToNodes, arm, sampledClip, samples, keyframes, hitTime } from './figure.mjs';
import { COATS, paintSaddle } from './horse.mjs';
import { mountedRig, paintHorse, STILL, mountedBindings, mountedIdle, mountedCanter } from './mounted.mjs';
import { KITE } from './spearman.mjs';

export function build() {
  const R = mountedRig(201);
  const { horse, rider, torso, head, armL, armR, shield, spear, pennon } = R;

  // ---- Horse -------------------------------------------------------------------------
  paintHorse(R, COATS.bay);
  paintSaddle(horse.mb);

  // ---- Rider -------------------------------------------------------------------------
  // Seat: the hauberk's skirt spread over the saddle, and the legs hanging astride.
  const seat = rider.mb;
  seat.color(C.mail, 0.06).at(T(0, -0.2, 0), () => seat.frustum(0.52, 0.4, 0.45, 0.31, 0.26, { bottom: false }));
  seat.color(C.leather, 0.04).at(T(0, -0.01, 0), () => seat.box(0.48, 0.07, 0.34));
  for (const s of [-1, 1]) {
    seat.color(C.hose, 0.05).beam([s * 0.14, -0.08, 0], [s * 0.3, -0.36, 0.3], 0.17, 0.18, { bottom: false });
    seat.color(C.wraps, 0.06).beam([s * 0.31, -0.3, 0.3], [s * 0.34, -0.8, 0.22], 0.13, 0.14);
    seat.color(C.leather, 0.05).at(T(s * 0.34, -0.89, 0.27), () => seat.box(0.13, 0.09, 0.27));
  }
  torso.mb.color(C.mail, 0.06).frustum(0.45, 0.31, 0.56, 0.34, 0.46);
  torso.mb.at(T(0, 0.44, 0), () => torso.mb.box(0.3, 0.09, 0.28));
  // Head: mail coif, conical helm with a nasal bar, as the spearman wears.
  const flat = Math.PI / 8;
  head.mb.color(C.mail, 0.05).at(T(0, 0, -0.01), () => head.mb.cyl(0.17, 0.165, 0.3, 8, { phase: flat }));
  head.mb.color(C.skin, 0.03).at(T(0, 0.05, 0.125), () => head.mb.box(0.17, 0.18, 0.05));
  head.mb.color(C.iron, 0.04).at(T(0, 0.21, -0.01), () => head.mb.cyl(0.195, 0.19, 0.055, 8, { top: false, bottom: false, phase: flat }));
  head.mb.color(C.steel, 0.06).at(T(0, 0.265, -0.01), () => head.mb.cyl(0.18, 0, 0.3, 8, { bottom: false, phase: flat }));
  head.mb.color(C.steel, 0.03).at(T(0, 0.08, 0.175), () => head.mb.box(0.045, 0.17, 0.03));
  arm(armL.mb, { upper: C.mail, lower: C.mail });
  arm(armR.mb, { upper: C.mail, lower: C.mail });

  // Kite shield on the left arm, hung along the horse's flank with its face turned up a little.
  shield.mb.at(RZ(0.4), RY(1.32), () => {
    shield.mb.team().extrude(KITE, -0.02, 0.025, { back: false, sides: false });
    shield.mb.color(C.leather, 0.05).extrude(KITE, -0.02, 0.025, { front: false, back: false });
    shield.mb.color(C.timberMid, 0.05).extrude(KITE, -0.02, 0.025, { front: false, sides: false });
    shield.mb.color(C.steel, 0.04).at(T(0, 0.12, 0.025), RX(Math.PI / 2), () => shield.mb.cyl(0.075, 0.03, 0.05, 6, { bottom: false }));
  });

  // Lance: ash shaft, socketed head, and a swallow-tailed pennon below it. The origin is the
  // grip. The pennon is a part of its own, so that it can fly level whichever way the lance points.
  spear.mb.color(C.timberLight, 0.04).at(T(0, -0.75, 0), () => spear.mb.cyl(0.026, 0.023, 2.5, 6));
  spear.mb.color(C.steel, 0.04).at(T(0, 1.75, 0), () => {
    spear.mb.cyl(0.03, 0.022, 0.1, 6, { bottom: false });
    spear.mb.at(T(0, 0.1, 0), () => spear.mb.cyl(0.02, 0.07, 0.1, 4, { top: false, bottom: false }));
    spear.mb.at(T(0, 0.2, 0), () => spear.mb.cyl(0.07, 0, 0.24, 4, { bottom: false }));
  });
  pennon.mb.team();
  const cloth = [[0, 0.15, 0], [0, -0.15, 0], [0, -0.11, -0.52], [0, 0, -0.36], [0, 0.11, -0.52]];
  for (const piece of [[cloth[0], cloth[1], cloth[3]], [cloth[1], cloth[2], cloth[3]], [cloth[0], cloth[3], cloth[4]]]) {
    pennon.mb.poly(piece.map((p) => [0.012, p[1], p[2]])).poly([...piece].reverse().map((p) => [-0.012, p[1], p[2]]));
  }

  const root = rigToNodes({ root: { name: 'root', children: [horse] } });

  // ---- Animation ----------------------------------------------------------------------
  const still = STILL;
  const bindings = mountedBindings(R);
  const idle = mountedIdle(bindings, still);
  // One loop is one stride of 2.4 m at the game's 4.8 m/s.
  const walk = mountedCanter(bindings, still, { stride: 0.5, lance: 0.5 });

  // Overarm thrust: the lance goes up and back over the shoulder, then down past the horse's
  // right shoulder at a man on foot. The blow lands at 0.4 s.
  const level = Math.PI / 2;
  const keys = [
    { t: 0, ...still, droop: -0.5 },
    { t: 0.22, ...still, body: [0, 0.02, -0.05], pitch: -0.04, neck: -0.14, nod: 0.1, fl: [-0.25, 0.6], tail: [0.3, 0, 0], torso: [-0.12, -0.35], look: 0.25, armL: -0.15, armR: -2.5, lance: level + 0.25 },
    { t: 0.4, hit: true, ...still, body: [0, -0.03, 0.1], pitch: 0.05, neck: 0.16, nod: 0.05, tail: [0.5, 0, 0], torso: [0.3, 0.3], look: -0.2, armL: -0.25, armR: -0.75, lance: level + 0.55 },
    { t: 0.56, ...still, body: [0, -0.025, 0.09], pitch: 0.045, neck: 0.14, nod: 0.05, tail: [0.4, 0, 0], torso: [0.27, 0.27], look: -0.2, armL: -0.22, armR: -0.8, lance: level + 0.52 },
    { t: 0.95, ...still, body: [0, 0, 0.02], neck: -0.05, tail: [0.1, 0, 0.2], torso: [0.02, -0.1], armR: -1.3, lance: 0.9 },
    { t: 1.3, ...still, droop: -0.5 },
    { t: 1.6, ...still, droop: -0.5 },
  ];
  const attack = sampledClip('attack', samples(1.6, 32), keyframes(keys), bindings);
  attack.hit = hitTime(keys);

  return {
    id: 'horseman',
    label: 'Horseman',
    note: 'Light Norman rider: nasal helm, mail, kite shield, a lance with a pennon. Horse and rider are 20 rigid parts; the canter covers 2.4 m a loop.',
    yaw: -0.7,
    roots: [root],
    animations: [idle, walk, attack],
  };
}
