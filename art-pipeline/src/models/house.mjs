// Peasant longhouse, c. 1100: earth-fast timber posts, wattle-and-daub infill, steep thatch.
// No chimney (smoke left through the thatch); door in the long side.
import { MeshBuilder } from '../mesh.mjs';
import { T, RZ, RY } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant } from './parts.mjs';

export function build() {
  const m = new MeshBuilder(11);
  const W = 5.0, L = 8.4, wallH = 1.8;
  const hw = W / 2, hl = L / 2;
  const slope = 1.112; // rise per metre of run, about 48 degrees
  const over = 0.45, gableOver = 0.4, thick = 0.42;
  const eaveY = wallH + 0.15 - over * slope; // top surface of the thatch at the eave
  const ridgeY = eaveY + (hw + over) * slope;

  // Walls: one pentagonal prism, daub coloured.
  const gableTop = ridgeY - thick + 0.18;
  m.color(C.daub, 0.03).extrude([[-hw, 0], [hw, 0], [hw, wallH], [0, gableTop], [-hw, wallH]], -hl, hl);

  // Timber frame standing slightly proud of the daub.
  const post = 0.22, proud = 0.05;
  m.color(C.timber, 0.06);
  const bays = [-hl + post / 2, -hl * 0.5, 0, hl * 0.5, hl - post / 2];
  for (const sx of [-1, 1]) {
    for (const z of bays) m.at(T(sx * (hw + proud - post / 2), 0, z), () => m.box(post, wallH, post));
    m.at(T(sx * (hw + proud - 0.08), 0, 0), () => m.box(0.16, 0.2, L)); // sill beam
    m.at(T(sx * (hw + proud - 0.08), wallH - 0.2, 0), () => m.box(0.16, 0.2, L)); // wall plate
  }
  for (const sz of [-1, 1]) {
    const z = sz * (hl + proud - 0.08);
    m.at(T(0, 0, z), () => m.box(W, 0.2, 0.16));
    m.at(T(0, wallH - 0.1, z), () => m.box(W + 0.1, 0.2, 0.16)); // tie beam
    m.at(T(0, 0, z), () => m.box(post, gableTop - 0.5, 0.16)); // king post
    for (const sx of [-1, 1]) {
      m.at(T(sx * hw * 0.5, 0, z), () => m.box(0.16, wallH, 0.16));
      // Raking strut from tie beam up towards the ridge.
      m.beam([sx * hw * 0.72, wallH, z], [sx * 0.1, gableTop - 0.75, z], 0.14, 0.16);
    }
  }

  // Thatch laid in three overlapping courses per slope, each butt edge standing proud of
  // the course below, capped by a darker ridge roll.
  const z0 = -hl - gableOver, z1 = hl + gableOver;
  const run = hw + over, rise = ridgeY - eaveY;
  const sl = Math.hypot(run, rise);
  const courses = [[0, 0.4, C.thatch], [0.36, 0.72, C.thatchMid], [0.68, 1, C.thatch]];
  const perp = thick * (run / sl); // slab thickness measured square to the slope
  for (const s of [-1, 1]) {
    const nx = (s * rise) / sl, ny = run / sl; // outward normal of this slope
    const at = (u, off) => [s * run * (1 - u) + nx * off, eaveY + rise * u + ny * off];
    courses.forEach(([u0, u1, col], k) => {
      const lift = 0.075 * k;
      m.color(col, 0.05).extrude([at(u0, lift), at(u1, lift), at(u1, -perp), at(u0, -perp)], z0 - 0.02 * k, z1 + 0.02 * k);
    });
    m.color(C.thatchDark, 0.05).extrude([at(0.84, 0.24), at(1.02, 0.24), at(1.02, 0.1), at(0.84, 0.1)], z0 - 0.06, z1 + 0.06);
  }
  // Smoke louvre on the ridge over the hearth.
  m.at(T(0, ridgeY + 0.2, -0.9), () => {
    m.color(C.timber, 0.05);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.at(T(sx * 0.2, 0, sz * 0.3), () => m.box(0.07, 0.3, 0.07));
    m.color(C.thatchDark, 0.05).at(T(0, 0.28, 0), () => m.extrude([[-0.36, 0], [0.36, 0], [0, 0.3]], -0.46, 0.46));
  });

  // Door in the long side (+X), plank-built, with a threshold stone.
  const doorZ = 0.45;
  m.at(T(hw + proud, 0, doorZ), () => {
    m.color(C.plank, 0.07);
    for (let i = 0; i < 4; i++) m.at(T(0.03, 0.08, -0.36 + i * 0.24), () => m.box(0.06, 1.42, 0.22));
    m.color(C.timber, 0.05);
    m.at(T(0.02, 0, -0.56), () => m.box(0.14, 1.62, 0.14));
    m.at(T(0.02, 0, 0.56), () => m.box(0.14, 1.62, 0.14));
    m.at(T(0.02, 1.5, 0), () => m.box(0.16, 0.14, 1.26));
    m.color(C.stoneDark, 0.05).at(T(0.28, 0, 0), () => m.box(0.5, 0.07, 1.0));
  });
  // Small shuttered window opening.
  m.at(T(hw + proud, 0.95, -2.6), () => {
    m.color(C.slit).box(0.04, 0.42, 0.4);
    m.color(C.plank, 0.06).at(T(0.02, 0, 0.36), () => m.box(0.05, 0.42, 0.3));
    m.color(C.timber).at(T(0.01, -0.07, 0.07), () => m.box(0.1, 0.07, 0.85));
  });

  // Woodpile against the wall.
  m.at(T(hw + 0.42, 0, 2.55), () => {
    const r = 0.13;
    const rows = [4, 3, 2];
    rows.forEach((n, row) => {
      for (let i = 0; i < n; i++) {
        const z = (i - (n - 1) / 2) * r * 2.05;
        m.at(T(-0.3, r + row * r * 1.75, z), RZ(-Math.PI / 2), RY(i * 1.3), () => {
          m.color(C.bark, 0.08).cyl(r, r, 0.6, 6, { top: false, bottom: false });
          m.color(C.timberLight, 0.06).cyl(r, r, 0.6, 6, { top: true, bottom: true });
        });
      }
    });
  });

  // Wattle fence closing a small yard at the door side.
  const fence = (a, b) => {
    const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.6);
    for (let i = 0; i <= n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n, z = a[1] + ((b[1] - a[1]) * i) / n;
      m.color(C.timberMid, 0.08).at(T(x, 0, z), () => m.cyl(0.045, 0.035, 0.95, 5, { bottom: false }));
    }
    m.color(C.timberLight, 0.08);
    for (const y of [0.3, 0.52, 0.74]) m.beam([a[0], y, a[1]], [b[0], y, b[1]], 0.16, 0.05);
  };
  fence([hw + 2.3, -3.6], [hw + 2.3, -0.6]);
  fence([hw + 0.25, -3.6], [hw + 2.3, -3.6]);

  // Chopping block.
  m.at(T(hw + 1.35, 0, -1.9), () => {
    m.color(C.bark, 0.06).cyl(0.28, 0.26, 0.4, 7, { top: false });
    m.at(T(0, 0.4, 0), () => m.color(C.timberLight, 0.04).cyl(0.26, 0.26, 0.03, 7, { bottom: false }));
  });

  pennant(m, [0, ridgeY + 0.1, hl + gableOver - 0.2], { height: 1.5, length: 0.85, drop: 0.42, yaw: 0.5 });

  return {
    id: 'house',
    label: 'Peasant house',
    note: 'Timber posts, wattle-and-daub, thatch. No chimney: smoke left through the roof.',
    yaw: -0.95,
    roots: [{ name: 'house', mesh: m.toMesh('house') }],
  };
}
