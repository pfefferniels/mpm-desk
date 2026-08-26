import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { outcomesOf, projectReconstruction } from './Reconstruction';
import { parseWorkFile } from './Work';
import { readPerformance } from '../utils/mpm';
import { readMeter } from '../utils/score';

/**
 * The viewer draws the tree from the work file and the MPM, with no chain.
 *
 * That only works because every call records the elements it wrote and the range it acted on.
 * This is the check that those recordings are actually there and actually sufficient: it runs the
 * projection exactly as `useReconstructionLoader` does, and compares the result against a
 * projection produced by a different pipeline on a different day.
 *
 * If it fails, the likely cause is a work file edited outside the editor without
 * `scripts/recordOutcomes.ts` being run over it.
 */
const work = parseWorkFile(readFileSync('public/work.json', 'utf-8'));
const performance = readPerformance(
    readFileSync('public/performance.mpm', 'utf-8'),
    readMeter(readFileSync('public/score.msm', 'utf-8')),
);

const project = () =>
    projectReconstruction({
        title: work.name,
        author: '',
        groupings: work.segments,
        outcomes: outcomesOf(work.provenance),
        elementTypes: new Map(
            performance.instructions.map((instruction) => [instruction.id, instruction.type]),
        ),
    });

describe('the projection the viewer derives', () => {
    it('needs no chain: every call carries what it wrote and where', () => {
        const withElements = work.provenance.filter((call) => call.elements?.length).length;
        const withRange = work.provenance.filter((call) => call.range).length;
        expect(withElements).toBeGreaterThan(400);
        expect(withRange).toBeGreaterThan(400);
    });

    it('reproduces the same segments and spans a full fit produces', () => {
        const { reconstruction, stats } = project();

        expect(reconstruction.segments).toHaveLength(128);

        const tally: Record<string, number> = {};
        for (const segment of reconstruction.segments)
            for (const span of segment.spans) tally[span.type] = (tally[span.type] ?? 0) + 1;

        expect(tally).toEqual({
            ornament: 98,
            movement: 100,
            dynamics: 61,
            tempo: 59,
            rubato: 56,
            accentuationPattern: 50,
            articulation: 26,
        });

        // The one call in no segment is the substituted `InsertMetadata`, which writes
        // `<metadata>` rather than an instruction. Nothing recorded should be unaccounted for.
        expect(stats.droppedElements).toBe(0);
    });

    it('gives every segment a word', () => {
        const { reconstruction } = project();
        for (const segment of reconstruction.segments) {
            expect((segment.note ?? '').trim().length, segment.id).toBeGreaterThan(0);
        }
    });

    it('leads every span with the element it is named for', () => {
        // The selection model, the popover and the tree all key on this.
        const { reconstruction } = project();
        for (const segment of reconstruction.segments)
            for (const span of segment.spans) expect(span.id).toBe(span.elements[0]);
    });
});
