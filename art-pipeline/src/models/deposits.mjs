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
 *   apexY  height at which the sides would meet; higher gives more upright sides
 *   lean   [x, z] offset of that meeting point, to tip the block over
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
 * A seam through a block: wherever its surface lies between two parallel planes, lay a strip
 * a finger's breadth proud of the rock. The plane passes through `through`, strikes across
 * the compass direction `az` and dips by `dip`; `width` is the thickness of the seam.
 */
function seam(m, blk, through, az, dip, width) {
  const n = [Math.cos(az) * Math.cos(dip), Math.sin(dip), Math.sin(az) * Math.cos(dip)];
  const d = dot(n, through);
  for (const face of blk.faces) {
    const strip = clip(clip(face, n, d - width / 2), scale(n, -1), -d - width / 2);
    if (strip.length < 3) continue;
    const up = scale(normalize(cross(sub(face[1], face[0]), sub(face[2], face[0]))), 0.014);
    m.poly(strip.map((p) => add(p, up)));
  }
}

export function buildStone() {
  const m = new MeshBuilder(61);
  const rng = mulberry32(204);
  const rock = (cx, cz, rx, rz, n, yaw, opts) =>
    block(m, outline(rng, cx, cz, rx, rz, n, yaw), { tone: [C.stone, C.stoneLight], ...opts });

  // Tall parent block and three lesser ones split from it.
  rock(-0.22, -0.18, 0.5, 0.44, 5, 0.3, { h: 1.34, tilt: [-0.32, 0.2], apexY: 5.5, lean: [0.25, 0.1] });
  rock(0.38, 0.2, 0.42, 0.4, 4, 0.9, { h: 0.9, tilt: [0.28, 0.22], apexY: 4.2 });
  rock(-0.5, 0.48, 0.36, 0.34, 4, 0.5, { h: 0.6, tilt: [-0.2, 0.3], apexY: 2.6 });
  rock(0.36, -0.5, 0.42, 0.34, 4, 0.2, { h: 0.72, tilt: [0.25, -0.3], apexY: 3.2, tone: [C.stoneDark, C.stone] });
  // A slab fallen against them and another lying flat.
  m.at(T(0.05, -0.04, 0.86), RY(Math.PI / 2), RZ(0.55), () =>
    block(m, outline(rng, 0.31, 0, 0.42, 0.42, 4, Math.PI / 4), { h: 0.17, y0: 0, apexY: 3, bottom: true, tone: [C.stone, C.stoneLight] }));
  rock(-0.68, -0.05, 0.2, 0.32, 4, 0.7, { h: 0.26, tilt: [-0.2, 0], apexY: 1.6 });
  // Rubble at the foot.
  rock(0.74, -0.1, 0.15, 0.15, 3, 0.4, { h: 0.2, tone: [C.stoneDark, C.stone] });
  rock(0.64, 0.68, 0.18, 0.17, 4, 1.2, { h: 0.24, tilt: [0.3, 0.2] });
  rock(-0.64, -0.64, 0.19, 0.18, 3, 2.0, { h: 0.3, tilt: [-0.3, -0.2], tone: [C.stoneDark, C.stone] });
  rock(-0.08, -0.74, 0.14, 0.13, 3, 0.9, { h: 0.17 });

  return {
    id: 'stone-deposit',
    label: 'Stone deposit',
    note: 'Pale building stone split into blocks and slabs. One tile; neighbours run together into an outcrop.',
    yaw: 0.5,
    roots: [{ name: 'stone-deposit', mesh: m.toMesh('stone-deposit') }],
  };
}

export function buildGold() {
  const m = new MeshBuilder(67);
  const rng = mulberry32(318);
  const rock = (cx, cz, rx, rz, n, yaw, opts) =>
    block(m, outline(rng, cx, cz, rx, rz, n, yaw), { tone: [C.ore, C.oreLight], ...opts });
  const vein = (blk, through, az, dip, width, hex = C.gold) => {
    m.color(hex, 0.07);
    seam(m, blk, through, az, dip, width);
  };
  // A nugget standing out of the top of a block.
  const nugget = (blk, x, z, r, hex = C.goldLight) =>
    block(m, outline(rng, x, z, r, r, 4, x * 9), { y0: blk.top(x, z) - 0.06, h: blk.top(x, z) + 0.07, tilt: blk.tilt, tone: [C.gold, hex], vary: 0.08 });

  // Dark host rock in broad lumps, lower and heavier than the stone outcrop.
  const a = rock(0.14, -0.2, 0.55, 0.48, 5, 0.2, { h: 1.1, tilt: [0.2, 0.26], apexY: 3.6 });
  const b = rock(-0.42, 0.32, 0.42, 0.4, 4, 0.6, { h: 0.76, tilt: [-0.25, 0.2], apexY: 2.8 });
  const c = rock(0.46, 0.5, 0.36, 0.32, 4, 1.0, { h: 0.5, tilt: [0.2, 0.3], apexY: 2.0, tone: [C.oreDark, C.ore] });
  const d = rock(-0.5, -0.52, 0.33, 0.31, 4, 0.3, { h: 0.56, tilt: [-0.2, -0.25], apexY: 2.2, tone: [C.oreDark, C.ore] });

  // Seams of gold run through each lump, over the top and down the sides.
  vein(a, [0.05, 1.0, -0.2], 0.5, 0.25, 0.13);
  vein(a, [0.28, 1.0, -0.12], 2.2, -0.2, 0.09, C.goldLight);
  vein(b, [-0.4, 0.7, 0.3], 1.9, 0.3, 0.12);
  vein(b, [-0.52, 0.7, 0.3], 0.3, -0.15, 0.07, C.goldLight);
  vein(c, [0.48, 0.45, 0.5], 1.2, 0.3, 0.11);
  vein(d, [-0.5, 0.5, -0.5], 2.7, 0.2, 0.11, C.goldLight);
  nugget(a, 0.3, -0.34, 0.1);
  nugget(a, -0.12, -0.05, 0.08);
  nugget(b, -0.34, 0.42, 0.085);

  // Broken ore at the foot.
  rock(0.76, -0.12, 0.14, 0.14, 3, 0.5, { h: 0.2, tone: [C.gold, C.goldLight] });
  rock(-0.72, -0.02, 0.16, 0.18, 4, 1.1, { h: 0.24, tilt: [-0.2, 0.2] });
  rock(0.02, 0.76, 0.15, 0.14, 3, 2.2, { h: 0.18, tone: [C.gold, C.goldLight] });
  rock(0.72, -0.62, 0.17, 0.16, 4, 0.2, { h: 0.26, tone: [C.oreDark, C.ore] });

  return {
    id: 'gold-deposit',
    label: 'Gold deposit',
    note: 'Dark host rock shot through with seams of gold. The same one-tile module as the stone.',
    yaw: 0.5,
    roots: [{ name: 'gold-deposit', mesh: m.toMesh('gold-deposit') }],
  };
}
