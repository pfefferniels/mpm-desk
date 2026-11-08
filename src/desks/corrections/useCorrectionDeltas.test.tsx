import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import type { Call } from '../../model/Work';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { useCorrectionDeltas } from './useCorrectionDeltas';

/**
 * The ghosts: which events the chain has already corrected, and by how much — by hand or by an
 * expansion of the scale.
 *
 * Two desks read it: the corrections desk while it has a call in flight, the dynamics desk with
 * nothing in flight ever. What it must not do is count a call twice. A correction sent but not
 * yet answered by a fit is in the chain *and* drawn optimistically on the plot, which would put
 * the ghost on the wrong side of the dot until the fit came back.
 */

const note = (id: string, date: number): AlignedNote => ({
    'xml:id': id,
    part: 1,
    staff: '1',
    layer: '1',
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': date,
    'milliseconds.date.end': date + 500,
    'midi.pitch': 60,
    velocity: 64,
});

const msm = new Alignment([note('a', 0), note('b', 720), note('c', 1440)]);

const call = (options: Record<string, unknown>, name = 'Modify'): Call => ({
    id: `call_${JSON.stringify(options)}`,
    name,
    options,
});

const wrapperFor = (calls: readonly Call[]) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return (
            <CallSelectionProvider
                calls={calls}
                outcomes={[]}
                activeCallIds={new Set()}
                setActiveCallIds={vi.fn()}
                onRemoveCalls={vi.fn()}
                focusCall={vi.fn()}
            >
                {children}
            </CallSelectionProvider>
        );
    };

const deltas = (
    calls: readonly Call[],
    aspect: 'velocity' | 'onset' | 'duration' = 'velocity',
    pending?: Parameters<typeof useCorrectionDeltas>[3],
    unfitted?: string,
    on: Alignment = msm,
) =>
    renderHook(() => useCorrectionDeltas(on, 'global', aspect, pending, unfitted), {
        wrapper: wrapperFor(calls),
    }).result.current;

describe('what counts', () => {
    it('sums the corrections a list of ids names', () => {
        const result = deltas([
            call({ scope: 'global', aspect: 'velocity', change: -3, noteIDs: ['a'] }),
            call({ scope: 'global', aspect: 'velocity', change: -2, noteIDs: ['a', 'b'] }),
        ]);

        expect([...result]).toEqual([
            ['a', -5],
            ['b', -2],
        ]);
    });

    it('resolves a stretch of the score to the notes inside it', () => {
        const result = deltas([call({ scope: 'global', aspect: 'velocity', change: 4, from: 0, to: 720 })]);

        expect([...result]).toEqual([
            ['a', 4],
            ['b', 4],
        ]);
    });

    it('keys a pedal correction by the pedal', () => {
        const result = deltas(
            [call({ scope: 'global', aspect: 'onset', change: 120, pedalIDs: ['p1'] })],
            'onset',
        );

        expect(result.get('p1')).toBe(120);
    });

    it('drops an event whose corrections cancel out, rather than marking it corrected by zero', () => {
        const result = deltas([
            call({ scope: 'global', aspect: 'velocity', change: 5, noteIDs: ['a'] }),
            call({ scope: 'global', aspect: 'velocity', change: -5, noteIDs: ['a'] }),
        ]);

        expect(result.has('a')).toBe(false);
    });
});

describe('what does not count', () => {
    it('another aspect', () => {
        const result = deltas([call({ scope: 'global', aspect: 'onset', change: 100, noteIDs: ['a'] })]);

        expect(result.size).toBe(0);
    });

    it('another call entirely', () => {
        const result = deltas([call({ scope: 'global', from: 0, to: 720 }, 'InsertDynamicsInstructions')]);

        expect(result.size).toBe(0);
    });

    it('a correction made on some other part', () => {
        const result = deltas([call({ scope: 1, aspect: 'velocity', change: -3, noteIDs: ['a'] })]);

        expect(result.size).toBe(0);
    });
});

