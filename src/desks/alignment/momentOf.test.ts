/**
 * Where in the recording an alteration is, which is what "Hear it" plays around.
 */
import { describe, expect, it } from 'vitest';
import type { Divergence } from '../../alignment/divergences';
import { momentOf } from './momentOf';

const scoreNotes = [
    { note: 'n1', onset: 0 },
    { note: 'n2', onset: 1 },
    { note: 'n3', onset: 2 },
    { note: 'n4', onset: 3 },
];
const spans = [
    { id: 'p1', onsetMs: 1000 },
    { id: 'p2', onsetMs: 2000 },
    { id: 'p4', onsetMs: 5000 },
    { id: 'extra', onsetMs: 2600 },
];
const matches = [
    { scoreId: 'n1', performanceId: 'p1' },
    { scoreId: 'n2', performanceId: 'p2' },
    { scoreId: 'n4', performanceId: 'p4' },
];

const missing = (onset: number) => ({ kind: 'missing', onset }) as Divergence;

describe('the moment of an alteration in the recording', () => {
    it('is the moment a played note was struck', () => {
        const added = { kind: 'added', onsetMs: 2600 } as Divergence;
        expect(momentOf(added, matches, spans, scoreNotes)).toBe(2600);

        const replaced = { kind: 'replaced', onset: 1, onsetMs: 2040 } as Divergence;
        expect(momentOf(replaced, matches, spans, scoreNotes)).toBe(2040);
    });

    it('is, for a note nobody played, when it was due between the notes around it', () => {
        // n3 stands halfway between n2, struck at two seconds, and n4, struck at five
        expect(momentOf(missing(2), matches, spans, scoreNotes)).toBe(3500);
    });

    it('is the moment of the chord, where the rest of its chord was played', () => {
        expect(momentOf(missing(1), matches, spans, scoreNotes)).toBe(2000);
    });

    it('is the nearest played note, past either end of what was played', () => {
        expect(momentOf(missing(4), matches, spans, scoreNotes)).toBe(5000);
        expect(momentOf(missing(-1), matches, spans, scoreNotes)).toBe(1000);
    });

    it('is nowhere, when nothing was matched at all', () => {
        expect(momentOf(missing(2), [], spans, scoreNotes)).toBeUndefined();
    });
});
