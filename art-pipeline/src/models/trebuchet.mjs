// Traction trebuchet (perrier), the stone-thrower in use before the counterweight
// machine arrived in the late 12th century: a crew hauls on ropes at the short end of the beam.
// It throws towards +Z. Shown at rest with the sling loaded.
import { MeshBuilder } from '../mesh.mjs';
import { T, add, sub, scale } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant } from './parts.mjs';

export function build() {
  const m = new MeshBuilder(67);
  const fx = 0.95, axleY = 3.3, footZ = 1.45;

  // Sledge base.
  m.color(C.timber, 0.06);
  for (const s of [-1, 1]) m.at(T(s * fx, 0, 0), () => m.box(0.24, 0.22, 3.6));
  for (const z of [-1.6, 0, 1.6]) m.at(T(0, 0.2, z), () => m.box(fx * 2 + 0.6, 0.18, 0.22));

  // Two A-frame trestles carrying the axle, tied together with saltire bracing.
  for (const s of [-1, 1]) {
    m.color(C.timberMid, 0.06);
    m.beam([s * fx, 0.2, -footZ], [s * fx, axleY + 0.15, 0], 0.2, 0.22);
    m.beam([s * fx, 0.2, footZ], [s * fx, axleY + 0.15, 0], 0.2, 0.22);
    m.color(C.timber, 0.06).at(T(s * fx, 1.45, 0), () => m.box(0.14, 0.16, 1.7));
  }
  m.color(C.timber, 0.07);
  m.beam([-fx, 0.4, -footZ * 0.85], [fx, 2.5, -footZ * 0.25], 0.1, 0.12);
  m.beam([fx, 0.4, -footZ * 0.85], [-fx, 2.5, -footZ * 0.25], 0.1, 0.12);
  m.color(C.iron, 0.04).rod([-fx - 0.3, axleY, 0], [fx + 0.3, axleY, 0], 0.09, 6);

  // Throwing beam: long arm down and back, short arm up and forward.
  const phi = (38 * Math.PI) / 180;
  const dir = [0, Math.sin(phi), Math.cos(phi)]; // unit vector towards the short end
  const pivot = [0, axleY, 0];
  const longTip = add(pivot, scale(dir, -4.3));
  const shortTip = add(pivot, scale(dir, 1.25));
  m.color(C.timberLight, 0.05).beam(add(pivot, scale(dir, -1.6)), shortTip, 0.26, 0.3);
  m.color(C.timberLight, 0.05).beam(longTip, add(pivot, scale(dir, -1.5)), 0.17, 0.2);
  m.color(C.rope, 0.05);
  for (const d of [-1.75, -1.35, 0.35]) {
    const p = add(pivot, scale(dir, d));
    m.beam(sub(p, scale(dir, 0.07)), add(p, scale(dir, 0.07)), 0.3, 0.34); // rope lashings
  }

  // Spreader bar and the hauling ropes hanging from it.
  m.color(C.timber, 0.05).rod(add(shortTip, [-0.85, 0, 0]), add(shortTip, [0.85, 0, 0]), 0.06, 6);
  m.color(C.rope, 0.06);
  for (let i = 0; i < 8; i++) {
    const x = -0.75 + i * (1.5 / 7);
    const top = add(shortTip, [x, -0.03, 0]);
    const foot = [x * 1.25, 1.15 + (i % 3) * 0.12, shortTip[2] + 0.55 + (i % 2) * 0.18];
    m.beam(top, foot, 0.035, 0.035);
    m.at(T(foot[0], foot[1] - 0.06, foot[2]), () => m.box(0.07, 0.08, 0.07)); // knot
  }

  // Sling: two cords down to a leather pouch holding the stone, resting in a trough.
  const pouch = [0, 0.38, -1.9];
  m.color(C.rope, 0.05);
  for (const s of [-1, 1]) m.beam(add(longTip, [s * 0.05, 0, 0]), add(pouch, [s * 0.16, 0, -0.1]), 0.03, 0.03);
  m.color(C.plank, 0.07).at(T(0, 0.29, -1.9), () => m.box(0.6, 0.06, 1.7));
  m.color(C.leather, 0.05).at(T(pouch[0], pouch[1] - 0.04, pouch[2]), () => m.frustum(0.3, 0.42, 0.44, 0.56, 0.12));
  m.color(C.stone, 0.08).at(T(pouch[0], pouch[1] + 0.2, pouch[2]), () => m.blob(0.2, { jitter: 0.1, detail: 0 }));

  // Ready ammunition.
  const pile = [[1.75, 0.17, -0.9], [2.1, 0.17, -0.75], [1.9, 0.17, -0.5], [1.92, 0.42, -0.72]];
  for (const p of pile) m.color(C.stoneDark, 0.1).at(T(...p), () => m.blob(0.19, { jitter: 0.12, detail: 0 }));

  pennant(m, [fx + 0.14, axleY - 0.2, 0], { height: 1.9, length: 0.95, drop: 0.46, yaw: -0.35 });

  return {
    id: 'trebuchet',
    label: 'Traction trebuchet',
    note: 'Crew-hauled stone-thrower. The counterweight type only appears in the late 12th century.',
    yaw: 0.9,
    roots: [{ name: 'trebuchet', mesh: m.toMesh('trebuchet') }],
  };
}
