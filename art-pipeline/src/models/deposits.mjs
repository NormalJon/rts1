// Stone and gold deposits: one-tile outcrops of split, angular rock. Neutral map objects, so
// they carry no TeamColor material. The game sets them on neighbouring 2 m tiles, each turned
// in quarter steps and scaled a little, so the blocks are spread unevenly over the tile and
// the ragged edges of one run into the next.
import { MeshBuilder } from '../mesh.mjs';
import { T, RY, RZ, add, sub, scale, cross, dot, lerp3, normalize, mulberry32 } from '../math.mjs';
import { C } from '../palette.mjs';

/** Irregular convex outline: n corners unevenly spaced round an ellipse, as [x, z] pairs. */
function outline(rng, cx, cz, rx, rz, n, yaw = 0) {
  return Array.from({ length: n }, (_, i) => {
    const a = yaw + ((i + (rng() - 0.5) * 0.45) / n) * Math.PI * 2;
    const k = 0.9 + rng() * 0.2;
    return [cx + rx * k * Math.cos(a), cz + rz * k * Math.sin(a)];
  });
}

/**
 * One angular block: a pyramid over a convex base, cut off by a tilted plane. Every face is
 * flat, which is what makes it read as split rock rather than a boulder.
 *   base   [[x, z], ...] corners, either winding
 *   h      height of the cut above y = 0, over the middle of the base
 *   tilt   slope of the cut as [rise per metre of x, rise per metre of z]
 *   y0     height of the base; by default just under the ground, so nothing hovers
 *   apexY  height at which the sides would meet; higher gives more upright sides
 *   lean   [x, z] offset of that meeting point, to tip the block over
 *   bottom close the underside, for a block that is lifted or overhangs
 *   tone   [side colour, top colour]
 * Returns its faces and the height of its top at any point, for seams and for stacking.
 */
function block(m, base, { h, tilt = [0, 0], y0 = -0.06, apexY = (h - y0) * 4 + y0, lean = [0, 0], bottom = false, tone, vary = 0.06 }) {
  let ring = base;
  const area = ring.reduce((s, p, i) => s + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0);
  if (area > 0) ring = [...ring].reverse(); // wind so that the top faces up
  const n = ring.length;
  const cx = ring.reduce((s, p) => s + p[0], 0) / n, cz = ring.reduce((s, p) => s + p[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], c = ring[(i + 2) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 0) throw new Error('block: base outline is not convex');
  }
  const top = (x, z) => h + tilt[0] * (x - cx) + tilt[1] * (z - cz);
  const apex = [cx + lean[0], apexY, cz + lean[1]];
  const B = ring.map(([x, z]) => [x, y0, z]);
  const Tp = B.map((b) => {
    // Where the edge from this corner to the apex meets the cut.
    const t = (top(b[0], b[2]) - y0) / (apexY - y0 - tilt[0] * (apex[0] - b[0]) - tilt[1] * (apex[2] - b[2]));
    return lerp3(b, apex, t);
  });
  const faces = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([B[i], B[j], Tp[j], Tp[i]]);
  }
  m.color(tone[0], vary);
  for (const f of faces) m.poly(f);
  if (bottom) m.poly([...B].reverse());
  faces.push(Tp);
  m.color(tone[1], vary * 0.7).poly(Tp);
  return { faces, top, tilt };
}

/** The part of a convex polygon on the side of a plane where dot(n, p) >= d. */
function clip(poly, n, d) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = dot(n, a) - d, db = dot(n, b) - d;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) out.push(lerp3(a, b, da / (da - db)));
  }
  return out;
}

/**
 * A seam cutting through blocks: wherever their surface lies between two planes, lay a strip
 * a finger's breadth proud of the rock, so one seam shows on the top and down the sides.
 * The seam passes through `through`, strikes across the compass direction `az` and dips by
 * `dip`. It is `width` thick there and, with `flare`, swells one way and pinches out the other.
 */
function seam(m, blocks, { through, az, dip = 0, width, flare = 0 }) {
  const plane = (a) => [Math.cos(a) * Math.cos(dip), Math.sin(dip), Math.sin(a) * Math.cos(dip)];
  const n0 = plane(az - flare / 2), n1 = scale(plane(az + flare / 2), -1);
  for (const blk of blocks) {
    for (const face of blk.faces) {
      const facing = normalize(cross(sub(face[1], face[0]), sub(face[2], face[0])));
      // A face lying nearly along the seam would be plated with it; leave those bare.
      if (Math.abs(dot(facing, n0)) > 0.72) continue;
      const strip = clip(clip(face, n0, dot(n0, through) - width / 2), n1, dot(n1, through) - width / 2);
      if (strip.length >= 3) m.poly(strip.map((p) => add(p, scale(facing, 0.014))));
    }
  }
}

