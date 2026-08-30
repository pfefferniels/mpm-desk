import type { Divergence } from '../../alignment/divergences';
import type { Attribution, Resolution } from '../../alignment/readings';
import {
    addOrnamentSign,
    addPlayedNotes,
    markUnplayed,
    replaceWithPlayed,
} from '../../mei/editScore';
import type { NoteSpan } from '../../performance/midiSpans';

/**
 * Carry out the decisions that change the notation.
 *
 * Only four of the seven actions do; everything else is a fact about the *recording*, which is
 * already written into it. Each of these adds an editorial reading to the score itself — an
 * `<app>` holding what the source writes beside what the performer played — under the
 * responsibility and certainty the reader gave.
 *
 * The edited score replaces the one the desk is working on, so the next alignment sees the notes
 * just added: that is what makes a written-in note *match* rather than turn up as an addition all
 * over again.
 */

export interface ScoreEdits {
    mei: string;
    /** How many decisions were carried out. Zero is worth reporting; it means none could be. */
    changed: number;
}

export interface ScoreEditInput {
    mei: string;
    divergences: readonly Divergence[];
    resolutions: ReadonlyMap<string, Resolution>;
    spans: readonly NoteSpan[];
    attribution: Attribution;
    /**
     * The key the added notes are spelled in.
     *
     * `C` unless somebody says otherwise, which is what `spellMidi` falls back to anyway. A real
     * answer would come from the score's own key signature; nothing reads one yet, and guessing
     * from the first `<keySig>` would be wrong for any piece that modulates.
     */
    tonic?: string;
}

export const applyToScore = ({
    mei,
    divergences,
    resolutions,
    spans,
    attribution,
    tonic = 'C',
}: ScoreEditInput): ScoreEdits => {
    const doc = new DOMParser().parseFromString(mei, 'application/xml');
    const byId = new Map(spans.map((span) => [span.id, span]));
    const who = { resp: attribution.resp || undefined, certainty: attribution.certainty };
    let changed = 0;

    for (const divergence of divergences) {
        const action = resolutions.get(divergence.id)?.action;
        if (!action || action === 'record' || action === 'ignore') continue;

        if (divergence.kind === 'added' && divergence.anchorId) {
            if (action === 'add-sign') {
                if (addOrnamentSign(doc, divergence.anchorId, 'trill', who)) changed++;
            } else if (action === 'write-notes') {
                const played = divergence.perfIds
                    .map((id) => byId.get(id))
                    .filter((span): span is NoteSpan => span !== undefined);
                const reason =
                    divergence.reading === 'added-octave' ||
                    divergence.reading === 'fuller-chord' ||
                    divergence.reading === 'ornamentation'
                        ? divergence.reading
                        : 'unknown';
                if (addPlayedNotes(doc, divergence.anchorId, played, reason, tonic, who)) {
                    changed++;
                }
            }
        } else if (divergence.kind === 'missing' && action === 'mark-simplification') {
            if (markUnplayed(doc, divergence.scoreIds, who)) changed++;
        } else if (divergence.kind === 'replaced' && action === 'write-variant') {
            const played = byId.get(divergence.perfId);
            if (played && replaceWithPlayed(doc, divergence.scoreId, played, tonic, who)) {
                changed++;
            }
        }
    }

    return { mei: new XMLSerializer().serializeToString(doc), changed };
};
