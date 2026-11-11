// MeshBuilder: collects flat-shaded polygons into two glTF primitives, one per material.
//   "Palette"   - white base colour, per-face colour stored in COLOR_0
//   "TeamColor" - no vertex colour; the engine tints this material per player
import { identity, mul, transformPoint, det3, sub, cross, len, normalize, alongSegment, mulberry32, lerp3 } from './math.mjs';

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const hexToLinear = (hex) => hexToRgb(hex).map(srgbToLinear);

export class MeshBuilder {
  constructor(seed = 1) {
    this.rng = mulberry32(seed);
    this.groups = {
      Palette: { positions: [], normals: [], colors: [], indices: [], count: 0 },
      TeamColor: { positions: [], normals: [], colors: null, indices: [], count: 0 },
    };
    this.stack = [identity()];
    this.mat = 'Palette';
    this.rgb = [1, 1, 1];
    this.varyAmt = 0;
  }

  get M() {
    return this.stack[this.stack.length - 1];
  }

  /** Set the current palette colour (sRGB hex). `vary` jitters brightness per face. */
  color(hex, vary = 0) {
    this.mat = 'Palette';
    this.rgb = hexToRgb(hex);
    this.varyAmt = vary;
    return this;
  }

  /** Following faces use the tintable TeamColor material. */
  team() {
    this.mat = 'TeamColor';
    return this;
  }

  /** at(matrix, matrix, ..., fn): run fn with the matrices applied left to right. */
  at(...args) {
    const fn = args.pop();
    let m = this.M;
    for (const x of args) m = mul(m, x);
    this.stack.push(m);
    fn();
    this.stack.pop();
    return this;
  }

  /** Add one convex planar polygon, counter-clockwise when seen from its front. */
  poly(points, rgbOverride = null) {
    const M = this.M;
    let pts = points.map((p) => transformPoint(M, p));
    if (det3(M) < 0) pts = pts.reverse();
    // Newell's method gives a stable normal even for slightly non-planar faces.
    let n = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    if (len(n) < 1e-10) return this;
    n = normalize(n);
    const g = this.groups[this.mat];
    const base = g.count;
    let lin = null;
    if (g.colors) {
      const k = 1 + (this.rng() * 2 - 1) * this.varyAmt;
      const rgb = rgbOverride ?? this.rgb;
      lin = rgb.map((c) => srgbToLinear(Math.min(1, Math.max(0, c * k))));
    }
    for (const p of pts) {
      g.positions.push(p[0], p[1], p[2]);
      g.normals.push(n[0], n[1], n[2]);
      if (lin) g.colors.push(lin[0], lin[1], lin[2]);
    }
    for (let i = 1; i < pts.length - 1; i++) {
      // Skip degenerate fan triangles (e.g. where a frustum collapses to a point).
      const a = pts[0], b = pts[i], c = pts[i + 1];
      if (len(cross(sub(b, a), sub(c, a))) < 1e-10) continue;
      g.indices.push(base, base + i, base + i + 1);
    }
    g.count += pts.length;
    return this;
  }

  /** Tapered box. Base w0 x d0 at y=0, top w1 x d1 at y=h, centred on x and z. */
  frustum(w0, d0, w1, d1, h, { top = true, bottom = true } = {}) {
    const a = w0 / 2, b = d0 / 2, c = w1 / 2, d = d1 / 2;
    const p0 = [-a, 0, -b], p1 = [a, 0, -b], p4 = [-a, 0, b], p5 = [a, 0, b];
    const p3 = [-c, h, -d], p2 = [c, h, -d], p7 = [-c, h, d], p6 = [c, h, d];
    this.poly([p4, p5, p6, p7]);
    this.poly([p1, p0, p3, p2]);
    this.poly([p5, p1, p2, p6]);
    this.poly([p0, p4, p7, p3]);
    if (top) this.poly([p7, p6, p2, p3]);
    if (bottom) this.poly([p0, p1, p5, p4]);
    return this;
  }

  /** Box with its base at y=0, centred on x and z. */
  box(w, h, d, opts) {
    return this.frustum(w, d, w, d, h, opts);
  }

  /** Box of cross-section w x d running from point a to point b. */
  beam(a, b, w, d = w, opts) {
    const L = len(sub(b, a));
    return this.at(alongSegment(a, b), () => this.box(w, L, d, opts));
  }

