// Archer, c. 1100: an unarmoured bowman as the Bayeux Tapestry shows them. Tunic and hose, a
// linen coif under a felt cap, a quiver slung on the back, and a self bow of about 1.5 m
// carried level at the left side, where a high camera sees its whole length.
// The figure is the spearman's rig. The bow adds four parts of its own: two limbs hinged at
// the grip and the two halves of the string, so it bends as it is drawn and the string stays
// one length. One arrow travels between the quiver and the string.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RZ, qAxis, qEuler, qMul, qConj, qSlerp, qRotate, add } from '../math.mjs';
import { C } from '../palette.mjs';
import { makeRig, rigToNodes, arm, leg, idleClip, walkClip, keyedClip, jointQuat, samples } from './figure.mjs';

// The bow in its own frame: stave along Y, the arrow flies along +Z, the string stands behind.
const BRACE = 0.16; // from grip to string at rest
const DRAW = 0.64; // how far the string comes back beyond that
const ROOT = 0.06; // each limb hinges this far from the middle of the grip
const TIP = [0, 0.64, -BRACE]; // limb tip from its hinge, at rest
const HALF = ROOT + TIP[1]; // half the string
const NOCK_Y = 0.035; // the arrow passes just above the hand

/** How far each limb bends, and how its half of the string turns, with the string drawn by d (0 to 1). */
function drawn(d) {
  const zn = -(BRACE + DRAW * d);
  const tip = (phi) => [ROOT + Math.cos(phi) * TIP[1] + Math.sin(phi) * TIP[2], -Math.sin(phi) * TIP[1] + Math.cos(phi) * TIP[2]];
  // The limb bends until its tip is half a string from the nocking point.
  let lo = 0, hi = 0.9;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2, [y, z] = tip(mid);
    if (Math.hypot(y, z - zn) > HALF) lo = mid;
    else hi = mid;
  }
  const phi = (lo + hi) / 2, [y, z] = tip(phi);
  // Direction from tip to nocking point, seen from the bent limb.
  const vy = -y, vz = zn - z;
  const ly = Math.cos(phi) * vy - Math.sin(phi) * vz, lz = Math.sin(phi) * vy + Math.cos(phi) * vz;
  return { phi, string: Math.atan2(-lz, -ly) };
}

