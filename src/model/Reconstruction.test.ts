import { describe, expect, it } from 'vitest';
import { projectReconstruction, type CallOutcome, type SegmentClaim } from './Reconstruction';

const types = (entries: Record<string, string>) => new Map(Object.entries(entries));

const project = (params: {
    claims: SegmentClaim[];
    outcomes: CallOutcome[];
    elementTypes: Record<string, string>;
}) =>
    projectReconstruction({
        title: 'T',
        author: 'A',
        claims: params.claims,
        outcomes: params.outcomes,
        elementTypes: types(params.elementTypes),
    });

describe('projectReconstruction', () => {
    it('spans one segment over the union of its calls’ ranges', () => {
        const { reconstruction } = project({
            claims: [{ id: 's1' }],
            outcomes: [
                { id: 'a', segment: 's1', elements: ['tempo_0'], range: { from: 0, to: 720 } },
                { id: 'b', segment: 's1', elements: ['rubato_400'], range: { from: 400, to: 1440 } },
            ],
            elementTypes: { tempo_0: 'tempo', rubato_400: 'rubato' },
        });

        expect(reconstruction.segments).toHaveLength(1);
        expect(reconstruction.segments[0]).toMatchObject({ from: 0, to: 1440 });
        expect(reconstruction.segments[0].spans.map((s) => s.type).sort()).toEqual([
            'rubato',
            'tempo',
        ]);
    });

    it('gives a date-only call a span at that date, not a zero-width hole', () => {
        const { reconstruction } = project({
            claims: [{ id: 's1' }],
            outcomes: [{ id: 'a', segment: 's1', elements: ['ornament_41040'], range: { from: 41040, to: null } }],
            elementTypes: { ornament_41040: 'ornament' },
        });

        const [segment] = reconstruction.segments;
        expect(segment.from).toBe(41040);
        expect(segment.to).toBe(41040);
        expect(segment.spans[0]).toMatchObject({ from: 41040, to: 41040, type: 'ornament' });
    });

    it('drops element ids a later call removed from the document, and counts them', () => {
        const { reconstruction, stats } = project({
            claims: [{ id: 's1' }],
            outcomes: [
                { id: 'a', segment: 's1', elements: ['tempo_0', 'tempo_gone'], range: { from: 0, to: 720 } },
            ],
            elementTypes: { tempo_0: 'tempo' },
        });

        expect(reconstruction.segments[0].spans[0].elements).toEqual(['tempo_0']);
        expect(stats.droppedElements).toBe(1);
    });

    it('leaves out a group whose every element was removed again', () => {
        const { reconstruction, stats } = project({
            claims: [{ id: 's1' }],
            outcomes: [{ id: 'a', segment: 's1', elements: ['gone'], range: { from: 0, to: 10 } }],
            elementTypes: {},
        });

        expect(reconstruction.segments).toHaveLength(0);
        expect(stats.emptySegments).toBe(1);
        expect(stats.droppedSpans).toBe(1);
    });

    it('folds a call repeated verbatim into one span rather than two identical lanes', () => {
        const { reconstruction } = project({
            claims: [{ id: 's1' }],
            outcomes: [
                { id: 'a', segment: 's1', elements: ['tempo_0'], range: { from: 0, to: 720 } },
                { id: 'b', segment: 's1', elements: ['tempo_0'], range: { from: 0, to: 1440 } },
            ],
            elementTypes: { tempo_0: 'tempo' },
        });

        const [segment] = reconstruction.segments;
        expect(segment.spans).toHaveLength(1);
        expect(segment.spans[0]).toMatchObject({ from: 0, to: 1440 });
    });

    it('counts calls belonging to no segment', () => {
        const { stats } = project({
            claims: [{ id: 's1' }],
            outcomes: [
                { id: 'a', segment: 's1', elements: ['tempo_0'], range: { from: 0, to: 720 } },
                { id: 'orphan', elements: ['tempo_1'], range: { from: 0, to: 720 } },
            ],
            elementTypes: { tempo_0: 'tempo', tempo_1: 'tempo' },
        });

        expect(stats.ungroupedCalls).toBe(1);
    });

    it('leaves out a group where no call reported a range, and counts it', () => {
        const { reconstruction, stats } = project({
            claims: [{ id: 's1' }],
            outcomes: [{ id: 'a', segment: 's1', elements: ['ornament_9'], range: null }],
            elementTypes: { ornament_9: 'ornament' },
        });

        expect(reconstruction.segments).toHaveLength(0);
        expect(stats.placelessSegments).toBe(1);
    });

    it('gives a rangeless call the segment’s own stretch, never Infinity', () => {
        const { reconstruction } = project({
            claims: [{ id: 's1' }],
            outcomes: [
                // Declared first, so a one-pass projection would read the segment range while
                // it was still Infinity. This is the regression that motivated two passes.
                { id: 'wide', segment: 's1', elements: ['gradient_0'], range: null },
                { id: 'placed', segment: 's1', elements: ['tempo_0'], range: { from: 720, to: 1440 } },
            ],
            elementTypes: { gradient_0: 'ornament', tempo_0: 'tempo' },
        });

        const [segment] = reconstruction.segments;
        expect(segment).toMatchObject({ from: 720, to: 1440 });
        for (const span of segment.spans) {
            expect(Number.isFinite(span.from)).toBe(true);
            expect(Number.isFinite(span.to)).toBe(true);
            expect(span.to).toBeGreaterThanOrEqual(span.from);
        }
        expect(segment.spans.find((s) => s.id === 'gradient_0')).toMatchObject({
            from: 720,
            to: 1440,
        });
    });

    it('carries the narrative through', () => {
        const { reconstruction } = project({
            claims: [{ id: 's1', note: '„Hineinfallen“ — durch gedachtes Portamento' }],
            outcomes: [{ id: 'a', segment: 's1', elements: ['rubato_0'], range: { from: 0, to: 720 } }],
            elementTypes: { rubato_0: 'rubato' },
        });

        expect(reconstruction.segments[0]).toMatchObject({
            note: '„Hineinfallen“ — durch gedachtes Portamento',
        });
    });


    it('never emits a segment whose end precedes its start', () => {
        const { reconstruction } = project({
            claims: [{ id: 's1' }],
            outcomes: [{ id: 'a', segment: 's1', elements: ['tempo_5'], range: { from: 500, to: null } }],
            elementTypes: { tempo_5: 'tempo' },
        });

        const [segment] = reconstruction.segments;
        expect(segment.to).toBeGreaterThanOrEqual(segment.from);
    });
});