  /** n-sided cylinder or cone. Base radius rb at y=0, top radius rt at y=h. */
  cyl(rb, rt, h, sides = 6, { top = true, bottom = true, phase = 0 } = {}) {
    const ring = (r, y) =>
      Array.from({ length: sides }, (_, i) => {
        const a = phase + (i / sides) * Math.PI * 2;
        return [r * Math.cos(a), y, r * Math.sin(a)];
      });
    const B = ring(rb, 0), Tp = ring(rt, h);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (rt < 1e-9) this.poly([B[j], B[i], [0, h, 0]]);
      else if (rb < 1e-9) this.poly([[0, 0, 0], Tp[i], Tp[j]]);
      else this.poly([B[j], B[i], Tp[i], Tp[j]]);
    }
    if (bottom && rb > 1e-9) this.poly(B);
    if (top && rt > 1e-9) this.poly([...Tp].reverse());
    return this;
  }

  /** Cylinder between two points. */
  rod(a, b, r, sides = 6, opts) {
    const L = len(sub(b, a));
    return this.at(alongSegment(a, b), () => this.cyl(r, opts?.rt ?? r, L, sides, opts));
  }

  /**
   * Prism from a convex 2D profile in the XY plane, spanning z0..z1.
   * `parts` picks which faces to emit so caps and sides can take different colours.
   */
  extrude(profile, z0, z1, { front = true, back = true, sides = true } = {}) {
    let area = 0;
    for (let i = 0; i < profile.length; i++) {
      const a = profile[i], b = profile[(i + 1) % profile.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const P = area < 0 ? [...profile].reverse() : profile;
    if (front) this.poly(P.map((p) => [p[0], p[1], z1]));
    if (back) this.poly([...P].reverse().map((p) => [p[0], p[1], z0]));
    if (sides) {
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        this.poly([[a[0], a[1], z1], [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]]);
      }
    }
    return this;
  }

  /**
   * Lumpy faceted ball for foliage, stones and thatch bundles.
   * colors = [undersideHex, topHex]: faces are shaded by how far they face up.
   */
  blob(r, { jitter = 0.15, detail = 1, colors = null, vary = 0.05 } = {}) {
    const { verts, faces } = icosphere(detail);
    const vs = verts.map((v) => {
      const k = r * (1 + (this.rng() * 2 - 1) * jitter);
      return [v[0] * k, v[1] * k, v[2] * k];
    });
    const lo = colors ? hexToRgb(colors[0]) : null;
    const hi = colors ? hexToRgb(colors[1]) : null;
    for (const f of faces) {
      const tri = [vs[f[0]], vs[f[1]], vs[f[2]]];
      let rgb = null;
      if (colors) {
        const wn = normalize(
          cross(
            sub(transformPoint(this.M, tri[1]), transformPoint(this.M, tri[0])),
            sub(transformPoint(this.M, tri[2]), transformPoint(this.M, tri[0])),
          ),
        );
        const t = Math.min(1, Math.max(0, wn[1] * 0.6 + 0.45));
        const k = 1 + (this.rng() * 2 - 1) * vary;
        rgb = lerp3(lo, hi, t).map((c) => c * k);
      }
      this.poly(tri, rgb);
    }
    return this;
  }

  triangleCount() {
    return (this.groups.Palette.indices.length + this.groups.TeamColor.indices.length) / 3;
  }

  /** Mesh data in the shape the GLB writer expects. */
  toMesh(name) {
    const primitives = [];
    for (const [material, g] of Object.entries(this.groups)) {
      if (g.indices.length === 0) continue;
      primitives.push({
        material,
        positions: new Float32Array(g.positions),
        normals: new Float32Array(g.normals),
        colors: g.colors ? new Float32Array(g.colors) : null,
        indices: new Uint16Array(g.indices),
      });
      if (g.count > 65535) throw new Error(`${name}: too many vertices for 16-bit indices`);
    }
    return { name, primitives };
  }
}

const icoCache = new Map();
/** Unit icosphere: { verts, faces }. Exported for models that need to know a blob's facets. */
export function icosphere(detail) {
  if (icoCache.has(detail)) return icoCache.get(detail);
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
    [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5],
    [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let d = 0; d < detail; d++) {
    const mid = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!mid.has(key)) {
        verts.push(normalize([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]));
        mid.set(key, verts.length - 1);
      }
      return mid.get(key);
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  // Make every face wind outwards.
  faces = faces.map((f) => {
    const [a, b, c] = f.map((i) => verts[i]);
    const n = cross(sub(b, a), sub(c, a));
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    return n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0 ? [f[0], f[2], f[1]] : f;
  });
  const out = { verts, faces };
  icoCache.set(detail, out);
  return out;
}

