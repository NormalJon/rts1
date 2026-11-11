// Bramble thicket in fruit: the forage bush. A neutral map object, so no TeamColor material.
// Kept low and wide, with the berries set on the upper facets where a high camera sees them.
import { MeshBuilder, hexToRgb, icosphere } from '../mesh.mjs';
import { T, S, RY, mul, transformPoint, alongSegment, add, sub, scale, cross, normalize, lerp3, mulberry32 } from '../math.mjs';
import { C } from '../palette.mjs';

export function build() {
  const m = new MeshBuilder(83);
  const rng = mulberry32(29);

  // One broad leafy dome with two lower mounds pushing out of it, all sunk into the ground:
  // [x, y, z, radius, height as a share of the radius, turn, facet detail, lumpiness].
  const mounds = [
    [0.02, 0.3, -0.04, 0.68, 1.12, 0.4, 1, 0.13],
    [0.4, 0.24, 0.3, 0.37, 0.95, 1.1, 0, 0.08],
    [-0.45, 0.22, 0.16, 0.34, 0.95, 2.3, 0, 0.08],
  ].map(([x, y, z, r, tall, turn, detail, lumps]) => {
    const M = mul(T(x, y, z), mul(RY(turn), S(1, tall, 1)));
    const { verts, faces } = icosphere(detail);
    const lumpy = verts.map((v) => transformPoint(M, scale(v, r * (1 + (rng() * 2 - 1) * lumps))));
    // Whatever would hang below the ground is drawn up to it, so the bush meets the grass in a skirt.
    return { c: [x, y, z], r, tall, faces, core: detail ? 0.78 : 0.68, verts: lumpy.map((p) => [p[0], Math.max(p[1], -0.03), p[2]]) };
  });
  // Is a point inside a mound shrunk by k? At k = mound.core the answer holds for the faceted shape too.
  const within = (p, s, k) => Math.hypot((p[0] - s.c[0]) / s.r, (p[1] - s.c[1]) / (s.r * s.tall), (p[2] - s.c[2]) / s.r) < k;

  const lo = hexToRgb(C.bushLo), hi = hexToRgb(C.bushHi);
  const berries = [];
  for (const mound of mounds) {
    for (const f of mound.faces) {
      const tri = f.map((i) => mound.verts[i]);
      // Leave out facets swallowed by the ground or by another mound.
      if (tri.every((p) => p[1] < 0)) continue;
      if (mounds.some((o) => o !== mound && tri.every((p) => within(p, o, o.core)))) continue;
      const n = normalize(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
      const k = 1 + (rng() * 2 - 1) * 0.07;
      m.poly(tri, lerp3(lo, hi, Math.min(1, Math.max(0, n[1] * 0.6 + 0.45))).map((c) => c * k));
      const mid = scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
      if (n[1] > 0.05 && mid[1] > 0.3 && !mounds.some((o) => o !== mound && within(mid, o, 1))) berries.push({ tri, mid, n });
    }
  }

  // Berry clusters on two in five of those facets: a red one, and on some a ripe dark one beside it.
  const berry = (at, n, r, sides, hex) =>
    m.color(hex, 0.1).at(alongSegment(sub(at, scale(n, 0.02)), add(at, n)), () => m.cyl(r, 0, r * 0.9, sides, { bottom: false, phase: at[0] * 40 }));
  berries.forEach(({ tri, mid, n }, i) => {
    if (i % 5 !== 0 && i % 5 !== 2) return;
    berry(lerp3(mid, tri[i % 3], 0.1), n, 0.09, 5, C.berry);
    if (i % 10 === 0) berry(lerp3(mid, tri[(i + 1) % 3], 0.55), n, 0.065, 4, C.berryRipe);
  });

  return {
    id: 'berry-bush',
    label: 'Berry bush',
    note: 'Bramble thicket with fruit ripening from red to black. Neutral, so no team colour.',
    yaw: 0.5,
    roots: [{ name: 'berry-bush', mesh: m.toMesh('berry-bush') }],
  };
}
