// Archery range, c. 1100: a practice ground for bowmen. An open-fronted shelter under a
// lean-to of thatch stands in one back corner with the bows racked inside; three straw butts
// on timber frames stand along the back before a turf bank that stops the arrows. The yard is
// open and fenced, with shooting marks at its near side, a rack of strung bows and a barrel
// of arrows. No longhouse: the butts and the empty yard are what a high camera sees.
// The plot is 5 x 5 tiles, so everything stays inside 9.4 m square. The butts and the open
// front of the shelter face +Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RY, RZ } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, hangingBanner, groundPatch, stakeFence, tub, disc } from './parts.mjs';

/** A bow stave standing on its tip, bellied towards +Z; `plain` leaves it a straight rod. */
function stave(m, h = 1.45, plain = false) {
  m.color(C.yew, 0.07);
  if (plain) return m.rod([0, 0, 0], [0, h, 0], 0.022, 4, { rt: 0.016, bottom: false });
  m.rod([0, 0, 0], [0, h * 0.5, 0.07], 0.016, 4, { rt: 0.024, top: false, bottom: false });
  return m.rod([0, h * 0.5, 0.07], [0, h, 0], 0.024, 4, { rt: 0.016, bottom: false });
}

/** An arrow with its head at the origin and its fletched end at +Y. */
function arrow(m, len = 0.75) {
  m.color(C.timberLight, 0.06).rod([0, 0, 0], [0, len, 0], 0.012, 3, { top: false, bottom: false });
  m.color(C.linen, 0.07).at(T(0, len - 0.17, 0), () => m.cyl(0.012, 0.05, 0.17, 3, { top: false, bottom: false }));
}

