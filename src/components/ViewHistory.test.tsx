/**
 * The history entry the reader is on holds what is on screen, so Back and Forward can return to it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { act, useEffect, useState } from 'react';
import { createFakePiano } from '../test/fakePiano';
import { readNoteDates } from '../utils/score';
import { ZoomContext } from '../hooks/ZoomProvider';
import { PlaybackProvider } from '../hooks/PlaybackProvider';
import { CallSelectionProvider } from '../hooks/CallSelection';
import type { Scope } from '../fitting/instructions/index';
import type { Call } from '../model/Work';
import { ViewerAddress } from './ViewerAddress';
import { ViewHistory } from './ViewHistory';

let rig = createFakePiano();

vi.mock('react-pianosound', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-pianosound')>()),
    usePiano: () => rig.usePiano(),
}));

const scoreMsm = readFileSync('src/test/fixtures/score.msm', 'utf-8');
const performanceMpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8');
const dateByNoteId = readNoteDates(scoreMsm);

const calls: Call[] = [
    { id: '2aac2b1a-7be2-4182-8503-7cc3d7a03229', name: 'InsertTempo', options: {} },
    { id: '9f8b5d24-4423-431f-80dc-5178e79af043', name: 'Modify', options: {} },
];

let select: (ids: Set<string>) => void = () => {};
let open: (desk: string, scope: Scope) => void = () => {};

/** The two components as the viewer mounts them, with the desk, scope and selection as state. */
const Viewer = () => {
    const [activeCallIds, setActiveCallIds] = useState(new Set<string>());
    const [view, setView] = useState<{ desk: string; scope: Scope }>({ desk: 'tempo', scope: 'global' });
    useEffect(() => {
        select = setActiveCallIds;
        open = (desk, scope) => setView({ desk, scope });
    }, []);
    return (
        <ZoomContext
            value={{ symbolic: { stretchX: 20 }, physical: { stretchX: 20 }, setStretchX: () => {} }}
        >
            <PlaybackProvider
                scoreMsm={scoreMsm}
                performanceMpm={performanceMpm}
                dateByNoteId={dateByNoteId}
            >
                <CallSelectionProvider
                    calls={calls}
                    outcomes={[]}
                    activeCallIds={activeCallIds}
                    setActiveCallIds={setActiveCallIds}
                    onRemoveCalls={() => {}}
                    focusCall={() => {}}
                >
                    <ViewerAddress />
                    <ViewHistory desk={view.desk} scope={view.scope} />
                </CallSelectionProvider>
            </PlaybackProvider>
        </ZoomContext>
    );
};

describe('the view a history entry holds', () => {
    beforeEach(() => {
        rig = createFakePiano();
        window.history.replaceState(null, '', '/');
    });

    it('is the desk, the scope and the selection on screen, kept as they change', () => {
        render(<Viewer />);
        expect(window.history.state).toEqual({ desk: 'tempo', scope: 'global', calls: [] });

        act(() => open('markup', 1));
        act(() => select(new Set([calls[1].id])));
        expect(window.history.state).toEqual({ desk: 'markup', scope: 1, calls: [calls[1].id] });
    });

    it('is written into the entry the reader is on, adding none and leaving the address', () => {
        render(<Viewer />);
        const before = window.history.length;

        act(() => select(new Set([calls[0].id])));
        act(() => open('rubato', 'global'));

        expect(window.history.length).toBe(before);
        // The address is `ViewerAddress`'s, and what each of the two writes keeps the other's.
        expect(window.location.hash).toBe('#2aac2b1a');
        expect(window.history.state).toEqual({
            desk: 'rubato',
            scope: 'global',
            calls: [calls[0].id],
        });
    });
});
