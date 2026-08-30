import { describe, expect, test, vi } from 'vitest';
import { createMpm, type Mpm } from '../../../src/fitting/instructions/index';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../../src/fitting/alignment';
import { Modify } from '../../../src/fitting/transformers/modification/Modify';
import { only } from '../../support/at';

/**
 * `Modify` corrects the recording — the one call in the chain whose subject is what the roll scan
 * read rather than what the performance did with it.
 *
 * Three of its four aspects had no way of being called until the corrections desk existed, so
 * this file is mostly about arms that have never run: an onset drags a note's release along with
 * it, a duration moves only the release, and a pedal is corrected in exactly the same two ways
 * despite having no symbolic date to be selected by.
 *
 * The velocity tests are the other kind: 33 saved calls of the reconstruction are velocity
 * corrections in the two selector shapes below, so those two are a compatibility check.
 */

const note = (
    id: string,
    over: Partial<AlignedNote> = {},
): AlignedNote => ({
    'xml:id': id,
    part: 1,
    staff: '1',
    layer: '1',
    date: 0,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': 1000,
    'milliseconds.date.end': 2000,
    'midi.pitch': 60,
    velocity: 64,
    ...over,
});

const pedal = (id: string, over: Partial<AlignedPedal> = {}): AlignedPedal => ({
    'xml:id': id,
    type: 'sustain',
    'milliseconds.date': 1000,
    'milliseconds.date.end': 3000,
    ...over,
});

/** Call the protected `transform` method for testing */
const run = (transformer: Modify, msm: Alignment, mpm: Mpm = createMpm()) => {
    interface Transformable {
        transform(msm: Alignment, mpm: Mpm): void;
    }
    (transformer as unknown as Transformable).transform(msm, mpm);
};

describe('velocity, the shape that is on disk', () => {
    test('a list of note ids raises every reading of each of them', () => {
        // Two notes under one id is what an alignment looks like before a `MakeChoice` covering
        // the passage has collapsed the readings — one per source. A correction is about the
        // note, so it belongs on both; `getByID` would have found only the first.
        const msm = new Alignment([
            note('a', { source: 'take1', velocity: 40 }),
            note('a', { source: 'take2', velocity: 50 }),
            note('b', { date: 720, velocity: 90 }),
        ]);

        run(new Modify({ scope: 'global', aspect: 'velocity', change: -3, noteIDs: ['a'] }), msm);

        expect(msm.allNotes.map((n) => n.velocity)).toEqual([37, 47, 90]);
    });

    test('a tick range reaches the notes inside it and no others', () => {
        const msm = new Alignment([
            note('a', { date: 0 }),
            note('b', { date: 720 }),
            note('c', { date: 1440 }),
        ]);

        run(new Modify({ scope: 'global', aspect: 'velocity', change: 5, from: 0, to: 720 }), msm);

        expect(msm.allNotes.map((n) => n.velocity)).toEqual([69, 69, 64]);
    });

    test('a correction cannot push a velocity below zero', () => {
        const msm = new Alignment([note('a', { velocity: 2 })]);

        run(new Modify({ scope: 'global', aspect: 'velocity', change: -10, noteIDs: ['a'] }), msm);

        expect(only(msm.allNotes, 'note').velocity).toBe(0);
    });
});

