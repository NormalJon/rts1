// Bramble thicket in fruit: the forage bush. A neutral map object, so no TeamColor material.
// Kept low and wide, with the berries set on the upper facets where a high camera sees them.
import { MeshBuilder, hexToRgb, icosphere } from '../mesh.mjs';
import { T, S, RY, mul, transformPoint, alongSegment, add, sub, scale, cross, normalize, lerp3, mulberry32 } from '../math.mjs';
import { C } from '../palette.mjs';

export function build() {
  const m = new MeshBuilder(83);
  const rng = mulberry32(29);
  const squash = 0.8;

  // Overlapping leafy mounds: [x, y, z, radius, turn].
  const mounds = [
    [0.02, 0.6, -0.04, 0.5, 0.0],
    [0.36, 0.42, 0.2, 0.4, 1.1],
    [-0.36, 0.4, 0.16, 0.41, 2.3],
    [-0.14, 0.4, -0.38, 0.39, 0.7],
    [0.3, 0.36, -0.3, 0.34, 3.1],
    [-0.02, 0.34, 0.44, 0.33, 1.9],
  ].map(([x, y, z, r, turn]) => {
    const M = mul(T(x, y, z), mul(RY(turn), S(1, squash, 1)));
    return { c: [x, y, z], r, verts: icosphere(0).verts.map((v) => transformPoint(M, scale(v, r * (0.9 + rng() * 0.2)))) };
  });
  // Is a point inside a mound shrunk by k? With k below about 0.7 the answer is safe for the faceted shape.
  const within = (p, s, k) => Math.hypot((p[0] - s.c[0]) / s.r, (p[1] - s.c[1]) / (s.r * squash), (p[2] - s.c[2]) / s.r) < k;

  const lo = hexToRgb(C.bushLo), hi = hexToRgb(C.bushHi);
  const berries = [];
  for (const mound of mounds) {
    for (const f of icosphere(0).faces) {
      const tri = f.map((i) => mound.verts[i]);
      // Leave out facets swallowed by a neighbour or by the ground.
      if (tri.every((p) => p[1] < 0)) continue;
      if (mounds.some((o) => o !== mound && tri.every((p) => within(p, o, 0.68)))) continue;
      const n = normalize(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
      const k = 1 + (rng() * 2 - 1) * 0.07;
      m.poly(tri, lerp3(lo, hi, Math.min(1, Math.max(0, n[1] * 0.6 + 0.45))).map((c) => c * k));
      const mid = scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
      if (n[1] > -0.1 && mid[1] > 0.3 && !mounds.some((o) => o !== mound && within(mid, o, 0.95))) berries.push({ tri, mid, n });
    }
  }

  // Berry clusters on about two facets in three: a red one, and often a ripe dark one beside it.
  const berry = (at, n, r, hex) =>
    m.color(hex, 0.1).at(alongSegment(sub(at, scale(n, 0.02)), add(at, n)), () => m.cyl(r, 0, r * 0.95, 5, { bottom: false, phase: at[0] * 40 }));
  berries.forEach(({ tri, mid, n }, i) => {
    if (i % 3 === 2) return;
    const corner = tri[i % 3];
    berry(lerp3(mid, corner, 0.12), n, 0.085, C.berry);
    if (i % 2 === 0) berry(lerp3(mid, tri[(i + 1) % 3], 0.5), n, 0.06, C.berryRipe);
  });

  return {
    id: 'berry-bush',
    label: 'Berry bush',
    note: 'Bramble thicket with fruit ripening from red to black. Neutral, so no team colour.',
    yaw: 0.5,
    roots: [{ name: 'berry-bush', mesh: m.toMesh('berry-bush') }],
  };
}
