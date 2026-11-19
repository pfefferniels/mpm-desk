/**
 * How sure the aligner was of each note on the page, and the notes it was sure enough of to
 * place the others by.
 *
 * The notated page shows the score as it is written, so where a note stands says nothing about
 * when it was played, and the ink is free to say something else: how sure the model was that
 * the note is what it says it is. A match the model was sure of is drawn in full; one it was
 * guessing at is faint, and so is a note it guessed was left out or added. The reader's eye goes
 * to the faint notes because those are the ones that need it.
 *
 * Only the working form knows. A saved document keeps the match and not the doubt, and a note
 * nothing is known of is drawn in full rather than as though the model had been unsure.
 */
import { writtenIdOf, type Outcome } from '../../alignment/transcription';
import type { Divergence } from '../../alignment/divergences';
import type { DeletedNote, InsertedNote, MatchedNote } from '../../alignment/mlign';

/** A match the model is at least this sure of is a place to put the played notes by. */
export const SURE = 0.95;

/** How faint the faintest note is drawn: faint enough to be seen as unsure, not to vanish. */
const FAINTEST = 0.2;

interface Played {
    id: string;
    onsetMs: number;
    pitch: number;
}

/**
 * When each written note the model was sure of was struck, by its id: the anchors a played
 * note with no written note is drawn between.
 *
 * Every match, where the document does not say how sure the model was.
 */
export function anchorsOf(
    matches: readonly MatchedNote[],
    spans: readonly Played[],
    hidden?: ReadonlySet<string>,
): Map<string, number> {
    const struck = new Map(spans.map((span) => [span.id, span.onsetMs]));
    const anchors = new Map<string, number>();
    for (const match of matches) {
        if (match.confidence < SURE || hidden?.has(match.scoreId)) continue;
        const ms = struck.get(match.performanceId);
        if (ms !== undefined) anchors.set(match.scoreId, ms);
    }
    return anchors;
}

interface CertaintyInput {
    matches: readonly MatchedNote[];
    deletions: readonly DeletedNote[];
    insertions: readonly InsertedNote[];
    spans: readonly Played[];
    divergences: readonly Divergence[];
    /** What the transcriber wrote for each divergence, so that a written-in note has its doubt */
    outcomes: ReadonlyMap<string, Outcome>;
    /** The ties on the page, from the note each starts on to the note it runs into */
    ties?: ReadonlyMap<string, string>;
}

/**
 * How sure the model was of each note on the page, in [0, 1], by the id it is drawn under: a
 * written note by its own, a cross by the played note's.
 */
export function certaintyOf({
    matches,
    deletions,
    insertions,
    spans,
    divergences,
    outcomes,
    ties,
}: CertaintyInput): Map<string, number> {
    const certainty = new Map<string, number>();
    for (const match of matches) certainty.set(match.scoreId, match.confidence);
    for (const deletion of deletions) certainty.set(deletion.scoreId, deletion.confidence);

    // A played note is drawn as a cross under its own id, or written into the score under the
    // id the transcriber gave it
    const spanById = new Map(spans.map((span) => [span.id, span]));
    const byWritten = new Map<string, number>();
    for (const insertion of insertions) {
        certainty.set(insertion.performanceId, insertion.confidence);
        const span = spanById.get(insertion.performanceId);
        if (span) byWritten.set(writtenIdOf(span), insertion.confidence);
    }
    for (const divergence of divergences) {
        const outcome = outcomes.get(divergence.id);
        if (!outcome) continue;
        if (divergence.kind === 'replaced') {
            for (const id of outcome.noteIds) certainty.set(id, divergence.confidence);
            continue;
        }
        for (const note of outcome.notes) {
            const sure = byWritten.get(note.played);
            if (sure !== undefined && !certainty.has(note.id)) certainty.set(note.id, sure);
        }
    }

    // A note a tie runs into was not struck: it is as sure as the note it is held from
    for (const [start, sure] of [...certainty]) {
        const seen = new Set<string>();
        for (let into = ties?.get(start); into && !seen.has(into); into = ties?.get(into)) {
            seen.add(into);
            if (!certainty.has(into)) certainty.set(into, sure);
        }
    }
    return certainty;
}

const MARKED = 'data-certainty';

/**
 * Draw each notehead, and each cross, as faint as the model was unsure of it.
 *
 * The notehead only: a stem or a beam is shared with the notes around it, and what is being
 * said is about the one note. Set as an inline `!important`, which is the one thing that
 * outranks the sheet's own: that draws what the performer did differently at full strength,
 * because in the performed layout the faintness it overrides is how softly a note was played.
 */
export function paintCertainty(root: Element, certainty: ReadonlyMap<string, number> | undefined): void {
    for (const element of root.querySelectorAll(`[${MARKED}]`)) {
        (element as SVGElement).style.removeProperty('opacity');
        element.removeAttribute(MARKED);
    }
    if (!certainty || certainty.size === 0) return;

    const faint = (element: Element | null | undefined, sure: number | undefined) => {
        if (!element || sure === undefined) return;
        const opacity = FAINTEST + (1 - FAINTEST) * Math.min(1, Math.max(0, sure));
        (element as SVGElement).style.setProperty('opacity', opacity.toFixed(2), 'important');
        element.setAttribute(MARKED, sure.toFixed(3));
    };

    for (const note of root.querySelectorAll('g.note[data-id]')) {
        faint(note.querySelector('.notehead'), certainty.get(note.getAttribute('data-id') ?? ''));
    }
    for (const cross of root.querySelectorAll('.performanceExtraNote[data-perf-id]')) {
        faint(cross, certainty.get(cross.getAttribute('data-perf-id') ?? ''));
    }
}
