// Trees are neutral map objects, so they carry no TeamColor material.
import { MeshBuilder } from '../mesh.mjs';
import { T, S, RY, mulberry32 } from '../math.mjs';
import { C } from '../palette.mjs';

export function buildOak() {
  const m = new MeshBuilder(53);
  // Short thick bole with a root flare, then spreading limbs: an open-grown oak.
  m.color(C.bark, 0.08);
  m.cyl(0.78, 0.5, 0.45, 7, { top: false });
  m.at(T(0, 0.45, 0), () => m.cyl(0.5, 0.4, 2.0, 7, { top: false, bottom: false }));
  const limbs = [
    [[0, 2.3, 0], [1.5, 3.9, 0.5]],
    [[0, 2.3, 0], [-1.4, 4.0, -0.5]],
    [[0, 2.3, 0], [0.2, 3.8, 1.5]],
    [[0, 2.3, 0], [-0.3, 4.1, -1.5]],
    [[0, 2.3, 0], [0, 4.6, 0]],
  ];
  for (const [a, b] of limbs) m.rod(a, b, 0.24, 5, { rt: 0.12, top: false, bottom: false });

  const crown = [
    [0, 5.3, 0, 2.0],
    [1.7, 4.5, 0.5, 1.5],
    [-1.6, 4.6, -0.6, 1.55],
    [0.3, 4.4, 1.7, 1.4],
    [-0.4, 4.6, -1.7, 1.45],
    [1.0, 5.0, -1.2, 1.25],
    [-1.2, 4.9, 1.1, 1.25],
  ];
  crown.forEach(([x, y, z, r], i) => {
    m.at(T(x, y, z), RY(i * 1.1), S(1, 0.78, 1), () =>
      m.blob(r, { jitter: 0.14, detail: 1, colors: [C.oakLo, C.oakHi], vary: 0.07 }));
  });

  return {
    id: 'oak',
    label: 'Oak',
    note: 'Open-grown oak with a short bole and broad crown. Neutral, so no team colour.',
    yaw: 0.4,
    roots: [{ name: 'oak', mesh: m.toMesh('oak') }],
  };
}

export function buildConifer() {
  const m = new MeshBuilder(59);
  const rng = mulberry32(77);
  m.color(C.barkPine, 0.08).cyl(0.26, 0.1, 6.2, 6, { top: false });

  // Drooping tiers: each is a cone whose skirt is pulled in and out at alternate points.
  const tiers = [
    [1.3, 1.75, 1.7],
    [2.3, 1.5, 1.6],
    [3.3, 1.22, 1.5],
    [4.25, 0.94, 1.4],
    [5.15, 0.66, 1.3],
    [5.95, 0.4, 1.15],
  ];
  tiers.forEach(([y, r, h], t) => {
    const sides = 8;
    const ring = Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + t * 0.5;
      const k = r * (i % 2 ? 0.72 : 1.0) * (0.92 + rng() * 0.16);
      return [k * Math.cos(a), y - (i % 2 ? 0 : 0.28) + (rng() - 0.5) * 0.1, k * Math.sin(a)];
    });
    const apex = [0, y + h, 0];
    const under = [0, y + h * 0.3, 0];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      m.color(i % 2 ? C.firHi : '#3c6a43', 0.08).poly([ring[j], ring[i], apex]);
      m.color(C.firLo, 0.05).poly([ring[i], ring[j], under]);
    }
  });

  return {
    id: 'conifer',
    label: 'Conifer',
    note: 'Fir or spruce in drooping tiers. Neutral, so no team colour.',
    yaw: 0.3,
    roots: [{ name: 'conifer', mesh: m.toMesh('conifer') }],
  };
}
