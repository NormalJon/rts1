// Parts shared between models.
import { T, RY } from '../math.mjs';
import { C } from '../palette.mjs';

/**
 * A pole with a swallow-tailed pennant in TeamColor.
 * base: [x, y, z] of the pole foot. The pennant flies towards +X before `yaw`.
 */
export function pennant(m, base, { height = 1.6, length = 0.9, drop = 0.45, yaw = 0, pole = 0.035 } = {}) {
  m.at(T(...base), RY(yaw), () => {
    m.color(C.pole, 0.04).cyl(pole, pole * 0.8, height, 5);
    const top = height - 0.05;
    const mid = top - drop / 2;
    // Two faces so the cloth shows from both sides.
    const cloth = [
      [0, top, 0], [length, top - drop * 0.12, 0], [length * 0.72, mid, 0], [length, top - drop * 0.88, 0], [0, top - drop, 0],
    ];
    m.team();
    // The swallow tail is concave, so split it into two convex pieces.
    const upper = [cloth[0], cloth[4], cloth[2], cloth[1]];
    const lower = [cloth[4], cloth[3], cloth[2]];
    for (const z of [0.012, -0.012]) {
      const lift = (p) => [p[0], p[1], z];
      const a = upper.map(lift), b = lower.map(lift);
      if (z > 0) {
        m.poly([a[0], a[1], a[2], a[3]]);
        m.poly([b[0], b[1], b[2]]);
      } else {
        m.poly([a[3], a[2], a[1], a[0]]);
        m.poly([b[2], b[1], b[0]]);
      }
    }
  });
}

/** A rectangular hanging banner in TeamColor with a pointed foot, facing +Z. */
export function hangingBanner(m, topCentre, { width = 0.9, height = 1.6 } = {}) {
  const w = width / 2;
  m.at(T(...topCentre), () => {
    m.color(C.pole, 0.04).box(width + 0.24, 0.06, 0.06);
    m.team();
    const pts = [[-w, 0, 0], [-w, -height * 0.8, 0], [0, -height, 0], [w, -height * 0.8, 0], [w, 0, 0]];
    m.poly(pts.map((p) => [p[0], p[1], 0.035]));
    m.poly([...pts].reverse().map((p) => [p[0], p[1], 0.012]));
  });
}

/** Row of sharpened logs along X from x0 to x1, standing on y0. */
export function logRow(m, x0, x1, y0, height, { r = 0.18, z = 0, seed = 0 } = {}) {
  const n = Math.max(1, Math.round((x1 - x0) / (r * 2)));
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    // Deterministic per-log variation so a wall does not look machine-made.
    const k = Math.sin((i + seed) * 12.9898) * 43758.5453;
    const f = k - Math.floor(k);
    const h = height + (f - 0.5) * 0.35;
    const rr = r * (0.9 + f * 0.18);
    m.at(T(x0 + step * (i + 0.5), y0, z + (f - 0.5) * 0.05), RY(f * 3), () => {
      m.color(i % 2 ? C.timberMid : C.plank, 0.07).cyl(rr, rr * 0.95, h, 6, { top: false, bottom: false });
      m.at(T(0, h, 0), () => m.color(C.timberLight, 0.05).cyl(rr * 0.95, 0, 0.42, 6, { bottom: false }));
    });
  }
}
