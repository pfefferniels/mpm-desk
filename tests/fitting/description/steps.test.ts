/**
 * The fitted steps as transformers: what one is answerable for, as the chain asks it.
 */
import { describe, expect, it } from 'vitest';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';
import { FitTempo } from '../../../src/fitting/description/steps';
import { createMpm, exportMPM } from '../../../src/fitting/instructions/index';
import { InsertTempo } from '../../../src/fitting/transformers/index';

/** A quarter every second. */
const note = (id: string, date: number): AlignedNote =>
    ({
        'xml:id': id,
        part: 1,
        date,
        duration: 720,
        'midi.pitch': 60,
        'milliseconds.date': (date / 720) * 1000,
        'milliseconds.date.end': (date / 720) * 1000 + 500,
        velocity: 40,
    }) as AlignedNote;

describe('FitTempo', () => {
    it('is answerable for the tempo it fitted, not for the one its call wrote back at its end', () => {
        const msm = new Alignment(
            [0, 720, 1440, 2160, 2880].map((date) => note(`n${date}`, date)),
            [],
        );
        const mpm = createMpm();
        // A tempo stands in the middle of the two beats that are fitted, and none where they end:
        // `InsertTempo` removes it, and writes the tempo that was in force back on the end.
        new InsertTempo({ scope: 'global', from: 720, to: 2880, bpm: 90, beatLength: 0.25 }).run(
            msm,
            mpm,
        );
        const fitted = new FitTempo({
            scope: 'global',
            from: 0,
            to: 1440,
            beatLength: 0.25,
            shape: 'steady',
        });
        fitted.run(msm, mpm);

        expect(exportMPM(mpm)).toContain(
            '<tempo date="1440" bpm="90" beatLength="0.25" xml:id="tempo_1440"',
        );
        expect(fitted.fitted).toMatchObject({ from: 0, to: 1440, bpm: 60 });
        expect(fitted.created).toEqual(['tempo_0']);
    });
});
