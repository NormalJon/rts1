// Mill, c. 900: where food is brought. Not a windmill, which western Europe does not have
// before the late 12th century, but a granary raised on posts, each capped with a board to
// keep rats out, under a hipped thatch. Grain is ground by hand at a rotary quern in front.
// The plot is 3 x 3 tiles, so everything stays inside 5.7 m square. The door, its gangplank,
// the sacks and the quern face +Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RY, RZ } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, hippedThatch, groundPatch, basket, disc } from './parts.mjs';

/** A filled sack standing on end, tied at the neck. */
function sack(m, k = 1) {
  m.color(C.sack, 0.08).frustum(0.5 * k, 0.4 * k, 0.46 * k, 0.36 * k, 0.5 * k, { top: false, bottom: false });
  m.at(T(0, 0.5 * k, 0), () => m.frustum(0.46 * k, 0.36 * k, 0.12 * k, 0.1 * k, 0.1 * k, { top: false, bottom: false }));
  m.at(T(0, 0.6 * k, 0), () => m.frustum(0.1 * k, 0.09 * k, 0.2 * k, 0.15 * k, 0.08 * k, { bottom: false }));
}

/** A sheaf of corn: bound stalks spreading to the ears. */
function sheaf(m) {
  m.color(C.thatchMid, 0.08).cyl(0.17, 0.08, 0.5, 5, { top: false, bottom: false });
  m.color(C.grain, 0.08).at(T(0, 0.5, 0), () => m.cyl(0.08, 0.2, 0.34, 5, { bottom: false }));
}

