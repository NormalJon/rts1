// Lumber camp, c. 900: where woodcutters bring felled timber. An open shed of six posts under
// a roof of riven boards held down by poles, with hewn baulks and cordwood stacked in the dry.
// Whole trunks lie stacked between stakes beside it; a sawhorse and a chopping block stand in
// front. The plot is 3 x 3 tiles, so everything stays inside 5.7 m square. The shed's ridge runs
// front to back, so its open gable and the cut ends of the timber face +Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RY, RZ } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, hangingBanner, pitch, groundPatch, logPile, disc } from './parts.mjs';

export function build() {
  const m = new MeshBuilder(23);
  const xc = -1.1, hw = 1.4; // the shed stands in the left of the plot
  const zb = -2.5, zf = 0.55, postH = 2.0;
  const slope = 0.8, over = 0.2; // rise per metre of run, about 39 degrees
  const run = hw + over, rise = run * slope;
  const eaveY = postH + 0.14 - over * slope; // top surface of the boards at the eave
  const ridgeY = eaveY + rise;
  const z0 = zb - 0.2, z1 = zf + 0.2;
  const on = pitch({ run, rise, eaveY });

  // Trodden earth, and chips where the chopping is done.
  groundPatch(m.color(C.earth, 0.04), [[-2.72, -2.72], [-2.72, 2.3], [-2.3, 2.72], [2.35, 2.72], [2.72, 2.35], [2.72, -2.72]]);
  groundPatch(m.color(C.timberLight, 0.06), [[0.05, 1.3], [-0.1, 2.05], [0.5, 2.5], [1.3, 2.4], [1.5, 1.6], [0.9, 1.15]], 0.045);

  // Frame: posts, wall plates, tie beams, and a king post and rafters in each gable.
  const px = [xc - hw + 0.1, xc + hw - 0.1], pz = [zb + 0.1, (zb + zf) / 2, zf - 0.1];
  m.color(C.timber, 0.06);
  for (const x of px) {
    for (const z of pz) m.at(T(x, 0, z), () => m.box(0.2, postH, 0.2, { top: false, bottom: false }));
    m.at(T(x, postH - 0.08, (zb + zf) / 2), () => m.box(0.18, 0.14, zf - zb + 0.24));
  }
  for (const z of pz) m.beam([px[0], postH - 0.2, z], [px[1], postH - 0.2, z], 0.14, 0.16, { top: false, bottom: false });
  for (const z of [pz[0], pz[2]]) {
    m.color(C.timber, 0.06).at(T(xc, postH - 0.12, z), () => m.box(0.14, ridgeY - postH - 0.04, 0.14, { top: false, bottom: false }));
    m.color(C.timberMid, 0.07);
    for (const s of [-1, 1]) m.beam([xc + s * (hw - 0.1), postH, z], [xc + s * 0.04, ridgeY - 0.2, z], 0.1, 0.12, { top: false, bottom: false });
  }
  // Braces from the corner posts up to the plates.
  for (const x of px) {
    for (const [z, d] of [[pz[0], 1], [pz[2], -1]]) m.beam([x, 1.3, z + d * 0.1], [x, 1.9, z + d * 0.72], 0.1, 0.1, { top: false, bottom: false });
  }
  // Windbreak of upright slabs across the back, their tops left ragged.
  const zw = zb + 0.12, nb = 7;
  for (let i = 0; i < nb; i++) {
    const xa = px[0] + (i * (px[1] - px[0])) / nb, xb = px[0] + ((i + 1) * (px[1] - px[0])) / nb;
    const top = 1.46 + ((i * 7) % 3) * 0.11;
    m.color(i % 2 ? C.plank : C.timberMid, 0.08);
    m.poly([[xa, 0, zw], [xb, 0, zw], [xb, top, zw], [xa, top, zw]]);
    m.poly([[xb, 0, zw - 0.05], [xa, 0, zw - 0.05], [xa, top, zw - 0.05], [xb, top, zw - 0.05]]);
  }

  // Roof: riven boards laid from eave to ridge, light and dark by turns, their feet uneven,
  // under a ridge board and a pole on each slope to hold them in a wind.
  const nBoards = 9, t = 0.07;
  m.at(T(xc, 0, 0), () => {
    for (const s of [-1, 1]) {
      const P = (u, off, z) => [...on(s, u, off), z];
      m.color(C.shingle, 0.05).extrude([on(s, 0, 0), on(s, 1, 0), on(s, 1, -t), on(s, 0, -t)], z0, z1);
      for (let i = 0; i < nBoards; i++) {
        const za = z0 + (i * (z1 - z0)) / nBoards, zc = z0 + ((i + 1) * (z1 - z0)) / nBoards;
        const foot = -0.01 - ((i * 5) % 3) * 0.02;
        const board = [P(foot, 0.016, zc), P(foot, 0.016, za), P(1, 0.016, za), P(1, 0.016, zc)];
        m.color(i % 2 ? C.plank : C.timberLight, 0.08).poly(s > 0 ? board : board.reverse());
      }
      m.color(C.bark, 0.07).rod(P(0.42, 0.07, z0 - 0.07), P(0.42, 0.07, z1 + 0.07), 0.055, 5);
    }
  });
  m.color(C.timber, 0.05).beam([xc, ridgeY + 0.035, z0 - 0.08], [xc, ridgeY + 0.035, z1 + 0.08], 0.26, 0.09);

  // In the dry: hewn baulks stacked along the left, cordwood on the right with its ends outwards.
  const baulks = [[-2.14, 0, -1.0, 2.5], [-1.81, 0, -1.12, 2.3], [-1.48, 0, -0.95, 2.55], [-1.98, 0.25, -1.05, 2.4], [-1.64, 0.25, -1.0, 2.2], [-1.8, 0.5, -1.1, 2.0]];
  baulks.forEach(([x, y, z, len], i) => {
    m.color(i % 2 ? C.timberLight : C.plank, 0.07).at(T(x, y, z), () => m.box(0.29, 0.25, len, { bottom: false }));
  });
  m.at(T(xc + 0.62, 0, -0.22), () => logPile(m, [4, 3, 2], { r: 0.13, length: 0.62 }));

  // Felled trunks stacked between stakes, butt ends to the front.
  const tx = 1.74;
  m.at(T(tx, 0, -2.58), () => logPile(m, [3, 2, 1], { r: 0.27, length: 3.25, sides: 6, ragged: 0.28, barks: [C.bark, C.barkPine, C.timberMid] }));
  m.color(C.timberMid, 0.08);
  for (const sx of [-1, 1]) {
    for (const z of [-2.0, 0.1]) m.at(T(tx + sx * 0.9, 0, z), () => m.cyl(0.07, 0.05, 1.05, 5, { bottom: false, phase: z }));
  }

  // Sawhorse: two crossed trestles with a log across them.
  const sz = 1.85, crossY = 0.555;
  for (const x of [-2.02, -0.92]) {
    m.color(C.timberMid, 0.07);
    m.beam([x, 0, sz - 0.38], [x, 0.95, sz + 0.27], 0.09, 0.1, { bottom: false });
    m.beam([x + 0.09, 0, sz + 0.38], [x + 0.09, 0.95, sz - 0.27], 0.09, 0.1, { bottom: false });
  }
  m.color(C.timber, 0.06).beam([-2.02, crossY - 0.1, sz], [-0.83, crossY - 0.1, sz], 0.1, 0.08, { top: false, bottom: false });
  m.at(T(-2.5, 0.94, sz), RZ(-Math.PI / 2), () => {
    m.color(C.barkPine, 0.07).cyl(0.17, 0.16, 1.95, 6, { top: false, bottom: false });
    m.color(C.timberLight, 0.05);
    disc(m, 0.16, 1.95, 6);
    disc(m, 0.17, 0, 6, { up: false });
  });

  // Chopping block with the axe left in it, and billets split from the last log.
  m.at(T(0.72, 0, 1.82), () => {
    m.color(C.bark, 0.06).cyl(0.31, 0.34, 0.44, 7, { top: false, bottom: false, phase: 0.2 });
    m.color(C.timberLight, 0.04);
    disc(m, 0.31, 0.44, 7, { phase: 0.2 });
    m.at(T(0.03, 0.56, 0), RY(0.5), RZ(-1.0), () => {
      m.color(C.timberLight, 0.05).at(T(0, -0.1, 0), () => m.box(0.05, 0.86, 0.04, { bottom: false }));
      m.color(C.iron, 0.05).extrude([[0.0, -0.06], [0.22, -0.11], [0.22, 0.11], [0.0, 0.06]], -0.022, 0.022);
    });
  });
  const billets = [[0.2, 2.2, 0.5], [1.22, 2.12, -0.7], [0.5, 1.28, 1.3], [1.3, 1.5, 0.2]];
  billets.forEach(([x, z, turn], i) => {
    m.color(i % 2 ? C.timberLight : C.plank, 0.08).at(T(x, 0.03, z), RY(turn), () => m.frustum(0.14, 0.46, 0.05, 0.46, 0.11, { bottom: false }));
  });

  // The owner's colours: a banner in the gable and a pennant on a pole in the yard.
  hangingBanner(m, [xc, ridgeY - 0.46, zf + 0.04], { width: 0.7, height: 0.86 });
  pennant(m, [2.3, 0, 2.2], { height: 3.1, length: 1.05, drop: 0.5, yaw: Math.PI - 0.25, pole: 0.05 });

  return {
    id: 'lumber-camp',
    label: 'Lumber camp',
    note: 'Open shed roofed with riven boards, felled trunks stacked beside it. Woodcutters bring timber here. 3 by 3 tile plot.',
    yaw: 0.5,
    plot: 3,
    roots: [{ name: 'lumber-camp', mesh: m.toMesh('lumber-camp') }],
  };
}
