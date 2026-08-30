import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { convertMeiToMsm } from 'espressivo';
import { asMSM } from '../../fitting/asMSM';
import { measureTicks, tickRange } from './measures';

const mei = readFileSync('public/transcription.mei', 'utf-8');

describe('measureTicks, against the real transcription', () => {
    const alignment = asMSM(mei, convertMeiToMsm(mei)[0]!.msm);
    const dates = new Map(alignment.allNotes.map((note) => [note['xml:id'], note.date]));
    const ticks = measureTicks(mei, dates);

    test('finds the bars', () => {
        expect(ticks.size).toBeGreaterThan(20);
    });

    test('the first bar it knows starts at the beginning', () => {
        expect(ticks.get(1)).toBe(0);
    });

    test('bars ascend, so the table can be read as an axis', () => {
        const entries = [...ticks.entries()].sort((a, b) => a[0] - b[0]);
        const ascending = entries.every(
            ([, tick], index) => index === 0 || tick >= entries[index - 1]![1],
        );
        expect(ascending).toBe(true);
    });

    test('no bar starts after the last note', () => {
        expect(Math.max(...ticks.values())).toBeLessThanOrEqual(alignment.lastDate());
    });
});

describe('tickRange', () => {
    const ticks = new Map([
        [1, 0],
        [2, 720],
        [3, 1440],
    ]);

    test('covers the whole of the last bar named, not just its downbeat', () => {
        expect(tickRange(ticks, 1, 2)).toEqual({ from: 0, to: 1440 });
    });

    test('reads a reversed pair as the range between them', () => {
        expect(tickRange(ticks, 2, 1)).toEqual({ from: 0, to: 1440 });
    });

    test('runs to the end of the piece when nothing follows', () => {
        expect(tickRange(ticks, 3, 3)).toEqual({ from: 1440, to: Infinity });
    });

    test('answers nothing for a bar the score has not got', () => {
        expect(tickRange(ticks, 9, 9)).toBeUndefined();
    });
});
