import { describe, expect, it } from 'vitest';
import { combineByMeter, metricLevels } from './metricGrouping';
import type { Range } from './Tempo';

const QUARTER = 720;
const EIGHTH = QUARTER / 2;
const HALF = QUARTER * 2;
const BAR = QUARTER * 4;
const DOTTED_QUARTER = QUARTER + EIGHTH;

/** `count` boxes of `length` ticks each, laid end to end from `start`. */
const run = (start: number, length: number, count: number): Range[] =>
    Array.from({ length: count }, (_, i) => ({
        start: start + i * length,
        end: start + (i + 1) * length,
    }));

describe('metricLevels', () => {
    it('halves the beat downwards and groups it upwards in simple time', () => {
        expect(metricLevels({ numerator: 4, denominator: 4 })).toEqual([45, 90, 180, 360, 720, 1440, 2880]);
    });

    it('takes a bar of three beats in one step, having nothing to halve it into', () => {
        expect(metricLevels({ numerator: 3, denominator: 4 })).toEqual([45, 90, 180, 360, 720, 2160]);
    });

    it('beats a compound signature in dotted notes', () => {
        // No 720: in 6/8 two eighths make nothing, and three make the beat.
        expect(metricLevels({ numerator: 6, denominator: 8 })).toEqual([45, 90, 180, 360, 1080, 2160]);
        expect(metricLevels({ numerator: 9, denominator: 8 })).toEqual([45, 90, 180, 360, 1080, 3240]);
        expect(metricLevels({ numerator: 12, denominator: 8 })).toEqual([45, 90, 180, 360, 1080, 2160, 4320]);
    });

    it('reads a numerator of three as simple triple time', () => {
        // The eighth is the beat and the three of them are the bar, where 6/8 reads the same
        // 1080 ticks as one beat and puts a bar of 2160 over it.
        expect(metricLevels({ numerator: 3, denominator: 8 })).toEqual([45, 90, 180, 360, 1080]);
    });

    it('groups an irregular bar straight from the beat', () => {
        expect(metricLevels({ numerator: 5, denominator: 4 })).toEqual([45, 90, 180, 360, 720, 3600]);
    });

    it('falls back to common time where the score states no signature', () => {
        expect(metricLevels()).toEqual(metricLevels({ numerator: 4, denominator: 4 }));
    });
});

describe('combineByMeter', () => {
    it('builds the halves and then the bar out of four quarters', () => {
        expect(combineByMeter(run(0, QUARTER, 4))).toEqual([
            { start: 0, end: HALF },
            { start: HALF, end: BAR },
            { start: 0, end: BAR },
        ]);
    });

    it('recurses from the eighth up, forming every level on the way', () => {
        const formed = combineByMeter(run(0, EIGHTH, 8));

        expect(formed).toContainEqual({ start: 0, end: QUARTER });
        expect(formed).toContainEqual({ start: QUARTER, end: HALF });
        expect(formed).toContainEqual({ start: 0, end: HALF });
        expect(formed).toContainEqual({ start: 0, end: BAR });
        expect(formed).toHaveLength(4 + 2 + 1);
    });

    it('leaves a cell the boxes do not fill alone', () => {
        // Three quarters of the bar: the first half is tiled, the second is not, and so neither
        // is the bar.
        const formed = combineByMeter(run(0, QUARTER, 3));

        expect(formed).toEqual([{ start: 0, end: HALF }]);
    });

    it('will not combine off the grid', () => {
        // Two quarters starting an eighth late span a quarter's worth of a half, aligned to
        // neither.
        expect(combineByMeter(run(EIGHTH, QUARTER, 2))).toEqual([]);
    });

    it('does not restate a box that is there already', () => {
        const boxes = [...run(0, QUARTER, 4), { start: 0, end: HALF }];

        expect(combineByMeter(boxes)).toEqual([
            { start: HALF, end: BAR },
            { start: 0, end: BAR },
        ]);
    });

    it('groups eighths in threes under a compound signature', () => {
        const formed = combineByMeter(run(0, EIGHTH, 6), [{ date: 0, numerator: 6, denominator: 8 }]);

        expect(formed).toEqual([
            { start: 0, end: DOTTED_QUARTER },
            { start: DOTTED_QUARTER, end: 2 * DOTTED_QUARTER },
            { start: 0, end: 2 * DOTTED_QUARTER },
        ]);
    });

    it('spans several bars, each on its own', () => {
        const formed = combineByMeter(run(0, HALF, 4));

        expect(formed).toEqual([
            { start: 0, end: BAR },
            { start: BAR, end: 2 * BAR },
        ]);
    });

    it('forms nothing out of nothing', () => {
        expect(combineByMeter([])).toEqual([]);
    });

    it('counts the bars of a score with an anacrusis from its downbeat', () => {
        // 1/4 of upbeat, then 4/4 — the map `latest/score.msm` states. The bars run 720..3600
        // and 3600..6480, and nothing of the piece is grouped from tick 0.
        const anacrusis = [
            { date: 0, numerator: 1, denominator: 4 },
            { date: QUARTER, numerator: 4, denominator: 4 },
        ];
        const formed = combineByMeter(run(0, QUARTER, 9), anacrusis);

        expect(formed).toContainEqual({ start: QUARTER, end: QUARTER + BAR });
        expect(formed).toContainEqual({ start: QUARTER + BAR, end: QUARTER + 2 * BAR });
        expect(formed.filter(box => box.start === 0)).toEqual([]);
    });

    it('groups each stretch under the signature governing it', () => {
        // 3/4 for two bars, then 2/4. Neither bar length is formed where the other governs.
        const formed = combineByMeter(run(0, QUARTER, 8), [
            { date: 0, numerator: 3, denominator: 4 },
            { date: 6 * QUARTER, numerator: 2, denominator: 4 },
        ]);

        expect(formed).toEqual([
            { start: 0, end: 3 * QUARTER },
            { start: 3 * QUARTER, end: 6 * QUARTER },
            { start: 6 * QUARTER, end: 8 * QUARTER },
        ]);
    });

    it('forms no cell reaching over a change of signature', () => {
        // The 3/4 bar would run 3600..5760, past the 2/4 that begins at 5040.
        const formed = combineByMeter(run(0, QUARTER, 8), [
            { date: 0, numerator: 3, denominator: 4 },
            { date: 7 * QUARTER, numerator: 2, denominator: 4 },
        ]);

        expect(formed).toEqual([
            { start: 0, end: 3 * QUARTER },
            { start: 3 * QUARTER, end: 6 * QUARTER },
        ]);
    });
});