it('holds a sent correction out until the fit answers it', () => {
    // In the chain and drawn on the plot at once. Counting both would put the ghost above the dot
    // when the correction moved it down.
    const pending = { scope: 'global' as const, aspect: 'velocity' as const, change: -3, noteIDs: ['a'] };
    const result = deltas(
        [call({ scope: 'global', aspect: 'velocity', change: -3, noteIDs: ['a'] })],
        'velocity',
        pending,
    );

    expect(result.has('a')).toBe(false);
});

it('still shows an earlier correction of the same note while a new one is in flight', () => {
    const pending = { scope: 'global' as const, aspect: 'velocity' as const, change: -3, noteIDs: ['a'] };
    const result = deltas(
        [
            call({ scope: 'global', aspect: 'velocity', change: -10, noteIDs: ['a'] }),
            call({ scope: 'global', aspect: 'velocity', change: -3, noteIDs: ['a'] }),
        ],
        'velocity',
        pending,
    );

    expect(result.get('a')).toBe(-10);
});

describe('an expansion', () => {
    // The alignment as the chain left it: 'a' recorded at 35, 'b' at 54, 'c' at 35 and then
    // lowered by hand. Expanded through [[35, 20], [54, 46]], 'a' sits at 20, 'b' at 46, and 'c'
    // at 20 - 6.
    const expanded = () =>
        new Alignment([
            { ...note('a', 0), velocity: 20 },
            { ...note('b', 720), velocity: 46 },
            { ...note('c', 1440), velocity: 14 },
        ]);
    const roll = { scope: 'global', aspect: 'velocity', points: [[35, 20], [54, 46]] };

    it('is undone back to what the roll recorded, the further the softer', () => {
        const result = deltas([call(roll, 'Expand')], 'velocity', undefined, undefined, expanded());

        expect(result.get('a')).toBeCloseTo(-15, 9);
        expect(result.get('b')).toBeCloseTo(-8, 9);
    });

    it('is undone after the corrections by hand, which ran after it', () => {
        const result = deltas(
            [call(roll, 'Expand'), call({ scope: 'global', aspect: 'velocity', change: -6, noteIDs: ['c'] })],
            'velocity',
            undefined,
            undefined,
            expanded(),
        );

        // 14 is 20 - 6, and 20 is where the roll's 35 went: 21 below what was recorded.
        expect(result.get('c')).toBeCloseTo(-21, 9);
    });

    it('reaches only what its selector names', () => {
        const result = deltas([call({ ...roll, noteIDs: ['a'] }, 'Expand')], 'velocity', undefined, undefined, expanded());

        expect([...result.keys()]).toEqual(['a']);
    });

    it('is left out while it is sent and not yet fitted', () => {
        const sent = call(roll, 'Expand');
        const result = deltas([sent], 'velocity', undefined, sent.id, expanded());

        expect(result.size).toBe(0);
    });

    it('leaves no ghost where its map has no way back', () => {
        const folded = { ...roll, points: [[35, 20], [45, 40], [54, 30]] };
        const result = deltas([call(folded, 'Expand')], 'velocity', undefined, undefined, expanded());

        expect(result.size).toBe(0);
    });

    it('of onsets is undone from the first note, as it was made', () => {
        // Twice as slow from the first note on: 'b' was at 720, 'c' at 1440, and 'a', the first,
        // stayed where it was.
        const slower = new Alignment([note('a', 0), { ...note('b', 720), 'milliseconds.date': 1440 }, {
            ...note('c', 1440),
            'milliseconds.date': 2880,
        }]);
        const result = deltas(
            [call({ scope: 'global', aspect: 'onset', points: [[0, 0], [1000, 2000]] }, 'Expand')],
            'onset',
            undefined,
            undefined,
            slower,
        );

        expect(result.has('a')).toBe(false);
        expect(result.get('b')).toBeCloseTo(720, 9);
        expect(result.get('c')).toBeCloseTo(1440, 9);
    });
});
