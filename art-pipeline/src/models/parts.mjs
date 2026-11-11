// Parts shared between models.
import { T, RX, RY } from '../math.mjs';
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

// ---- Roofs ---------------------------------------------------------------------------

/**
 * A gable roof seen end on, ridge along local Z. `run` and `rise` are measured on the top
 * surface from eave to ridge. Returns a function giving the point on slope s (-1 or 1) at
 * u (0 at the eave, 1 at the ridge) and `off` metres out from the surface, square to it.
 */
export function pitch({ run, rise, eaveY }) {
  const sl = Math.hypot(run, rise);
  const on = (s, u, off = 0) => [s * run * (1 - u) + ((s * rise) / sl) * off, eaveY + rise * u + (run / sl) * off];
  return Object.assign(on, { sl });
}

/**
 * Thatch on both slopes, laid as on the house: overlapping courses, each butt edge proud of
 * the one below, under a darker ridge roll. Returns the height of the roll above the surface.
 */
export function thatch(m, roof, { z0, z1, thick, courses, step = 0.06, roll = 0.16, back = true }) {
  const on = pitch(roof);
  const perp = thick * (roof.run / on.sl); // slab thickness measured square to the slope
  const top = step * (courses.length - 1);
  const u = 1 - (roll * 4.2) / on.sl;
  for (const s of [-1, 1]) {
    courses.forEach(([u0, u1, col], k) => {
      const lift = step * k;
      m.color(col, 0.05).extrude([on(s, u0, lift), on(s, u1, lift), on(s, u1, -perp), on(s, u0, -perp)], z0 - 0.02 * k, z1 + 0.02 * k, { back });
    });
    m.color(C.thatchDark, 0.05).extrude([on(s, u, top + roll), on(s, 1.02, top + roll), on(s, 1.02, top - 0.05), on(s, u, top - 0.05)], z0 - 0.06, z1 + 0.06, { back });
  }
  return { top: top + roll, from: u };
}

/** Gable boards at one end of a roof, lapped where they cross and carried on above the ridge. */
export function gableBoards(m, roof, z, { out = 1, past = 0.17, w = 0.1, d = 0.24 } = {}) {
  const on = pitch(roof);
  m.color(C.timber, 0.06);
  [-1, 1].forEach((s, k) => {
    const at = (u) => [...on(s, u, -d * 0.35), z + out * w * (0.5 + 0.5 * k)];
    m.beam(at(-0.01), at(1 + past), w, d);
  });
}

/**
 * Thatch on a hipped roof, ridge along X, centred on the origin of the current frame.
 * `ex` and `ez` are the half-lengths of the eave, `hip` the run of each hipped end (equal to
 * `ez` for hips as steep as the sides). Laid in courses like `thatch`, each a ring standing
 * `step` proud of the one below, over butt ends cut back under the eave and under a ridge
 * roll. With `gablet` the top course stops in an upright end with a smoke hole in it, as on
 * a longhouse. Returns the height of the top of the roll.
 */
export function hippedThatch(m, { ex, ez, hip = ez, rise, eaveY }, { courses, step = 0.06, butt = 0.2, gablet = false }) {
  const sl = Math.hypot(ez, rise);
  const hx = (u) => ex - hip * u, hz = (u) => ez * (1 - u);
  m.color(C.thatchDark, 0.05).at(T(0, eaveY - butt, 0), () =>
    m.frustum(2 * (ex - butt * 0.55), 2 * (ez - butt * 0.55), 2 * ex, 2 * ez, butt, { top: false }));
  let ridge = null;
  courses.forEach(([u0, u1, col], k) => {
    const out = (step * k * rise) / sl, up = (step * k * ez) / sl;
    const y0 = eaveY + rise * u0 + up, h = rise * (u1 - u0);
    const x0 = hx(u0) + out, z0 = hz(u0) + out;
    const upright = gablet && k === courses.length - 1;
    const x1 = upright ? x0 : hx(u1) + out;
    m.color(col, 0.05).at(T(0, y0, 0), () => m.frustum(2 * x0, 2 * z0, 2 * x1, 2 * (hz(u1) + out), h, { top: false, bottom: false }));
    if (upright) {
      for (const s of [-1, 1]) {
        const x = s * (x0 + 0.012);
        const hole = [[x, y0 + h * 0.14, z0 * 0.62], [x, y0 + h * 0.14, -z0 * 0.62], [x, y0 + h * 0.8, 0]];
        m.color(C.slit).poly(s > 0 ? hole : [hole[1], hole[0], hole[2]]);
      }
    }
    ridge = { y: y0 + h, x: x1 };
  });
  m.color(C.thatchDark, 0.05).at(T(0, ridge.y - 0.12, 0), () =>
    m.frustum(2 * (ridge.x + (gablet ? 0.07 : 0.2)), 0.66, 2 * (ridge.x + (gablet ? 0.07 : 0.04)), 0.22, 0.28, { bottom: false }));
  return ridge.y + 0.16;
}

