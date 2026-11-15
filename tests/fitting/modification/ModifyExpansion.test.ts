import { describe, expect, test, vi } from 'vitest';
import { createMpm, type Mpm } from '../../../src/fitting/instructions/index';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../../src/fitting/alignment';
import { expansion, inverseExpansion } from '../../../src/fitting/expansion';
import { Modify, type ExpansionOptions } from '../../../src/fitting/transformers/modification/Modify';
import { buildChain } from '../../../src/fitting/chain';
import { parseWorkFile, serializeWorkFile, type WorkFile } from '../../../src/model/Work';

/**
 * A `Modify` that states `points` is an expansion: it maps a range of recorded values onto
 * another — the roll's floor of 35 to 20 and its loudest 54 to 46, say — where one that states a
 * `change` shifts each by the same amount. Its subject is the scale the roll recorded on, so the
 * case on disk is a call with no selector at all.
 *
 * Until November 2026 an expansion was a transformer of its own, `Expand`, and these were its
 * tests; `Modify.test.ts` has the shifts.
 */

const note = (id: string, over: Partial<AlignedNote> = {}): AlignedNote => ({
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

const velocities = (msm: Alignment) => msm.allNotes.map((n) => n.velocity);

const roll: ExpansionOptions = {
    scope: 'global',
    aspect: 'velocity',
    points: [
        [35, 20],
        [54, 46],
    ],
};

describe('the map the points draw', () => {
    test('passes through every point, and is linear between them', () => {
        const map = expansion([
            [35, 20],
            [45, 30],
            [54, 46],
        ])!;
        expect(map(35)).toBe(20);
        expect(map(40)).toBe(25);
        expect(map(45)).toBe(30);
        expect(map(54)).toBe(46);
    });

    test('carries the outermost lines on beyond the points', () => {
        const map = expansion(roll.points)!;
        expect(map(35 - 19)).toBeCloseTo(20 - 26);
        expect(map(54 + 19)).toBeCloseTo(46 + 26);
    });

    test('runs back the same way, beyond the points as well', () => {
        const points: ExpansionOptions['points'] = [
            [35, 20],
            [45, 30],
            [54, 46],
        ];
        const map = expansion(points)!;
        const back = inverseExpansion(points)!;
        for (const value of [10, 35, 40, 45, 50, 54, 70]) expect(back(map(value))).toBeCloseTo(value, 9);
    });

    test('has no way back where it does not rise throughout', () => {
        expect(inverseExpansion([[35, 20], [45, 30], [54, 25]])).toBeNull();
        expect(inverseExpansion([[35, 20], [54, 20]])).toBeNull();
    });

    test.each([
        ['one point', [[35, 20]]],
        ['recorded values that do not rise', [[54, 46], [35, 20]]],
        ['two points at one recorded value', [[35, 20], [35, 30]]],
        ['a value that is no number', [[35, 20], [Number.NaN, 46]]],
    ] as [string, ExpansionOptions['points']][])('draws none from %s', (_, points) => {
        expect(expansion(points)).toBeNull();
    });
});

describe('velocity, without a selector', () => {
    test('moves every note the further the softer it was recorded', () => {
        const msm = new Alignment([
            note('floor', { velocity: 35 }),
            note('middle', { velocity: 44.5 }),
            note('top', { velocity: 54 }),
        ]);
        run(new Modify(roll), msm);
        expect(velocities(msm)).toEqual([20, 33, 46]);
    });

    test('reaches only the notes of its part when it has one', () => {
        const msm = new Alignment([note('upper', { velocity: 35 }), note('lower', { part: 2, velocity: 35 })]);
        run(new Modify({ ...roll, scope: 1 }), msm);
        expect(velocities(msm)).toEqual([35, 20]);
    });

    test('does not take a note below silence', () => {
        const msm = new Alignment([note('a', { velocity: 2 })]);
        run(new Modify(roll), msm);
        expect(velocities(msm)).toEqual([0]);
    });

    test('leaves the pedals alone', () => {
        const msm = new Alignment([note('a', { velocity: 35 })]);
        msm.pedals = [pedal('p')];
        run(new Modify(roll), msm);
        expect(msm.pedals[0]).toEqual(pedal('p'));
    });
});

describe('velocity, with a selector', () => {
    test('a list of note ids reaches every reading of each and nothing else', () => {
        const msm = new Alignment([
            note('a', { velocity: 35, source: 'take1' }),
            note('a', { velocity: 54, source: 'take2' }),
            note('b', { velocity: 35 }),
        ]);
        run(new Modify({ ...roll, noteIDs: ['a'] }), msm);
        expect(velocities(msm)).toEqual([20, 46, 35]);
    });

    test('a stretch of ticks reaches the notes within it, both ends included', () => {
        const msm = new Alignment([
            note('before', { date: 0, velocity: 35 }),
            note('from', { date: 720, velocity: 35 }),
            note('to', { date: 1440, velocity: 35 }),
            note('after', { date: 2160, velocity: 35 }),
        ]);
        run(new Modify({ ...roll, from: 720, to: 1440 }), msm);
        expect(velocities(msm)).toEqual([35, 20, 20, 35]);
    });

    test('a list of pedals is reported, not stretched', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const msm = new Alignment([note('a', { velocity: 35 })]);
        msm.pedals = [pedal('p')];
        run(new Modify({ ...roll, pedalIDs: ['p'] }), msm);
        expect(velocities(msm)).toEqual([35]);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('not of a pedal'));
        error.mockRestore();
    });
});

