// Palisade wall segment and timber gate, as used around a motte-and-bailey castle or a
// fortified village, 10th-12th century. Both are 4 m modules so they tile along X.
import { MeshBuilder } from '../mesh.mjs';
import { T, RY } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, hangingBanner, logRow } from './parts.mjs';

function bank(m, length) {
  // Low earth bank the stakes are set into, grassed on the outer slope.
  m.color(C.earth, 0.05).frustum(length, 2.2, length, 0.9, 0.55, { bottom: false });
  m.color(C.grass, 0.06);
  m.poly([[-length / 2, 0.02, 1.13], [length / 2, 0.02, 1.13], [length / 2, 0.57, 0.47], [-length / 2, 0.57, 0.47]]);
}

export function buildWall() {
  const m = new MeshBuilder(31);
  const L = 4;
  bank(m, L);
  logRow(m, -L / 2, L / 2, 0.45, 3.0, { r: 0.18, z: 0.12, seed: 3 });
  // Rails and a fighting step on the inner (-Z) face.
  m.color(C.timber, 0.06);
  for (const y of [1.5, 2.7]) m.at(T(0, y, -0.1), () => m.box(L, 0.16, 0.12));
  m.color(C.plank, 0.07).at(T(0, 1.75, -0.62), () => m.box(L, 0.08, 0.95));
  m.color(C.timber, 0.06);
  for (const x of [-1.5, 0, 1.5]) {
    m.at(T(x, 0.35, -1.0), () => m.box(0.14, 1.42, 0.14));
    m.beam([x, 1.0, -1.0], [x, 1.72, -0.2], 0.1, 0.1);
  }
  pennant(m, [-1.62, 3.3, 0.12], { height: 1.3, length: 0.75, drop: 0.38, yaw: -0.25 });

  return {
    id: 'palisade',
    label: 'Palisade wall',
    note: 'Sharpened oak stakes on an earth bank, with a fighting step behind. 4 m module.',
    yaw: 0.6,
    roots: [{ name: 'palisade', mesh: m.toMesh('palisade') }],
  };
}

export function buildGate() {
  const m = new MeshBuilder(37);
  const open = 2.8, towerW = 3.7, towerD = 2.6, floorY = 3.5, topY = 5.0;
  const hx = towerW / 2, hz = towerD / 2;

  // Wall stubs either side so the gate joins the palisade module.
  for (const s of [-1, 1]) {
    m.at(T(s * 2.55, 0, 0), () => {
      m.color(C.earth, 0.05).frustum(1.3, 2.2, 1.3, 0.9, 0.55, { bottom: false });
    });
    logRow(m, s > 0 ? hx - 0.05 : -3.2, s > 0 ? 3.2 : -hx + 0.05, 0.45, 3.0, { r: 0.18, z: 0.12, seed: s > 0 ? 9 : 5 });
  }

  // Four great posts carry a boarded fighting platform over the passage.
  m.color(C.timber, 0.06);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) m.at(T(sx * (hx - 0.2), 0, sz * (hz - 0.2)), () => m.box(0.4, topY + 0.1, 0.4));
    // Side framing.
    m.beam([sx * (hx - 0.2), 0.3, -hz + 0.2], [sx * (hx - 0.2), floorY - 0.2, hz - 0.2], 0.16, 0.14);
    m.at(T(sx * (hx - 0.2), 1.9, 0), () => m.box(0.14, 0.18, towerD - 0.4));
  }
  for (const sz of [-1, 1]) m.at(T(0, 3.05, sz * (hz - 0.2)), () => m.box(towerW - 0.4, 0.34, 0.32)); // lintels
  m.color(C.plank, 0.07).at(T(0, floorY - 0.12, 0), () => m.box(towerW + 0.5, 0.14, towerD + 0.5));

  // Plank breastwork with gaps to shoot through.
  m.color(C.plank, 0.08);
  const breast = (len, n, place) => {
    const w = len / n;
    for (let i = 0; i < n; i++) {
      const tall = i % 2 === 0;
      place((i - (n - 1) / 2) * w, () => m.box(w - 0.03, tall ? 1.45 : 0.95, 0.09));
    }
  };
  for (const sz of [-1, 1]) breast(towerW + 0.5, 9, (x, f) => m.at(T(x, floorY, sz * (hz + 0.21)), f));
  for (const sx of [-1, 1]) breast(towerD + 0.5, 6, (z, f) => m.at(T(sx * (hx + 0.21), floorY, z), RY(Math.PI / 2), f));

  // Shingled pyramid roof on the post heads.
  m.color(C.timber, 0.05);
  for (const sz of [-1, 1]) m.at(T(0, topY, sz * (hz - 0.2)), () => m.box(towerW + 0.2, 0.2, 0.26));
  for (const sx of [-1, 1]) m.at(T(sx * (hx - 0.2), topY, 0), () => m.box(0.26, 0.2, towerD + 0.2));
  m.color(C.shingle, 0.1).at(T(0, topY + 0.2, 0), () => m.frustum(towerW + 1.1, towerD + 1.1, towerW * 0.62, towerD * 0.5, 0.75));
  m.color('#77593d', 0.1).at(T(0, topY + 0.95, 0), () => m.frustum(towerW * 0.7, towerD * 0.62, 0.5, 0.16, 1.15));

  // Two-leaf gate, planked and iron-strapped, standing closed.
  for (const s of [-1, 1]) {
    m.at(T(s * (open / 4 + 0.01), 0.1, hz - 0.32), () => {
      m.color(C.plank, 0.08);
      for (let i = 0; i < 4; i++) m.at(T((i - 1.5) * (open / 8), 0, 0), () => m.box(open / 8 - 0.015, 2.9, 0.1));
      m.color(C.iron, 0.04);
      for (const y of [0.45, 1.45, 2.45]) m.at(T(0, y, 0.055), () => m.box(open / 2 - 0.08, 0.12, 0.03));
    });
  }
  m.color(C.timber, 0.05).at(T(0, 1.3, hz - 0.2), () => m.box(open + 0.1, 0.14, 0.1)); // drawbar

  hangingBanner(m, [0, floorY + 1.3, hz + 0.3], { width: 1.0, height: 1.9 });
  pennant(m, [0, topY + 2.0, 0], { height: 1.5, length: 0.95, drop: 0.45, yaw: -0.3 });

  return {
    id: 'gate',
    label: 'Timber gate',
    note: 'Gate tower on four posts with a boarded fighting platform and shingled roof.',
    yaw: -0.42,
    roots: [{ name: 'gate', mesh: m.toMesh('gate') }],
  };
}
