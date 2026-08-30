import type { Divergence } from '../../alignment/divergences';
import { isOmittedPassage } from '../../alignment/readings';
import type { NoteSpan } from '../../performance/midiSpans';
import type { ExtraNote } from '../../verovio/extraNotes';
import type { OmittedGroup } from '../../verovio/omissionMarks';

/**
 * The two things drawn onto the engraving that verovio did not put there: a cross where a note was
 * played that the score does not write, and a bracket over a passage the recording goes past.
 *
 * Both carry the disagreement they belong to, so that clicking one asks about it — which is the
 * whole of the review's chrome. A resolved one is drawn differently rather than taken away: a
 * decision is not a reason to stop showing what it was about.
 */
export interface Marks {
    extraNotes: ExtraNote[];
    omissions: OmittedGroup[];
}

export const marksOf = (
    divergences: readonly Divergence[],
    spans: readonly NoteSpan[],
    resolved: ReadonlySet<string>,
): Marks => {
    const byId = new Map(spans.map((span) => [span.id, span]));

    const cross = (divergence: Divergence, perfId: string): ExtraNote[] => {
        const span = byId.get(perfId);
        if (!span) return [];
        return [
            {
                id: span.id,
                divergenceId: divergence.id,
                onsetMs: span.onsetMs,
                offsetMs: span.offsetMs,
                pitch: span.pitch,
                resolved: resolved.has(divergence.id),
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
        resolved: resolved.has(divergence.id),
    }));

    return { extraNotes, omissions };
};
