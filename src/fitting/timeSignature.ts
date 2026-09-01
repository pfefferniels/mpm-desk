/**
 * The metre, as MSM states it: a map rather than a signature.
 *
 * Its own module because both halves of the application read it and neither owns it — the
 * alignment carries the map the chain fits against, the viewer reads one off the score MSM it
 * loads, and the two must answer the same question the same way. Nothing here parses or renders
 * anything, so a bundle takes the lookup without taking the fitting layer with it.
 */

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/** One entry of a `<timeSignatureMap>`: a signature and the tick it takes effect at. */
export interface DatedTimeSignature extends TimeSignature {
  date: number;
}

/**
 * The signature governing `date`, or `undefined` where the score states none by then.
 *
 * The last entry that has taken effect, which is how MSM's maps are read throughout: an entry
 * governs from its own date until the next one displaces it. Asking a map for one signature is
 * what a score with an anacrusis punishes — its first entry is the upbeat bar (issue #22).
 *
 * @param signatures ascending by date.
 */
export const timeSignatureAt = (
  signatures: readonly DatedTimeSignature[],
  date: number,
): DatedTimeSignature | undefined => signatures.findLast((signature) => signature.date <= date);
