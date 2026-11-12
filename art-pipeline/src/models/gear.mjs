// War gear shared by the later soldiers: the heater shield and the flat-topped great helm of
// the High Middle Ages.
import { T } from '../math.mjs';
import { C } from '../palette.mjs';

/** Heater shield, c. 1200-1250: flat across the top, the sides curving in to a point. Faces +Z. */
export const HEATER = [[-0.26, 0.3], [0.26, 0.3], [0.27, 0.05], [0.2, -0.22], [0, -0.48], [-0.2, -0.22], [-0.27, 0.05]];

/** The shield in the current frame: owner's colour on the face, leather edge, wooden back. */
export function paintHeater(mb) {
  mb.team().extrude(HEATER, -0.02, 0.025, { back: false, sides: false });
  mb.color(C.leather, 0.05).extrude(HEATER, -0.02, 0.025, { front: false, back: false });
  mb.color(C.timberMid, 0.05).extrude(HEATER, -0.02, 0.025, { front: false, sides: false });
}

/**
 * Head in a great helm: a flat-topped iron pot closed all round, with a sight slit, a bar
 * riveted down the face, and its crown painted in the owner's colour so that he can be
 * told from above and behind. Painted on the head part, whose origin is the base of the neck.
 */
export function paintGreatHelm(mb) {
  const flat = Math.PI / 8; // turns the octagon so a flat faces forward
  mb.color(C.mailDark, 0.05).at(T(0, 0, -0.01), () => mb.cyl(0.165, 0.16, 0.1, 8, { top: false, phase: flat }));
  mb.color(C.helm, 0.06).at(T(0, 0.07, -0.005), () => mb.cyl(0.198, 0.205, 0.36, 8, { top: false, phase: flat }));
  mb.team().at(T(0, 0.43, -0.005), () => mb.cyl(0.2, 0.165, 0.035, 8, { bottom: false, phase: flat }));
  mb.color(C.steel, 0.04).at(T(0, 0.33, -0.005), () => mb.cyl(0.212, 0.212, 0.035, 8, { top: false, bottom: false, phase: flat }));
  const face = 0.205 * Math.cos(flat) + 0.004;
  mb.color(C.slit).poly([[-0.125, 0.29, face], [0.125, 0.29, face], [0.125, 0.325, face], [-0.125, 0.325, face]]);
  mb.color(C.steel, 0.04).at(T(0, 0.1, face - 0.004), () => mb.box(0.04, 0.3, 0.022, { top: false, bottom: false }));
}
