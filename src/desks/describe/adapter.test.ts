import { describe, expect, it } from 'vitest';
import type { RollNote as Laid } from '../../fitting/description/client';
import type { Call } from '../../model/Work';
import { notesOf, scaleOf } from './adapter';

/**
 * What the roll is told of a note that arrived elsewhere than it now stands.
 *
 * The figures are the published reconstruction's own: its roll's loudness is opened along
 * `[[35, 20], [54, 46]]`, a note that arrived at 41 stands at 28.21 by that alone, and the chord
 * at 1440 that arrived at 35 was made softer by hand and stands at 14.
 */

const OPENED: Call = { id: 'opened', name: 'Modify', options: { scope: 'global', aspect: 'velocity', points: [[35, 20], [54, 46]] } };
const SOFTER: Call = { id: 'softer', name: 'Modify', options: { scope: 'global', aspect: 'velocity', change: -6, from: 1440, to: 1440 } };

/** A note of a run: sounding from 1000 to 1900 ms at `velocity`, having arrived as `arrived` has it. */
const laid = (id: string, velocity: number, arrived?: Partial<Laid['arrived']>, part = 1): Laid => {
    const sounds = { ms: 1000, msEnd: 1900, velocity };
    return { id, part, pitch: 60, date: 0, duration: 720, ...sounds, ...(arrived && { arrived: { ...sounds, ...arrived } }), mpm: sounds, late: 0, longMs: 0, loud: 0 };
};

const arrivedOf = (calls: Call[], ...notes: Laid[]) => notesOf({ notes }, new Map(), scaleOf(calls), null).map((note) => note.arrived);

describe('the scale a document reads the roll\'s loudness on', () => {
    it('is the line an expansion of the velocity draws for every note', () => {
        const scale = scaleOf([OPENED]);
        expect(scale(1, 35)).toBe(20);
        expect(scale(2, 54)).toBe(46);
        expect(scale(1, 41)).toBeCloseTo(28.2105, 4);
    });

    it('leaves a velocity where it is in a document that opens nothing', () => {
        expect(scaleOf([SOFTER])(1, 41)).toBe(41);
        expect(scaleOf([])(1, 41)).toBe(41);
    });

    it('runs one expansion after another, in the order they were made, and never below nought', () => {
        const halved: Call = { id: 'halved', name: 'Modify', options: { scope: 'global', aspect: 'velocity', points: [[0, 0], [100, 50]] } };
        expect(scaleOf([OPENED, halved])(1, 35)).toBe(10);
        expect(scaleOf([OPENED])(1, 10)).toBe(0);
    });

    it('reaches only the part an expansion is made on, which is counted from nought', () => {
        const upper: Call = { ...OPENED, options: { ...OPENED.options, scope: 0 } };
        expect(scaleOf([upper])(1, 35)).toBe(20);
        expect(scaleOf([upper])(2, 35)).toBe(35);
    });

    it('takes no expansion that names a place, another aspect, or points that draw no line', () => {
        const here: Call = { ...OPENED, options: { ...OPENED.options, from: 0, to: 2880 } };
        const these: Call = { ...OPENED, options: { ...OPENED.options, noteIDs: ['a'] } };
        const sooner: Call = { ...OPENED, options: { ...OPENED.options, aspect: 'onset' } };
        const nothing: Call = { ...OPENED, options: { ...OPENED.options, points: [[35, 20]] } };
        expect(scaleOf([here, these, sooner, nothing])(1, 35)).toBe(35);
    });
});

describe('a note as it arrived', () => {
    it('is not handed to the roll where all that happened to it happened to every note alike', () => {
        const [arrived] = arrivedOf([OPENED, SOFTER], laid('a', 20 + (6 * 26) / 19, { velocity: 41 }));
        expect(arrived).toBeUndefined();
    });

    it('is handed over, on the scale the document opened, where a correction was made at its place', () => {
        const [arrived] = arrivedOf([OPENED, SOFTER], laid('b', 14, { velocity: 35 }));
        expect(arrived).toEqual({ ms: 1000, msEnd: 1900, velocity: 20 });
    });

    it('is handed over where it sounded sooner or was held longer, however loud it arrived', () => {
        const [sooner, longer] = arrivedOf([OPENED], laid('a', 20, { velocity: 35, ms: 980 }), laid('b', 20, { velocity: 35, msEnd: 2000 }));
        expect(sooner).toEqual({ ms: 980, msEnd: 1900, velocity: 20 });
        expect(longer).toEqual({ ms: 1000, msEnd: 2000, velocity: 20 });
    });

    it('is handed over as the run has it where the document opens no scale', () => {
        const [arrived, same, untouched] = arrivedOf([SOFTER], laid('a', 29, { velocity: 35 }), laid('b', 29, { velocity: 29 }), laid('c', 29));
        expect(arrived).toEqual({ ms: 1000, msEnd: 1900, velocity: 35 });
        expect(same).toBeUndefined();
        expect(untouched).toBeUndefined();
    });

    it('is still outlined where an expansion was made of one place only', () => {
        const here: Call = { ...OPENED, options: { ...OPENED.options, from: 0, to: 0 } };
        expect(arrivedOf([here], laid('a', 20, { velocity: 35 }))[0]).toEqual({ ms: 1000, msEnd: 1900, velocity: 35 });
    });
});