export function build() {
  const m = new MeshBuilder(29);
  const W = 3.3, D = 2.8;
  const hw = W / 2, hd = D / 2;
  const zc = -0.9, zf = zc + hd, zb = zc - hd;
  const floorY = 0.88, wallH = 1.55, wallTop = floorY + wallH;
  const over = 0.45, slope = 1.0;
  const ex = hw + over, ez = hd + over;
  const rise = ez * slope;
  const eaveY = wallTop + 0.12 - over * slope;

  groundPatch(m.color(C.earth, 0.04), [[-2.5, 0.7], [-2.7, 1.5], [-2.45, 2.55], [-1.2, 2.74], [1.4, 2.74], [2.55, 2.45], [2.7, 1.3], [2.4, 0.7]]);

  // Eight posts, each under a rat guard, carry three floor beams and the boarded floor.
  const px = [-(hw - 0.22), 0, hw - 0.22], pz = [zb + 0.22, zc, zf - 0.22];
  for (const x of px) {
    for (const z of pz) {
      if (x === 0 && z === zc) continue;
      m.color(C.timber, 0.06).at(T(x, 0, z), () => m.frustum(0.3, 0.3, 0.22, 0.22, 0.6, { top: false, bottom: false }));
      m.color(C.timberLight, 0.06).at(T(x, 0.6, z), () => m.box(0.54, 0.07, 0.54, { bottom: false }));
    }
  }
  m.color(C.timber, 0.06);
  for (const z of pz) m.at(T(0, 0.67, z), () => m.box(W + 0.24, 0.15, 0.2));
  m.color(C.plank, 0.06).at(T(0, 0.82, zc), () => m.box(W + 0.12, 0.06, D + 0.12));

  // Walls of upright planks, one face a plank, between corner posts.
  const stave = (i) => m.color(i % 2 ? C.plank : C.timberMid, 0.07);
  const nx = 10, nz = 8;
  for (let i = 0; i < nx; i++) {
    const x0 = -hw + (i * W) / nx, x1 = -hw + ((i + 1) * W) / nx;
    stave(i).poly([[x0, floorY, zf], [x1, floorY, zf], [x1, wallTop, zf], [x0, wallTop, zf]]);
    stave(i + 1).poly([[x1, floorY, zb], [x0, floorY, zb], [x0, wallTop, zb], [x1, wallTop, zb]]);
  }
  for (let i = 0; i < nz; i++) {
    const z0 = zb + (i * D) / nz, z1 = zb + ((i + 1) * D) / nz;
    stave(i).poly([[hw, floorY, z1], [hw, floorY, z0], [hw, wallTop, z0], [hw, wallTop, z1]]);
    stave(i + 1).poly([[-hw, floorY, z0], [-hw, floorY, z1], [-hw, wallTop, z1], [-hw, wallTop, z0]]);
  }
  m.color(C.timber, 0.06);
  for (const sx of [-1, 1]) {
    for (const z of [zf - 0.06, zb + 0.06]) m.at(T(sx * (hw - 0.06), floorY, z), () => m.box(0.2, wallH, 0.2, { top: false, bottom: false }));
  }

  // A low door of three planks in a frame, opening onto a landing.
  m.at(T(0, floorY, zf), () => {
    for (let i = 0; i < 3; i++) {
      const x0 = -0.39 + i * 0.26, x1 = x0 + 0.26;
      m.color(i % 2 ? C.timberLight : C.plank, 0.07).poly([[x0, 0.02, 0.04], [x1, 0.02, 0.04], [x1, 0.97, 0.04], [x0, 0.97, 0.04]]);
    }
    m.color(C.timber, 0.05);
    for (const sx of [-1, 1]) m.at(T(sx * 0.46, 0, 0.03), () => m.box(0.14, 1.02, 0.16, { bottom: false }));
    m.at(T(0, 0.95, 0.03), () => m.box(1.2, 0.13, 0.18));
  });
  const landing = zf + 0.78;
  m.color(C.plank, 0.07).at(T(0, floorY - 0.06, zf + 0.39), () => m.box(1.7, 0.06, 0.78));
  m.color(C.timber, 0.06);
  for (const sx of [-1, 1]) m.at(T(sx * 0.72, 0, landing - 0.1), () => m.box(0.14, floorY - 0.06, 0.14, { top: false, bottom: false }));
  // Gangplank with cleats nailed across it.
  const foot = 2.7;
  m.color(C.timberLight, 0.06).beam([0, floorY - 0.03, landing - 0.04], [0, 0.0, foot], 0.72, 0.06);
  m.color(C.timber, 0.06);
  for (const k of [0.2, 0.4, 0.6, 0.8]) {
    m.at(T(0, (floorY - 0.03) * (1 - k) + 0.02, landing - 0.04 + (foot - landing + 0.04) * k), () => m.box(0.78, 0.05, 0.07, { bottom: false }));
  }

  // Hipped thatch in three courses, coming almost to a point.
  let top;
  m.at(T(0, 0, zc), () => {
    top = hippedThatch(m, { ex, ez, rise, eaveY }, { step: 0.07, butt: 0.18, courses: [[0, 0.38, C.thatch], [0.34, 0.7, C.thatchMid], [0.66, 1, C.thatch]] });
  });

  // Sacks waiting to go up: three standing, one lying across them, two on the landing.
  for (const [x, z, turn, k] of [[1.27, 1.62, 0.3, 0.95], [1.73, 1.52, -0.4, 1], [1.46, 2.16, 1.1, 0.95]]) m.at(T(x, 0, z), RY(turn), () => sack(m, k));
  m.at(T(2.3, 0.2, 1.72), RY(0.15), RX(Math.PI / 2 - 0.12), () => sack(m, 1));
  for (const [x, turn] of [[-0.62, 0.2], [0.63, -0.3]]) m.at(T(x, floorY, zf + 0.5), RY(turn), () => sack(m, 0.9));

  // Rotary quern on a block: the upper stone is turned by its handle on the lower.
  m.at(T(-1.55, 0, 1.7), () => {
    m.color(C.bark, 0.06).cyl(0.36, 0.38, 0.4, 6, { top: false, bottom: false });
    m.color(C.stoneDark, 0.06).at(T(0, 0.4, 0), () => m.cyl(0.44, 0.44, 0.13, 8, { bottom: false }));
    m.color(C.stoneLight, 0.06).at(T(0, 0.53, 0), () => m.cyl(0.41, 0.38, 0.15, 8, { bottom: false, phase: 0.3 }));
    m.color(C.slit).at(T(0, 0.684, 0), () => disc(m, 0.09, 0, 5));
    m.color(C.timber, 0.05).at(T(0.27, 0.68, 0.06), () => m.box(0.06, 0.22, 0.06, { bottom: false }));
  });
  // Baskets of threshed grain, and sheaves stooked to dry.
  for (const [x, z, r] of [[-0.78, 1.72, 0.27], [-1.02, 2.3, 0.24]]) m.at(T(x, 0, z), () => basket(m, { r, fill: C.grain }));
  m.at(T(-2.18, 0, 2.2), () => {
    for (let i = 0; i < 3; i++) m.at(RY((i * Math.PI * 2) / 3 + 0.4), T(0.2, 0, 0), RZ(0.3), () => sheaf(m));
  });

  // The owner's colours: a cloth thrown over two of the sacks and a pennant on the roof.
  m.team().at(T(1.5, 0.3, 1.57), RY(-0.1), () => m.frustum(1.36, 0.94, 0.98, 0.6, 0.47, { bottom: false }));
  pennant(m, [0, top - 0.1, zc], { height: 1.15, length: 0.95, drop: 0.44, yaw: -0.3, pole: 0.04 });

  return {
    id: 'mill',
    label: 'Mill',
    note: 'Granary raised on posts, with a hand quern: no windmill turns in Europe before the late 12th century. Food is brought here. 3 by 3 tile plot.',
    yaw: 0.5,
    plot: 3,
    roots: [{ name: 'mill', mesh: m.toMesh('mill') }],
  };
}
