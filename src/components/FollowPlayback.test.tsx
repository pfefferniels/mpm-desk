/**
 * The editor following the playhead: the calls whose instructions are sounding are the
 * selected ones — and a scoped preview, which the reader asked for, leaves the selection alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { act, useEffect, useState, type ReactNode } from 'react';
import { createFakePiano } from '../test/fakePiano';
import { readNoteDates } from '../utils/score';
import {
    instructionsEffectiveAtDate,
    instructionTypes,
    parseMPM,
} from '../fitting/instructions/index';
import { ZoomContext } from '../hooks/ZoomProvider';
import { PlaybackProvider, usePlayback } from '../hooks/PlaybackProvider';
import { CallSelectionProvider, useCallSelection } from '../hooks/CallSelection';
import { ScrollSyncProvider } from '../hooks/ScrollSyncProvider';
import { outcomesOf, type Reconstruction } from '../model/Reconstruction';
import type { Call } from '../model/Work';
import { FollowPlayback } from './FollowPlayback';

let rig = createFakePiano();

vi.mock('react-pianosound', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-pianosound')>()),
    usePiano: () => rig.usePiano(),
}));

const scoreMsm = readFileSync('src/test/fixtures/score.msm', 'utf-8');
const performanceMpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8');
const dateByNoteId = readNoteDates(scoreMsm);
const mpm = parseMPM(performanceMpm);
const { segments } = JSON.parse(
    readFileSync('src/test/fixtures/segments.json', 'utf-8'),
) as Reconstruction;

/** One call per span of the shipped reconstruction, answerable for that span's elements. */
const calls: Call[] = segments.flatMap((segment) =>
    segment.spans.map((span) => ({
        id: `call:${span.id}`,
        name: `Insert:${span.type}`,
        options: {},
        elements: [...span.elements],
        range: { from: span.from, to: span.to },
        segment: segment.id,
    })),
);
const outcomes = outcomesOf(calls);

/** The calls the follow ought to select at `date`, worked out the long way round. */
const callsSoundingAt = (date: number) => {
    const ids = new Set<string>();
    for (const type of instructionTypes) {
        for (const instruction of instructionsEffectiveAtDate(mpm, date, type)) {
            const owner = outcomes.find((outcome) => outcome.elements.includes(instruction.id!));
            if (owner) ids.add(owner.id);
        }
    }
    return [...ids].sort();
};

let play: ReturnType<typeof usePlayback>['play'] | null = null;
let lastDate: number | null = null;
let selected: Set<string> = new Set();

const Capture = () => {
    const { play: playNow, subscribeNoteEvents } = usePlayback();
    const { activeCallIds } = useCallSelection();
    useEffect(() => {
        selected = activeCallIds;
    }, [activeCallIds]);
    useEffect(() => {
        play = playNow;
    }, [playNow]);
    useEffect(
        () =>
            subscribeNoteEvents(({ date }) => {
                lastDate = date;
            }),
        [subscribeNoteEvents],
    );
    return null;
};

const Selection = ({ children }: { children: ReactNode }) => {
    const [activeCallIds, setActiveCallIds] = useState<Set<string>>(new Set());
    return (
        <CallSelectionProvider
            calls={calls}
            outcomes={outcomes}
            activeCallIds={activeCallIds}
            setActiveCallIds={setActiveCallIds}
            onRemoveCalls={() => {}}
            focusCall={() => {}}
        >
            {children}
        </CallSelectionProvider>
    );
};

const mount = async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <ZoomContext
                value={{
                    symbolic: { stretchX: 20 },
                    physical: { stretchX: 20 },
                    setStretchX: () => {},
                }}
            >
                <PlaybackProvider
                    scoreMsm={scoreMsm}
                    performanceMpm={performanceMpm}
                    dateByNoteId={dateByNoteId}
                >
                    <Selection>
                        <ScrollSyncProvider symbolicZoom={20}>
                            <FollowPlayback mpm={mpm} beatDenominator={4} />
                            <Capture />
                        </ScrollSyncProvider>
                    </Selection>
                </PlaybackProvider>
            </ZoomContext>,
        );
    });
    return async () => {
        await act(async () => root.unmount());
        container.remove();
    };
};

describe('following the playhead in the editor', () => {
    beforeEach(() => {
        rig = createFakePiano();
        play = null;
        lastDate = null;
        selected = new Set();
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('selects the calls whose instructions are in effect, and moves with the playhead', async () => {
        const unmount = await mount();
        expect(selected.size).toBe(0);

        act(() => {
            play!({ exaggerate: 1 });
        });
        act(() => {
            rig.transport.advanceTo(10);
        });
        expect(lastDate).not.toBeNull();
        const first = callsSoundingAt(lastDate!);
        expect(first.length).toBeGreaterThan(0);
        expect([...selected].sort()).toEqual(first);

        act(() => {
            rig.transport.advanceTo(60);
        });
        const later = callsSoundingAt(lastDate!);
        expect(later).not.toEqual(first);
        expect([...selected].sort()).toEqual(later);

        await unmount();
    });

    it('leaves the selection alone during a scoped preview', async () => {
        const unmount = await mount();

        act(() => {
            play!({ exaggerate: 1 });
        });
        act(() => {
            rig.transport.advanceTo(10);
        });
        const before = [...selected].sort();
        expect(before.length).toBeGreaterThan(0);

        // A preview of particular instructions — what a chip or a word plays.
        act(() => {
            play!({ mpmIds: calls[0].elements!, isolate: true });
        });
        act(() => {
            rig.transport.advanceTo(60);
        });
        expect([...selected].sort()).toEqual(before);

        await unmount();
    });
});
