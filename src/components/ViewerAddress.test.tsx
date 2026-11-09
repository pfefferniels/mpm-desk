/**
 * The viewer's URL names the call selected, so copying it cites what is on screen.
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
import type { Call } from '../model/Work';
import { ViewerAddress } from './ViewerAddress';

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
    { id: '9f8b5d24-aaaa-431f-80dc-5178e79af043', name: 'Modify', options: {} },
];

let select: (ids: Set<string>) => void = () => {};

const Viewer = () => {
    const [activeCallIds, setActiveCallIds] = useState(new Set<string>());
    useEffect(() => {
        select = setActiveCallIds;
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
                </CallSelectionProvider>
            </PlaybackProvider>
        </ZoomContext>
    );
};

describe('the viewer’s address', () => {
    beforeEach(() => {
        rig = createFakePiano();
        window.history.replaceState(null, '', '/');
    });

    it('names the one call selected, as short as names it alone', () => {
        render(<Viewer />);
        const before = window.history.length;

        act(() => select(new Set([calls[0].id])));
        expect(window.location.hash).toBe('#2aac2b1a');

        act(() => select(new Set([calls[1].id])));
        expect(window.location.hash).toBe('#9f8b5d24-4');

        // Replaced, not pushed: a click on a curve is not a place to go back to.
        expect(window.history.length).toBe(before);
    });

    it('names nothing where nothing, or several, are selected', () => {
        render(<Viewer />);
        act(() => select(new Set([calls[0].id])));
        act(() => select(new Set([calls[0].id, calls[1].id])));
        expect(window.location.hash).toBe('');
    });
});
