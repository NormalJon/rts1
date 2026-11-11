// Mining camp, c. 900: where quarried stone and gold ore are brought. A rough lean-to of
// unsquared poles, open to the front and roofed with bark slabs weighted with poles and
// stones, keeps the ore baskets dry. Cut blocks are stacked beside it, and a handcart stands
// loaded in front. The plot is 3 x 3 tiles, so everything stays inside 5.7 m square. The
// open high side of the lean-to faces +Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RY, RZ } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, hangingBanner, groundPatch, basket } from './parts.mjs';

/** A cut block, a little out of square, standing on y = 0. */
function stone(m, w, h, d, tone = C.stone) {
  m.color(tone, 0.07).frustum(w, d, w - 0.05, d - 0.04, h, { bottom: false });
}

export function build() {
  const m = new MeshBuilder(43);
  const xl = -2.5, xr = 1.0; // end posts of the lean-to
  const zB = -2.5, zF = -0.72; // back and front rows of posts
  const hB = 1.3, hF = 2.2;
  const slope = (hF - hB) / (zF - zB);
  const roofY = (z, off = 0) => hB + 0.2 + (z - zB) * slope + off; // top of the roofing above z
  const rz0 = zB - 0.26, rz1 = zF + 0.34;
  const rx0 = xl - 0.24, rx1 = xr + 0.26;

  groundPatch(m.color(C.earth, 0.04), [[-2.72, -2.72], [-2.72, 2.2], [-2.2, 2.72], [2.3, 2.72], [2.72, 2.3], [2.72, -2.72]]);

  // Poles: three posts a row, a beam along each row and rafters across them.
  const px = [xl, (xl + xr) / 2, xr];
  m.color(C.bark, 0.07);
  for (const x of px) {
    m.at(T(x, 0, zF), () => m.cyl(0.1, 0.085, hF, 5, { top: false, bottom: false, phase: x }));
    m.at(T(x, 0, zB), () => m.cyl(0.1, 0.085, hB, 5, { top: false, bottom: false, phase: x + 1 }));
  }
  m.color(C.timberMid, 0.07);
  m.rod([xl - 0.2, hF, zF], [xr + 0.22, hF, zF], 0.085, 5);
  m.rod([xl - 0.2, hB, zB], [xr + 0.22, hB, zB], 0.085, 5);
  m.color(C.bark, 0.07);
  for (const x of [xl + 0.06, xl + 1.2, xr - 1.2, xr - 0.06]) {
    m.rod([x, roofY(rz0 + 0.1, -0.13), rz0 + 0.1], [x, roofY(rz1 - 0.08, -0.13), rz1 - 0.08], 0.06, 5, { top: false });
  }
  // A brace to the open end, so the frame does not rack.
  m.beam([xr, 0.9, zB + 0.05], [xr, hF - 0.25, zF - 0.1], 0.09, 0.09, { top: false, bottom: false });

  // Back and one end closed with upright slabs.
  const slab = (i) => m.color(i % 2 ? C.shingle : C.timberMid, 0.09);
  const nb = 9;
  for (let i = 0; i < nb; i++) {
    const x0 = xl + (i * (xr - xl)) / nb, x1 = xl + ((i + 1) * (xr - xl)) / nb;
    const top = hB - 0.02 - ((i * 4) % 3) * 0.05;
    slab(i).poly([[x0, 0, zB + 0.06], [x1, 0, zB + 0.06], [x1, top, zB + 0.06], [x0, top, zB + 0.06]]);
    slab(i + 1).poly([[x1, 0, zB], [x0, 0, zB], [x0, top, zB], [x1, top, zB]]);
  }
  const ne = 4;
  for (let i = 0; i < ne; i++) {
    const z0 = zB + (i * (zF - zB)) / ne, z1 = zB + ((i + 1) * (zF - zB)) / ne;
    const y0 = roofY(z0, -0.26), y1 = roofY(z1, -0.26);
    slab(i).poly([[xl + 0.06, 0, z1], [xl + 0.06, 0, z0], [xl + 0.06, y0, z0], [xl + 0.06, y1, z1]]);
    slab(i + 1).poly([[xl, 0, z0], [xl, 0, z1], [xl, y1, z1], [xl, y0, z0]]);
  }

  // Roofing: bark slabs running down the slope, weathered grey, their ends uneven.
  const n = 9, t = 0.06;
  m.color(C.timber, 0.05).poly([[rx0, roofY(rz0, -t), rz0], [rx1, roofY(rz0, -t), rz0], [rx1, roofY(rz1, -t), rz1], [rx0, roofY(rz1, -t), rz1]]);
  for (let i = 0; i < n; i++) {
    const x0 = rx0 + (i * (rx1 - rx0)) / n, x1 = rx0 + ((i + 1) * (rx1 - rx0)) / n;
    const za = rz0 - ((i * 5) % 3) * 0.03, zb = rz1 + ((i * 4) % 3) * 0.035;
    m.color(i % 2 ? C.shingle : C.oreLight, 0.09).poly([[x0, roofY(zb), zb], [x1, roofY(zb), zb], [x1, roofY(za), za], [x0, roofY(za), za]]);
    // The front edge of each slab, which is what shows of its thickness.
    m.poly([[x0, roofY(zb, -t), zb], [x1, roofY(zb, -t), zb], [x1, roofY(zb), zb], [x0, roofY(zb), zb]]);
  }
  m.color(C.shingle, 0.06);
  m.poly([[rx1, roofY(rz1, -t), rz1], [rx1, roofY(rz0, -t), rz0], [rx1, roofY(rz0), rz0], [rx1, roofY(rz1), rz1]]);
  m.poly([[rx0, roofY(rz0, -t), rz0], [rx0, roofY(rz1, -t), rz1], [rx0, roofY(rz1), rz1], [rx0, roofY(rz0), rz0]]);
  m.poly([[rx1, roofY(rz0, -t), rz0], [rx0, roofY(rz0, -t), rz0], [rx0, roofY(rz0), rz0], [rx1, roofY(rz0), rz0]]);
  // Poles and stones laid on the slabs to hold them down.
  m.color(C.bark, 0.07);
  for (const z of [rz0 + 0.5, rz1 - 0.55]) m.rod([rx0 - 0.04, roofY(z, 0.05), z], [rx1 + 0.04, roofY(z, 0.05), z], 0.055, 5);
  for (const [x, z, w, turn] of [[-2.0, -1.55, 0.34, 0.4], [-0.5, -1.2, 0.3, 1.0], [0.75, -1.75, 0.36, 0.2]]) {
    m.at(T(x, roofY(z, -0.02), z), RX(-Math.atan(slope)), RY(turn), () => stone(m, w, 0.2, w * 0.8, C.rockDark));
  }

  // Under the roof: baskets of ore, the middle one of gold-bearing rock.
  const ore = (x, z, r, rich) => m.at(T(x, 0, z), () => {
    basket(m, { r, h: 0.4, fill: C.ore, heap: 0.14 });
    if (!rich) return;
    m.color(C.goldLight, 0.08);
    for (const [dx, dz, turn] of [[0.08, 0.06, 0.2], [-0.1, 0.02, 1.2], [0.0, -0.11, 2.2]]) {
      m.at(T(dx, 0.42, dz), RY(turn), () => m.cyl(0.08, 0, 0.17, 4, { bottom: false }));
    }
  });
  ore(-2.0, -1.2, 0.3, false);
  ore(-1.36, -1.42, 0.3, true);
  ore(-0.68, -1.15, 0.28, false);

  // Cut blocks stacked three courses high beside the lean-to, and two more set down in front.
  const sx = 2.08;
  const stack = [
    [-0.31, 0, -2.2, 0.56, 0.4, 0.84, 0.03], [0.32, 0, -2.16, 0.58, 0.38, 0.8, -0.04], [-0.3, 0, -1.26, 0.58, 0.42, 0.86, -0.03], [0.33, 0, -1.3, 0.55, 0.4, 0.8, 0.05],
    [0.02, 0.4, -2.14, 1.0, 0.36, 0.56, 0.04], [-0.05, 0.42, -1.34, 0.96, 0.34, 0.6, -0.06],
    [0.0, 0.77, -1.76, 0.6, 0.34, 0.86, 0.12],
  ];
  stack.forEach(([x, y, z, w, h, d, turn], i) => {
    m.at(T(sx + x, y, z), RY(turn), () => stone(m, w, h, d, i % 3 === 1 ? C.stoneLight : i % 3 ? C.rockLight : C.stone));
  });
  m.at(T(1.95, 0, -0.2), RY(0.3), () => stone(m, 0.62, 0.4, 0.86, C.stoneLight));
  // The nearer one has a pick leant on it.
  m.at(T(2.2, 0, 0.82), RY(-0.5), () => {
    stone(m, 0.58, 0.36, 0.8, C.stone);
    m.at(T(0.04, 0, 0.83), RX(-0.85), () => {
      m.color(C.timberLight, 0.05).box(0.05, 0.94, 0.045, { bottom: false });
      m.color(C.iron, 0.05);
      for (const s of [-1, 1]) m.rod([0, 0.9, 0], [s * 0.32, 0.8, 0], 0.045, 4, { rt: 0.012 });
    });
  });

  // Handcart on two plank wheels, propped level on its legs and loaded with a block and a basket.
  m.at(T(-0.6, 0, 1.35), RY(1.1), () => {
    const bedY = 0.5;
    m.color(C.plank, 0.07).at(T(0, bedY, 0), () => m.box(0.96, 0.07, 1.42));
    m.color(C.timberMid, 0.07);
    for (const s of [-1, 1]) m.at(T(s * 0.46, bedY + 0.07, 0), () => m.box(0.05, 0.24, 1.42, { bottom: false }));
    m.at(T(0, bedY + 0.07, -0.685), () => m.box(0.87, 0.24, 0.05, { bottom: false }));
    m.color(C.timber, 0.06);
    for (const s of [-1, 1]) {
      m.beam([s * 0.42, bedY - 0.03, 0.5], [s * 0.42, bedY - 0.03, 1.62], 0.07, 0.07, { bottom: false });
      m.at(T(s * 0.42, 0, 0.62), () => m.box(0.07, bedY - 0.06, 0.07, { top: false, bottom: false }));
    }
    m.rod([-0.62, 0.42, -0.12], [0.62, 0.42, -0.12], 0.045, 4, { top: false, bottom: false });
    for (const s of [-1, 1]) {
      m.color(C.timberLight, 0.07).at(T(s * 0.585, 0.42, -0.12), RZ(-s * Math.PI / 2), () => m.cyl(0.42, 0.42, 0.07, 8, { phase: Math.PI / 8 }));
      m.color(C.timber, 0.05).at(T(s * 0.655, 0.42, -0.12), RZ(-s * Math.PI / 2), () => m.cyl(0.09, 0.07, 0.05, 5, { bottom: false }));
    }
    m.at(T(0.02, bedY + 0.07, -0.22), RY(0.1), () => stone(m, 0.62, 0.36, 0.7, C.stoneLight));
    m.at(T(-0.05, bedY + 0.07, 0.43), () => basket(m, { r: 0.24, h: 0.3, fill: C.ore, heap: 0.1 }));
  });

  // Spoil broken off in the dressing, heaped at the corner of the yard.
  for (const [x, z, w, h, turn] of [[-2.1, 1.1, 0.62, 0.34, 0.3], [-1.86, 1.7, 0.5, 0.26, 1.1], [-2.3, 1.66, 0.4, 0.4, 2.0], [-1.72, 0.82, 0.34, 0.18, 0.7]]) {
    m.at(T(x, 0, z), RY(turn), () => m.color(C.rockDark, 0.1).frustum(w, w * 0.8, w * 0.42, w * 0.3, h, { bottom: false }));
  }

  // The owner's colours: a banner on the front beam and a pennant on a pole in the yard.
  hangingBanner(m, [(px[1] + xr) / 2, hF - 0.12, zF + 0.12], { width: 0.8, height: 1.0 });
  pennant(m, [2.3, 0, 2.3], { height: 3.0, length: 1.05, drop: 0.5, yaw: Math.PI - 0.25, pole: 0.05 });

  return {
    id: 'mining-camp',
    label: 'Mining camp',
    note: 'Pole lean-to roofed with bark slabs, with cut blocks, ore baskets, a handcart and a pick. Where stone and gold are brought. 3 by 3 tile plot.',
    yaw: 0.5,
    plot: 3,
    roots: [{ name: 'mining-camp', mesh: m.toMesh('mining-camp') }],
  };
}