// ---- Yards and stores ----------------------------------------------------------------

/** A flat patch of ground from [x, z] corners in either winding: trodden earth, a garden bed. */
export function groundPatch(m, corners, y = 0.03) {
  let area = 0;
  corners.forEach((p, i) => {
    const q = corners[(i + 1) % corners.length];
    area += p[0] * q[1] - q[0] * p[1];
  });
  m.poly((area > 0 ? [...corners].reverse() : corners).map(([x, z]) => [x, y, z]));
}

/**
 * Stakes and withy rails from a to b, given as [x, z]: the yard fence of the hall. Leave out
 * the `first` or `last` stake where another run or a gate post already stands.
 */
export function stakeFence(m, a, b, { first = true, last = true, spacing = 1.1, height = 0.98, rails = [0.3, 0.52, 0.74] } = {}) {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
  m.color(C.timberMid, 0.08);
  for (let i = first ? 0 : 1; i <= (last ? n : n - 1); i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n, z = a[1] + ((b[1] - a[1]) * i) / n;
    m.at(T(x, 0, z), () => m.cyl(0.055, 0.04, height, 4, { bottom: false, phase: i }));
  }
  m.color(C.timberLight, 0.08);
  for (const y of rails) m.beam([a[0], y, a[1]], [b[0], y, b[1]], 0.16, 0.05);
}

/** A flat n-sided disc at height y, facing up or down: the cut end of a log, the lid of a tub. */
export function disc(m, r, y, sides, { phase = 0, up = true } = {}) {
  const ring = Array.from({ length: sides }, (_, i) => {
    const a = phase + (i / sides) * Math.PI * 2;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  });
  m.poly(up ? ring.reverse() : ring);
}

/**
 * Logs stacked in rows from the ground up, lying along +Z from z = 0, bark outside and the
 * cut ends pale. `rows` is the number of logs in each row; `ragged` staggers the ends and
 * `barks` are the colours the logs take in turn.
 */
export function logPile(m, rows, { r = 0.14, length = 0.62, sides = 5, back = true, ragged = 0, barks = [C.bark] } = {}) {
  rows.forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      const k = Math.sin((i * 7 + row * 3 + 1) * 12.9898) * 43758.5453;
      const f = k - Math.floor(k);
      const x = (i - (n - 1) / 2) * r * 2.05;
      m.at(T(x, r + row * r * 1.75, (f - 0.5) * ragged), RX(Math.PI / 2), RY(i * 1.3 + row), () => {
        m.color(barks[(i + row * 2) % barks.length], 0.08).cyl(r, r, length, sides, { top: false, bottom: false });
        m.color(C.timberLight, 0.06);
        disc(m, r, length, sides);
        if (back) disc(m, r, 0, sides, { up: false });
      });
    }
  });
}

/** A round wicker basket, wider at the rim. `fill` heaps it with grain or ore of that colour. */
export function basket(m, { r = 0.27, h = 0.36, fill = null, heap = 0.12 } = {}) {
  m.color(C.wicker, 0.09).cyl(r * 0.76, r, h, 7, { top: false, bottom: false });
  if (fill) m.color(fill, 0.09).at(T(0, h - 0.04, 0), () => m.cyl(r * 0.95, 0, heap + 0.04, 7, { bottom: false }));
  else m.color(C.timber, 0.05).at(T(0, h * 0.4, 0), () => disc(m, r * 0.85, 0, 7));
}

/** A stave-built tub with a lid. */
export function tub(m, { r = 0.36, h = 0.62 } = {}) {
  m.color(C.plank, 0.08).cyl(r * 0.86, r, h, 8, { top: false, bottom: false });
  m.color(C.timberLight, 0.05).at(T(0, h - 0.04, 0), () => m.cyl(r * 1.04, r * 1.04, 0.06, 8, { bottom: false }));
}

/**
 * A round shield lying flat with its face up: TeamColor board, iron boss, plank back.
 * Turn it with at() to hang or lean it.
 */
export function roundShield(m, r = 0.42) {
  m.team().cyl(r, r, 0.05, 8, { bottom: false, phase: Math.PI / 8 });
  m.color(C.plank, 0.05);
  disc(m, r, 0, 8, { phase: Math.PI / 8, up: false });
  m.color(C.iron, 0.04).at(T(0, 0.05, 0), () => m.cyl(r * 0.26, 0, r * 0.2, 6, { bottom: false }));
}
