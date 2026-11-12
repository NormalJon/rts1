// Blacksmith, c. 1200: a forge. An open-sided timber shed under shingles shelters the bellows
// and the bench; at its end stands the hearth of rough stone, a fire of charcoal glowing on
// its table under a hood that draws the smoke up a chimney. The anvil stands on its block in
// the open in front, with the quench trough, a rack of finished blades and horseshoes, and
// the charcoal heap. Among the small buildings it is the one with the chimney and the fire.
// The plot is 3 x 3 tiles, so everything stays inside 5.7 m square. The fire, the anvil and
// the open side of the shed face +Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RY, RZ } from '../math.mjs';
import { C } from '../palette.mjs';
import { hangingBanner, pitch, groundPatch, basket, disc } from './parts.mjs';

export function build() {
  const m = new MeshBuilder(131);

  groundPatch(m.color(C.earth, 0.04), [[-2.72, -2.72], [-2.72, 2.3], [-2.3, 2.72], [2.35, 2.72], [2.72, 2.35], [2.72, -2.72]]);

  // ---- Shed: six posts, ridge along X, open to the front and the left ----------------------
  const xl = -2.5, xr = 0.82; // end posts
  const zb = -2.5, zf = -0.32, postH = 2.1;
  const zc = (zb + zf) / 2, hd = (zf - zb) / 2;
  const slope = 0.7, over = 0.24;
  const run = hd + over, rise = run * slope;
  const eaveY = postH + 0.14 - over * slope;
  const ridgeY = eaveY + rise;
  const on = pitch({ run, rise, eaveY });
  const px = [xl, (xl + xr) / 2, xr];
  m.color(C.timber, 0.06);
  for (const x of px) {
    for (const z of [zb + 0.1, zf - 0.1]) m.at(T(x, 0, z), () => m.box(0.2, postH, 0.2, { top: false, bottom: false }));
    m.beam([x, postH - 0.2, zb + 0.1], [x, postH - 0.2, zf - 0.1], 0.14, 0.16, { top: false, bottom: false });
  }
  for (const z of [zb + 0.1, zf - 0.1]) m.at(T((xl + xr) / 2, postH - 0.08, z), () => m.box(xr - xl + 0.3, 0.14, 0.18));
  m.color(C.timberMid, 0.07);
  for (const x of [xl, xr]) {
    m.at(T(x, postH - 0.12, zc), () => m.box(0.13, ridgeY - postH - 0.02, 0.13, { top: false, bottom: false }));
    for (const s of [-1, 1]) m.beam([x, postH, zc + s * (hd - 0.1)], [x, ridgeY - 0.18, zc + s * 0.04], 0.1, 0.12, { top: false, bottom: false });
  }
  // Back wall of upright planks.
  const nb = 9;
  for (let i = 0; i < nb; i++) {
    const x0 = xl + (i * (xr - xl)) / nb, x1 = xl + ((i + 1) * (xr - xl)) / nb;
    m.color(i % 2 ? C.plank : C.timberMid, 0.08);
    m.poly([[x0, 0, zb + 0.13], [x1, 0, zb + 0.13], [x1, postH - 0.12, zb + 0.13], [x0, postH - 0.12, zb + 0.13]]);
    m.poly([[x1, 0, zb + 0.08], [x0, 0, zb + 0.08], [x0, postH - 0.12, zb + 0.08], [x1, postH - 0.12, zb + 0.08]]);
  }
  // Roof of oak shingles in three dark courses a slope, under a ridge board.
  const x0 = xl - 0.26, x1 = xr + 0.16, t = 0.09;
  m.at(T(0, 0, zc), RY(-Math.PI / 2), () => {
    for (const s of [-1, 1]) {
      [[0, 0.4, C.shingle], [0.36, 0.72, C.shingleLight], [0.68, 1, C.shingle]].forEach(([u0, u1, col], k) => {
        const lift = 0.035 * k;
        m.color(col, 0.07).extrude([on(s, u0, lift), on(s, u1, lift), on(s, u1, -t), on(s, u0, -t)], -x1, -x0 + 0.02 * k);
      });
    }
  });
  m.color(C.timber, 0.05).beam([x0 - 0.05, ridgeY + 0.07, zc], [x1, ridgeY + 0.07, zc], 0.09, 0.24);

  // ---- Hearth and chimney of rough stone at the right-hand end ------------------------------
  const hx0 = 0.95, hx1 = 2.55, hz0 = -2.55, hz1 = -0.85; // the hearth's footprint
  const tableY = 0.78, hoodY = 1.78, stackY = 2.7, topY = 4.0;
  const stone = (i) => m.color([C.stone, C.stoneLight, C.stoneDark][i % 3], 0.07);
  stone(0).at(T((hx0 + hx1) / 2, 0, hz0 + 0.2), () => m.box(hx1 - hx0, hoodY, 0.4, { bottom: false })); // back wall
  stone(1).at(T(hx1 - 0.18, 0, (hz0 + hz1) / 2 + 0.2), () => m.box(0.36, hoodY, hz1 - hz0 - 0.4, { bottom: false })); // right cheek
  stone(2).at(T(hx0 + 0.16, 0, hz1 - 0.16), () => m.box(0.32, hoodY, 0.32, { bottom: false })); // pier at the front corner
  stone(0).at(T((hx0 + hx1) / 2 - 0.18, 0, (hz0 + hz1) / 2 + 0.2), () => m.box(hx1 - hx0 - 0.36, tableY, hz1 - hz0 - 0.4, { bottom: false })); // the table
  // Hood and stack, darker with soot towards the top.
  const cx = (hx0 + hx1) / 2, cz = (hz0 + hz1) / 2;
  stone(1).at(T(cx, hoodY, cz), () => m.frustum(hx1 - hx0 + 0.1, hz1 - hz0 + 0.1, 0.84, 0.84, stackY - hoodY));
  stone(2).at(T(cx, stackY, cz), () => m.frustum(0.84, 0.84, 0.7, 0.7, topY - stackY, { bottom: false, top: false }));
  m.color(C.stoneDark, 0.06).at(T(cx, topY - 0.02, cz), () => m.frustum(0.82, 0.82, 0.82, 0.82, 0.14, { bottom: false }));
  m.color(C.charcoal).poly([[cx - 0.26, topY + 0.125, cz + 0.26], [cx + 0.26, topY + 0.125, cz + 0.26], [cx + 0.26, topY + 0.125, cz - 0.26], [cx - 0.26, topY + 0.125, cz - 0.26]]);
  // The fire: a bed of charcoal on the table, live coals and a few tongues of flame, and
  // their glow on the back of the hearth.
  const fx = cx - 0.2, fz = hz1 - 0.55;
  m.color(C.charcoal, 0.12).at(T(fx, tableY, fz), () => m.frustum(0.95, 0.8, 0.75, 0.6, 0.09, { bottom: false }));
  [[-0.2, 0.1, 0.15, 0.1, C.ember], [0.12, -0.12, 0.17, 0.12, C.flame], [0.25, 0.14, 0.13, 0.09, C.ember], [-0.05, -0.02, 0.15, 0.34, C.flame], [-0.28, -0.16, 0.12, 0.08, C.ember], [0.1, 0.18, 0.11, 0.22, C.ember]].forEach(([dx, dz, r, h, col], i) => {
    m.color(col, 0.08).at(T(fx + dx, tableY + 0.07, fz + dz), () => m.cyl(r, 0, h, 4, { bottom: false, phase: i }));
  });
  m.color(C.ember, 0.05).poly([[hx0 + 0.45, tableY + 0.1, hz0 + 0.41], [hx1 - 0.45, tableY + 0.1, hz0 + 0.41], [hx1 - 0.6, tableY + 0.75, hz0 + 0.41], [hx0 + 0.6, tableY + 0.75, hz0 + 0.41]]);

  // Bellows under the shed, their nozzle to the fire: leather between two boards, on a trestle.
  m.at(T(-0.55, 0.92, fz - 0.05), RZ(-Math.PI / 2), () => {
    m.color(C.leather, 0.07).frustum(0.26, 0.6, 0.1, 0.12, 1.15);
    m.color(C.iron, 0.05).at(T(0, 1.15, 0), () => m.cyl(0.045, 0.03, 0.4, 4, { top: false, bottom: false }));
  });
  m.color(C.timber, 0.06);
  for (const x of [-0.45, 0.25]) m.at(T(x, 0, fz - 0.05), () => m.box(0.09, 0.8, 0.5, { top: false, bottom: false }));
  // Workbench against the back wall, with tongs and a bar of iron on it.
  m.at(T(-1.7, 0, zb + 0.5), () => {
    m.color(C.timberLight, 0.06).at(T(0, 0.78, 0), () => m.box(1.3, 0.08, 0.5));
    m.color(C.timber, 0.06);
    for (const sx of [-1, 1]) m.at(T(sx * 0.52, 0, 0), () => m.box(0.09, 0.78, 0.44, { top: false, bottom: false }));
    m.color(C.iron, 0.05).at(T(0.1, 0.86, 0.02), RY(0.3), () => m.box(0.7, 0.04, 0.05, { bottom: false }));
  });

  // ---- The yard in front ------------------------------------------------------------------
  // Anvil on an oak block, the hammer laid across it.
  m.at(T(0.15, 0, 1.0), RY(0.25), () => {
    m.color(C.bark, 0.06).cyl(0.31, 0.34, 0.5, 7, { top: false, bottom: false, phase: 0.3 });
    m.color(C.timberLight, 0.04);
    disc(m, 0.31, 0.5, 7, { phase: 0.3 });
    m.color(C.iron, 0.05).at(T(0, 0.5, 0), () => m.frustum(0.3, 0.2, 0.2, 0.14, 0.17, { bottom: false }));
    m.color(C.steel, 0.05).at(T(0.04, 0.67, 0), () => m.box(0.5, 0.1, 0.19));
    m.color(C.iron, 0.05).rod([-0.21, 0.72, 0], [-0.52, 0.72, 0], 0.07, 4, { rt: 0, bottom: false });
    m.color(C.timberLight, 0.05).beam([0.08, 0.79, -0.26], [0.2, 0.79, 0.3], 0.04, 0.04);
    m.color(C.iron, 0.05).at(T(0.2, 0.74, 0.27), RY(-0.2), () => m.box(0.08, 0.1, 0.17));
  });
  // Quench trough by the hearth.
  m.at(T(1.72, 0, 0.15), () => {
    m.color(C.plank, 0.08).frustum(1.25, 0.46, 1.36, 0.56, 0.44, { top: false, bottom: false });
    m.color(C.water, 0.04).poly([[-0.64, 0.36, 0.25], [0.64, 0.36, 0.25], [0.64, 0.36, -0.25], [-0.64, 0.36, -0.25]]);
  });
  // Rack of finished work: sword blades hung by their tangs, horseshoes on the posts.
  m.at(T(-1.65, 0, 0.95), RY(0.12), () => {
    m.color(C.timber, 0.06);
    for (const s of [-1, 1]) m.at(T(s * 0.75, 0, 0), () => m.box(0.12, 1.4, 0.12, { bottom: false }));
    m.color(C.timberMid, 0.07).beam([-0.86, 1.3, 0], [0.86, 1.3, 0], 0.08, 0.09);
    for (let i = 0; i < 4; i++) {
      m.color(C.steel, 0.07).at(T(-0.45 + i * 0.3, 0.42 + (i % 2) * 0.06, 0.07), () => m.frustum(0.02, 0.012, 0.075, 0.016, 0.82 - (i % 2) * 0.06, { bottom: false }));
    }
    m.color(C.iron, 0.06);
    for (const [s, y] of [[-1, 0.95], [1, 1.02], [1, 0.62]]) {
      for (const bar of [[[-0.09, 0.12], [-0.09, -0.1]], [[0.09, 0.12], [0.09, -0.1]], [[-0.11, 0.12], [0.11, 0.12]]]) {
        m.beam([s * 0.75 + bar[0][0], y + bar[0][1], 0.075], [s * 0.75 + bar[1][0], y + bar[1][1], 0.075], 0.035, 0.03, { top: false, bottom: false });
      }
    }
  });
  // Grindstone in its trough frame, with the crank that turns it, and a bucket beside it.
  m.at(T(1.75, 0, 1.75), RY(-0.35), () => {
    m.color(C.timber, 0.06);
    for (const s of [-1, 1]) m.at(T(0, 0, s * 0.2), () => m.box(0.9, 0.52, 0.08, { bottom: false }));
    m.color(C.stoneLight, 0.06).at(T(0, 0.58, -0.07), RX(Math.PI / 2), () => m.cyl(0.36, 0.36, 0.14, 8, { phase: Math.PI / 8 }));
    m.color(C.iron, 0.05).rod([0, 0.58, 0.07], [0, 0.58, 0.36], 0.025, 4, { top: false, bottom: false });
    m.beam([0, 0.58, 0.36], [0.16, 0.44, 0.36], 0.04, 0.04);
  });
  m.at(T(0.95, 0, 2.2), () => {
    m.color(C.plank, 0.08).cyl(0.16, 0.19, 0.32, 6, { top: false, bottom: false });
    m.color(C.water, 0.04).at(T(0, 0.26, 0), () => disc(m, 0.175, 0, 6));
  });
  // Charcoal: a heap by the rack and a basket of it ready for the fire.
  m.at(T(-1.95, 0, 2.05), () => {
    m.color(C.charcoal, 0.16).cyl(0.72, 0.2, 0.42, 7, { bottom: false, phase: 0.4 });
    for (const [dx, dz, r] of [[0.62, 0.3, 0.13], [-0.5, 0.42, 0.11], [0.3, -0.62, 0.12]]) m.at(T(dx, 0, dz), () => m.cyl(r, 0, r * 1.1, 4, { bottom: false, phase: dx * 9 }));
  });
  m.at(T(0.7, 0, -0.05), () => basket(m, { r: 0.26, h: 0.34, fill: C.charcoal, heap: 0.1 }));

  // The owner's colours: a banner on the shed's front beam and the smith's apron hung on a post.
  hangingBanner(m, [(px[0] + px[1]) / 2, postH - 0.2, zf + 0.04], { width: 0.8, height: 1.0 });
  m.team().at(T(xr - 0.02, 0, zf + 0.02), () => m.extrude([[-0.2, 0.75], [0.2, 0.75], [0.15, 1.5], [-0.15, 1.5]], 0, 0.035));

  return {
    id: 'blacksmith',
    label: 'Blacksmith',
    note: 'A forge: stone hearth and chimney with a charcoal fire, bellows under a shingled shed, the anvil, a quench trough and a rack of blades in front. 3 by 3 tile plot.',
    yaw: 0.5,
    plot: 3,
    roots: [{ name: 'blacksmith', mesh: m.toMesh('blacksmith') }],
  };
}
