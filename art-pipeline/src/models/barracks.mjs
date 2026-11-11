// Barracks, c. 900: where spearmen are trained. A plank-walled longhouse, lower and plainer
// than the great hall: no porch, no gable boards, the thatch hipped at both ends below a
// smoke hole. A fenced drill yard takes the front of the plot, with hacked practice posts, a
// straw man carrying a shield, and a rack of spears and shields.
// The plot is 5 x 5 tiles, so everything stays inside 9.4 m square. The door and the yard face +Z.
import { MeshBuilder } from '../mesh.mjs';
import { T, RX, RY } from '../math.mjs';
import { C } from '../palette.mjs';
import { pennant, hippedThatch, groundPatch, stakeFence, roundShield, tub } from './parts.mjs';

export function build() {
  const m = new MeshBuilder(53);
  const L = 8.5, W = 3.6, wallH = 2.1;
  const hl = L / 2, hw = W / 2;
  const zc = -2.5; // centre line of the house, set back to leave the yard
  const zf = zc + hw, zb = zc - hw;
  const slope = 1.05, over = 0.3;
  const ex = hl + over, ez = hw + over;
  const rise = ez * slope;
  const eaveY = wallH + 0.15 - over * slope;

  // Trodden earth of the drill yard.
  groundPatch(m.color(C.earth, 0.04), [[-4.42, zf - 0.05], [-4.42, 4.15], [-4.12, 4.45], [4.12, 4.45], [4.42, 4.15], [4.42, zf - 0.05]]);

  // Walls of upright planks set edge to edge, one face a plank, their heads under the thatch.
  const stave = (i) => m.color(i % 2 ? C.plank : C.timberMid, 0.07);
  const nLong = 21, nEnd = 9;
  for (let i = 0; i < nLong; i++) {
    const x0 = -hl + (i * L) / nLong, x1 = -hl + ((i + 1) * L) / nLong;
    stave(i).poly([[x0, 0, zf], [x1, 0, zf], [x1, wallH, zf], [x0, wallH, zf]]);
    stave(i + 1).poly([[x1, 0, zb], [x0, 0, zb], [x0, wallH, zb], [x1, wallH, zb]]);
  }
  for (let i = 0; i < nEnd; i++) {
    const z0 = zb + (i * W) / nEnd, z1 = zb + ((i + 1) * W) / nEnd;
    stave(i).poly([[hl, 0, z1], [hl, 0, z0], [hl, wallH, z0], [hl, wallH, z1]]);
    stave(i + 1).poly([[-hl, 0, z0], [-hl, 0, z1], [-hl, wallH, z1], [-hl, wallH, z0]]);
  }
  // Earth-fast posts standing proud of the planking.
  const post = 0.24, proud = 0.06;
  m.color(C.timber, 0.06);
  for (const x of [-hl - proud + post / 2, -hl * 0.6, -hl * 0.2, hl * 0.2, hl * 0.6, hl + proud - post / 2]) {
    for (const z of [zf + proud - post / 2, zb - proud + post / 2]) m.at(T(x, 0, z), () => m.box(post, wallH - 0.2, post, { top: false, bottom: false }));
  }

  // One door, in the long side onto the yard: planked, in a heavy frame.
  m.at(T(0, 0, zf), () => {
    for (let i = 0; i < 4; i++) {
      const x0 = -0.5 + i * 0.25, x1 = x0 + 0.25;
      m.color(i % 2 ? C.timberLight : C.plank, 0.07).poly([[x0, 0.05, 0.05], [x1, 0.05, 0.05], [x1, 1.66, 0.05], [x0, 1.66, 0.05]]);
    }
    m.color(C.timber, 0.05);
    for (const sx of [-1, 1]) m.at(T(sx * 0.57, 0, 0.04), () => m.box(0.15, 1.72, 0.18, { bottom: false }));
    m.at(T(0, 1.64, 0.04), () => m.box(1.4, 0.16, 0.2));
    m.color(C.stoneDark, 0.05).at(T(0, 0, 0.34), () => m.box(1.0, 0.07, 0.5, { bottom: false }));
  });

  // Hipped thatch in four courses; the last stops in an upright end with a smoke hole.
  m.at(T(0, 0, zc), () => {
    hippedThatch(m, { ex, ez, hip: 1.3, rise, eaveY }, {
      step: 0.06, butt: 0.18, gablet: true,
      courses: [[0, 0.3, C.thatch], [0.27, 0.55, C.thatchMid], [0.52, 0.8, C.thatch], [0.76, 1, C.thatchMid]],
    });
  });

  // Yard fence: stakes and withy rails, with a gate gap between two posts.
  const fx = 4.5, fz = 4.5, gate = 1.05;
  for (const sx of [-1, 1]) {
    stakeFence(m, [sx * fx, zf + 0.2], [sx * fx, fz]);
    stakeFence(m, [sx * fx, fz], [sx * gate, fz], { first: false, last: false });
    m.color(C.timber, 0.06).at(T(sx * gate, 0, fz), () => m.box(0.18, 1.45, 0.18, { bottom: false }));
  }

  // Practice posts, hacked thin and pale where the blows land.
  for (const [x, z, h, turn] of [[-3.3, 1.0, 1.85, 0.3], [-2.25, 2.0, 1.7, 1.1]]) {
    m.at(T(x, 0, z), RY(turn), () => {
      m.color(C.timberMid, 0.07).cyl(0.16, 0.15, h * 0.5, 6, { top: false, bottom: false });
      m.color(C.timberLight, 0.07).at(T(0, h * 0.5, 0), () => m.cyl(0.15, 0.11, h * 0.24, 6, { top: false, bottom: false }));
      m.color(C.timberMid, 0.07).at(T(0, h * 0.74, 0), () => m.cyl(0.11, 0.14, h * 0.26, 6, { bottom: false }));
    });
  }

  // Straw man on a stake: a bound truss of straw, a sack for a head under an old helmet,
  // and a shield hung on one arm of the cross-pole.
  m.at(T(-0.95, 0, 3.0), RY(0.3), () => {
    m.color(C.timber, 0.06).cyl(0.07, 0.06, 1.55, 5, { top: false, bottom: false });
    m.beam([-0.62, 1.38, 0], [0.62, 1.38, 0], 0.08, 0.08);
    m.color(C.thatchMid, 0.08).at(T(0, 0.66, 0), () => m.frustum(0.34, 0.26, 0.52, 0.34, 0.82));
    m.color(C.rope, 0.05).at(T(0, 1.0, 0), () => m.box(0.47, 0.07, 0.33, { top: false, bottom: false }));
    m.color(C.sack, 0.06).at(T(0, 1.48, 0), () => m.cyl(0.15, 0.13, 0.27, 6, { top: false, bottom: false }));
    m.color(C.iron, 0.05).at(T(0, 1.7, 0), () => m.cyl(0.18, 0, 0.2, 6, { bottom: false }));
    m.at(T(0.52, 1.1, 0.07), RX(Math.PI / 2 - 0.1), () => roundShield(m, 0.4));
  });

  // Rack: spears leant on the top rail, shields on the lower one.
  m.at(T(2.65, 0, 1.3), () => {
    const half = 1.5;
    m.color(C.timber, 0.06);
    for (const s of [-1, 1]) {
      m.at(T(s * half, 0, 0), () => m.box(0.12, 1.5, 0.12, { bottom: false }));
      m.beam([s * half, 0, -0.5], [s * half, 0.95, 0], 0.09, 0.09, { top: false, bottom: false });
    }
    m.color(C.timberMid, 0.07);
    m.beam([-half - 0.12, 1.4, 0.105], [half + 0.12, 1.4, 0.105], 0.09, 0.09);
    m.beam([-half - 0.12, 0.55, 0.105], [half + 0.12, 0.55, 0.105], 0.09, 0.09);
    for (let i = 0; i < 6; i++) {
      const x = -1.36 + i * 0.27, out = 0.5 + (i % 2) * 0.07;
      const dir = [0, 1.4, 0.17 - out], k = 1 / Math.hypot(dir[1], dir[2]);
      const at = (d) => [x, 0.02 + dir[1] * k * d, out + dir[2] * k * d];
      m.color(C.pole, 0.07).beam(at(0), at(2.0), 0.045, 0.045, { top: false, bottom: false });
      m.color(C.steel, 0.05).rod(at(2.0), at(2.34), 0.05, 4, { rt: 0, bottom: false });
    }
    [0.44, 0.92, 1.36].forEach((x, i) => {
      const lean = 1.13 - i * 0.05, r = 0.4;
      m.at(T(x, r * Math.sin(lean) + 0.01, 0.24 + i * 0.06), RX(lean), () => roundShield(m, r));
    });
  });

  // A bench and a tub against the wall.
  m.at(T(-2.5, 0, zf + 0.36), () => {
    m.color(C.timberLight, 0.06).at(T(0, 0.42, 0), () => m.box(1.6, 0.07, 0.36));
    m.color(C.timber, 0.06);
    for (const sx of [-1, 1]) m.at(T(sx * 0.6, 0, 0), () => m.box(0.08, 0.42, 0.32, { top: false, bottom: false }));
  });
  m.at(T(1.75, 0, zf + 0.5), () => tub(m));

  // The owner's pennant on a pole at the gate.
  pennant(m, [gate, 1.4, fz], { height: 2.7, length: 1.35, drop: 0.6, yaw: Math.PI - 0.12, pole: 0.045 });

  return {
    id: 'barracks',
    label: 'Barracks',
    note: 'Plain longhouse under hipped thatch, with a drill yard: practice posts, a straw man, spears and shields. Trains spearmen on a 5 by 5 tile plot.',
    yaw: -0.5,
    plot: 5,
    roots: [{ name: 'barracks', mesh: m.toMesh('barracks') }],
  };
}
