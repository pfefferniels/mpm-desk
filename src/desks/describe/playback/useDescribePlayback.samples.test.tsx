/**
 * The first press of a visit, through the Desk's own door to the piano: nothing has been sent for
 * yet, so the press is what sends for the samples, and it plays once they are here.
 *
 * `performance/piano` is the real one. Its state is the module's, which is why this is a file and
 * a test of its own.
 */
import { act, renderHook } from '@testing-library/react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PianoProvider } from '../../../performance/PianoProvider';
import { createFakePiano } from '../../../test/fakePiano';
import { aRun, places } from './fixture';
import { useDescribePlayback } from './index';

const rig = createFakePiano();
let status: 'loading' | 'done' = 'loading';
const statusListeners = new Set<() => void>();

vi.mock('react-pianosound', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-pianosound')>()),
    PianoContextProvider: ({ children }: { children: ReactNode }) => children,
    usePiano: () => ({
        ...rig.usePiano(),
        status: useSyncExternalStore(
            (listener) => {
                statusListeners.add(listener);
                return () => {
                    statusListeners.delete(listener);
                };
            },
            () => status,
        ),
    }),
}));

const client = {
    describe: () => new Promise<never>(() => undefined),
    bringOut: () => new Promise<never>(() => undefined),
    dispose: () => undefined,
};

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

it('sends for the samples, waits for them, and plays on the piano that comes', () => {
    const run = aRun();
    const { result } = renderHook(() => useDescribePlayback({ run, places: places(), client }), {
        wrapper: PianoProvider,
    });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ playing: false, pending: true });
    expect(rig.played).toHaveLength(0);

    act(() => {
        status = 'done';
        statusListeners.forEach((listener) => listener());
    });
    expect(result.current).toMatchObject({ playing: true, pending: false });
    expect(rig.played).toHaveLength(1);

    // The piano is the transport's own from then on: it is followed, and stopped.
    act(() => {
        rig.transport.advanceTo(1);
        vi.advanceTimersByTime(20);
    });
    expect(result.current.playing).toBe(true);
    expect(result.current.line.read()).toBe(900);
    act(() => result.current.toggle());
    expect(rig.transport.state).toBe('stopped');
});
