// Small peasant house, c. 900: earth-fast timber posts, wattle-and-daub between them, steep
// thatch. No chimney: smoke left through a louvre on the ridge. One room, door in the long side.
// The plot is 3 x 3 tiles, so everything stays inside 5.7 m square: the house stands across the
// back of it and a fenced toft with a garden bed takes the front. The door faces +Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RY } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, thatch, groundPatch, stakeFence, logPile, disc, tub } from './parts.mjs';

export function build() {
  const m = new MeshBuilder(11);
  const L = 4.6, W = 2.9, wallH = 1.9;
  const hl = L / 2, hw = W / 2;
  const zc = -1.0; // centre line of the house, set back to leave the toft
  const zf = zc + hw, zb = zc - hw;
  const slope = 1.0; // rise per metre of run: 45 degrees, to keep the ridge under 4.5 m
  const over = 0.35, gableOver = 0.3, thick = 0.36;
  const run = hw + over, rise = run * slope;
  const eaveY = wallH + 0.15 - over * slope; // top surface of the thatch at the eave
  const ridgeY = eaveY + rise;
  const gableTop = ridgeY - thick + 0.18;

  // Trodden earth of the toft.
  groundPatch(m.color(C.earth, 0.04), [[-2.62, zf - 0.05], [-2.62, 2.42], [-2.38, 2.66], [2.38, 2.66], [2.62, 2.42], [2.62, zf - 0.05]]);

  // Walls: one pentagonal prism, daub coloured. Built in a frame turned so the ridge runs along X.
  m.at(T(0, 0, zc), RY(-Math.PI / 2), () => {
    m.color(C.daub, 0.03).extrude([[-hw, 0], [hw, 0], [hw, wallH], [0, gableTop], [-hw, wallH]], -hl, hl);
  });

  // Timber frame standing slightly proud of the daub: posts, a sill and a rail on each long side.
  const post = 0.2, proud = 0.05;
  const bays = [-hl - proud + post / 2, -0.78, 0.78, hl + proud - post / 2];
  for (const s of [1, -1]) {
    const z = zc + s * (hw + proud - post / 2);
    m.color(C.timber, 0.06);
    for (const x of bays) m.at(T(x, 0, z), () => m.box(post, wallH, post, { top: false, bottom: false }));
    const face = zc + s * (hw + proud - 0.085);
    m.beam([-hl, 0.075, face], [hl, 0.075, face], 0.14, 0.16, { top: false, bottom: false });
    // The rail stops either side of the door at the front and runs through at the back.
    const spans = s > 0 ? [[bays[0], bays[1]], [bays[2], bays[3]]] : [[bays[0], bays[3]]];
    for (const [x0, x1] of spans) m.beam([x0, 0.98, face], [x1, 0.98, face], 0.14, 0.12, { top: false, bottom: false });
  }
  // Gable frames: studs under a tie beam whose ends are lost in the thatch, a king post and
  // raking struts above it.
  for (const s of [-1, 1]) {
    const x = s * (hl + proud - 0.09);
    m.color(C.timber, 0.06);
    m.at(T(x, wallH - 0.1, zc), () => m.box(0.16, 0.2, W - 0.1));
    for (const dz of [-hw / 3, hw / 3]) m.at(T(x, 0, zc + dz), () => m.box(0.16, wallH - 0.1, 0.16, { top: false, bottom: false }));
    m.at(T(x, wallH + 0.1, zc), () => m.box(0.16, gableTop - wallH - 0.25, 0.18, { bottom: false }));
    for (const sz of [-1, 1]) {
      m.beam([x, wallH + 0.08, zc + sz * hw * 0.7], [x, gableTop - 0.72, zc + sz * 0.13], 0.12, 0.13, { top: false, bottom: false });
    }
  }

  // Thatch in three overlapping courses a slope, each butt edge proud of the one below.
  const roof = { run, rise, eaveY };
  m.at(T(0, 0, zc), RY(-Math.PI / 2), () => {
    thatch(m, roof, {
      thick, z0: -hl - gableOver, z1: hl + gableOver, step: 0.07, roll: 0.14,
      courses: [[0, 0.4, C.thatch], [0.36, 0.72, C.thatchMid], [0.68, 1, C.thatch]],
    });
  });
  // Smoke louvre astride the ridge over the hearth: four stakes and a cap of thatch.
  m.at(T(-0.85, ridgeY - 0.08, zc), () => {
    m.color(C.timber, 0.05);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.at(T(sx * 0.3, 0, sz * 0.17), () => m.box(0.07, 0.52, 0.07, { top: false, bottom: false }));
    m.color(C.thatchDark, 0.05).at(T(0, 0.5, 0), RY(-Math.PI / 2), () => m.extrude([[-0.36, 0], [0.36, 0], [0, 0.3]], -0.46, 0.46));
  });

  // Door of three planks in a timber frame, with a threshold stone.
  m.at(T(0, 0, zf), () => {
    for (let i = 0; i < 3; i++) {
      const x0 = -0.42 + i * 0.28, x1 = x0 + 0.28;
      m.color(i % 2 ? C.timberLight : C.plank, 0.07).poly([[x0, 0.05, 0.04], [x1, 0.05, 0.04], [x1, 1.58, 0.04], [x0, 1.58, 0.04]]);
    }
    m.color(C.timber, 0.05);
    for (const sx of [-1, 1]) m.at(T(sx * 0.49, 0, 0.03), () => m.box(0.14, 1.64, 0.16, { bottom: false }));
    m.at(T(0, 1.56, 0.03), () => m.box(1.26, 0.14, 0.18));
    m.color(C.stoneDark, 0.05).at(T(0, 0, 0.36), () => m.box(0.9, 0.06, 0.5, { bottom: false }));
  });
  // Small window opening with its shutter swung aside.
  m.at(T(1.42, 1.08, zf + 0.012), () => {
    m.color(C.slit).poly([[-0.2, 0, 0], [0.2, 0, 0], [0.2, 0.36, 0], [-0.2, 0.36, 0]]);
    m.color(C.plank, 0.06).at(T(0.37, 0, 0.03), () => m.box(0.3, 0.36, 0.05, { bottom: false }));
  });

  // Firewood stacked against the wall, cut ends outwards.
  m.at(T(-1.52, 0, zf + proud + 0.02), () => logPile(m, [4, 3, 2], { r: 0.12, length: 0.56, back: false }));

  // The toft fence: stakes and withy rails, open in front of the door.
  const fx = 2.7, fz = 2.7, gate = 0.72;
  for (const sx of [-1, 1]) {
    stakeFence(m, [sx * fx, zf + 0.3], [sx * fx, fz], { spacing: 0.95 });
    stakeFence(m, [sx * fx, fz], [sx * gate, fz], { first: false, spacing: 0.95 });
  }

  // Garden bed: three rows of leeks and worts in dug earth.
  m.at(T(1.68, 0, 1.78), () => {
    m.color(C.loam, 0.05).frustum(1.5, 1.34, 1.38, 1.22, 0.1, { bottom: false });
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 4; i++) {
        m.color(row === 1 ? C.bushHi : C.leaf, 0.12).at(T(-0.5 + i * 0.335 + (row % 2) * 0.05, 0.08, -0.4 + row * 0.4), RY(i + row), () =>
          m.cyl(row === 1 ? 0.14 : 0.11, 0, row === 1 ? 0.2 : 0.3, 4, { bottom: false }));
      }
    }
  });

  // Chopping block and a tub by the door.
  m.at(T(-1.55, 0, 1.75), () => {
    m.color(C.bark, 0.06).cyl(0.26, 0.28, 0.4, 7, { top: false, bottom: false, phase: 0.3 });
    m.color(C.timberLight, 0.04);
    disc(m, 0.26, 0.4, 7, { phase: 0.3 });
  });
  m.at(T(-0.72, 0, zf + 0.42), () => tub(m, { r: 0.27, h: 0.5 }));

  // The owner's colours: a blanket airing on the fence and a small pennant at the gable.
  m.team().at(T(-1.75, 0, fz), RY(-Math.PI / 2), () => m.extrude([[-0.075, 0.36], [0.085, 0.5], [0.05, 1.02], [-0.045, 1.02]], -0.38, 0.38));
  pennant(m, [hl + gableOver - 0.22, ridgeY + 0.08, zc], { height: 0.88, length: 0.8, drop: 0.36, yaw: Math.PI + 0.35 });

  return {
    id: 'house',
    label: 'Peasant house',
    note: 'Timber posts, wattle-and-daub, thatch, c. 900. No chimney: smoke leaves by a louvre on the ridge. 3 by 3 tile plot.',
    yaw: -0.5,
    plot: 3,
    roots: [{ name: 'house', mesh: m.toMesh('house') }],
  };
}
