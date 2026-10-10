import { describe, expect, test } from 'vitest';
import { createMpm } from '../../../src/fitting/instructions/index';
import type { AlignedPedal } from '../../../src/fitting/alignment';
import { InsertPedal } from '../../../src/fitting/transformers/pedal/InsertPedalInstructions';
import { InsertTempo, TranslatePhysicalTimeToTicks } from '../../../src/fitting/transformers/tempo/index';
import { compareTransformers } from '../../../src/fitting/transformers/index';
import { deriveResidual } from '../../../src/fitting/residual';
import { buildScore, QUARTER } from '../roundtrip/score';

const press = (id: string, from: number, to: number): AlignedPedal => ({
    'xml:id': id,
    type: 'sustain',
    'milliseconds.date': from,
    'milliseconds.date.end': to,
});

describe('where a pedal call is placed', () => {
    // Half a second to the quarter at 120 bpm, so a press of one second spans two quarters.
    const placedScore = () => {
        const score = buildScore({ beats: 8 });
        for (const n of score.allNotes) {
            const onset = (n.date / QUARTER) * 500;
            n['milliseconds.date'] = onset;
            n['milliseconds.date.end'] = onset + 500;
            n.velocity = 64;
        }
        score.pedals = [press('ped0', 0, 1000), press('ped1', 1500, 2500)];
        const mpm = createMpm();
        const chain = [
            new InsertTempo({ scope: 'global', from: 0, to: 7 * QUARTER, bpm: 120, beatLength: 0.25 }),
            new TranslatePhysicalTimeToTicks({ translatePhysicalModifiers: true }),
        ].sort(compareTransformers);
        for (const transformer of chain) transformer.run(score, mpm);
        return { score, residual: deriveResidual(score, mpm) };
    };

    test('a call naming a press spans that press', () => {
        const { score, residual } = placedScore();

        expect(new InsertPedal({ pedal: 'ped1' }).range(score, residual))
            .toEqual({ from: 3 * QUARTER, to: 5 * QUARTER });
    });

    test('a call naming no press spans every press', () => {
        const { score, residual } = placedScore();

        expect(new InsertPedal().range(score, residual)).toEqual({ from: 0, to: 5 * QUARTER });
    });

    test('a ramp spans the ramp, hung on the end it names', () => {
        const { score, residual } = placedScore();
        const ramp = new InsertPedal({ pedal: 'ped0', start: 10, duration: 100, direction: 'up' });

        expect(ramp.range(score, residual)).toEqual({ from: 2 * QUARTER + 10, to: 2 * QUARTER + 110 });
    });
});
