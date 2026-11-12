// Free-standing timber watchtower: splayed legs, cross-braced, boarded platform, thatched cap.
import { MeshBuilder } from '../mesh.mjs';
import { T, RY, lerp3 } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, hangingBanner } from './parts.mjs';

export function build() {
  const m = new MeshBuilder(41);
  const baseR = 1.7, topR = 1.15, floorY = 6.0, roofY = 8.0;
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const foot = (c) => [c[0] * baseR, 0, c[1] * baseR];
  const head = (c) => [c[0] * topR, floorY, c[1] * topR];
  const on = (c, y) => lerp3(foot(c), head(c), y / floorY);

  m.color(C.timber, 0.06);
  for (const c of corners) m.beam(foot(c), head(c), 0.3, 0.3);
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    m.color(C.timber, 0.06);
    for (const y of [0.25, 2.2, 4.2]) m.beam(on(a, y), on(b, y), 0.16, 0.18);
    // Saltire bracing in the two lower stages; the side with the ladder stays open below.
    m.color(C.timberMid, 0.07);
    for (const [y0, y1] of [[0.3, 2.2], [2.25, 4.2]]) {
      if (i === 3 && y0 < 1) continue;
      m.beam(on(a, y0), on(b, y1), 0.1, 0.12);
      m.beam(on(b, y0), on(a, y1), 0.1, 0.12);
    }
  }

  // Platform, jettied out past the legs, with a plank breastwork.
  const pw = 3.5;
  m.color(C.timber, 0.05);
  for (const z of [-1.15, 0, 1.15]) m.at(T(0, floorY - 0.22, z), () => m.box(pw, 0.2, 0.2));
  m.color(C.plank, 0.08).at(T(0, floorY, 0), () => m.box(pw, 0.1, pw));
  for (let side = 0; side < 4; side++) {
    m.at(RY((side * Math.PI) / 2), () => {
      const n = 8, w = pw / n;
      for (let i = 0; i < n; i++) {
        if (side === 2 && (i === 3 || i === 4)) continue; // gap at the head of the ladder
        m.color(C.plank, 0.09).at(T((i - (n - 1) / 2) * w, floorY + 0.1, pw / 2 - 0.05), () => m.box(w - 0.03, i % 3 === 1 ? 0.8 : 1.15, 0.08));
      }
    });
  }

  // Roof posts and thatched pyramid cap.
  m.color(C.timber, 0.06);
  for (const c of corners) m.at(T(c[0] * (pw / 2 - 0.18), floorY + 0.1, c[1] * (pw / 2 - 0.18)), () => m.box(0.2, roofY - floorY, 0.2));
  m.color(C.thatch, 0.07).at(T(0, roofY, 0), () => m.frustum(pw + 1.0, pw + 1.0, 0.25, 0.25, 2.1));
  m.color(C.thatchDark, 0.05).at(T(0, roofY + 1.95, 0), () => m.frustum(0.6, 0.6, 0.1, 0.1, 0.45, { bottom: false }));

  // Ladder up the -Z side, set steep so that its foot stays on the tower's 3 x 3 tile plot.
  const lx = 0.28, bottom = [0, 0, -baseR - 1.02], topPt = [0, floorY + 0.1, -pw / 2 - 0.02];
  m.color(C.timberLight, 0.06);
  for (const s of [-1, 1]) m.beam([s * lx, bottom[1], bottom[2]], [s * lx, topPt[1], topPt[2]], 0.08, 0.1);
  for (let i = 1; i < 14; i++) {
    const p = lerp3(bottom, topPt, i / 14);
    m.at(T(p[0], p[1], p[2]), () => m.box(lx * 2, 0.06, 0.06));
  }

  hangingBanner(m, [0, floorY + 1.0, pw / 2 + 0.03], { width: 0.95, height: 1.7 });
  pennant(m, [0, roofY + 2.3, 0], { height: 1.5, length: 1.0, drop: 0.48, yaw: -0.3 });

  return {
    id: 'watchtower',
    label: 'Watchtower',
    note: 'Cross-braced timber tower with a jettied platform under a thatched cap.',
    yaw: 0.7,
    plot: 3,
    roots: [{ name: 'watchtower', mesh: m.toMesh('watchtower') }],
  };
}
