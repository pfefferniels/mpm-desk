import { describe, expect, it } from 'vitest';
import type { Divergence } from '../../alignment/divergences';
import { paintingOf } from './paintAlignment';

/**
 * What each note of the score is, as far as the colouring is concerned.
 *
 * Three of these rules are decisions rather than arithmetic, and each fails quietly: a note played
 * as another note is not unplayed, a match the reader stopped believing *is*, and a passage the
 * recording never reaches is neither — colouring it red would say the performer left it out.
 */

const match = (scoreId: string, confidence = 0.9) => ({
    scoreId,
    performanceId: `p-${scoreId}`,
    confidence,
});

const missing = (scoreIds: string[], reading: Divergence extends { reading: infer R } ? R : never) =>
    ({
        kind: 'missing',
        id: `missing-${scoreIds[0]}`,
        scoreIds,
        reading,
        because: '',
        onset: 0,
        confidence: 0.5,
    }) as Divergence;

const replaced = (scoreId: string): Divergence => ({
    kind: 'replaced',
    id: `replaced-${scoreId}`,
    scoreId,
    perfId: 'p-x',
    pitches: [60, 61],
    reading: 'neighbour-slip',
    because: '',
    onset: 0,
    onsetMs: 0,
    lateMs: 10,
    confidence: 0.5,
});

const paint = (over: Partial<Parameters<typeof paintingOf>[0]> = {}) =>
    paintingOf({
        matches: [],
        deletions: [],
        divergences: [],
        minConfidence: 0,
        hidden: new Set(),
        ...over,
    });

describe('what the score is coloured by', () => {
    it('calls a matched note matched', () => {
        const painting = paint({ matches: [match('n1'), match('n2')] });

        expect([...painting.matched]).toEqual(['n1', 'n2']);
        expect(painting.unplayed.size).toBe(0);
    });

    it('turns a match the reader stopped believing into an unplayed note', () => {
        const painting = paint({
            matches: [match('n1', 0.9), match('n2', 0.3)],
            minConfidence: 0.5,
        });

        expect([...painting.matched]).toEqual(['n1']);
        expect([...painting.unplayed]).toEqual(['n2']);
    });

    it('leaves out a match the engraving cannot show', () => {
        // A repeat written with signs is played twice and drawn once; verovio mints an id for the
        // second pass that the document does not hold.
        const painting = paint({ matches: [match('n1'), match('n1-rend2')], hidden: new Set(['n1-rend2']) });

        expect([...painting.matched]).toEqual(['n1']);
    });

    it('does not call a note played as another note unplayed: it sounded', () => {
        const painting = paint({
            deletions: [{ scoreId: 'n1', confidence: 0.4 }],
            divergences: [replaced('n1')],
        });

        expect(painting.unplayed.size).toBe(0);
        expect(painting.replaced.get('n1')).toBe('replaced-n1');
    });

    it('sets a passage the recording never reaches apart from one the performer left out', () => {
        const painting = paint({
            deletions: [
                { scoreId: 'n1', confidence: 0.4 },
                { scoreId: 'n9', confidence: 0.4 },
            ],
            divergences: [missing(['n1'], 'omitted-note'), missing(['n9'], 'outside')],
        });

        expect(painting.unplayed).toEqual(new Set(['n1', 'n9']));
        // Both are unplayed; only one of them is something the performer did
        expect([...painting.outside]).toEqual(['n9']);
    });

    it('says which disagreement each mark would ask about', () => {
        const painting = paint({
            deletions: [{ scoreId: 'n1', confidence: 0.4 }],
            divergences: [missing(['n1', 'n2'], 'omitted-passage'), replaced('n7')],
        });

        expect(painting.divergenceOf.get('n1')).toBe('missing-n1');
        expect(painting.divergenceOf.get('n2')).toBe('missing-n1');
        expect(painting.divergenceOf.get('n7')).toBe('replaced-n7');
    });
});
