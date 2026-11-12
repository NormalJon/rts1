// Stable, c. 1100: where horsemen are mounted. A low timber range of four open stalls under
// a roof of riven boards, each stall closed by a half-door, and a paddock in front inside a
// post-and-rail fence: a hay rick, a water trough with a saddled horse drinking at it, and
// a tethering rail with saddle blankets thrown over it. A second horse looks out of its stall.
// The plot is 5 x 5 tiles, so everything stays inside 9.4 m square. The stalls and the
// paddock face +Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RY, RZ } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, pitch, groundPatch } from './parts.mjs';
import { JOINT, COATS, standingHorse, paintNeck, paintHead } from './horse.mjs';

export function build() {
  const m = new MeshBuilder(97);
  const L = 8.4, D = 2.9, wallH = 2.2;
  const hl = L / 2, hd = D / 2;
  const zc = -2.8, zf = zc + hd, zb = zc - hd;
  const slope = 0.6, over = 0.25; // a low pitch, about 31 degrees, so the stall fronts show under the eave
  const run = hd + over, rise = run * slope;
  const eaveY = wallH + 0.12 - over * slope; // top surface of the boards at the eave
  const ridgeY = eaveY + rise;
  const on = pitch({ run, rise, eaveY });

  groundPatch(m.color(C.earth, 0.04), [[-4.42, zf - 0.05], [-4.42, 4.08], [-4.12, 4.38], [4.12, 4.38], [4.42, 4.08], [4.42, zf - 0.05]]);

  // Back and end walls of upright planks, one face a plank; the ends run up into the gables.
  const stave = (i) => m.color(i % 2 ? C.plank : C.timberMid, 0.07);
  const nLong = 20, nEnd = 8;
  for (let i = 0; i < nLong; i++) {
    const x0 = -hl + (i * L) / nLong, x1 = -hl + ((i + 1) * L) / nLong;
    stave(i).poly([[x1, 0, zb], [x0, 0, zb], [x0, wallH, zb], [x1, wallH, zb]]);
  }
  const gableY = (z) => wallH + (ridgeY - 0.14 - wallH) * (1 - Math.abs(z - zc) / hd);
  for (let i = 0; i < nEnd; i++) {
    const z0 = zb + (i * D) / nEnd, z1 = zb + ((i + 1) * D) / nEnd;
    stave(i).poly([[hl, 0, z1], [hl, 0, z0], [hl, gableY(z0), z0], [hl, gableY(z1), z1]]);
    stave(i + 1).poly([[-hl, 0, z0], [-hl, 0, z1], [-hl, gableY(z1), z1], [-hl, gableY(z0), z0]]);
  }

  // The front: five posts under a beam make four stalls, each with a half-door of planks and
  // the dark of the stall above it.
  const stalls = 4, bay = L / stalls;
  m.color(C.timber, 0.06);
  for (let i = 0; i <= stalls; i++) m.at(T(-hl + i * bay + (i === 0 ? 0.11 : i === stalls ? -0.11 : 0), 0, zf - 0.05), () => m.box(0.22, wallH, 0.22, { top: false, bottom: false }));
  m.at(T(0, wallH - 0.22, zf - 0.05), () => m.box(L, 0.2, 0.18, { top: false }));
  const doorH = 1.12;
  for (let s = 0; s < stalls; s++) {
    const x0 = -hl + s * bay + 0.11, x1 = x0 + bay - 0.22;
    m.color(C.slit).poly([[x0, doorH, zf - 0.12], [x1, doorH, zf - 0.12], [x1, wallH - 0.2, zf - 0.12], [x0, wallH - 0.2, zf - 0.12]]);
    for (let i = 0; i < 4; i++) {
      const a = x0 + ((x1 - x0) * i) / 4, b = x0 + ((x1 - x0) * (i + 1)) / 4;
      m.color((i + s) % 2 ? C.timberLight : C.plank, 0.08).poly([[a, 0.08, zf - 0.03], [b, 0.08, zf - 0.03], [b, doorH, zf - 0.03], [a, doorH, zf - 0.03]]);
    }
    m.color(C.timber, 0.06).beam([x0, doorH, zf - 0.02], [x1, doorH, zf - 0.02], 0.08, 0.1, { top: false, bottom: false });
  }
  // One horse has its head out over the door.
  const out = -hl + 1.5 * bay;
  m.at(T(out, 1.02, zf - 0.42), RX(0.3), () => {
    paintNeck(m, COATS.dun);
    m.at(T(...JOINT.head), RX(0.15), () => paintHead(m, COATS.dun));
  });

  // Roof of riven boards from eave to ridge, light and dark by turns, under a ridge board
  // and a pole on each slope. Built in a frame turned so the ridge runs along X.
  const nBoards = 14, t = 0.08, gableOver = 0.25;
  const z0 = -hl - gableOver, z1 = hl + gableOver;
  m.at(T(0, 0, zc), RY(-Math.PI / 2), () => {
    for (const s of [-1, 1]) {
      const P = (u, off, z) => [...on(s, u, off), z];
      m.color(C.shingle, 0.05).extrude([on(s, 0, 0), on(s, 1, 0), on(s, 1, -t), on(s, 0, -t)], z0, z1);
      for (let i = 0; i < nBoards; i++) {
        const za = z0 + (i * (z1 - z0)) / nBoards, zb2 = z0 + ((i + 1) * (z1 - z0)) / nBoards;
        const foot = -0.01 - ((i * 5) % 3) * 0.03;
        const board = [P(foot, 0.016, zb2), P(foot, 0.016, za), P(1, 0.016, za), P(1, 0.016, zb2)];
        m.color(i % 2 ? C.plank : C.timberLight, 0.08).poly(s > 0 ? board : board.reverse());
      }
      m.color(C.bark, 0.07).rod(P(0.45, 0.07, z0 - 0.05), P(0.45, 0.07, z1 + 0.05), 0.055, 5);
    }
  });
  m.color(C.timber, 0.05).beam([-hl - gableOver - 0.06, ridgeY + 0.035, zc], [hl + gableOver + 0.06, ridgeY + 0.035, zc], 0.09, 0.26);

  // ---- Paddock -----------------------------------------------------------------------------
  // Post-and-rail fence, open at a gate in front.
  const fx = 4.48, fz = 4.42, gate = 0.95;
  const rail = (a, b) => {
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.75));
    m.color(C.timber, 0.07);
    for (let i = 0; i <= n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n, z = a[1] + ((b[1] - a[1]) * i) / n;
      if (i > 0 || a.first !== false) m.at(T(x, 0, z), () => m.box(0.15, 1.28, 0.15, { bottom: false }));
    }
    m.color(C.timberLight, 0.08);
    for (const y of [0.55, 1.05]) m.beam([a[0], y, a[1]], [b[0], y, b[1]], 0.07, 0.13);
  };
  for (const sx of [-1, 1]) {
    rail([sx * fx, zf + 0.45], [sx * fx, fz]);
    rail(Object.assign([sx * fx, fz], { first: false }), [sx * gate, fz]);
  }

  // Hay rick: a round stack raked to a point about its pole, with a hay fork leant on it.
  m.at(T(-2.9, 0, 2.3), () => {
    m.color(C.thatchMid, 0.07).cyl(1.0, 1.08, 0.85, 8, { top: false, bottom: false, phase: 0.2 });
    m.color(C.thatch, 0.07).at(T(0, 0.85, 0), () => m.cyl(1.12, 0.1, 1.45, 8, { bottom: false, phase: 0.2 }));
    m.color(C.timber, 0.06).at(T(0, 2.2, 0), () => m.cyl(0.045, 0.035, 0.4, 4, { bottom: false }));
    m.at(T(1.0, 0, 0.75), RZ(0.3), RX(-0.25), () => {
      m.color(C.timberLight, 0.06).box(0.045, 1.5, 0.045, { bottom: false });
      for (const s of [-1, 1]) m.rod([0, 1.45, 0], [s * 0.1, 1.82, 0.03], 0.02, 3, { rt: 0.01, bottom: false });
    });
  });

  // Water trough of planks, and a saddled horse with its head down to drink.
  m.at(T(2.05, 0, 2.25), () => {
    m.color(C.plank, 0.08).frustum(0.5, 1.5, 0.6, 1.62, 0.44, { top: false, bottom: false });
    m.color(C.water, 0.04).poly([[-0.28, 0.36, 0.78], [0.28, 0.36, 0.78], [0.28, 0.36, -0.78], [-0.28, 0.36, -0.78]]);
    m.color(C.timber, 0.06);
    for (const sz of [-1, 1]) m.at(T(0, 0, sz * 0.84), () => m.box(0.7, 0.5, 0.07, { bottom: false }));
  });
  m.at(T(0.42, 0, 2.2), RY(Math.PI / 2), () => standingHorse(m, { coat: COATS.bay, neck: 1.02, head: -0.15, saddled: true }));

  // Tethering rail near the stalls, with saddle blankets over it in the owner's colour.
  const tz = 0.25;
  m.color(C.timber, 0.06);
  for (const x of [1.3, 3.7]) m.at(T(x, 0, tz), () => m.box(0.14, 1.08, 0.14, { bottom: false }));
  m.color(C.timberLight, 0.07).beam([1.12, 1.0, tz], [3.88, 1.0, tz], 0.1, 0.1);
  for (const [x, w] of [[1.95, 0.62], [2.95, 0.7]]) {
    m.team().at(T(x, 0, tz), RY(-Math.PI / 2), () => m.extrude([[-0.1, 0.5], [0.11, 0.62], [0.065, 1.07], [-0.06, 1.07]], -w / 2, w / 2));
  }

  // A saddle waiting on the rail beside them, and a bucket by the trough.
  m.color(C.leather, 0.06).at(T(2.45, 1.05, tz), () => {
    m.frustum(0.3, 0.44, 0.22, 0.4, 0.1, { bottom: false });
    m.at(T(0, 0.1, -0.17), () => m.box(0.2, 0.09, 0.06, { bottom: false }));
  });
  m.at(T(1.45, 0, 3.3), () => {
    m.color(C.plank, 0.08).cyl(0.15, 0.18, 0.3, 6, { top: false, bottom: false });
    m.color(C.water, 0.04).at(T(0, 0.24, 0), () => m.cyl(0.165, 0.165, 0.01, 6, { bottom: false }));
  });

  // The owner's pennant on the ridge, flying back along the roof so it stays over the plot.
  pennant(m, [hl + gableOver - 0.35, ridgeY + 0.05, zc], { height: 1.4, length: 1.35, drop: 0.6, yaw: Math.PI + 0.35, pole: 0.045 });

  return {
    id: 'stable',
    label: 'Stable',
    note: 'Four open stalls under riven boards, and a railed paddock with a hay rick, a trough and a horse drinking at it. Trains horsemen on a 5 by 5 tile plot.',
    yaw: -0.5,
    plot: 5,
    roots: [{ name: 'stable', mesh: m.toMesh('stable') }],
  };
}
