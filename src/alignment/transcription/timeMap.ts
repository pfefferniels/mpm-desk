/**
 * Where the recording was at each moment of the score: the matched notes, read as a tempo curve.
 *
 * This is what makes the transcription a small problem rather than the open one of transcribing
 * a performance blind. A blind transcriber has to find the beat before it can say where a note
 * falls in it. Here every matched note is a point where score time and played time are both
 * known, they lie a fraction of a second apart, and a played note the score does not write has
 * only to be placed between the two nearest of them.
 */

/** One written moment and when it was played. */
export interface Anchor {
    /** Quarter notes from the start of the piece */
    onset: number;
    /** When it was played: the median of the notes written there, in milliseconds */
    ms: number;
    /** The first and the last of them, which lie well apart where a chord is rolled */
    first: number;
    last: number;
    /** Each of them: when it was struck and at what pitch, in the order they were struck */
    notes: { ms: number; pitch: number }[];
}

export interface TimeMap {
    /** In score order, and strictly later in the recording one after the other */
    anchors: Anchor[];
}

const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Build the map from matched notes.
 *
 * Notes written at one moment are one anchor. An anchor the recording reaches before the one
 * written ahead of it cannot be read as a tempo at all, a mismatch or a hand far ahead of the
 * other, so the longest run of anchors that does go forwards is kept and the rest are dropped.
 */
export function buildTimeMap(
    pairs: Iterable<{ onset: number; ms: number; pitch: number }>,
    /**
     * Where the score begins and ends, in quarter notes. Given, the map is carried on at the
     * pace of its first and last stretches to those two places, so that a note played before
     * the first matched moment or after the last has somewhere to be read against.
     */
    extent?: { from: number; to: number },
): TimeMap {
    const byOnset = new Map<number, { ms: number; pitch: number }[]>();
    for (const pair of pairs) {
        if (!Number.isFinite(pair.onset) || !Number.isFinite(pair.ms)) continue;
        const key = Math.round(pair.onset * 1e6) / 1e6;
        const list = byOnset.get(key);
        const note = { ms: pair.ms, pitch: pair.pitch };
        if (list) list.push(note);
        else byOnset.set(key, [note]);
    }

    const all: Anchor[] = [...byOnset]
        .map(([onset, notes]) => {
            const times = notes.map((note) => note.ms);
            return {
                onset,
                ms: median(times),
                first: Math.min(...times),
                last: Math.max(...times),
                notes: notes.sort((a, b) => a.ms - b.ms),
            };
        })
        .sort((a, b) => a.onset - b.onset);

    const anchors = longestForward(all);
    if (!extent || anchors.length < 2) return { anchors };

    // A moment with no note of its own: nothing can be struck with it, only before or after
    const map = { anchors };
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    const carried: Anchor[] = [...anchors];
    if (extent.from < first.onset - 1e-6) {
        const ms = first.ms - (first.onset - extent.from) * localPace(map, 0);
        carried.unshift({ onset: extent.from, ms, first: ms, last: ms, notes: [] });
    }
    if (extent.to > last.onset + 1e-6) {
        const ms = last.ms + (extent.to - last.onset) * localPace(map, anchors.length - 2);
        carried.push({ onset: extent.to, ms, first: ms, last: ms, notes: [] });
    }
    return { anchors: carried };
}

/** When the recording was at a place in the score, read between the anchors around it. */
export function msAt(map: TimeMap, onset: number): number | undefined {
    const { anchors } = map;
    if (anchors.length === 0 || onset < anchors[0].onset - 1e-9 || onset > anchors[anchors.length - 1].onset + 1e-9) {
        return undefined;
    }
    let low = 0;
    let high = anchors.length - 1;
    while (low < high - 1) {
        const mid = (low + high) >> 1;
        if (anchors[mid].onset <= onset) low = mid;
        else high = mid;
    }
    const before = anchors[low];
    const after = anchors[high];
    if (after.onset - before.onset < 1e-9) return before.ms;
    return before.ms + ((onset - before.onset) / (after.onset - before.onset)) * (after.ms - before.ms);
}

/** The longest subsequence strictly increasing in played time, by patience sorting. */
function longestForward(anchors: Anchor[]): Anchor[] {
    const tails: number[] = [];
    const previous = new Array<number>(anchors.length).fill(-1);

    anchors.forEach((anchor, index) => {
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (anchors[tails[mid]].ms < anchor.ms) low = mid + 1;
            else high = mid;
        }
        if (low > 0) previous[index] = tails[low - 1];
        tails[low] = index;
    });

    const kept: Anchor[] = [];
    for (let index = tails[tails.length - 1] ?? -1; index >= 0; index = previous[index]) {
        kept.push(anchors[index]);
    }
    return kept.reverse();
}

/** The interval a played moment falls in: the index of the last anchor at or before it, or -1. */
export function intervalAt(map: TimeMap, ms: number): number {
    const { anchors } = map;
    let low = 0;
    let high = anchors.length - 1;
    let found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (anchors[mid].ms <= ms) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return found;
}

/** Where the score was when the recording was at `ms`, read between the anchors around it. */
export function onsetAt(map: TimeMap, ms: number): number | undefined {
    const { anchors } = map;
    const index = intervalAt(map, ms);
    if (index < 0 || index >= anchors.length - 1) {
        return index === anchors.length - 1 && anchors[index].ms === ms ? anchors[index].onset : undefined;
    }
    const before = anchors[index];
    const after = anchors[index + 1];
    const share = (ms - before.ms) / (after.ms - before.ms);
    return before.onset + share * (after.onset - before.onset);
}

/** How long a quarter note lasted in each interval, in milliseconds. */
const paceOf = (map: TimeMap, index: number): number => {
    const before = map.anchors[index];
    const after = map.anchors[index + 1];
    return (after.ms - before.ms) / (after.onset - before.onset);
};

/**
 * Whether the recording spends time between two anchors that the score does not account for.
 *
 * A repeat the engraving shows once, a cadenza, a passage played from another edition: the
 * recording goes on for seconds while the score stands still, and the interval's pace comes out
 * many times that of everything around it. A note played in there has no place in this score,
 * and interpolating one for it would write a whole repeat into a single bar.
 */
export function isUnaccounted(map: TimeMap, index: number): boolean {
    const { anchors } = map;
    if (index < 0 || index >= anchors.length - 1) return true;

    const span = anchors[index + 1].ms - anchors[index].ms;
    if (span < UNACCOUNTED_MS) return false;

    const around: number[] = [];
    for (let other = Math.max(0, index - 8); other < Math.min(anchors.length - 1, index + 9); other++) {
        if (other !== index) around.push(paceOf(map, other));
    }
    if (around.length === 0) return false;

    return paceOf(map, index) > UNACCOUNTED_PACE * median(around);
}

/** How long an interval has to last before it can be one the score does not account for. */
const UNACCOUNTED_MS = 3000;

/** And how many times slower than its surroundings it has to be. */
const UNACCOUNTED_PACE = 4;

/** The pace around an interval, steadied over its neighbours: milliseconds per quarter note. */
export function localPace(map: TimeMap, index: number): number {
    const { anchors } = map;
    const from = Math.max(0, index - 2);
    const to = Math.min(anchors.length - 1, index + 3);
    if (to <= from) return 500;
    return (anchors[to].ms - anchors[from].ms) / (anchors[to].onset - anchors[from].onset);
}
