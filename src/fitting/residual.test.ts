import { beforeEach, describe, expect, it } from 'vitest';
import { Alignment, type AlignedNote } from './alignment';
import { clearResidualCache, deriveResidual, residualStats } from './residual';
import { createMpm, getInstructions } from './instructions/index';
import { InsertTempo } from './transformers/tempo/InsertTempo';
import { InsertMetricalAccentuation } from './transformers/accentuation/InsertMetricalAccentuation';
import { InsertDynamicsInstructions } from './transformers/dynamics/InsertDynamicsInstructions';
import { PULSES_PER_QUARTER } from './ppq';

/**
 * The residual is cached twice over — once on the whole probe document, once on just the tempo
 * and rubato maps the tick walk reads — and both caches are module state that a fold writes
 * through. What follows is the part that has to be true for that to be an optimisation rather
 * than a bug: the caches must answer differently when the answer is different.
 *
 * The gate (`scripts/verifyChain.ts`) proves the caches change no output over the real 494-call
 * reconstruction. These prove *why*, on cases small enough to reason about.
 */

const BEAT = PULSES_PER_QUARTER;

/** Sixteen notes at a steady 500 ms apart, swelling, so both halves of a residual have work. */
const buildAlignment = () => {
    const notes: AlignedNote[] = Array.from({ length: 16 }, (_, i) => ({
        'xml:id': `n_${String(i)}`,
        part: 1,
        date: i * BEAT,
        duration: BEAT,
        pitchname: 'g',
        accidentals: 0,
        octave: 4,
        'midi.pitch': 67,
        'milliseconds.date': i * 500,
        'milliseconds.date.end': i * 500 + 400,
        velocity: 50 + i,
    }));
    return new Alignment(notes, { numerator: 4, denominator: 4 });
};

describe('deriveResidual caching', () => {
    beforeEach(() => {
        clearResidualCache();
    });

    it('answers a repeated question from cache, without deriving again', () => {
        const msm = buildAlignment();
        const mpm = createMpm();
        new InsertTempo({ scope: 'global', from: 0, to: 16 * BEAT, bpm: 120, beatLength: 0.25 }).run(
            msm,
            mpm,
        );

        const first = deriveResidual(msm, mpm, { without: ['rubato'] });
        const second = deriveResidual(msm, mpm, { without: ['rubato'] });

        expect(second).toBe(first);
        expect(residualStats.asks).toBe(2);
        expect(residualStats.hits).toBe(1);
    });

    it('does NOT reuse a residual once the tempo has changed', () => {
        const msm = buildAlignment();
        const mpm = createMpm();
        new InsertTempo({ scope: 'global', from: 0, to: 16 * BEAT, bpm: 120, beatLength: 0.25 }).run(
            msm,
            mpm,
        );
        const at120 = deriveResidual(msm, mpm, { without: ['rubato'] });
        const ticksAt120 = at120.notes.map((n) => n.tickDate);

        new InsertTempo({ scope: 'global', from: 0, to: 16 * BEAT, bpm: 60, beatLength: 0.25 }).run(
            msm,
            mpm,
        );
        const at60 = deriveResidual(msm, mpm, { without: ['rubato'] });

        expect(at60).not.toBe(at120);
        // The whole point: halving the tempo moves where a recorded onset lands on the grid.
        expect(at60.notes.map((n) => n.tickDate)).not.toEqual(ticksAt120);
    });

    it('reuses the tick walk when only a header def changed, and still re-renders', () => {
        // This is the 76-hit case from the real run. `InsertMetricalAccentuation` writes an
        // `<accentuationPatternDef>` into the header, which `withoutMaps` does not remove — so the
        // probe text differs on every call while the tempo and rubato maps have not moved.
        const msm = buildAlignment();
        const mpm = createMpm();
        new InsertTempo({ scope: 'global', from: 0, to: 16 * BEAT, bpm: 120, beatLength: 0.25 }).run(
            msm,
            mpm,
        );
        new InsertDynamicsInstructions({
            scope: 'global',
            from: 0,
            to: 16 * BEAT,
            phantomVelocities: new Map(),
        }).run(msm, mpm);

        deriveResidual(msm, mpm, { without: ['accentuationPattern'] });
        const ticksBefore = residualStats.ticksMs;
        const tickHitsBefore = residualStats.tickHits;

        new InsertMetricalAccentuation({
            scope: 'global',
            name: 'first',
            from: 0,
            to: 4 * BEAT,
            beatLength: 0.25,
            scaleTolerance: 0.5,
        }).run(msm, mpm);

        deriveResidual(msm, mpm, { without: ['accentuationPattern'] });

        // A def landed in the header, so the probe changed and the residual was re-derived …
        expect(residualStats.hits).toBe(0);
        // … but the tempo and rubato maps did not, so the tick walk was not repeated. More than
        // one hit, because `InsertMetricalAccentuation` derives a residual of its own as it runs
        // — which is the very ask this cache exists to make cheap.
        expect(residualStats.tickHits).toBeGreaterThan(tickHitsBefore);
        expect(residualStats.ticksMs).toBeGreaterThanOrEqual(ticksBefore);
        expect(getInstructions(mpm, 'accentuationPattern').length).toBeGreaterThan(0);
    });

    it('does not answer one alignment from another alignment’s cache', () => {
        // Identity, not equality: `MakeChoice` and `Modify` write through the alignment, so two
        // alignments can hold the same MPM and owe different residuals.
        const mpm = createMpm();
        const a = buildAlignment();
        new InsertTempo({ scope: 'global', from: 0, to: 16 * BEAT, bpm: 120, beatLength: 0.25 }).run(
            a,
            mpm,
        );
        const forA = deriveResidual(a, mpm, { without: ['rubato'] });

        const b = buildAlignment();
        for (const note of b.allNotes) note['milliseconds.date'] += 250;
        const forB = deriveResidual(b, mpm, { without: ['rubato'] });

        expect(forB).not.toBe(forA);
    });

    it('clearResidualCache forgets the document and zeroes the counters', () => {
        const msm = buildAlignment();
        const mpm = createMpm();
        new InsertTempo({ scope: 'global', from: 0, to: 16 * BEAT, bpm: 120, beatLength: 0.25 }).run(
            msm,
            mpm,
        );
        const first = deriveResidual(msm, mpm, { without: ['rubato'] });

        clearResidualCache();
        expect(residualStats.asks).toBe(0);

        const afterClear = deriveResidual(msm, mpm, { without: ['rubato'] });
        expect(afterClear).not.toBe(first);
        expect(residualStats.hits).toBe(0);
    });
});
