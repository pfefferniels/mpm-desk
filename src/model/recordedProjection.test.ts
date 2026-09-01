import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { outcomesOf, projectReconstruction } from './Reconstruction';
import { parseWorkFile } from './Work';
import { readPerformance } from '../utils/mpm';
import { beatTicksAt, readMeter } from '../utils/score';

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
        claims: work.segments,
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

        // 97 rather than 98: the piece-wide `InsertDynamicsGradient` sweep is claimed under
        // „[Pauschale Werte, vorläufig]", which reports no range and so is drawn nowhere.
        expect(tally).toEqual({
            ornament: 97,
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

    /**
     * A claim is about a spot in the piece, so what it holds has to be at that spot.
     *
     * The one way this breaks is a transformer whose bulk form sweeps the whole score —
     * `InsertDynamicsGradient` with no `date` fits every arpeggio in the piece, and
     * `StylizeOrnamentation` reshapes every ornament. Such a call reports no range, so the
     * projection gives its span the *segment's* stretch, and the drawing looks right while the
     * claim quietly owns instructions from bar 1 to the last bar. That is what `elementOwners`
     * reads, so the word lights up across the whole performance during playback, and it is what
     * `InstructionAttributes` quotes when the lane is pointed at.
     *
     * It happened: the sweep was claimed under its own „[Pauschale Werte, vorläufig]" until a
     * consolidation pass dissolved that claim and left the call on „Beruhigen", a gesture at
     * 84960. So the bound is deliberately loose — two bars, against a piece of thirty-odd —
     * because what it has to catch is a claim reaching across the whole score, not a beat of
     * overhang.
     */
    it('keeps a claim at the spot it is drawn at', () => {
        const { reconstruction } = project();
        const dateById = new Map(
            performance.instructions.map((instruction) => [instruction.id, instruction.date]),
        );
        const beat = beatTicksAt(performance.meter, 0);
        const slack = 8 * beat;

        for (const segment of reconstruction.segments)
            for (const span of segment.spans)
                for (const id of span.elements) {
                    const date = dateById.get(id);
                    if (date === undefined) continue;
                    // An `accentuationPattern` is in force until the next one, so four of them
                    // legitimately start a beat or two past the claim they belong to.
                    expect(
                        Math.max(segment.from - date, date - segment.to, 0),
                        `${segment.note ?? segment.id} is drawn over ${String(segment.from)}..${String(segment.to)} but holds ${id} at ${String(date)}`,
                    ).toBeLessThanOrEqual(slack);
                }
    });
});
