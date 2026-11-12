// The mounted rig shared by the horseman and the knight: horse and rider as rigid parts on one
// joint hierarchy. The barrel carries the neck and head, the tail, four legs of two parts
// each, and the rider's seat; the rider is a torso with head and arms, a shield on the left
// arm and a lance in the right hand. Nothing bends.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, qEuler, add } from '../math.mjs';
import { C } from '../palette.mjs';
import { sampledClip, samples, jointQuat } from './figure.mjs';
import { JOINT, paintBody, paintNeck, paintHead, paintLeg, paintCannon, paintTail } from './horse.mjs';

const TAU = Math.PI * 2;

/** The parts, each with an empty MeshBuilder. `pennon` adds a part of its own on the lance. */
export function mountedRig(seed, { pennon: flown = true } = {}) {
  const part = (name, translation, children = []) => ({ name, translation, mb: new MeshBuilder(seed++), children });
  const leg = (name, joint, knee) => {
    const cannon = part(`cannon_${name}`, knee);
    return { upper: part(`leg_${name}`, joint, [cannon]), cannon };
  };
  const FL = leg('FL', JOINT.fore(1), JOINT.foreCannon), FR = leg('FR', JOINT.fore(-1), JOINT.foreCannon);
  const HL = leg('HL', JOINT.hind(1), JOINT.hindCannon), HR = leg('HR', JOINT.hind(-1), JOINT.hindCannon);
  const horseHead = part('horse_head', JOINT.head);
  const neck = part('neck', JOINT.neck, [horseHead]);
  const tail = part('tail', JOINT.tail);
  const pennon = flown ? part('pennon', [0, 1.55, 0]) : null;
  const spear = part('spear', [0, -0.3, 0.29], pennon ? [pennon] : []);
  const shield = part('shield', [0.1, -0.3, 0.1]);
  const armL = part('arm_L', [0.31, 0.42, 0], [shield]);
  const armR = part('arm_R', [-0.31, 0.42, 0], [spear]);
  const head = part('head', [0, 0.5, 0]);
  const torso = part('torso', [0, 0.06, 0], [head, armL, armR]);
  const rider = part('rider', JOINT.saddle, [torso]);
  const horse = part('horse', JOINT.body, [neck, tail, FL.upper, FR.upper, HL.upper, HR.upper, rider]);
  return { FL, FR, HL, HR, horseHead, neck, tail, pennon, spear, shield, armL, armR, head, torso, rider, horse };
}

/** The horse itself in its coat, with a bridle. Saddle and cloths are the caller's to add. */
export function paintHorse(R, coat) {
  paintBody(R.horse.mb, coat);
  paintNeck(R.neck.mb, coat);
  paintHead(R.horseHead.mb, coat);
  // Bridle: a noseband and the cheek straps, which is all that shows at this size.
  R.horseHead.mb.color(C.leather, 0.05).at(T(0, 0.05, -0.08), RX(2.2), T(0, 0.36, 0), () => R.horseHead.mb.box(0.175, 0.05, 0.215, { top: false, bottom: false }));
  paintTail(R.tail.mb, coat);
  for (const l of [R.FL, R.FR]) {
    paintLeg(l.upper.mb, coat);
    paintCannon(l.cannon.mb, coat);
  }
  for (const l of [R.HL, R.HR]) {
    paintLeg(l.upper.mb, coat, true);
    paintCannon(l.cannon.mb, coat, true);
  }
}

/**
 * A pose holds: body [dx, dy, dz] and pitch of the barrel; neck, nod (the horse's head) and
 * tail [pitch, yaw, roll]; fl, fr, hl, hr as [leg, cannon]; and for the rider torso
 * [pitch, yaw], look, armL, armR, lance (the lance's lean forward from upright) and droop,
 * how far its pennon hangs below level.
 */
export const STILL = {
  body: [0, 0, 0], pitch: 0, neck: 0, nod: 0, tail: [0, 0, 0], fl: [0, 0], fr: [0, 0], hl: [0, 0], hr: [0, 0],
  torso: [0, 0], look: 0, armL: 0, armR: 0, lance: 0, droop: 0,
};

