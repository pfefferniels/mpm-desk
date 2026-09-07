import { describe, expect, test, vi } from 'vitest';
import { createMpm, type Mpm } from '../../../src/fitting/instructions/index';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../../src/fitting/alignment';
import {
    CorrectPedal,
    newPressId,
    type CorrectPedalOptions,
} from '../../../src/fitting/transformers/modification/CorrectPedal';
import { Modify } from '../../../src/fitting/transformers/modification/Modify';
import { getRange } from '../../../src/fitting/transformers/Transformer';
import { InsertTempo, TranslatePhysicalTimeToTicks } from '../../../src/fitting/transformers/tempo/index';
import { compareTransformers } from '../../../src/fitting/transformers/index';
import { buildChain } from '../../../src/fitting/chain';
import { deriveResidual } from '../../../src/fitting/residual';
import { parseWorkFile, serializeWorkFile, type WorkFile } from '../../../src/model/Work';
import type { Travel } from '../../../src/performance/pedalTravel';
import { buildScore, QUARTER } from '../roundtrip/score';

/**
 * `CorrectPedal` corrects the line a recorded pedal drew — the record `1dec582` made of a press.
 * `Modify` moves a press or its release; this replaces the line between them, adds a press the
 * roll lacks, or removes one the pianist did not make.
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

const line: Travel = [
    { ms: 0, position: 1 },
    { ms: 1500, position: 1 },
    { ms: 2000, position: 0 },
];

const redrawn: Travel = [
    { ms: 0, position: 0.5 },
    { ms: 200, position: 1 },
    { ms: 2800, position: 1 },
    { ms: 3000, position: 0 },
];

const pedal = (id: string, over: Partial<AlignedPedal> = {}): AlignedPedal => ({
    'xml:id': id,
    type: 'sustain',
    'milliseconds.date': 1000,
    'milliseconds.date.end': 3000,
    travel: line,
    ...over,
});

const withPresses = () => {
    const msm = new Alignment([note('a')]);
    msm.pedals = [pedal('p1'), pedal('p2', { 'milliseconds.date': 4000, 'milliseconds.date.end': 6000 })];
    return msm;
};

/** Call the protected `transform` method for testing */
const run = (transformer: CorrectPedal | Modify, msm: Alignment, mpm: Mpm = createMpm()) => {
    interface Transformable {
        transform(msm: Alignment, mpm: Mpm): void;
    }
    (transformer as unknown as Transformable).transform(msm, mpm);
};

describe('redrawing a press', () => {
    test('replaces its line and moves its release to where the line comes down', () => {
        const msm = withPresses();

        run(new CorrectPedal({ pedal: 'p1', travel: redrawn }), msm);

        expect(msm.pedals[0]?.travel).toBe(redrawn);
        expect(msm.pedals[0]?.['milliseconds.date']).toBe(1000);
        expect(msm.pedals[0]?.['milliseconds.date.end']).toBe(4000);
        expect(msm.pedals[1]?.travel).toBe(line);
    });

    test('reaches every reading under the id', () => {
        const msm = new Alignment([note('a')]);
        msm.pedals = [pedal('p1', { source: 'take1' }), pedal('p1', { source: 'take2' })];

        run(new CorrectPedal({ pedal: 'p1', travel: redrawn }), msm);

        expect(msm.pedals.every((p) => p.travel === redrawn)).toBe(true);
    });

    test('leaves the copy it was cloned from as it was', () => {
        // The worker keeps a pristine alignment and clones it for every fit; the clone shares
        // the travel arrays with it, so a correction that wrote into one would outlive the fit.
        const pristine = withPresses();
        const fitted = pristine.deepClone();

        run(new CorrectPedal({ pedal: 'p1', travel: redrawn }), fitted);

        expect(pristine.pedals[0]?.travel).toBe(line);
        expect(line).toHaveLength(3);
        expect(pristine.pedals[0]?.['milliseconds.date.end']).toBe(3000);
    });

    test('skips an id nobody has', () => {
        const msm = withPresses();

        run(new CorrectPedal({ pedal: 'gone', travel: redrawn }), msm);

        expect(msm.pedals.map((p) => p.travel)).toEqual([line, line]);
    });

    test('reports a line that is not a press and changes nothing', () => {
        const msm = withPresses();
        const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        run(new CorrectPedal({ pedal: 'p1', travel: [{ ms: 0, position: 1 }] }), msm);

        expect(reported).toHaveBeenCalled();
        expect(msm.pedals[0]?.travel).toBe(line);
        reported.mockRestore();
    });

    test('keeps a line that touches rest on the way as one press, released at its end', () => {
        const msm = withPresses();
        const retaken: Travel = [
            { ms: 0, position: 1 },
            { ms: 800, position: 0 },
            { ms: 1000, position: 1 },
            { ms: 2500, position: 0 },
        ];

        run(new CorrectPedal({ pedal: 'p1', travel: retaken }), msm);

        expect(msm.pedals).toHaveLength(2);
        expect(msm.pedals[0]?.['milliseconds.date.end']).toBe(3500);
    });
});

describe('removing a press', () => {
    test('drops it and leaves its neighbour', () => {
        const msm = withPresses();

        run(new CorrectPedal({ pedal: 'p1', remove: true }), msm);

        expect(msm.pedals.map((p) => p['xml:id'])).toEqual(['p2']);
    });
});

