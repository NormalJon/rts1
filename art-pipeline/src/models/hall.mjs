// Timber great hall, c. 900: the hall of a lord or a village in the Anglo-Saxon and Carolingian
// manner, and the town centre of the first age. Earth-fast posts, upright plank walls, steep
// thatch, gable boards crossed above the ridge. No chimney: smoke left by a gap under each
// gable peak. A door in each long side, the front one under a porch.
// The plot is 5 x 5 tiles, so everything stays inside 9.4 m square; the hall stands at the back
// of it and a fenced forecourt takes the front. The porch side faces +Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RY } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, hangingBanner } from './parts.mjs';

/**
 * A gable roof seen end on, ridge along local Z. `run` and `rise` are measured on the top
 * surface from eave to ridge. Returns a function giving the point on slope s (-1 or 1) at
 * u (0 at the eave, 1 at the ridge) and `off` metres out from the surface, square to it.
 */
function pitch({ run, rise, eaveY }) {
  const sl = Math.hypot(run, rise);
  const on = (s, u, off = 0) => [s * run * (1 - u) + ((s * rise) / sl) * off, eaveY + rise * u + (run / sl) * off];
  return Object.assign(on, { sl });
}

/**
 * Thatch on both slopes, laid as on the house: overlapping courses, each butt edge proud of
 * the one below, under a darker ridge roll. Returns the height of the roll above the surface.
 */
