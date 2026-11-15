import type { Divergence } from '../../alignment/divergences';
import { isOmittedPassage } from '../../alignment/readings';
import { writtenIdOf, type Outcome } from '../../alignment/transcription';
import type { NoteSpan } from '../../performance/midiSpans';
import type { ExtraNote } from '../../verovio/extraNotes';
import type { OmittedGroup } from '../../verovio/omissionMarks';

/**
 * The two things drawn onto the engraving that verovio did not put there: a cross where a note was
 * played that the score does not write, and a bracket over a passage the recording goes past.
 *
 * Both carry the disagreement they belong to, so that clicking one asks about it — which is the
 * whole of the review's chrome.
 *
 * A cross is what is left over. A played note the transcriber wrote into the score is a notehead
 * like any other, engraved by verovio and coloured by `paintAlignment`, so a cross now means
 * exactly one thing: this was played and the score does not show it. A written trill being
 * trilled, a note outside the music, a figure the reader asked to be left out.
 */
interface Marks {
    extraNotes: ExtraNote[];
    omissions: OmittedGroup[];
}

export const marksOf = (
    divergences: readonly Divergence[],
    spans: readonly NoteSpan[],
    outcomes: ReadonlyMap<string, Outcome>,
): Marks => {
    const byId = new Map(spans.map((span) => [span.id, span]));

    const cross = (divergence: Divergence, perfId: string): ExtraNote[] => {
        const span = byId.get(perfId);
        if (!span) return [];
        // Written into the score: verovio has drawn it, and a cross on top would say twice
        const key = writtenIdOf(span);
        if (outcomes.get(divergence.id)?.notes.some((note) => note.played === key)) return [];
        return [
            {
                id: span.id,
                divergenceId: divergence.id,
                onsetMs: span.onsetMs,
                offsetMs: span.offsetMs,
                pitch: span.pitch,
                resolved: true,
            },
        ];
    };

    /**
     * A substitution draws one too, at the pitch actually struck, so that the written note and
     * what was played in its place stand one above the other at the same moment. Where the two are
     * the same pitch there is nothing to draw: the notehead already sits exactly where the cross
     * would go, and the note itself is the whole story — which is what `unmatched-pair` means.
     */
    const extraNotes = divergences.flatMap((divergence) => {
        if (divergence.kind === 'added') {
            return divergence.perfIds.flatMap((perfId) => cross(divergence, perfId));
        }
        if (divergence.kind === 'replaced' && divergence.reading !== 'unmatched-pair') {
            return cross(divergence, divergence.perfId);
        }
        return [];
    });

    /**
     * Not every group of unplayed notes: a note or two missing from a chord that did sound stands
     * perfectly well as red noteheads, and so does a single note. A bracket is for a stretch of
     * music that was not played at all, which is the one case with no room to be drawn in.
     */
    const omissions = divergences.filter(isOmittedPassage).map((divergence) => ({
        divergenceId: divergence.id,
        scoreIds: divergence.kind === 'missing' ? divergence.scoreIds : [],
        resolved: true,
    }));

    return { extraNotes, omissions };
};