describe('adding a press the roll lacks', () => {
    const added = (over: Partial<CorrectPedalOptions> = {}): CorrectPedalOptions => ({
        pedal: newPressId(),
        type: 'soft',
        source: 'take1',
        onsetMs: 7000,
        travel: redrawn,
        ...over,
    });

    test('creates it under the id the call gives it, released where its line ends', () => {
        const msm = withPresses();
        const options = added();

        run(new CorrectPedal(options), msm);

        const press = msm.pedals.at(-1);
        expect(press?.['xml:id']).toBe(options.pedal);
        expect(press?.type).toBe('soft');
        expect(press?.source).toBe('take1');
        expect(press?.['milliseconds.date']).toBe(7000);
        expect(press?.['milliseconds.date.end']).toBe(10000);
        expect(press?.travel).toBe(redrawn);
    });

    test('counts it under no take when none is given', () => {
        const msm = withPresses();

        run(new CorrectPedal(added({ source: undefined })), msm);

        expect('source' in (msm.pedals.at(-1) ?? {})).toBe(false);
    });

    test('mints an id of its own shape', () => {
        expect(newPressId()).toMatch(/^pedal-[0-9a-f-]{36}$/);
        expect(newPressId()).not.toBe(newPressId());
    });

    test('refuses an id a press already has', () => {
        const msm = withPresses();
        const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        run(new CorrectPedal(added({ pedal: 'p1' })), msm);

        expect(reported).toHaveBeenCalled();
        expect(msm.pedals).toHaveLength(2);
        reported.mockRestore();
    });

    test('a displacement can then reach it', () => {
        const msm = withPresses();
        const options = added();

        run(new CorrectPedal(options), msm);
        run(new Modify({ scope: 'global', aspect: 'onset', change: -500, pedalIDs: [options.pedal] }), msm);

        expect(msm.pedals.at(-1)?.['milliseconds.date']).toBe(6500);
        expect(msm.pedals.at(-1)?.['milliseconds.date.end']).toBe(9500);
    });
});

describe('its place in the chain', () => {
    test('is after the choice and before a displacement, whatever order the file lists them in', () => {
        const options = { pedal: newPressId(), type: 'sustain', onsetMs: 7000, travel: redrawn };
        const { transformers } = buildChain([
            { id: 'modify', name: 'Modify', options: { scope: 'global', aspect: 'onset', change: 1, pedalIDs: [options.pedal] } },
            { id: 'add', name: 'CorrectPedal', options },
            { id: 'choice', name: 'MakeChoice', options: { prefer: 'take1' } },
        ]);

        const corrections = transformers
            .map((transformer) => transformer.name)
            .filter((name) => ['MakeChoice', 'CorrectPedal', 'Modify'].includes(name));
        expect(corrections).toEqual(['MakeChoice', 'CorrectPedal', 'Modify']);
    });

    test('a call survives the work file with its vertices', () => {
        const call = new CorrectPedal({ pedal: 'p1', travel: redrawn });
        const work = { provenance: [{ id: call.id, name: call.name, options: call.options }], segments: [] };

        const reopened = parseWorkFile(serializeWorkFile(work as unknown as WorkFile));

        expect(reopened.provenance[0]?.options).toEqual({ pedal: 'p1', travel: redrawn });
    });
});

describe('where a correction is placed', () => {
    // Half a second to the quarter, so 120 bpm is the tempo the milliseconds describe, as in
    // the pedal round-trip case; a press of one second is then two quarters of the grid.
    const placedScore = () => {
        const score = buildScore({ beats: 8 });
        for (const n of score.allNotes) {
            const onset = (n.date / QUARTER) * 500;
            n['milliseconds.date'] = onset;
            n['milliseconds.date.end'] = onset + 500;
            n.velocity = 64;
        }
        score.pedals = [pedal('ped0', { 'milliseconds.date': 0, 'milliseconds.date.end': 1000, travel: [{ ms: 0, position: 1 }, { ms: 1000, position: 0 }] })];
        const mpm = createMpm();
        const chain = [
            new InsertTempo({ scope: 'global', from: 0, to: 7 * QUARTER, bpm: 120, beatLength: 0.25 }),
            new TranslatePhysicalTimeToTicks({ translatePhysicalModifiers: true, translatePedalling: true }),
        ].sort(compareTransformers);
        for (const transformer of chain) transformer.run(score, mpm);
        return { score, residual: deriveResidual(score, mpm) };
    };

    test('a redraw spans the press it is about', () => {
        const { score, residual } = placedScore();

        expect(getRange(new CorrectPedal({ pedal: 'ped0', travel: redrawn }).options, score, residual))
            .toEqual({ from: 0, to: 2 * QUARTER });
    });

    test('a removal has no press left to be placed by', () => {
        // Placed as the fit places every call: over the recording as the chain left it.
        const { score, residual } = placedScore();
        const removal = new CorrectPedal({ pedal: 'ped0', remove: true });
        run(removal, score);

        expect(getRange(removal.options, score, residual)).toBeUndefined();
    });

    test('there is no place before a base text is chosen, and no error either', () => {
        const { score } = placedScore();

        expect(getRange(new CorrectPedal({ pedal: 'ped0', travel: redrawn }).options, score)).toBeUndefined();
    });
});
