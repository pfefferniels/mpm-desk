/**
 * How thick the articulation desk draws a note's bar, in pixels: by how far its recorded velocity
 * is from the one the MPM renders, in MIDI steps, and never thinner than a note right on it.
 *
 * How far, and not which way. The residual is recorded minus rendered, so a note played softer
 * than the MPM has it is negative, and the bar was drawn `residual + 2` thick: a note more than two
 * steps too soft got a negative height, which the browser refuses to draw, and 23 notes of WM 225
 * were missing from the desk. Which way a note is off is in the readout over it on hover.
 *
 * `undefined`, a note the MPM renders no velocity for yet, is drawn as one right on it: the
 * thickness is a cue to the eye rather than a measurement.
 */
export const barThickness = (velocityResidual: number | undefined): number =>
    Math.max(Math.abs(velocityResidual ?? 0), 1) + 2;
