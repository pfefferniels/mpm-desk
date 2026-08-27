import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import type { Call } from '../../model/Work';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { useModifyDeltas } from './useModifyDeltas';

/**
 * The ghosts: which events the chain has already corrected, and by how much.
 *
 * The arithmetic used to be a `useMemo` inside the dynamics desk, and two desks read it now — the
 * corrections desk while it has a call in flight, the dynamics desk with nothing in flight ever.
 * What it must not do is count a call twice: a correction that has been sent but not yet answered
 * by a fit is in the chain *and* drawn optimistically on the plot, so the ghost would be on the
 * wrong side of the dot until the fit came back.
 */

const note = (id: string, date: number): AlignedNote => ({
    'xml:id': id,
    part: 1,
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
    pending?: Parameters<typeof useModifyDeltas>[3],
) =>
    renderHook(() => useModifyDeltas(msm, 'global', aspect, pending), {
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