describe('the timing aspects', () => {
    // Twice as slow, from the first note on: what a roll played at half its speed asks.
    const slower = (aspect: 'onset' | 'duration'): ExpansionOptions => ({
        scope: 'global',
        aspect,
        points: [
            [0, 0],
            [1000, 2000],
        ],
    });

    /** The first note at 0 ms, so its onset is the zero the points are measured from. */
    const first = () => note('first', { 'milliseconds.date': 0, 'milliseconds.date.end': 500 });

    test('onset moves every event without changing its length, the pedals with the notes', () => {
        const msm = new Alignment([first(), note('a', { 'milliseconds.date': 1000, 'milliseconds.date.end': 1500 })]);
        msm.pedals = [pedal('p', { 'milliseconds.date': 3000, 'milliseconds.date.end': 4000 })];
        run(new Modify(slower('onset')), msm);
        expect(msm.allNotes[1]).toMatchObject({ 'milliseconds.date': 2000, 'milliseconds.date.end': 2500 });
        expect(msm.pedals[0]).toMatchObject({ 'milliseconds.date': 6000, 'milliseconds.date.end': 7000 });
    });

    test('onset is measured from the first note, not from the start of the roll', () => {
        // The roll's leader: the first note sounds 28 seconds in.
        const msm = new Alignment([
            note('first', { 'milliseconds.date': 28000, 'milliseconds.date.end': 28500 }),
            note('a', { 'milliseconds.date': 29000, 'milliseconds.date.end': 29500 }),
        ]);
        run(new Modify(slower('onset')), msm);
        expect(msm.allNotes.map((n) => n['milliseconds.date'])).toEqual([28000, 30000]);
    });

    test('duration moves every release and keeps every attack', () => {
        const msm = new Alignment([note('a', { 'milliseconds.date': 1000, 'milliseconds.date.end': 1500 })]);
        msm.pedals = [pedal('p', { 'milliseconds.date': 3000, 'milliseconds.date.end': 4000 })];
        run(new Modify(slower('duration')), msm);
        expect(msm.allNotes[0]).toMatchObject({ 'milliseconds.date': 1000, 'milliseconds.date.end': 2000 });
        expect(msm.pedals[0]).toMatchObject({ 'milliseconds.date': 3000, 'milliseconds.date.end': 5000 });
    });

    test('both, with the same points, make the whole recording slower', () => {
        const msm = new Alignment([first(), note('a', { 'milliseconds.date': 1000, 'milliseconds.date.end': 1500 })]);
        run(new Modify(slower('onset')), msm);
        run(new Modify(slower('duration')), msm);
        expect(msm.allNotes[1]).toMatchObject({ 'milliseconds.date': 2000, 'milliseconds.date.end': 3000 });
    });

    test('a call on one part leaves the pedals, which belong to no part, where they are', () => {
        const msm = new Alignment([first(), note('a')]);
        msm.pedals = [pedal('p')];
        run(new Modify({ ...slower('onset'), scope: 0 }), msm);
        expect(msm.allNotes[1]['milliseconds.date']).toBe(2000);
        expect(msm.pedals[0]).toEqual(pedal('p'));
    });

    test('a note the recording never played is passed over', () => {
        const msm = new Alignment([note('a', { 'milliseconds.date': Number.NaN, 'milliseconds.date.end': Number.NaN })]);
        run(new Modify(slower('onset')), msm);
        expect(msm.allNotes[0]['milliseconds.date']).toBeNaN();
    });
});

describe('points that draw no map', () => {
    test('change nothing, and say why', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const msm = new Alignment([note('a', { velocity: 35 })]);
        run(new Modify({ ...roll, points: [[35, 20]] }), msm);
        expect(velocities(msm)).toEqual([35]);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('draws no map'));
        error.mockRestore();
    });
});

