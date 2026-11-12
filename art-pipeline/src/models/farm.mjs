// Farm, c. 900-1100: tilled ground a villager works for food, laid out as the strips of an
// open field. The plough has thrown the earth up into ridges with furrows between; six of
// them carry rows of young wheat and two lie fallow under stubble. A grass balk is left at
// the edge of the plot, so farms set side by side read as strips of one field.
// Units walk straight across a farm, so it is kept low: nothing rises above a third of a
// metre except a scarecrow in the back corner, which wears the owner's colour.
// The plot is 3 x 3 tiles, so everything stays inside 5.7 m square. The ridges run front to
// back, along Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RY } from '../math.mjs';
import { C } from '../palette.mjs';

export function build() {
  const m = new MeshBuilder(113);
  const half = 2.82; // the field stops just short of the plot's limit
  const ridges = 8, pitch = (half * 2) / ridges;
  const fallowFrom = 6; // the last two ridges carry no crop

  // The furrow bottoms: one sheet of dark earth under everything.
  m.color(C.loam, 0.03).poly([[-half, 0.03, half], [half, 0.03, half], [half, 0.03, -half], [-half, 0.03, -half]]);

  // Deterministic unevenness, so that no two ridges are quite alike.
  const rough = (i, k = 0) => {
    const v = Math.sin((i * 7 + k * 13 + 1) * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  };

  for (let i = 0; i < ridges; i++) {
    const x = -half + pitch * (i + 0.5);
    const fallow = i >= fallowFrom;
    const h = 0.11 + rough(i) * 0.04; // height of the ridge's flat top
    const w = pitch / 2 - 0.07, wt = 0.11; // half-widths at the foot and at the top
    const z0 = -half + rough(i, 1) * 0.05, z1 = half - rough(i, 2) * 0.05;
    // A ridge is two slopes, a narrow top and its two ends.
    m.color(fallow ? C.stubble : C.earth, 0.07);
    m.poly([[x + wt, h, z1], [x + w, 0.03, z1], [x + w, 0.03, z0], [x + wt, h, z0]]);
    m.poly([[x - w, 0.03, z1], [x - wt, h, z1], [x - wt, h, z0], [x - w, 0.03, z0]]);
    m.poly([[x - wt, h, z1], [x + wt, h, z1], [x + wt, h, z0], [x - wt, h, z0]]);
    m.poly([[x - w, 0.03, z1], [x + w, 0.03, z1], [x + wt, h, z1], [x - wt, h, z1]]);
    m.poly([[x + w, 0.03, z0], [x - w, 0.03, z0], [x - wt, h, z0], [x + wt, h, z0]]);
    if (fallow) continue;
    // Young wheat along the top, in three or four lengths of slightly different height and
    // green, broken at a different place on every ridge.
    const parts = 3 + (i % 2);
    const cuts = [z0 + 0.06];
    for (let k = 1; k < parts; k++) cuts.push(z0 + (z1 - z0) * ((k + (rough(i, 2 + k) - 0.5) * 0.55) / parts));
    cuts.push(z1 - 0.06);
    for (let k = 0; k < parts; k++) {
      const a = cuts[k] + (k ? 0.05 : 0), b = cuts[k + 1] - (k < parts - 1 ? 0.05 : 0);
      const top = h + 0.13 + rough(i, 7 + k) * 0.06, cw = 0.15;
      m.color((i + k) % 2 ? C.leaf : C.wheatYoung, 0.1);
      m.poly([[x, top, b], [x + cw, h - 0.01, b], [x + cw, h - 0.01, a], [x, top, a]]);
      m.poly([[x - cw, h - 0.01, b], [x, top, b], [x, top, a], [x - cw, h - 0.01, a]]);
      m.poly([[x - cw, h - 0.01, b], [x + cw, h - 0.01, b], [x, top, b]]);
      m.poly([[x + cw, h - 0.01, a], [x - cw, h - 0.01, a], [x, top, a]]);
    }
  }

  // Scarecrow at the back corner, out of the way of anyone crossing: a cross of poles in a
  // ragged tunic of the owner's colour, a sack for a head and a straw hat.
  m.at(T(-2.3, 0, -2.32), RY(0.2), () => {
    m.color(C.timber, 0.06).box(0.07, 1.3, 0.07, { top: false, bottom: false });
    m.beam([-0.5, 1.18, 0], [0.5, 1.18, 0], 0.06, 0.06);
    m.team().at(T(0, 0.6, 0), () => m.frustum(0.48, 0.17, 0.36, 0.14, 0.6, { bottom: false }));
    m.color(C.sack, 0.06).at(T(0, 1.22, 0), () => m.cyl(0.12, 0.11, 0.22, 5, { top: false, bottom: false }));
    m.color(C.thatch, 0.07).at(T(0, 1.42, 0), () => m.cyl(0.25, 0, 0.17, 6, { bottom: false }));
  });

  return {
    id: 'farm',
    label: 'Farm',
    note: 'Open-field strips: ridge and furrow under young wheat, two ridges fallow, a scarecrow in the corner. Worked for food, and low enough to walk across. 3 by 3 tile plot.',
    yaw: 0.5,
    plot: 3,
    roots: [{ name: 'farm', mesh: m.toMesh('farm') }],
  };
}
