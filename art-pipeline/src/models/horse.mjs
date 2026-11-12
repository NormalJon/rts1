// A riding horse of about 1.5 m at the withers, in rigid parts: barrel, neck, head, tail and
// four legs of two parts each. The horseman hangs these on a joint hierarchy and animates
// them; the stable paints the same parts into one mesh as a horse standing at the rail.
// The horse faces +Z. Joint positions are each given in the frame of the part above.
import { T, RX, S } from '../math.mjs';
import { C } from '../palette.mjs';

export const JOINT = {
  body: [0, 1.2, -0.2], // middle of the barrel, above the ground
  neck: [0, 0.1, 0.44],
  head: [0, 0.56, 0.5], // the poll
  tail: [0, 0.17, -0.78],
  fore: (s) => [s * 0.17, -0.12, 0.33], // shoulder
  hind: (s) => [s * 0.18, -0.08, -0.62], // hip
  foreCannon: [0, -0.5, 0], // knee
  hindCannon: [0, -0.484, -0.124], // hock
  saddle: [0, 0.4, -0.04], // where the rider sits
};

export const COATS = {
  bay: { coat: C.bay, points: C.bayDark },
  dun: { coat: C.dun, points: C.bayDark },
};

/** Barrel and quarters, six-sided with a flat along the back. */
export function paintBody(m, { coat }) {
  m.color(coat, 0.05);
  m.at(T(0, 0, -0.8), RX(Math.PI / 2), S(1, 1, 1.1), () => m.cyl(0.2, 0.275, 0.55, 6, { top: false }));
  m.at(T(0, 0, -0.25), RX(Math.PI / 2), S(1, 1, 1.1), () => m.cyl(0.275, 0.235, 0.75, 6, { bottom: false }));
}

/** Saddle on a cloth in the owner's colour. */
export function paintSaddle(m) {
  m.team().at(T(0, 0.05, -0.12), () => m.box(0.62, 0.225, 0.74, { bottom: false }));
  m.color(C.leather, 0.05).at(T(0, 0.275, -0.04), () => m.box(0.36, 0.075, 0.46, { bottom: false }));
  m.at(T(0, 0.33, -0.25), () => m.box(0.34, 0.12, 0.07, { bottom: false })); // cantle
  m.at(T(0, 0.33, 0.17), () => m.box(0.22, 0.1, 0.07, { bottom: false })); // pommel
}

export function paintNeck(m, { coat, points }) {
  m.at(RX(0.75), () => {
    m.color(coat, 0.05).at(T(0, -0.1, 0), () => m.frustum(0.3, 0.46, 0.2, 0.26, 0.86, { bottom: false }));
    m.color(points, 0.06).at(T(0, 0.02, -0.21), () => m.frustum(0.07, 0.1, 0.06, 0.09, 0.76, { bottom: false }));
  });
}

export function paintHead(m, { coat, points }) {
  m.color(coat, 0.05).at(T(0, 0.05, -0.08), RX(2.2), () => m.frustum(0.2, 0.27, 0.13, 0.15, 0.6));
  m.color(points, 0.06);
  for (const s of [-1, 1]) m.at(T(s * 0.07, 0.1, -0.06), () => m.cyl(0.04, 0, 0.13, 4, { bottom: false }));
}

/** Upper part of a leg, hanging from its joint. The hind one is broader and slants back to the hock. */
export function paintLeg(m, { coat }, hind = false) {
  m.color(coat, 0.05);
  if (hind) m.at(RX(0.25), T(0, -0.5, 0), () => m.frustum(0.12, 0.15, 0.2, 0.36, 0.5, { top: false }));
  else m.at(T(0, -0.5, 0), () => m.frustum(0.11, 0.13, 0.17, 0.26, 0.5, { top: false }));
}

/** Cannon bone and hoof, hanging from the knee or hock. */
export function paintCannon(m, { points }, hind = false) {
  const len = hind ? 0.52 : 0.46;
  m.color(points, 0.06).at(T(0, -len, 0), () => m.frustum(0.085, 0.09, 0.105, 0.125, len, { bottom: false }));
  m.color(C.hoof, 0.05).at(T(0, -len - 0.1, 0.012), () => m.box(0.13, 0.1, 0.155, { top: false }));
}

export function paintTail(m, { points }) {
  m.color(points, 0.07).at(RX(Math.PI + 0.12), () => m.frustum(0.08, 0.08, 0.14, 0.11, 0.72, { bottom: false }));
}

/**
 * The whole horse painted into one mesh at the current transform, standing square.
 * `neck` and `head` are how far each is lowered, in radians; `saddled` adds saddle and cloth.
 */
export function standingHorse(m, { coat = COATS.bay, neck = 0, head = 0, saddled = false } = {}) {
  m.at(T(...JOINT.body), () => {
    paintBody(m, coat);
    if (saddled) paintSaddle(m);
    m.at(T(...JOINT.neck), RX(neck), () => {
      paintNeck(m, coat);
      m.at(T(...JOINT.head), RX(head), () => paintHead(m, coat));
    });
    m.at(T(...JOINT.tail), () => paintTail(m, coat));
    for (const s of [-1, 1]) {
      m.at(T(...JOINT.fore(s)), RX(s * 0.04), () => {
        paintLeg(m, coat);
        m.at(T(...JOINT.foreCannon), RX(-s * 0.04), () => paintCannon(m, coat));
      });
      m.at(T(...JOINT.hind(s)), () => {
        paintLeg(m, coat, true);
        m.at(T(...JOINT.hindCannon), () => paintCannon(m, coat, true));
      });
    }
  });
}
