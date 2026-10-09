import type { Prerequisite } from './types';

/**
 * The first prerequisite the document does not meet, in the order they are named.
 *
 * So a desk that wants a tempo names the recording first: with nothing aligned there is no tempo
 * to draw either, and being sent to the tempo desk to fit one would be a second dead end.
 */
export const allOf =
    (...checks: readonly Prerequisite[]): Prerequisite =>
    (facts) =>
        checks.map((check) => check(facts)).find((reason) => reason !== undefined);

/**
 * Every desk that draws or reads the recording wants one in hand.
 *
 * Zero aligned notes is a blank surface with no gesture on it that can write anything: the plots
 * are `msm.end` wide, which is 0, and the chords they draw from are empty. The desks that read
 * the MPM or the score instead are not gated, since the narrative, markup and metadata desks all
 * have something to do before a note has been played.
 *
 * The voices desk is the one gated over a surface that is not blank; its entry says why.
 */
export const needsRecording: Prerequisite = ({ aligned }) =>
    aligned > 0 ? undefined : 'No recording is aligned yet. Align one first.';

/**
 * The two desks whose subject is where the recording falls on the *tick* grid.
 *
 * Only a `<tempo>` puts it there. Without one `residual.of(note)?.tickDate` is undefined for every
 * note, so the rubato desk draws no hooks and `InsertRubato` returns having logged, while the
 * pedal desk draws no presses and `InsertPedal` writes no `<movement>`.
 *
 * The articulation desk reads the same domain and is deliberately not gated. Three of its four
 * aspects go unmeasured without a tempo, but `relativeVelocity` comes off the rendered velocity
 * and still measures, and its unit dialog disables the other three meanwhile.
 */
export const needsTempo: Prerequisite = ({ tempos }) =>
    tempos > 0 ? undefined : 'No tempo yet. Draw one on the tempo desk first.';

/**
 * Every desk that fits *from* the recording wants to know which recording it is fitting.
 *
 * A desk measures one row of the alignment at a time, and while the readings stand side by side a
 * score note has a row per take, each with its own velocity and onset under the one `xml:id`.
 * Nothing says which is on screen. `Alignment.build` keeps the first row of an id, so a plot may
 * be read against another take's rendering, and the arpeggiation desks frame a chord from the
 * earliest onset in any take to the latest, a spread no performance played.
 *
 * There is no residual to plot either: `deriveResidual` refuses an alignment on more than one
 * reading rather than answering off whichever row it kept.
 *
 * Three desks are not gated, the takes being their subject rather than their input: the alignment
 * desk is where a further recording comes from, Base Text is the remedy this points at, and the
 * corrections desk edits the recording itself.
 */
export const needsChoice: Prerequisite = ({ unchosen }) =>
    unchosen === 0
        ? undefined
        : `${unchosen} notes are still on more than one reading. Choose a base text first.`;