export function build() {
  const HAND = [0, -0.61, 0]; // the bow hand, at the end of a straight arm
  const CARRY = qEuler(0, -Math.PI / 2, -Math.PI / 2); // bow level, stave fore and aft, string outwards
  const rig = makeRig(151, { itemL: { name: 'bow', translation: HAND, rotation: CARRY }, turn: true });
  const part = (name, translation, seed) => ({ name, translation, mb: new MeshBuilder(seed), children: [] });
  const limbU = part('bow_upper', [0, ROOT, 0], 171), limbL = part('bow_lower', [0, -ROOT, 0], 172);
  const stringU = part('string_upper', TIP, 173), stringL = part('string_lower', [0, -TIP[1], TIP[2]], 174);
  limbU.children.push(stringU);
  limbL.children.push(stringL);
  rig.itemL.children.push(limbU, limbL);

  // Hips: the tunic's skirt in the owner's colour, belted, with a pouch.
  const hips = rig.hips.mb;
  hips.team().at(T(0, -0.48, 0), () => hips.frustum(0.58, 0.44, 0.45, 0.31, 0.54));
  hips.color(C.leather, 0.04).at(T(0, -0.01, 0), () => hips.box(0.48, 0.06, 0.34));
  hips.color(C.leather, 0.05).at(T(-0.2, -0.2, 0.13), () => hips.box(0.12, 0.16, 0.08));

  // Torso, with the quiver slung from the right shoulder to the left hip.
  const torso = rig.torso.mb;
  torso.team().frustum(0.45, 0.31, 0.54, 0.33, 0.46);
  const quiverFoot = [0.13, 0, -0.215], slant = 0.569;
  const quiverAxis = [-Math.sin(slant), Math.cos(slant), 0];
  torso.at(T(...quiverFoot), RZ(slant), () => {
    torso.color(C.leather, 0.06).frustum(0.09, 0.08, 0.12, 0.1, 0.6);
    torso.color(C.linen, 0.08).at(T(0, 0.6, 0), () => torso.frustum(0.1, 0.08, 0.14, 0.1, 0.13, { bottom: false }));
  });
  // The strap it hangs from, across the chest.
  torso.color(C.leather, 0.05).beam([0.2, 0.04, 0.166], [-0.22, 0.45, 0.176], 0.06, 0.02, { top: false, bottom: false });

  // Head: linen coif with a pale felt cap over it, so the head reads light from above.
  const head = rig.head.mb;
  const flat = Math.PI / 8;
  head.color(C.linen, 0.05).at(T(0, 0, -0.01), () => head.cyl(0.165, 0.158, 0.3, 8, { phase: flat }));
  head.color(C.skin, 0.03).at(T(0, 0.05, 0.118), () => head.box(0.17, 0.18, 0.05));
  head.color(C.wraps, 0.06).at(T(0, 0.25, -0.01), () => head.cyl(0.18, 0.11, 0.12, 8, { bottom: false, phase: flat }));

  // The bow arm is held straight, with a leather bracer on the forearm; the other is the usual arm.
  const armL = rig.armL.mb;
  armL.team().at(T(0, -0.3, 0), () => armL.frustum(0.12, 0.13, 0.14, 0.15, 0.32));
  armL.color(C.leather, 0.05).at(T(0, -0.57, 0), () => armL.frustum(0.1, 0.1, 0.12, 0.125, 0.28));
  armL.color(C.skin, 0.03).at(T(0, -0.665, 0), () => armL.box(0.1, 0.11, 0.1));
  arm(rig.armR.mb, { upper: 'team', lower: C.linen });
  leg(rig.legL.mb, rig.shinL.mb, { hose: C.hose, wraps: C.wraps });
  leg(rig.legR.mb, rig.shinR.mb, { hose: C.hose, wraps: C.wraps });

  // Bow: a leather-bound grip, two limbs of yew tapering to the nocks, and the string.
  rig.itemL.mb.color(C.leather, 0.05).at(T(0, -0.07, 0), () => rig.itemL.mb.box(0.06, 0.14, 0.066, { top: false, bottom: false }));
  for (const [limb, string, s] of [[limbU, stringU, 1], [limbL, stringL, -1]]) {
    const mid = [0, s * 0.36, -0.05], tip = [0, s * TIP[1], TIP[2]];
    limb.mb.color(C.yew, 0.06).rod([0, 0, 0], mid, 0.03, 4, { rt: 0.025, top: false, bottom: false });
    limb.mb.rod(mid, tip, 0.025, 4, { rt: 0.015, bottom: false });
    string.mb.color(C.linen, 0.03).rod([0, 0, 0], [0, -s * HALF, 0], 0.006, 3, { top: false, bottom: false });
  }

  // The arrow: nock at its origin, head along +Z. At rest it stands in the quiver.
  const ARROW = 0.8;
  const arrow = part('arrow', add(quiverFoot, quiverAxis.map((n) => n * 0.79)), 175);
  const inQuiver = qMul(qAxis([0, 0, 1], slant), qAxis([1, 0, 0], Math.PI / 2));
  arrow.rotation = inQuiver;
  rig.torso.children.push(arrow);
  arrow.mb.color(C.timberLight, 0.05).rod([0, 0, 0], [0, 0, ARROW - 0.06], 0.009, 3, { top: false });
  arrow.mb.color(C.steel, 0.05).rod([0, 0, ARROW - 0.08], [0, 0, ARROW], 0.022, 4, { rt: 0 });
  arrow.mb.color(C.linen, 0.06);
  for (const [dx, dy] of [[0.036, 0], [0, 0.036]]) {
    const vane = [[-dx, -dy, 0.03], [dx, dy, 0.03], [dx, dy, 0.2], [-dx, -dy, 0.2]];
    arrow.mb.poly(vane).poly([...vane].reverse());
  }

  const root = rigToNodes(rig);

  // ---- Animation ----------------------------------------------------------------------
  // The figure's pose carries two numbers of the bow's own: `aim`, from carried (0) to held
  // upright towards the target (1), and `draw`, how far the string is back.
  const SHOULDER_L = [0.31, 0.42, 0];
  const body = (p) => qMul(qEuler(0, p.turn, 0), qEuler(p.torso[0], p.torso[1], 0));
  // Bow in the arm's frame: at full aim it undoes every turn above it, so it stands upright
  // and points where the figure as a whole is facing.
  const bowTurn = (p) => qSlerp(CARRY, qConj(qMul(body(p), jointQuat(p.armL))), p.aim);
  // Only the attack takes the arrow out of the quiver: it is on the string from NOCK to LOOSE.
  const arrowPose = (p, t, shooting) => {
    if (!shooting || t <= NOCK || t > LOOSE) return { at: arrow.translation, turn: inQuiver };
    const qArm = jointQuat(p.armL), qBow = qMul(qArm, bowTurn(p));
    const nock = qRotate(qBow, [0, NOCK_Y, -(BRACE + DRAW * p.draw)]);
    return { at: add(add(SHOULDER_L, qRotate(qArm, HAND)), nock), turn: qBow };
  };
  const bowParts = (times, shooting = false) => {
    // The arrow jumps between quiver and string, so it gets a key a moment after each jump.
    const arrowTimes = shooting ? [...times, NOCK + 0.0001, LOOSE + 0.0001].sort((a, b) => a - b) : times;
    return [
      { part: rig.itemL, path: 'rotation', value: bowTurn },
      { part: limbU, path: 'rotation', value: (p) => qAxis([1, 0, 0], -drawn(p.draw).phi) },
      { part: limbL, path: 'rotation', value: (p) => qAxis([1, 0, 0], drawn(p.draw).phi) },
      { part: stringU, path: 'rotation', value: (p) => qAxis([1, 0, 0], drawn(p.draw).string) },
      { part: stringL, path: 'rotation', value: (p) => qAxis([1, 0, 0], -drawn(p.draw).string) },
      { part: arrow, path: 'translation', times: arrowTimes, value: (p, t) => arrowPose(p, t, shooting).at },
      { part: arrow, path: 'rotation', times: arrowTimes, value: (p, t) => arrowPose(p, t, shooting).turn },
    ];
  };

  const NOCK = 0.1, LOOSE = 0.5, LENGTH = 1.5;
  const carry = [-0.06, 0, 0.08]; // the bow arm hanging, a little out from the hip
  const carried = (swing) => ({ armL: [carry[0] + swing, 0, carry[2]], aim: 0, draw: 0 });
  const rest = {
    hips: [0, 0, 0], turn: 0, torso: [0, 0], head: 0, armL: carry, armR: [0, 0, 0],
    legL: 0, shinL: 0, legR: 0, shinR: 0, aim: 0, draw: 0,
  };
  // Side on to the target: the bow arm straight out along the line of the shoulders, the string
  // hand under the chin with its elbow high.
  const full = {
    hips: [0, -0.02, 0], turn: -1.0, torso: [0, -0.45], head: 1.15, armL: [0, -0.507, 1.636], armR: [0.609, 1.113, -3.074],
    legL: -0.22, legR: 0.18, aim: 1, draw: 1,
  };
  const loosed = { ...full, draw: 0, armR: [0.75, 0.8, -3.074], head: 1.2 };
  const keys = [
    { t: 0, ...rest },
    { t: 0.14, ...rest, hips: [0, -0.01, 0], turn: -0.5, torso: [0, -0.25], head: 0.55, armL: [-0.45, -0.15, 0.8], armR: [0.3, 0.55, -1.5], legL: -0.12, legR: 0.1, aim: 0.8, draw: 0.04 },
    { t: 0.4, ...rest, ...full },
    { t: 0.45, ...rest, ...full },
    { t: LOOSE, hit: true, ...rest, ...loosed },
    { t: 0.72, ...rest, ...loosed },
    { t: 1.0, ...rest, turn: -0.35, torso: [0, -0.15], head: 0.3, armL: [-0.25, -0.1, 0.5], armR: [-1.4, 0.3, -1.2], legL: -0.08, legR: 0.06, aim: 0.25 },
    { t: 1.25, ...rest, head: -0.3, armR: [-2.9, 0, 0] },
    { t: 1.34, ...rest, head: -0.3, armR: [-2.9, 0, 0] },
    { t: LENGTH, ...rest },
  ];
  const attack = keyedClip(rig, 'attack', keys, 30, bowParts(samples(LENGTH, 30), true));
  const idle = idleClip(rig, 0, { also: (p) => carried(p.armL), extra: bowParts(samples(3.2, 16)) });
  const walk = walkClip(rig, 0, { also: (p) => carried(p.armL), extra: bowParts(samples(0.9, 16)) });

  return {
    id: 'archer',
    label: 'Archer',
    note: 'Unarmoured bowman: tunic, coif and cap, back quiver, a self bow that bends as it is drawn. The arrow leaves at 0.5 s.',
    yaw: 0.55,
    roots: [root],
    animations: [idle, walk, attack],
  };
}