export function buildStone() {
  const m = new MeshBuilder(61);
  const rng = mulberry32(204);
  const rock = (cx, cz, rx, rz, n, yaw, opts) =>
    block(m, outline(rng, cx, cz, rx, rz, n, yaw), { tone: [C.rock, C.rockLight], ...opts });
  const weathered = [C.rockDark, C.rock];

  // Parent block with a shoulder split from it, and lesser blocks crowding round.
  rock(-0.2, -0.2, 0.56, 0.5, 5, 0.3, { h: 1.24, tilt: [-0.3, 0.24], apexY: 4.6, lean: [0.2, 0.1] });
  rock(0.24, -0.02, 0.44, 0.42, 4, 0.9, { h: 0.9, tilt: [0.26, 0.2], apexY: 3.6 });
  rock(-0.5, 0.44, 0.36, 0.34, 5, 0.5, { h: 0.66, tilt: [-0.2, 0.3], apexY: 2.6 });
  rock(0.46, 0.44, 0.36, 0.34, 4, 0.2, { h: 0.46, tilt: [0.04, 0.03], apexY: 2.2, tone: weathered });
  // A bed split from the top of that one and slid a little askew.
  rock(0.42, 0.4, 0.35, 0.3, 4, 0.75, { y0: 0.42, h: 0.6, tilt: [0.1, 0.06], apexY: 2.4, bottom: true });
  rock(0.44, -0.56, 0.36, 0.3, 4, 0.5, { h: 0.6, tilt: [0.25, -0.3], apexY: 2.6, tone: weathered });
  // A slab fallen against them and another lying flat.
  m.at(T(0.0, -0.04, 0.8), RY(Math.PI / 2 + 0.15), RZ(0.5), () =>
    block(m, outline(rng, 0.3, 0, 0.4, 0.4, 4, Math.PI / 4), { h: 0.16, y0: 0, apexY: 3, bottom: true, tone: [C.rock, C.rockLight] }));
  rock(-0.7, -0.12, 0.17, 0.32, 4, 0.7, { h: 0.26, tilt: [-0.2, 0], apexY: 1.6 });
  // Rubble at the foot.
  rock(0.76, 0.0, 0.13, 0.15, 3, 0.4, { h: 0.2, tone: weathered });
  rock(-0.62, -0.68, 0.17, 0.16, 3, 2.0, { h: 0.28, tilt: [-0.3, -0.2], tone: weathered });
  rock(-0.02, -0.76, 0.14, 0.12, 3, 0.9, { h: 0.17 });

  return {
    id: 'stone-deposit',
    label: 'Stone deposit',
    note: 'Pale grey building stone split into blocks and slabs. One tile; neighbours run together into an outcrop.',
    yaw: 0.5,
    roots: [{ name: 'stone-deposit', mesh: m.toMesh('stone-deposit') }],
  };
}

export function buildGold() {
  const m = new MeshBuilder(67);
  const rng = mulberry32(318);
  const rock = (cx, cz, rx, rz, n, yaw, opts) =>
    block(m, outline(rng, cx, cz, rx, rz, n, yaw), { tone: [C.ore, C.oreLight], ...opts });
  const dark = [C.oreDark, C.ore];

  // Dark host rock in one heavy mass with lesser lumps against it, lower than the stone outcrop.
  const a = rock(0.1, -0.16, 0.6, 0.52, 5, 0.2, { h: 1.08, tilt: [0.22, 0.26], apexY: 3.0, lean: [-0.1, 0.1] });
  const b = rock(-0.42, 0.34, 0.42, 0.4, 5, 0.6, { h: 0.74, tilt: [-0.25, 0.2], apexY: 2.4 });
  const c = rock(0.44, 0.44, 0.36, 0.32, 4, 1.0, { h: 0.5, tilt: [0.2, 0.3], apexY: 1.8, tone: dark });
  const d = rock(-0.44, -0.48, 0.33, 0.31, 4, 0.3, { h: 0.56, tilt: [-0.2, -0.25], apexY: 2.0, tone: dark });
  // Broken ore at the foot.
  const rubble = [
    rock(0.74, -0.22, 0.15, 0.16, 4, 0.5, { h: 0.22, tilt: [0.2, 0] }),
    rock(-0.02, 0.76, 0.15, 0.13, 3, 2.2, { h: 0.18 }),
    rock(0.6, -0.68, 0.17, 0.16, 4, 0.2, { h: 0.26, tone: dark }),
    rock(-0.76, -0.06, 0.12, 0.15, 3, 1.1, { h: 0.2, tone: dark }),
  ];

  // One system of seams runs through the mass: a main seam and a thinner one beside it on
  // the same strike, each swelling one way and pinching out the other, and a branch leaving
  // them at a shallow angle. A cross seam takes in the outlying lumps, so gold shows from
  // every side.
  const all = [a, b, c, d, ...rubble];
  m.color(C.gold, 0.07);
  seam(m, all, { through: [0.0, 0.5, 0.0], az: 0.45, dip: 0.2, width: 0.1, flare: 0.07 });
  seam(m, [b, c, d, ...rubble], { through: [0.45, 0.5, -0.3], az: 1.0, dip: 0.2, width: 0.075, flare: -0.07 });
  seam(m, [c, d, ...rubble], { through: [0.0, 0.3, -0.02], az: 2.36, dip: 0.15, width: 0.085, flare: 0.03 });
  m.color(C.goldLight, 0.07);
  seam(m, all, { through: [-0.27, 0.5, -0.1], az: 0.45, dip: 0.2, width: 0.05, flare: -0.05 });

  // Nuggets by the seams, standing a little out of the rock.
  const nugget = (blk, x, z, r) =>
    block(m, outline(rng, x, z, r, r * 0.8, 5, x * 9), { y0: blk.top(x, z) - 0.07, h: blk.top(x, z) + 0.05, tilt: blk.tilt, apexY: blk.top(x, z) + 0.2, tone: [C.gold, C.goldLight], vary: 0.08 });
  nugget(a, 0.2, -0.36, 0.11);
  nugget(a, 0.02, 0.04, 0.085);
  nugget(b, -0.36, 0.4, 0.09);

  return {
    id: 'gold-deposit',
    label: 'Gold deposit',
    note: 'Dark host rock shot through with seams of gold. The same one-tile module as the stone.',
    yaw: 0.5,
    roots: [{ name: 'gold-deposit', mesh: m.toMesh('gold-deposit') }],
  };
}
