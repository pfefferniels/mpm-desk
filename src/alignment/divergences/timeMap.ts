/** The matched notes, read as a map between score time and performed time. */

/** A matched note, as both a moment in the score and a moment in the recording. */
export interface Anchor {
    scoreId: string;
    /** Where the score puts it, in quarter notes */
    onset: number;
    /** When it was played */
    onsetMs: number;
    pitch: number;
}

/**
 * The written note a played note leans on: the last one struck at or before it.
 *
 * A figure that leans on the *following* note, a turn played just before the
 * beat it decorates, is left anchored to the note before it. Guessing between
 * the two on timing alone would be less honest than showing where the sound
 * sits, and the reader can move it.
 */
export function anchorFor(onsetMs: number, anchors: Anchor[]): Anchor | undefined {
    let low = 0;
    let high = anchors.length - 1;
    let found: Anchor | undefined;

    while (low <= high) {
        const mid = (low + high) >> 1;
        if (anchors[mid].onsetMs <= onsetMs) {
            found = anchors[mid];
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return found;
}

/** Matched notes as (score time, performed time), for reading between them. */
export function timeMapOf(anchors: Anchor[]): { onset: number; ms: number }[] {
    return anchors
        .map((anchor) => ({ onset: anchor.onset, ms: anchor.onsetMs }))
        .sort((a, b) => a.onset - b.onset);
}

/**
 * When a written note was due, in the recording's own time.
 *
 * Read off the matched notes on either side of it. A moment the matched notes do
 * not bracket has no answer: the recording says nothing about it, and a guess
 * extrapolated past the last note it does cover would be an invention.
 */
export function expectedMs(
    onset: number,
    map: readonly { onset: number; ms: number }[]
): number | undefined {
    if (map.length === 0) return undefined;
    if (onset < map[0].onset || onset > map[map.length - 1].onset) return undefined;

    let low = 0;
    let high = map.length - 1;
    while (low < high - 1) {
        const mid = (low + high) >> 1;
        if (map[mid].onset <= onset) low = mid;
        else high = mid;
    }

    const before = map[low];
    const after = map[high];
    if (after.onset === before.onset) return before.ms;

    const t = (onset - before.onset) / (after.onset - before.onset);
    return before.ms + t * (after.ms - before.ms);
}