export function build() {
  const m = new MeshBuilder(71);

  groundPatch(m.color(C.earth, 0.04), [[-4.42, -4.42], [-4.42, 4.08], [-4.12, 4.38], [4.12, 4.38], [4.42, 4.08], [4.42, -4.42]]);

  // ---- Shelter: a lean-to on six posts, closed at the back and one end ---------------------
  const xl = -4.2, xr = -0.75; // end posts
  const zB = -4.2, zF = -2.55; // back and front rows
  const hB = 1.55, hF = 2.4;
  const slope = (hF - hB) / (zF - zB);
  const px = [xl, (xl + xr) / 2, xr];
  m.color(C.timber, 0.06);
  for (const x of px) {
    m.at(T(x, 0, zF), () => m.box(0.2, hF, 0.2, { top: false, bottom: false }));
    m.at(T(x, 0, zB), () => m.box(0.18, hB, 0.18, { top: false, bottom: false }));
  }
  m.at(T((xl + xr) / 2, hF - 0.02, zF), () => m.box(xr - xl + 0.5, 0.18, 0.18));
  m.at(T((xl + xr) / 2, hB - 0.02, zB), () => m.box(xr - xl + 0.5, 0.16, 0.16));
  m.color(C.timberMid, 0.07);
  for (const x of px) m.beam([x, hB + 0.12, zB - 0.25], [x, hF + 0.2, zF + 0.3], 0.1, 0.12, { top: false, bottom: false });
  m.beam([xr, 0.8, zB + 0.06], [xr, hF - 0.3, zF - 0.1], 0.09, 0.09, { top: false, bottom: false });
  const plank = (i) => m.color(i % 2 ? C.plank : C.timberMid, 0.08);
  const nb = 9;
  for (let i = 0; i < nb; i++) {
    const x0 = xl + (i * (xr - xl)) / nb, x1 = xl + ((i + 1) * (xr - xl)) / nb;
    plank(i).poly([[x0, 0, zB + 0.05], [x1, 0, zB + 0.05], [x1, hB, zB + 0.05], [x0, hB, zB + 0.05]]);
    plank(i + 1).poly([[x1, 0, zB], [x0, 0, zB], [x0, hB, zB], [x1, hB, zB]]);
  }
  for (let i = 0; i < 4; i++) {
    const z0 = zB + (i * (zF - zB)) / 4, z1 = zB + ((i + 1) * (zF - zB)) / 4;
    const y0 = hB + (z0 - zB) * slope, y1 = hB + (z1 - zB) * slope;
    plank(i).poly([[xl + 0.05, 0, z1], [xl + 0.05, 0, z0], [xl + 0.05, y0, z0], [xl + 0.05, y1, z1]]);
    plank(i + 1).poly([[xl, 0, z0], [xl, 0, z1], [xl, y1, z1], [xl, y0, z0]]);
  }
  // Thatch in three courses running down to the back, under a pole along the high front edge.
  const zLo = zB - 0.3, zHi = zF + 0.42, thick = 0.26;
  const roofY = (z) => hB + 0.36 + (z - zB) * slope;
  const sl = Math.hypot(1, slope);
  const on = (u, off) => [zLo + (zHi - zLo) * u - (slope / sl) * off, roofY(zLo + (zHi - zLo) * u) + off / sl];
  const x0 = xl - 0.3, x1 = xr + 0.32;
  m.at(RY(-Math.PI / 2), () => {
    [[0, 0.4, C.thatch], [0.36, 0.72, C.thatchMid], [0.68, 1, C.thatch]].forEach(([u0, u1, col], k) => {
      const lift = 0.06 * k;
      m.color(col, 0.05).extrude([on(u0, lift), on(u1, lift), on(u1, -thick), on(u0, -thick)], -x1 - 0.02 * k, -x0 + 0.02 * k);
    });
  });
  m.color(C.timber, 0.06).rod([x0 - 0.05, roofY(zHi - 0.16) + 0.19, zHi - 0.16], [x1 + 0.05, roofY(zHi - 0.16) + 0.19, zHi - 0.16], 0.06, 5);

  // Bows racked along the back wall: a rail on pegs, the staves stood against it.
  m.color(C.timber, 0.06).beam([xl + 0.4, 1.1, zB + 0.24], [xr - 0.3, 1.1, zB + 0.24], 0.07, 0.07, { top: false, bottom: false });
  for (let i = 0; i < 5; i++) {
    m.at(T(xl + 0.7 + i * 0.6, 0, zB + 0.62), RX(-0.27), () => stave(m, 1.4 + (i % 3) * 0.05, true));
  }

  // ---- Butts: coiled straw on a frame, a cloth mark with the owner's colour at its centre ----
  const buttX = [0.85, 2.3, 3.75], buttZ = -3.25, lean = 0.22;
  for (const [i, x] of buttX.entries()) {
    m.at(T(x, 0, buttZ), () => {
      m.color(C.timberMid, 0.07);
      for (const s of [-1, 1]) m.beam([s * 0.42, 0, 0.12], [s * 0.26, 1.62, -0.2], 0.08, 0.08, { bottom: false });
      m.beam([0, 0, -0.78], [0, 1.5, -0.22], 0.08, 0.08, { bottom: false });
      m.beam([-0.36, 0.5, 0], [0.36, 0.5, 0], 0.07, 0.07, { top: false, bottom: false });
      m.at(T(0, 1.1, -0.1), RX(Math.PI / 2 - lean), () => {
        m.color(C.thatchMid, 0.06).cyl(0.64, 0.64, 0.24, 8, { top: false, phase: Math.PI / 8 });
        m.color(C.thatch, 0.06);
        disc(m, 0.64, 0.24, 8, { phase: Math.PI / 8 });
        m.color(C.linen, 0.04);
        disc(m, 0.42, 0.248, 8, { phase: Math.PI / 8 });
        m.team();
        disc(m, 0.2, 0.256, 8, { phase: Math.PI / 8 });
        // Arrows left in it from the last shoot.
        const stuck = [[[0.14, 0.26]], [[-0.3, -0.12]], [[0.3, -0.05], [-0.1, -0.28]]][i];
        for (const [ax, az] of stuck) m.at(T(ax, 0.16, az), RX(0.12 + ax * 0.5), RZ(az * 0.6), () => arrow(m, 0.66));
      });
    });
  }
  // Turf bank behind them to stop what misses.
  m.at(T(2.33, 0, -4.2), () => {
    m.color(C.earth, 0.05).frustum(4.35, 0.84, 4.1, 0.3, 0.95, { bottom: false });
    m.color(C.grass, 0.06).poly([[-2.18, 0.02, 0.42], [2.18, 0.02, 0.42], [2.05, 0.955, 0.15], [-2.05, 0.955, 0.15]]);
  });

  // ---- Yard --------------------------------------------------------------------------------
  // Fence: stakes and withy rails, open at the back where shelter and bank close the yard.
  const fx = 4.5, fz = 4.42, gate = 1.0;
  stakeFence(m, [-fx, zF + 0.3], [-fx, fz], { spacing: 1.2 });
  stakeFence(m, [-fx, fz], [-gate, fz], { first: false, last: false });
  stakeFence(m, [fx, -3.75], [fx, fz], { spacing: 1.2 });
  stakeFence(m, [fx, fz], [gate, fz], { first: false, last: false });
  m.color(C.timber, 0.06);
  for (const sx of [-1, 1]) m.at(T(sx * gate, 0, fz), () => m.box(0.18, 1.45, 0.18, { bottom: false }));

  // The shooting line: a pole pegged to the ground, with a mark opposite each butt and arrows
  // stuck in the earth beside it ready to hand.
  m.color(C.timberLight, 0.07).beam([0.1, 0.05, 2.9], [4.3, 0.05, 2.9], 0.1, 0.08);
  for (const [i, x] of buttX.entries()) {
    m.at(T(x, 0, 2.9), () => {
      m.color(C.timber, 0.06).cyl(0.07, 0.06, 0.5, 5, { bottom: false, phase: i });
      for (const [ax, az, tilt] of [[0.3, 0.25, 0.12], [0.42, 0.12, -0.1]]) {
        m.at(T(ax, -0.06, az), RZ(tilt), RX(tilt * 0.8), () => arrow(m, 0.72));
      }
    });
  }

  // A rack of strung bows in the yard, and a barrel of arrows beside it.
  m.at(T(-2.5, 0, 0.7), RY(0.25), () => {
    m.color(C.timber, 0.06);
    for (const s of [-1, 1]) {
      m.at(T(s * 0.95, 0, 0), () => m.box(0.11, 1.25, 0.11, { bottom: false }));
    }
    m.color(C.timberMid, 0.07).beam([-1.06, 1.15, 0.09], [1.06, 1.15, 0.09], 0.08, 0.08);
    for (let i = 0; i < 4; i++) {
      m.at(T(-0.66 + i * 0.44, 0.02, 0.5), RX(-0.3), RY(Math.PI / 2), () => {
        stave(m, 1.42);
        m.color(C.linen, 0.03).rod([0, 0.01, 0], [0, 1.41, 0], 0.007, 3, { top: false, bottom: false });
      });
    }
  });
  m.at(T(-0.9, 0, 1.55), () => {
    tub(m, { r: 0.34, h: 0.7 });
    for (let i = 0; i < 4; i++) {
      const a = i * 1.57 + 0.4;
      m.at(T(0.15 * Math.cos(a), 0.4, 0.15 * Math.sin(a)), RZ(0.14 * Math.cos(a)), RX(-0.14 * Math.sin(a)), () => arrow(m, 0.74));
    }
  });

  // The owner's colours: the butts' centres, a banner on the shelter and a pennant at the gate.
  hangingBanner(m, [(px[0] + px[1]) / 2, hF - 0.14, zF + 0.14], { width: 0.85, height: 1.05 });
  pennant(m, [-gate, 1.4, fz], { height: 2.6, length: 1.3, drop: 0.58, yaw: -0.12, pole: 0.045 });

  return {
    id: 'archery-range',
    label: 'Archery range',
    note: 'Three straw butts before a turf bank, a thatched shelter for the bows and an open, fenced yard to shoot down. Trains archers on a 5 by 5 tile plot.',
    yaw: -0.5,
    plot: 5,
    roots: [{ name: 'archery-range', mesh: m.toMesh('archery-range') }],
  };
}