function thatch(m, roof, { z0, z1, thick, courses, step = 0.06, roll = 0.16, back = true }) {
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
function gableBoards(m, roof, z, { out = 1, past = 0.17, w = 0.1, d = 0.24 } = {}) {
  const on = pitch(roof);
  m.color(C.timber, 0.06);
  [-1, 1].forEach((s, k) => {
    const at = (u) => [...on(s, u, -d * 0.35), z + out * w * (0.5 + 0.5 * k)];
    m.beam(at(-0.01), at(1 + past), w, d);
  });
}

export function build() {
  const m = new MeshBuilder(17);
  const L = 8.0, W = 5.6, wallH = 2.1;
  const hl = L / 2, hw = W / 2;
  const zc = -1.05; // centre line of the hall, set back to leave the forecourt
  const zf = zc + hw, zb = zc - hw; // front and back wall planes
  const slope = 1.15; // rise per metre of run, about 49 degrees
  const over = 0.45, gableOver = 0.4, thick = 0.42;
  const run = hw + over, rise = run * slope;
  const eaveY = wallH + 0.15 - over * slope; // top surface of the thatch at the eave
  const ridgeY = eaveY + rise;
  const gableTop = ridgeY - thick + 0.18;

  // Trodden earth of the forecourt.
  m.color(C.earth, 0.04).poly([[-4.45, 0.03, 4.2], [-4.15, 0.03, 4.47], [4.15, 0.03, 4.47], [4.45, 0.03, 4.2], [4.45, 0.03, zf - 0.05], [-4.45, 0.03, zf - 0.05]]);

  // Walls of upright planks set edge to edge: one face per plank.
  const stave = (i) => m.color(i % 2 ? C.plank : C.timberMid, 0.07);
  const nLong = 20, nGable = 14;
  for (let i = 0; i < nLong; i++) {
    const x0 = -hl + (i * L) / nLong, x1 = -hl + ((i + 1) * L) / nLong;
    stave(i).poly([[x0, 0, zf], [x1, 0, zf], [x1, wallH, zf], [x0, wallH, zf]]);
    stave(i + 1).poly([[x1, 0, zb], [x0, 0, zb], [x0, wallH, zb], [x1, wallH, zb]]);
  }
  const gableY = (z) => wallH + (gableTop - wallH) * (1 - Math.abs(z - zc) / hw);
  for (let i = 0; i < nGable; i++) {
    const z0 = zb + (i * W) / nGable, z1 = zb + ((i + 1) * W) / nGable;
    stave(i).poly([[hl, 0, z1], [hl, 0, z0], [hl, gableY(z0), z0], [hl, gableY(z1), z1]]);
    stave(i + 1).poly([[-hl, 0, z0], [-hl, 0, z1], [-hl, gableY(z1), z1], [-hl, gableY(z0), z0]]);
  }

  // Principal posts standing proud of the planking, their heads lost in the thatch.
  const post = 0.26, proud = 0.06;
  m.color(C.timber, 0.06);
  for (const x of [-hl - proud + post / 2, -hl / 2, hl / 2, hl + proud - post / 2]) {
    for (const z of [zf + proud - post / 2, zb - proud + post / 2]) {
      m.at(T(x, 0, z), () => m.box(post, wallH, post, { top: false, bottom: false }));
    }
  }
  for (const s of [-1, 1]) {
    const x = s * (hl + proud - 0.08);
    m.color(C.timber, 0.06);
    m.at(T(x, wallH - 0.1, zc), () => m.box(0.16, 0.2, W + 0.1)); // tie beam
    for (const dz of [-hw / 3, hw / 3]) m.at(T(x, 0, zc + dz), () => m.box(0.16, wallH - 0.1, 0.16, { top: false, bottom: false }));
    m.at(T(x, wallH + 0.1, zc), () => m.box(0.16, gableTop - wallH - 1.1, 0.2, { bottom: false })); // king post
    // Smoke gap under the peak.
    const gx = s * (hl + 0.012);
    const gap = [[gx, gableTop - 0.95, zc + 0.42], [gx, gableTop - 0.95, zc - 0.42], [gx, gableTop - 0.3, zc]];
    m.color(C.slit).poly(s > 0 ? gap : [gap[1], gap[0], gap[2]]);
  }
  // Raking shores against the back wall, as on excavated halls of the period.
  m.color(C.timberMid, 0.07);
  for (const x of [-hl + 0.2, -hl / 2, hl / 2, hl - 0.2]) {
    m.beam([x, -0.05, zb - 0.6], [x, 1.62, zb - 0.07], 0.16, 0.16, { top: false, bottom: false });
  }

  // Main roof, built in a frame turned so the ridge runs along X.
  const roof = { run, rise, eaveY };
  m.at(T(0, 0, zc), RY(-Math.PI / 2), () => {
    const ridge = thatch(m, roof, {
      thick, z0: -hl - gableOver, z1: hl + gableOver,
      courses: [[0, 0.3, C.thatch], [0.27, 0.55, C.thatchMid], [0.52, 0.79, C.thatch], [0.76, 1, C.thatchMid]],
    });
    for (const end of [-1, 1]) gableBoards(m, roof, end * (hl + gableOver + 0.06), { out: end });
    // Paired timbers hung astride the ridge to hold the roll down in a wind.
    const on = pitch(roof);
    m.color(C.timber, 0.07);
    for (const z of [-2.9, -1.45, 0, 1.45, 2.9]) {
      [-1, 1].forEach((s, k) => {
        const at = (u) => [...on(s, u, ridge.top + 0.045), z + (k - 0.5) * 0.1];
        m.beam(at(1 - 0.6 / on.sl), at(1 + 0.24 / on.sl), 0.09, 0.09);
      });
    }
  });

  // Doors: planked, in a heavy frame. The back one opens straight onto the yard behind.
  const door = () => {
    for (let i = 0; i < 4; i++) {
      const x0 = -0.6 + i * 0.3, x1 = x0 + 0.3;
      m.color(i % 2 ? C.timberLight : C.plank, 0.07).poly([[x0, 0.05, 0.05], [x1, 0.05, 0.05], [x1, 1.85, 0.05], [x0, 1.85, 0.05]]);
    }
    m.color(C.timber, 0.05);
    for (const sx of [-1, 1]) m.at(T(sx * 0.67, 0, 0.04), () => m.box(0.16, 1.95, 0.18, { bottom: false }));
    m.at(T(0, 1.83, 0.04), () => m.box(1.62, 0.18, 0.2));
    m.color(C.stoneDark, 0.05).at(T(0, 0, 0.32), () => m.box(1.1, 0.07, 0.5, { bottom: false }));
  };
  m.at(T(0, 0, zf), door);
  m.at(T(0, 0, zb), RY(Math.PI), door);

  // Porch over the front door: two posts, a tie beam, a planked gable and its own thatch.
  const pw = 1.15, pd = 1.25, pz = zf + pd;
  const pEave = 2.02, pRun = pw + 0.25, pRise = pRun * slope;
  m.color(C.timber, 0.06);
  for (const sx of [-1, 1]) {
    m.at(T(sx * (pw - 0.1), 0, pz - 0.1), () => m.box(0.2, 1.95, 0.2, { top: false, bottom: false }));
    m.at(T(sx * (pw - 0.1), 1.8, zf + pd / 2), () => m.box(0.14, 0.16, pd, { top: false })); // side plate
    m.color(C.plank, 0.08).at(T(sx * (pw - 0.1), 0, zf + pd / 2 - 0.05), () => m.box(0.07, 1.0, pd - 0.3, { bottom: false }));
    m.color(C.timber, 0.06);
  }
  m.at(T(0, 1.9, pz - 0.1), () => m.box(pw * 2 + 0.24, 0.2, 0.2));
  m.color(C.plank, 0.06).poly([[-pw, 2.08, pz], [pw, 2.08, pz], [0, 2.08 + pw * slope, pz]]);
  const porch = { run: pRun, rise: pRise, eaveY: pEave };
  const pFront = pz + 0.26;
  thatch(m, porch, { thick: 0.3, z0: zf - 1.4, z1: pFront, courses: [[0, 0.56, C.thatchMid], [0.5, 1, C.thatch]], roll: 0.12, back: false });
  gableBoards(m, porch, pFront + 0.06, { past: 0.2, w: 0.08, d: 0.18 });

  // Owner's colours at the entrance: a banner hung from the porch gable and a round shield on each post.
  hangingBanner(m, [0, 3.04, pFront + 0.25], { width: 1.0, height: 1.22 });
  for (const sx of [-1, 1]) {
    m.at(T(sx * (pw + 0.16), 1.26, pz), RX(Math.PI / 2), () => {
      m.team().cyl(0.43, 0.43, 0.05, 8, { bottom: false, phase: Math.PI / 8 });
      m.color(C.iron, 0.04).at(T(0, 0.05, 0), () => m.cyl(0.11, 0, 0.09, 6, { bottom: false }));
    });
  }

  // Forecourt fence: stakes and withy rails, open in front of the porch.
  const fence = (a, b, first = true) => {
    const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.1);
    m.color(C.timberMid, 0.08);
    for (let i = first ? 0 : 1; i <= n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n, z = a[1] + ((b[1] - a[1]) * i) / n;
      m.at(T(x, 0, z), () => m.cyl(0.055, 0.04, 0.98, 4, { bottom: false, phase: i }));
    }
    m.color(C.timberLight, 0.08);
    for (const y of [0.3, 0.52, 0.74]) m.beam([a[0], y, a[1]], [b[0], y, b[1]], 0.16, 0.05, { top: false, bottom: false });
  };
  for (const sx of [-1, 1]) {
    fence([sx * 4.5, zf + 0.15], [sx * 4.5, 4.5]);
    fence([sx * 4.5, 4.5], [sx * 1.35, 4.5], false);
    m.color(C.timber, 0.06).at(T(sx * 1.35, 0, 4.5), () => m.box(0.16, 1.3, 0.16, { bottom: false })); // gate post
  }

  // Firewood stacked against the wall, cut ends outwards.
  const r = 0.14, logL = 0.62;
  [5, 4, 3].forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      const x = -2.75 + (i - (n - 1) / 2) * r * 2.05;
      m.at(T(x, r + row * r * 1.75, zf + 0.07), RX(Math.PI / 2), RY(i * 1.3 + row), () => {
        m.color(C.bark, 0.08).cyl(r, r, logL, 5, { top: false, bottom: false });
        m.color(C.timberLight, 0.06).poly(Array.from({ length: 5 }, (_, k) => [r * Math.cos(-k * 1.2566), logL, r * Math.sin(-k * 1.2566)]));
      });
    }
  });

  // A bench against the wall and a lidded tub on the other side of the porch.
  m.at(T(2.55, 0, zf + 0.34), () => {
    m.color(C.timberLight, 0.06).at(T(0, 0.42, 0), () => m.box(1.6, 0.07, 0.36));
    m.color(C.timber, 0.06);
    for (const sx of [-1, 1]) m.at(T(sx * 0.6, 0, 0), () => m.box(0.08, 0.42, 0.32, { top: false, bottom: false }));
  });
  m.at(T(3.3, 0, zf + 1.45), () => {
    m.color(C.plank, 0.08).cyl(0.36, 0.42, 0.66, 8, { top: false, bottom: false });
    m.color(C.timberLight, 0.05).at(T(0, 0.6, 0), () => m.cyl(0.44, 0.44, 0.07, 8, { bottom: false }));
  });

  // Pennant on the ridge, flying back along the roof so it stays over the plot.
  pennant(m, [hl + gableOver - 0.4, ridgeY + 0.1, zc], { height: 1.45, length: 1.5, drop: 0.66, yaw: Math.PI + 0.4, pole: 0.045 });

  return {
    id: 'hall',
    label: 'Great hall',
    note: 'Timber hall of a lord or village, c. 900: plank walls, steep thatch, crossed gable boards. Town centre on a 5 by 5 tile plot.',
    yaw: -0.6,
    roots: [{ name: 'hall', mesh: m.toMesh('hall') }],
  };
}
