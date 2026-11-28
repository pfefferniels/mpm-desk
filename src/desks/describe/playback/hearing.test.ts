/**
 * What the piano is handed for each hearing of the roll: which keys, when, how hard, and the
 * sustaining pedal with them.
 */
import { describe, expect, it } from 'vitest';
import { aRun } from './fixture';
import { endOf, heardOf, keyOf, pedalled, pressesOf, struck } from './hearing';

const { roll } = aRun();

describe('the roll as it was played', () => {
    const heard = heardOf(roll, 'played');

    it('strikes every note where it was recorded, as hard as it was', () => {
        expect(heard.notes.find((key) => key.id === 'r0')).toEqual({
            id: 'r0',
            pitch: 60,
            onsetMs: 30,
            offsetMs: 480,
            velocity: 70,
        });
        expect(heard.notes.find((key) => key.id === 'l1')).toEqual({
            id: 'l1',
            pitch: 43,
            onsetMs: 2030,
            offsetMs: 3980,
            velocity: 70,
        });
    });

    it('strikes the grace notes too, for a moment each', () => {
        expect(heard.notes).toHaveLength(roll.notes.length + 1);
        expect(heard.notes.find((key) => key.id === 'g')).toEqual({
            id: 'g',
            pitch: 59,
            onsetMs: 1950,
            offsetMs: 2110,
            velocity: 40,
        });
    });

    it('presses the sustaining pedal as it was pressed, and no other', () => {
        expect(heard.pedals).toEqual([{ type: 'sustain', onsetMs: 0, durationMs: 1800 }]);
    });
});

describe('the roll as the MPM renders it', () => {
    const heard = heardOf(roll, 'rendered');

    it('strikes every note where the MPM has it, and no grace note', () => {
        expect(heard.notes.map((key) => key.id)).toEqual([
            'r0',
            'l0',
            'r1',
            'r2',
            'r3',
            'r4',
            'l1',
            'r5',
            'r6',
            'r7',
        ]);
        expect(heard.notes.find((key) => key.id === 'r0')).toEqual({
            id: 'r0',
            pitch: 60,
            onsetMs: 0,
            offsetMs: 450,
            velocity: 60,
        });
    });

    it('presses the pedal from each move down to the next move up', () => {
        expect(heard.pedals).toEqual([{ type: 'sustain', onsetMs: 0, durationMs: 1900 }]);
        expect(pedalled(roll, 'rendered')).toEqual(heard.pedals);
    });
});

describe('keys in the order they are struck', () => {
    const key = (id: string, pitch: number, onsetMs: number, offsetMs: number) => ({
        id,
        pitch,
        onsetMs,
        offsetMs,
        velocity: 60,
    });
    const keys = [
        key('a', 60, 0, 1000),
        key('b', 60, 600, 900),
        key('c', 62, 100, 2000),
        key('d', 60, 900, 1200),
    ];

    it('end a note where its pitch is struck again, which a key still down would not be', () => {
        expect(struck(keys)).toEqual([
            key('a', 60, 0, 600),
            key('c', 62, 100, 2000),
            key('b', 60, 600, 900),
            key('d', 60, 900, 1200),
        ]);
    });

    it('leave what they were made from as it was', () => {
        struck(keys);
        expect(keys[0].offsetMs).toBe(1000);
    });
});

describe('the presses of a pedal, from its moves', () => {
    it('begin past half-way and end below it, however often a move is stated', () => {
        const moves = [
            { ms: 0, value: 0 },
            { ms: 100, value: 127 },
            { ms: 100, value: 127 },
            { ms: 250, value: 64 },
            { ms: 300, value: 63 },
            { ms: 300, value: 0 },
            { ms: 500, value: 90 },
            { ms: 700, value: 0 },
        ];
        expect(pressesOf(moves, 900)).toEqual([
            { type: 'sustain', onsetMs: 100, durationMs: 200 },
            { type: 'sustain', onsetMs: 500, durationMs: 200 },
        ]);
    });

    it('end with the playing where the pedal never comes up', () => {
        expect(pressesOf([{ ms: 400, value: 127 }], 900)).toEqual([
            { type: 'sustain', onsetMs: 400, durationMs: 500 },
        ]);
        expect(pressesOf([{ ms: 1200, value: 127 }], 900)).toEqual([
            { type: 'sustain', onsetMs: 1200, durationMs: 0 },
        ]);
        expect(pressesOf([], 900)).toEqual([]);
    });
});

describe('a key', () => {
    const sound = { ms: 10, msEnd: 20, velocity: 60 };

    it('is struck at a share of its loudness, in whole velocities', () => {
        expect(keyOf('a', 60, sound).velocity).toBe(60);
        expect(keyOf('a', 60, sound, 0.55).velocity).toBe(33);
        expect(keyOf('a', 60, sound, 0.7 * 0.55).velocity).toBe(23);
    });

    it('is neither silent nor louder than a piano can be struck', () => {
        expect(keyOf('a', 60, { ...sound, velocity: 0.2 }).velocity).toBe(1);
        expect(keyOf('a', 60, { ...sound, velocity: 140 }).velocity).toBe(127);
    });
});

describe('the end of the roll', () => {
    it('is the last thing on it, played, rendered or counted', () => {
        expect(endOf(roll)).toBe(4000);
        expect(endOf({ notes: roll.notes, beats: [] })).toBe(3980);
        expect(endOf({ notes: [], beats: [] })).toBe(0);
    });
});
