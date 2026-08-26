/**
 * What a segment turns out to hold, once the narrative is read off the calls.
 *
 * The point of the whole shape is that a transformer which writes no MPM instruction is not part
 * of the narrative — and that this needs no list of names anywhere. So the first test is a
 * `Modify` and a `MakeChoice` sitting in a real segment and contributing nothing to it.
 */
import { describe, expect, it } from 'vitest';
import type { Call, Segment } from '../../model/Work';
import { gatherInstructions } from './gather';

const call = (id: string, name: string, extra: Partial<Call> = {}): Call => ({
    id,
    name,
    options: {},
    ...extra,
});

const types = (entries: Record<string, string>) => new Map(Object.entries(entries));
const segments = (...ids: string[]): Segment[] => ids.map((id) => ({ id }));

describe('gathering a segment’s instructions', () => {
    it('leaves out the calls that write no instruction, without knowing their names', () => {
        const { bySegment } = gatherInstructions(
            segments('s1'),
            [
                call('m', 'Modify', { segment: 's1' }),
                call('c', 'MakeChoice', { segment: 's1' }),
                call('t', 'InsertTempo', { segment: 's1', elements: ['tempo_0'] }),
            ],
            types({ tempo_0: 'tempo' }),
        );

        expect(bySegment.get('s1')?.instructions.map((i) => i.id)).toEqual(['tempo_0']);
    });

    it('marks an instruction another call wrote first as reshaped, not written', () => {
        // `StylizeOrnamentation` in miniature: it is answerable for the ornament because the diff
        // sees it change, and it is not what put it there.
        const { bySegment } = gatherInstructions(
            segments('s1', 's2'),
            [
                call('spread', 'InsertTemporalSpread', {
                    segment: 's1',
                    elements: ['ornament_0'],
                }),
                call('stylize', 'StylizeOrnamentation', {
                    segment: 's2',
                    elements: ['ornament_0'],
                }),
            ],
            types({ ornament_0: 'ornament' }),
        );

        expect(bySegment.get('s1')?.instructions[0]).toMatchObject({ written: true });
        expect(bySegment.get('s2')?.instructions[0]).toMatchObject({
            written: false,
            callName: 'StylizeOrnamentation',
        });
    });

    it('counts an instruction the document no longer holds instead of showing it', () => {
        const { bySegment } = gatherInstructions(
            segments('s1'),
            [
                call('a', 'InsertMetricalAccentuation', {
                    segment: 's1',
                    elements: ['accentuationPattern_0', 'accentuationPattern_gone'],
                }),
            ],
            types({ accentuationPattern_0: 'accentuationPattern' }),
        );

        expect(bySegment.get('s1')).toMatchObject({ overwritten: 1 });
        expect(bySegment.get('s1')?.instructions.map((i) => i.id)).toEqual([
            'accentuationPattern_0',
        ]);
    });

    it('shows an instruction two calls of one segment share exactly once', () => {
        // The two ends of adjacent ramps: `dynamics_720` closes one and opens the next. Within a
        // segment that is one chip; the chip selects the call that wrote it.
        const { bySegment } = gatherInstructions(
            segments('s1'),
            [
                call('a', 'InsertDynamicsInstructions', {
                    segment: 's1',
                    elements: ['dynamics_0', 'dynamics_720'],
                }),
                call('b', 'InsertDynamicsInstructions', {
                    segment: 's1',
                    elements: ['dynamics_720', 'dynamics_1440'],
                }),
            ],
            types({ dynamics_0: 'dynamics', dynamics_720: 'dynamics', dynamics_1440: 'dynamics' }),
        );

        expect(bySegment.get('s1')?.instructions.map((i) => i.id)).toEqual([
            'dynamics_0',
            'dynamics_720',
            'dynamics_1440',
        ]);
    });

    it('still shows a shared instruction under both segments that claim it', () => {
        const { bySegment } = gatherInstructions(
            segments('s1', 's2'),
            [
                call('a', 'InsertDynamicsInstructions', {
                    segment: 's1',
                    elements: ['dynamics_0', 'dynamics_720'],
                }),
                call('b', 'InsertDynamicsInstructions', {
                    segment: 's2',
                    elements: ['dynamics_720', 'dynamics_1440'],
                }),
            ],
            types({ dynamics_0: 'dynamics', dynamics_720: 'dynamics', dynamics_1440: 'dynamics' }),
        );

        expect(bySegment.get('s1')?.instructions.map((i) => i.id)).toEqual([
            'dynamics_0',
            'dynamics_720',
        ]);
        // The end of one ramp is the start of the next. Both claims are about it, and the second
        // is told it did not write it.
        expect(bySegment.get('s2')?.instructions.map((i) => [i.id, i.written])).toEqual([
            ['dynamics_720', false],
            ['dynamics_1440', true],
        ]);
    });

    it('puts what an unassigned call wrote in the ungrouped list', () => {
        const { bySegment, ungrouped } = gatherInstructions(
            segments('s1'),
            [
                call('t', 'InsertTempo', { elements: ['tempo_0'] }),
                // A segment the file no longer holds is the same state as none at all.
                call('r', 'InsertRubato', { segment: 'gone', elements: ['rubato_0'] }),
                call('m', 'Modify', {}),
            ],
            types({ tempo_0: 'tempo', rubato_0: 'rubato' }),
        );

        expect(ungrouped.map((i) => i.id)).toEqual(['tempo_0', 'rubato_0']);
        expect(bySegment.get('s1')?.instructions).toEqual([]);
    });
});
