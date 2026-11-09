/**
 * How a desk marks what the selected calls were fitted to.
 *
 * Selecting a call lights two things. What it wrote — its instructions, in whatever colour the desk
 * draws a selected instruction in, mostly red or orange. And, in this colour, the observations it
 * was fitted to or corrected: the notes, chords or presses whose `xml:id`s are in
 * `useCallSelection().activeEvidence` (`Transformer.evidence`). One colour on every desk, so the
 * two kinds of highlight read alike wherever they appear: the warm one is the instruction, the
 * blue one is the data under it.
 *
 * A chord is marked where any of its notes is evidence. A marked element also carries
 * `data-evidence`, which is what the desks' tests look for.
 */
export const EVIDENCE_COLOUR = '#1d4ed8';
