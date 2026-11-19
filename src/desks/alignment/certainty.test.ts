import { describe, expect, it } from 'vitest';
import type { Divergence } from '../../alignment/divergences';
import type { Outcome } from '../../alignment/transcription';
import { SURE, anchorsOf, certaintyOf, paintCertainty } from './certainty';

const spans = [
    { id: 'p1', onsetMs: 0, pitch: 60 },
    { id: 'p2', onsetMs: 500, pitch: 62 },
    { id: 'p3', onsetMs: 900, pitch: 64 },
    { id: 'x', onsetMs: 700, pitch: 67 },
];
const matches = [
    { scoreId: 'n1', performanceId: 'p1', confidence: 1 },
    { scoreId: 'n2', performanceId: 'p2', confidence: SURE - 0.01 },
    { scoreId: 'n3', performanceId: 'p3', confidence: 0.99 },
];

describe('the notes a played note is placed between', () => {
    it('are the matches the model was sure of, at the moment each was struck', () => {
        expect([...anchorsOf(matches, spans)]).toEqual([
            ['n1', 0],
            ['n3', 900],
        ]);
    });

    it('leave out what the engraving cannot show', () => {
        expect([...anchorsOf(matches, spans, new Set(['n3']))]).toEqual([['n1', 0]]);
    });
});

describe('how sure the model was of each note on the page', () => {
    const outcome = (notes: { id: string; played: string }[]): Outcome =>
        ({ written: 'measured', because: '', offers: [], noteIds: notes.map((note) => note.id), notes }) as unknown as Outcome;

    const certainty = certaintyOf({
        matches,
        deletions: [{ scoreId: 'n4', confidence: 0.3 }],
        insertions: [{ performanceId: 'x', confidence: 0.6 }],
        spans,
        divergences: [{ kind: 'added', id: 'added-x', perfIds: ['x'] } as unknown as Divergence],
        // The played g was written into the score as a note of its own
        outcomes: new Map([['added-x', outcome([{ id: 'w1', played: 'played-700ms-67' }])]]),
        ties: new Map([['n2', 'n2b']]),
    });

    it('is the match, the deletion or the insertion each note came of', () => {
        expect(certainty.get('n1')).toBe(1);
        expect(certainty.get('n4')).toBe(0.3);
        // As a cross, under the played note's id
        expect(certainty.get('x')).toBe(0.6);
    });

    it('goes with a played note into the score, under the id it is written under', () => {
        expect(certainty.get('w1')).toBe(0.6);
    });

    it('runs on through a tie, into a note nothing struck', () => {
        expect(certainty.get('n2b')).toBe(SURE - 0.01);
    });
});

describe('the ink', () => {
    const page = () => {
        const root = document.createElement('div');
        root.innerHTML = `<svg><g class="note" data-id="n1"><g class="notehead"/></g><g class="note" data-id="n2"><g class="notehead"/></g><g class="performanceExtraNote" data-perf-id="x"/></svg>`;
        return root;
    };
    const opacity = (root: Element, selector: string) =>
        (root.querySelector(selector) as SVGElement).style.getPropertyValue('opacity');

    it('is as faint as the model was unsure, and never quite gone', () => {
        const root = page();
        paintCertainty(root, new Map([['n1', 1], ['n2', 0], ['x', 0.5]]));

        expect(opacity(root, '[data-id="n1"] .notehead')).toBe('1');
        expect(opacity(root, '[data-id="n2"] .notehead')).toBe('0.2');
        expect(opacity(root, '.performanceExtraNote')).toBe('0.6');
    });

    it('is taken off again where nothing is known', () => {
        const root = page();
        paintCertainty(root, new Map([['n2', 0]]));
        paintCertainty(root, undefined);

        expect(opacity(root, '[data-id="n2"] .notehead')).toBe('');
        expect(root.querySelector('[data-certainty]')).toBeNull();
    });
});