describe('onset', () => {
    test('moving a note moves its release with it', () => {
        // The end is absolute, not a length, so shifting only the start would lengthen the note
        // instead of displacing it.
        const msm = new Alignment([note('a')]);

        run(new Modify({ scope: 'global', aspect: 'onset', change: 250, noteIDs: ['a'] }), msm);

        const corrected = only(msm.allNotes, 'note');
        expect(corrected['milliseconds.date']).toBe(1250);
        expect(corrected['milliseconds.date.end']).toBe(2250);
    });

    test('a note cannot be dragged before the start of the recording, and keeps its length there', () => {
        const msm = new Alignment([note('a')]);

        run(new Modify({ scope: 'global', aspect: 'onset', change: -5000, noteIDs: ['a'] }), msm);

        const corrected = only(msm.allNotes, 'note');
        expect(corrected['milliseconds.date']).toBe(0);
        // 1000 long before the clamp, and 1000 long after it: the clamped delta is applied to
        // both fields, not the delta that was asked for.
        expect(corrected['milliseconds.date.end']).toBe(1000);
    });

    test('a score note the recording never played is left alone', () => {
        // Its non-finite onset is what says it never sounded. Adding to it would write `NaN`
        // over that and lose the distinction from a note sounding at zero.
        const msm = new Alignment([note('a', { 'milliseconds.date': NaN, 'milliseconds.date.end': NaN })]);

        run(new Modify({ scope: 'global', aspect: 'onset', change: 250, noteIDs: ['a'] }), msm);

        expect(only(msm.allNotes, 'note')['milliseconds.date']).toBeNaN();
    });
});

describe('duration', () => {
    test('only the release moves', () => {
        const msm = new Alignment([note('a')]);

        run(new Modify({ scope: 'global', aspect: 'duration', change: -300, noteIDs: ['a'] }), msm);

        const corrected = only(msm.allNotes, 'note');
        expect(corrected['milliseconds.date']).toBe(1000);
        expect(corrected['milliseconds.date.end']).toBe(1700);
    });

    test('a release cannot be dragged back past its own onset', () => {
        const msm = new Alignment([note('a')]);

        run(new Modify({ scope: 'global', aspect: 'duration', change: -5000, noteIDs: ['a'] }), msm);

        expect(only(msm.allNotes, 'note')['milliseconds.date.end']).toBe(1000);
    });
});

describe('pedals, which have no place on the score to be selected by', () => {
    const withPedals = () => {
        const msm = new Alignment([note('a')]);
        msm.pedals = [pedal('p1'), pedal('p2', { 'milliseconds.date': 4000, 'milliseconds.date.end': 5000 })];
        return msm;
    };

    test('an onset correction displaces the depression and the release together', () => {
        const msm = withPedals();

        run(new Modify({ scope: 'global', aspect: 'onset', change: -400, pedalIDs: ['p1'] }), msm);

        expect(msm.pedals[0]?.['milliseconds.date']).toBe(600);
        expect(msm.pedals[0]?.['milliseconds.date.end']).toBe(2600);
        // The pedal that was not named is untouched.
        expect(msm.pedals[1]?.['milliseconds.date']).toBe(4000);
    });

    test('a duration correction moves only the release', () => {
        const msm = withPedals();

        run(new Modify({ scope: 'global', aspect: 'duration', change: 500, pedalIDs: ['p1'] }), msm);

        expect(msm.pedals[0]?.['milliseconds.date']).toBe(1000);
        expect(msm.pedals[0]?.['milliseconds.date.end']).toBe(3500);
    });

    test('the notes are left alone by a pedal correction', () => {
        const msm = withPedals();

        run(new Modify({ scope: 'global', aspect: 'onset', change: 400, pedalIDs: ['p1'] }), msm);

        expect(only(msm.allNotes, 'note')['milliseconds.date']).toBe(1000);
    });

    test('asking for a velocity on a pedal is reported, not silently dropped', () => {
        const msm = withPedals();
        const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        run(new Modify({ scope: 'global', aspect: 'velocity', change: 5, pedalIDs: ['p1'] }), msm);

        expect(reported).toHaveBeenCalled();
        expect(msm.pedals[0]?.['milliseconds.date']).toBe(1000);
        reported.mockRestore();
    });

    test('a pedal id nobody has is skipped rather than throwing', () => {
        const msm = withPedals();

        run(new Modify({ scope: 'global', aspect: 'onset', change: 100, pedalIDs: ['p1', 'gone'] }), msm);

        expect(msm.pedals[0]?.['milliseconds.date']).toBe(1100);
    });
});