/** How a pose drives the parts. */
export function mountedBindings(R) {
  const { horse, neck, horseHead, tail, FL, FR, HL, HR, torso, head, armL, armR, spear, pennon } = R;
  const bindings = [
    { part: horse, path: 'translation', value: (p) => add(JOINT.body, p.body) },
    { part: horse, path: 'rotation', value: (p) => qEuler(p.pitch, 0, 0) },
    { part: neck, path: 'rotation', value: (p) => qEuler(p.neck, 0, 0) },
    { part: horseHead, path: 'rotation', value: (p) => qEuler(p.nod, 0, 0) },
    { part: tail, path: 'rotation', value: (p) => jointQuat(p.tail) },
    ...[[FL, 'fl'], [FR, 'fr'], [HL, 'hl'], [HR, 'hr']].flatMap(([l, key]) => [
      { part: l.upper, path: 'rotation', value: (p) => qEuler(p[key][0], 0, 0) },
      { part: l.cannon, path: 'rotation', value: (p) => qEuler(p[key][1], 0, 0) },
    ]),
    { part: torso, path: 'rotation', value: (p) => qEuler(p.torso[0], p.torso[1], 0) },
    { part: head, path: 'rotation', value: (p) => qEuler(0, p.look, 0) },
    { part: armL, path: 'rotation', value: (p) => qEuler(p.armL, 0, 0) },
    { part: armR, path: 'rotation', value: (p) => qEuler(p.armR, 0, 0) },
    // The lance is set against everything above it, so `lance` is its lean in the world.
    { part: spear, path: 'rotation', value: (p) => qEuler(p.lance - p.armR - p.torso[0] - p.pitch, 0, 0) },
  ];
  if (pennon) bindings.push({ part: pennon, path: 'rotation', value: (p) => qEuler(p.droop - p.lance, 0, 0) });
  return bindings;
}

/** Standing: the horse breathes, nods and swishes its tail, the rider looks about. */
export function mountedIdle(bindings, still) {
  return sampledClip('idle', samples(3.2, 16), (t) => {
    const p = (t / 3.2) * TAU;
    return {
      ...still,
      body: [0, 0.006 * Math.sin(p), 0],
      neck: 0.05 * Math.sin(p) + 0.025 * Math.sin(2 * p),
      nod: 0.06 * Math.sin(p + 1),
      tail: [0.04 * Math.sin(2 * p), 0, 0.22 * Math.sin(2 * p + 0.5)],
      torso: [0.014 * Math.sin(p), 0.03 * Math.sin(p * 0.5)],
      look: 0.2 * Math.sin(p),
      armL: 0.02 * Math.sin(p + 2),
      armR: 0.03 * Math.sin(p + 1),
      droop: -0.5 + 0.06 * Math.sin(2 * p),
    };
  }, bindings);
}

/**
 * Canter on the left lead: right hind, then left hind with right fore, then left fore, then
 * a moment in the air. One loop of `stride` seconds is one stride; `lance` is how far the
 * lance leans forward as it is carried.
 */
export function mountedCanter(bindings, still, { stride, lance }) {
  const swing = (u, phase, reach, fold) => {
    const p = (u - phase) * TAU;
    return [-reach * Math.sin(p), fold * Math.max(0, Math.cos(p)) ** 1.3];
  };
  return sampledClip('walk', samples(stride, 16), (t) => {
    const u = t / stride;
    const pitch = 0.07 * Math.sin((u - 0.55) * TAU);
    return {
      ...still,
      body: [0, 0.045 * Math.cos((u - 0.1) * TAU), 0],
      pitch,
      neck: 0.16 - 0.5 * pitch,
      nod: 0.08 - 0.4 * pitch,
      tail: [0.85 + 0.12 * Math.sin(u * TAU), 0, 0],
      hr: swing(u, 0, 0.5, 0.9),
      hl: swing(u, 0.2, 0.5, 0.9),
      fr: swing(u, 0.2, 0.56, 1.15),
      fl: swing(u, 0.45, 0.56, 1.15),
      torso: [0.16 - 0.6 * pitch, 0.03 * Math.sin(u * TAU)],
      armL: -0.12,
      armR: -0.3 + 0.05 * Math.sin(u * TAU),
      lance,
      droop: 0.08 * Math.sin(2 * u * TAU),
    };
  }, bindings);
}
