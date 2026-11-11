// Square stone keep in the Anglo-Norman manner, c. 1130: battered plinth, flat pilaster
// buttresses, corner turrets, first-floor entrance reached through a forebuilding.
import { MeshBuilder } from '../mesh.mjs';
import { T, RY } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, hangingBanner } from './parts.mjs';

export function build() {
  const m = new MeshBuilder(23);
  const W = 9, H = 14.6, half = W / 2;
  const turret = 2.3, turretH = 17.2;

  // Battered plinth and main block.
  m.color(C.stoneDark, 0.04).frustum(W + 1.1, W + 1.1, W + 0.1, W + 0.1, 1.7, { bottom: false });
  m.color(C.stone, 0.035).at(T(0, 1.2, 0), () => m.box(W, H - 1.2, W, { bottom: false }));

  // Roof: low lead-covered pitch sitting below the wall walk.
  m.color(C.lead, 0.05).at(T(0, H - 0.9, 0), () => m.frustum(W - 1.4, W - 1.4, 0.3, W - 3.4, 1.0, { bottom: false }));

  // Parapet with merlons, on each face between the turrets.
  const span = W - turret * 2 + 0.6;
  for (let side = 0; side < 4; side++) {
    m.at(RY((side * Math.PI) / 2), () => {
      m.color(C.stone, 0.035).at(T(0, H, half - 0.25), () => m.box(span, 0.9, 0.5));
      const n = 3, mw = 0.95;
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * (span / n);
        m.color(C.stoneLight, 0.04).at(T(x, H + 0.9, half - 0.25), () => m.box(mw, 0.85, 0.5));
      }
      // Pilaster buttress at mid-wall and a string course.
      m.color(C.stoneLight, 0.03).at(T(0, 1.6, half + 0.14), () => m.box(1.3, H - 3.2, 0.3));
      m.color(C.stoneLight, 0.02).at(T(0, 5.3, half + 0.05), () => m.box(W - turret * 2 + 0.5, 0.22, 0.14));
      m.at(T(0, 9.6, half + 0.05), () => m.box(W - turret * 2 + 0.5, 0.22, 0.14));

      // Openings: loops low down, round-headed two-light windows at hall level.
      m.color(C.slit);
      for (const x of [-1.75, 1.75]) {
        m.at(T(x, 3.0, half + 0.02), () => m.box(0.16, 1.1, 0.04));
        m.at(T(x, 6.5, half + 0.02), () => m.box(0.2, 1.3, 0.04));
        // Round head approximated by a five-sided top.
        m.at(T(x, 10.6, half + 0.02), () => {
          for (const dx of [-0.3, 0.3]) {
            m.extrude([[dx - 0.2, 0], [dx + 0.2, 0], [dx + 0.2, 1.1], [dx + 0.12, 1.32], [dx, 1.4], [dx - 0.12, 1.32], [dx - 0.2, 1.1]], 0, 0.04, { back: false });
          }
        });
      }
    });
  }

  // Corner turrets, slightly proud, rising above the parapet with their own battlements.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (half - turret / 2 + 0.22), cz = sz * (half - turret / 2 + 0.22);
      m.color(C.stoneLight, 0.035).at(T(cx, 1.3, cz), () => m.box(turret, turretH - 1.3, turret, { bottom: false }));
      m.color(C.lead, 0.04).at(T(cx, turretH - 0.35, cz), () => m.box(turret - 0.7, 0.3, turret - 0.7, { bottom: false }));
      for (const ax of [-1, 1]) {
        for (const az of [-1, 1]) {
          m.color(C.stoneLight, 0.04).at(T(cx + ax * (turret / 2 - 0.3), turretH, cz + az * (turret / 2 - 0.3)), () => m.box(0.6, 0.75, 0.6, { bottom: false }));
        }
      }
      m.color(C.slit).at(T(cx + sx * (turret / 2 + 0.01), 12.2, cz), () => m.box(0.04, 1.0, 0.16));
      m.at(T(cx, 12.2, cz + sz * (turret / 2 + 0.01)), () => m.box(0.16, 1.0, 0.04));
    }
  }

  // Forebuilding on the +X face: covered stair up to the first-floor door.
  const fbW = 2.8, fbL = 7.2, fbH = 8.2;
  m.at(T(half + fbW / 2 - 0.05, 0, -0.6), () => {
    m.color(C.stoneDark, 0.04).frustum(fbW + 0.5, fbL + 0.5, fbW + 0.05, fbL + 0.05, 1.3, { bottom: false });
    m.color(C.stone, 0.035).at(T(0, 1.0, 0), () => m.box(fbW, fbH - 1.0, fbL, { bottom: false }));
    m.color(C.lead, 0.04).at(T(0, fbH - 0.3, 0), () => m.box(fbW - 0.8, 0.25, fbL - 0.8, { bottom: false }));
    // Parapet on the three free sides.
    m.color(C.stoneLight, 0.04);
    for (let i = 0; i < 5; i++) m.at(T(fbW / 2 - 0.22, fbH, -fbL / 2 + 0.5 + i * ((fbL - 1) / 4)), () => m.box(0.44, 0.8, 0.8));
    for (const sz of [-1, 1]) m.at(T(-0.25, fbH, sz * (fbL / 2 - 0.22)), () => m.box(0.85, 0.8, 0.44));
    // Arched doorway at the foot of the stair, facing +Z, with steps leading up to it.
    m.color(C.slit).at(T(0, 1.3, fbL / 2 + 0.01), () =>
      m.extrude([[-0.55, 0], [0.55, 0], [0.55, 1.5], [0.34, 1.95], [0, 2.1], [-0.34, 1.95], [-0.55, 1.5]], 0, 0.04, { back: false }));
    m.color(C.stoneDark, 0.05);
    for (let i = 0; i < 5; i++) m.at(T(0, 0, fbL / 2 + 0.3 + i * 0.4), () => m.box(1.9, 1.3 - i * 0.26, 0.4, { bottom: false }));
    m.color(C.slit);
    for (const z of [-1.6, 0.6]) m.at(T(fbW / 2 + 0.01, 4.6, z), () => m.box(0.04, 1.1, 0.18));
    hangingBanner(m, [0, 7.3, fbL / 2 + 0.06], { width: 1.1, height: 2.6 });
  });

  pennant(m, [half - turret / 2 + 0.22, turretH - 0.05, half - turret / 2 + 0.22], { height: 3.4, length: 2.1, drop: 1.0, yaw: -0.4, pole: 0.07 });

  return {
    id: 'keep',
    label: 'Stone keep',
    note: 'Anglo-Norman great tower: battered plinth, pilaster buttresses, entrance raised to the first floor.',
    yaw: -0.7,
    roots: [{ name: 'keep', mesh: m.toMesh('keep') }],
  };
}
