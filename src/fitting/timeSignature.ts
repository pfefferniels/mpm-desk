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

/** One bar of `signature` in ticks. `numerator` denominator-notes, whatever the beat is. */
const barTicks = ({ numerator, denominator }: TimeSignature, pulsesPerWhole: number) =>
  (numerator * pulsesPerWhole) / denominator;

/**
 * Where the bar lines fall, ascending, from the first signature to `until`.
 *
 * Each signature starts a bar where it takes effect and rules them off at its own bar length
 * from there, so a 4/4 that begins after a quarter of anacrusis has its downbeats on 720, 3600,
 * 6480 — counting from tick 0 would name none of them.
 *
 * A score that states no signature gets no bar lines. What is drawn is what the document says,
 * and common time assumed for it is an assumption to render under rather than one to draw.
 *
 * @param until the end of the piece in ticks; the last signature rules bars up to it.
 * @param pulsesPerWhole ticks to the whole note, which the caller's document states.
 */
export const barLines = (
  signatures: readonly DatedTimeSignature[],
  until: number,
  pulsesPerWhole: number,
): number[] =>
  signatures.flatMap((signature, index) => {
    const bar = barTicks(signature, pulsesPerWhole);
    if (!(bar > 0)) return [];
    const governedUntil = Math.min(signatures[index + 1]?.date ?? until, until);
    const bars = Math.max(0, Math.ceil((governedUntil - signature.date) / bar));
    return Array.from({ length: bars }, (_, n) => signature.date + n * bar);
  });