describe('where it acts', () => {
    const msm = new Alignment([note('a', { date: 720 }), note('b', { date: 2160 })]);

    test('without a selector, about no one place', () => {
        expect(new Modify(roll).range(msm)).toBeUndefined();
    });

    test('with a stretch of ticks, that stretch', () => {
        expect(new Modify({ ...roll, from: 0, to: 1440 }).range(msm)).toEqual({ from: 0, to: 1440 });
    });

    test('with notes, from the first to the last of them', () => {
        expect(new Modify({ ...roll, noteIDs: ['a', 'b'] }).range(msm)).toEqual({ from: 720, to: 2160 });
    });
});

describe('what it marks', () => {
    const msm = () => {
        const alignment = new Alignment([note('a'), note('b', { date: 720 })]);
        alignment.pedals = [pedal('p')];
        return alignment;
    };

    test('of velocity, the notes and no pedal, which has none', () => {
        expect(new Modify(roll).evidence(msm())).toEqual(['a', 'b']);
    });

    test('of the whole recording\'s time, the pedals with the notes', () => {
        const slower: ExpansionOptions = { scope: 'global', aspect: 'onset', points: [[0, 0], [1000, 2000]] };
        expect(new Modify(slower).evidence(msm())).toEqual(['a', 'b', 'p']);
    });
});

describe('a shift is the expansion that neither stretches nor squeezes', () => {
    const recorded = () => new Alignment([note('a', { velocity: 35 }), note('b', { velocity: 44 }), note('c', { velocity: 54 })]);

    test('so the two leave the same velocities', () => {
        const shifted = recorded();
        run(new Modify({ scope: 'global', aspect: 'velocity', change: -6, noteIDs: ['a', 'b', 'c'] }), shifted);

        const mapped = recorded();
        run(new Modify({ scope: 'global', aspect: 'velocity', points: [[35, 29], [54, 48]] }), mapped);

        expect(velocities(mapped)).toEqual(velocities(shifted));
    });

    test('and a shift, too, reaches every note where it names none', () => {
        const msm = recorded();
        run(new Modify({ scope: 'global', aspect: 'velocity', change: -6 }), msm);
        expect(velocities(msm)).toEqual([29, 38, 48]);
    });
});

describe('its place in the chain', () => {
    const points = [[35, 20], [54, 46]];

    /** The ids of the choice and the corrections, in the order the chain runs them. */
    const order = (provenance: Parameters<typeof buildChain>[0]) =>
        buildChain(provenance)
            .transformers.filter(({ name }) => ['MakeChoice', 'Modify'].includes(name))
            .map(({ id }) => id);

    test('is after the choice and before a shift, whatever order the file lists them in', () => {
        expect(
            order([
                { id: 'shift', name: 'Modify', options: { scope: 'global', aspect: 'velocity', change: -3, noteIDs: ['a'] } },
                { id: 'expansion', name: 'Modify', options: { scope: 'global', aspect: 'velocity', points } },
                { id: 'choice', name: 'MakeChoice', options: { prefer: 'take1' } },
            ]),
        ).toEqual(['choice', 'expansion', 'shift']);
    });

    test('and before a shift of a stretch that begins earlier in the score than its own', () => {
        expect(
            order([
                { id: 'shift', name: 'Modify', options: { scope: 'global', aspect: 'velocity', change: -3, from: 0, to: 720 } },
                { id: 'expansion', name: 'Modify', options: { scope: 'global', aspect: 'velocity', points, from: 1440, to: 2880 } },
            ]),
        ).toEqual(['expansion', 'shift']);
    });

    test('so a correction by hand keeps its size on the expanded scale', () => {
        const msm = new Alignment([note('a', { velocity: 35 })]);
        run(new Modify(roll), msm);
        run(new Modify({ scope: 'global', aspect: 'velocity', change: -6, noteIDs: ['a'] }), msm);
        expect(velocities(msm)).toEqual([14]);
    });

    test('a call survives the work file with its points', () => {
        const call = new Modify(roll);
        const work = { provenance: [{ id: call.id, name: call.name, options: call.options }] };
        const [read] = parseWorkFile(serializeWorkFile(work as unknown as WorkFile)).provenance;
        expect(read.options).toEqual(roll);
    });

    test('a call saved as an Expand, when that was a transformer, runs as the same expansion', () => {
        const older = { provenance: [{ id: 'older', name: 'Expand', options: roll }] };
        const { transformers, unknown } = buildChain(
            parseWorkFile(JSON.stringify(older)).provenance,
        );
        const read = transformers.find(({ id }) => id === 'older');

        expect(unknown).toEqual([]);
        expect(read).toBeInstanceOf(Modify);

        const msm = new Alignment([note('floor', { velocity: 35 }), note('top', { velocity: 54 })]);
        run(read as Modify, msm);
        expect(velocities(msm)).toEqual([20, 46]);
    });
});
