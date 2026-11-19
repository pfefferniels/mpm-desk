/**
 * The stretch of the recording a bar was played in, as a piano roll: what the notated page cannot
 * say about it.
 *
 * The page is the score, and the score is what was played, transcribed. What it leaves out is how
 * the bar was played: which notes came early or late, which were spread, how long each was held,
 * and where among them the notes the performer added fell. A reader about to change how something
 * is written wants exactly that, and wants it without leaving the page, so it is shown for the bar
 * under the pointer.
 */

/** What a key on the roll was, in the colours the page uses. */
export type RollKind = 'matched' | 'added' | 'replaced' | 'unplayed';

export interface RollNote {
    onsetMs: number;
    offsetMs: number;
    pitch: number;
    kind: RollKind;
    /** The note the pointer is on */
    hovered: boolean;
}

export interface Excerpt {
    fromMs: number;
    toMs: number;
    /** The lowest and highest pitch the roll has room for */
    low: number;
    high: number;
    notes: RollNote[];
}

interface Played {
    id: string;
    onsetMs: number;
    offsetMs: number;
    pitch: number;
}

interface Written {
    /** Quarter notes from the start of the piece */
    onset: number;
    duration: number;
    pitch: number;
}

export interface ExcerptInput {
    /** The notes drawn in the bar, by the ids they are drawn under */
    bar: readonly string[];
    /** What the pointer is on: a note of the page by its id, or a cross by the played note's */
    hovered: { noteId?: string; perfId?: string };
    /** Every key the recording struck */
    spans: readonly Played[];
    /** The key each note of the page was played as, where it was */
    playedOf: ReadonlyMap<string, string>;
    /** What each key is: anything not named here was matched */
    kindOf: ReadonlyMap<string, Exclude<RollKind, 'unplayed'>>;
    /** The written notes nothing was played for */
    unplayed: ReadonlySet<string>;
    /** Where each written note stands in the score */
    writtenOf: ReadonlyMap<string, Written>;
}

/** Room before the first key of the bar and after the last, so that neither is on the edge. */
const MARGIN_MS = 300;

/** How long a stretch a cross is shown in, where it has no bar to show. */
const AROUND_MS = 1200;

/** A quarter note, where a bar does not say how long one was. */
const QUARTER_MS = 500;

/** The fewest semitones a roll spans, so that a bar of one note is not one fat bar. */
const LEAST_RANGE = 12;

/**
 * The bar the pointer is in, as it was played. Nothing, where nothing of it was played and the
 * pointer is not on a cross: there is no moment to show.
 */
export function excerptOf({
    bar,
    hovered,
    spans,
    playedOf,
    kindOf,
    unplayed,
    writtenOf,
}: ExcerptInput): Excerpt | undefined {
    const spanById = new Map(spans.map((span) => [span.id, span]));
    const hoveredSpan =
        hovered.perfId ?? (hovered.noteId !== undefined ? playedOf.get(hovered.noteId) : undefined);

    // The keys the bar's own notes were played as: they say when the bar was
    const struck = bar.flatMap((id) => {
        const span = spanById.get(playedOf.get(id) ?? '');
        return span ? [{ id, span }] : [];
    });

    let fromMs: number;
    let toMs: number;
    if (struck.length > 0) {
        fromMs = Math.min(...struck.map(({ span }) => span.onsetMs)) - MARGIN_MS;
        toMs = Math.max(...struck.map(({ span }) => span.onsetMs)) + MARGIN_MS;
    } else {
        const span = spanById.get(hoveredSpan ?? '');
        if (!span) return undefined;
        fromMs = span.onsetMs - AROUND_MS;
        toMs = span.onsetMs + AROUND_MS;
    }

    const notes: RollNote[] = spans
        .filter((span) => span.onsetMs < toMs && span.offsetMs > fromMs)
        .map((span) => ({
            onsetMs: span.onsetMs,
            offsetMs: span.offsetMs,
            pitch: span.pitch,
            kind: kindOf.get(span.id) ?? 'matched',
            hovered: span.id === hoveredSpan,
        }));

    // A written note that was not played has no moment of its own. It is drawn where it was
    // due: where it stands in the bar, read against the notes of the bar that were played
    const measured = struck.flatMap(({ id, span }) => {
        const written = writtenOf.get(id);
        return written ? [{ place: written.onset, ms: span.onsetMs }] : [];
    });
    measured.sort((a, b) => a.place - b.place);
    const first = measured[0];
    const last = measured[measured.length - 1];
    const perQuarter =
        first && last && last.place > first.place ? (last.ms - first.ms) / (last.place - first.place) : QUARTER_MS;
    for (const id of bar) {
        if (!unplayed.has(id)) continue;
        const written = writtenOf.get(id);
        if (!written || !first) continue;
        const onsetMs = first.ms + (written.onset - first.place) * perQuarter;
        notes.push({
            onsetMs,
            offsetMs: onsetMs + Math.max(written.duration * perQuarter, 60),
            pitch: written.pitch,
            kind: 'unplayed',
            hovered: id === hovered.noteId,
        });
        toMs = Math.max(toMs, onsetMs + MARGIN_MS);
        fromMs = Math.min(fromMs, onsetMs - MARGIN_MS);
    }

    if (notes.length === 0) return undefined;
    let low = Math.min(...notes.map((note) => note.pitch)) - 2;
    let high = Math.max(...notes.map((note) => note.pitch)) + 2;
    if (high - low < LEAST_RANGE) {
        const widen = LEAST_RANGE - (high - low);
        low -= Math.floor(widen / 2);
        high += Math.ceil(widen / 2);
    }

    return { fromMs, toMs, low, high, notes };
}
