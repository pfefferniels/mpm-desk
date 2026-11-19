import { describe, expect, it } from 'vitest';
import { excerptOf, type ExcerptInput } from './rollExcerpt';

/**
 * A bar of four quarters, the first three played at 600 ms a beat, the fourth left out, and a key
 * added between the second and the third.
 */
const input = (overrides: Partial<ExcerptInput> = {}): ExcerptInput => ({
    bar: ['n1', 'n2', 'n3', 'n4'],
    hovered: { noteId: 'n2' },
    spans: [
        { id: 'p1', onsetMs: 1000, offsetMs: 1500, pitch: 60 },
        { id: 'p2', onsetMs: 1600, offsetMs: 2100, pitch: 62 },
        { id: 'x', onsetMs: 1900, offsetMs: 2000, pitch: 67 },
        { id: 'p3', onsetMs: 2200, offsetMs: 2700, pitch: 64 },
        // Long before the bar, and not in it
        { id: 'early', onsetMs: 100, offsetMs: 300, pitch: 50 },
    ],
    playedOf: new Map([
        ['n1', 'p1'],
        ['n2', 'p2'],
        ['n3', 'p3'],
    ]),
    kindOf: new Map([['x', 'added']]),
    unplayed: new Set(['n4']),
    writtenOf: new Map([
        ['n1', { onset: 0, duration: 1, pitch: 60 }],
        ['n2', { onset: 1, duration: 1, pitch: 62 }],
        ['n3', { onset: 2, duration: 1, pitch: 64 }],
        ['n4', { onset: 3, duration: 1, pitch: 65 }],
    ]),
    ...overrides,
});

describe('a bar as it was played', () => {
    const excerpt = excerptOf(input())!;

    it('runs from a little before its first key to a little after its last', () => {
        expect(excerpt.fromMs).toBe(700);
        expect(excerpt.toMs).toBeGreaterThanOrEqual(2500);
    });

    it('holds every key struck in that stretch, the added among them, and nothing from outside it', () => {
        expect(excerpt.notes.filter((note) => note.kind !== 'unplayed').map((note) => note.pitch)).toEqual([
            60, 62, 67, 64,
        ]);
        expect(excerpt.notes.find((note) => note.pitch === 67)?.kind).toBe('added');
    });

    it('rings the key the note under the pointer was played as', () => {
        expect(excerpt.notes.filter((note) => note.hovered).map((note) => note.pitch)).toEqual([62]);
    });

    it('draws a written note nobody played where it was due, at the pace the bar was played', () => {
        const unplayed = excerpt.notes.find((note) => note.kind === 'unplayed');

        expect(unplayed).toMatchObject({ pitch: 65, onsetMs: 2800, offsetMs: 3400 });
        expect(excerpt.toMs).toBeGreaterThanOrEqual(3100);
    });

    it('has room for an octave at least', () => {
        expect(excerpt.high - excerpt.low).toBeGreaterThanOrEqual(12);
        expect(excerpt.low).toBeLessThanOrEqual(58);
        expect(excerpt.high).toBeGreaterThanOrEqual(69);
    });
});

describe('a bar nothing of which was played', () => {
    it('is shown around the played note the pointer is on, where it is on one', () => {
        const excerpt = excerptOf(input({ bar: ['n4'], hovered: { perfId: 'x' } }))!;

        expect(excerpt.fromMs).toBe(700);
        expect(excerpt.toMs).toBe(3100);
        expect(excerpt.notes.find((note) => note.hovered)?.pitch).toBe(67);
    });

    it('is not shown at all otherwise: there is no moment to show', () => {
        expect(excerptOf(input({ bar: ['n4'], hovered: { noteId: 'n4' } }))).toBeUndefined();
    });
});
